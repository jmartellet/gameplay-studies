import { randomBytes } from 'node:crypto';
import { Router, type Request } from 'express';
import type { Config } from './config.js';
import { AppError, type Provider, type RequestService, type User, type UserInput } from './service.js';
import type { FetchLike } from './steam.js';

/**
 * Login com Twitch e Discord via OAuth2 "authorization code" — implementado à mão
 * (sem Passport) para ficar claro o que acontece em cada etapa:
 *
 *  1. /auth/:provider          → gera um `state` aleatório, guarda na sessão e redireciona
 *  2. provedor                 → usuário autoriza e volta com ?code=...&state=...
 *  3. /auth/:provider/callback → confere o state (proteção CSRF), troca o code por token,
 *                                busca o perfil e grava o usuário na sessão
 */

interface ProviderDef {
  authorizeUrl: string;
  tokenUrl: string;
  scope: string;
  fetchProfile(accessToken: string, clientId: string, fetchFn: FetchLike): Promise<UserInput>;
}

const PROVIDERS: Record<Provider, ProviderDef> = {
  twitch: {
    authorizeUrl: 'https://id.twitch.tv/oauth2/authorize',
    tokenUrl: 'https://id.twitch.tv/oauth2/token',
    scope: '',
    async fetchProfile(token, clientId, fetchFn) {
      const res = await fetchFn('https://api.twitch.tv/helix/users', {
        headers: { authorization: `Bearer ${token}`, 'client-id': clientId },
      });
      if (!res.ok) throw new AppError('oauth_profile', 'Não foi possível ler o perfil da Twitch', 502);
      const body = (await res.json()) as {
        data?: { id: string; login: string; display_name: string; profile_image_url?: string }[];
      };
      const u = body.data?.[0];
      if (!u) throw new AppError('oauth_profile', 'Perfil da Twitch vazio', 502);
      return {
        provider: 'twitch',
        providerId: u.id,
        username: u.login,
        displayName: u.display_name,
        avatarUrl: u.profile_image_url ?? null,
      };
    },
  },
  discord: {
    authorizeUrl: 'https://discord.com/oauth2/authorize',
    tokenUrl: 'https://discord.com/api/oauth2/token',
    scope: 'identify',
    async fetchProfile(token, _clientId, fetchFn) {
      const res = await fetchFn('https://discord.com/api/users/@me', {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new AppError('oauth_profile', 'Não foi possível ler o perfil do Discord', 502);
      const u = (await res.json()) as { id: string; username: string; global_name?: string | null; avatar?: string | null };
      return {
        provider: 'discord',
        providerId: u.id,
        username: u.username,
        displayName: u.global_name ?? u.username,
        avatarUrl: u.avatar ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=64` : null,
      };
    },
  },
};

interface SessionData {
  userId?: number;
  oauthState?: string;
  oauthProvider?: Provider;
  returnTo?: string;
}

export function session(req: Request): SessionData {
  return (req.session ?? {}) as SessionData;
}

export function enabledProviders(config: Config): Provider[] {
  return (['twitch', 'discord'] as const).filter((p) => config[p].oauth !== null);
}

export function isAdmin(user: User | null, config: Config): boolean {
  if (!user) return false;
  if (user.provider === 'twitch') return config.admins.twitchLogins.includes(user.username.toLowerCase());
  return config.admins.discordIds.includes(user.providerId);
}

export function currentUser(req: Request, service: RequestService): User | null {
  const id = session(req).userId;
  return typeof id === 'number' ? service.getUser(id) : null;
}

export function authRouter(deps: { config: Config; service: RequestService; fetch?: FetchLike }): Router {
  const { config, service } = deps;
  const fetchFn: FetchLike = deps.fetch ?? ((input, init) => fetch(input, init));
  const router = Router();

  const credentialsFor = (value: unknown) => {
    if (value !== 'twitch' && value !== 'discord') return null;
    const provider: Provider = value;
    const creds = config[provider].oauth;
    return creds ? { provider, def: PROVIDERS[provider], ...creds } : null;
  };

  const redirectUri = (provider: Provider) => `${config.baseUrl}/auth/${provider}/callback`;

  router.get('/auth/:provider', (req, res) => {
    const p = credentialsFor(req.params.provider);
    if (!p) throw new AppError('provider_disabled', 'Login por esse provedor não está configurado', 404);

    const state = randomBytes(16).toString('hex');
    const s = session(req);
    s.oauthState = state;
    s.oauthProvider = p.provider;
    s.returnTo = safeReturnTo(req.query.returnTo);

    const url = new URL(p.def.authorizeUrl);
    url.searchParams.set('client_id', p.clientId);
    url.searchParams.set('redirect_uri', redirectUri(p.provider));
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', p.def.scope);
    url.searchParams.set('state', state);
    res.redirect(url.toString());
  });

  router.get('/auth/:provider/callback', async (req, res) => {
    const p = credentialsFor(req.params.provider);
    if (!p) throw new AppError('provider_disabled', 'Login por esse provedor não está configurado', 404);

    const s = session(req);
    const { code, state, error } = req.query;
    const expectedState = s.oauthState;
    const returnTo = s.returnTo ?? '/';
    delete s.oauthState;
    delete s.oauthProvider;
    delete s.returnTo;

    if (error) return res.redirect(withParam(returnTo, 'login', 'cancelado'));
    if (typeof code !== 'string' || typeof state !== 'string' || !expectedState || state !== expectedState) {
      throw new AppError('oauth_state', 'Sessão de login inválida ou expirada. Tente entrar de novo.', 400);
    }

    const tokenRes = await fetchFn(p.def.tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({
        client_id: p.clientId,
        client_secret: p.clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri(p.provider),
      }),
    });
    if (!tokenRes.ok) throw new AppError('oauth_token', 'O provedor recusou o login', 502);
    const { access_token: accessToken } = (await tokenRes.json()) as { access_token?: string };
    if (!accessToken) throw new AppError('oauth_token', 'O provedor não devolveu token', 502);

    // Só usamos o token para descobrir quem é a pessoa; ele não é guardado.
    const profile = await p.def.fetchProfile(accessToken, p.clientId, fetchFn);
    const user = service.upsertUser(profile);
    s.userId = user.id;
    res.redirect(returnTo);
  });

  router.post('/auth/logout', (req, res) => {
    req.session = null;
    res.status(204).end();
  });

  return router;
}

/** Evita "open redirect": só aceita caminhos internos como /?jogo=123. */
function safeReturnTo(value: unknown): string {
  if (typeof value !== 'string') return '/';
  return value.startsWith('/') && !value.startsWith('//') && !value.includes('\\') ? value : '/';
}

function withParam(path: string, key: string, value: string): string {
  const url = new URL(path, 'http://x');
  url.searchParams.set(key, value);
  return url.pathname + url.search;
}
