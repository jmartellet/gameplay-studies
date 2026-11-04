import { Router, type NextFunction, type Request, type Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import type { Config } from './config.js';
import { currentUser, enabledProviders, isAdmin } from './auth.js';
import { AppError, GAME_STATUSES, RANKING_CHANGED, type GameStatus, type RequestService } from './service.js';
import { SteamError } from './steam.js';

export function apiRouter(deps: { config: Config; service: RequestService }): Router {
  const { config, service } = deps;
  const router = Router();

  const steamLimiter = rateLimit({ windowMs: 60_000, limit: 40, standardHeaders: 'draft-8', legacyHeaders: false });
  const voteLimiter = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false });

  /**
   * Proteção simples contra CSRF: requisições que alteram dados precisam de
   * Content-Type: application/json. Um formulário de outro site não consegue enviar
   * esse header sem passar por CORS (que não liberamos), e o cookie é SameSite=Lax.
   */
  router.use((req, _res, next) => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      const type = req.get('content-type') ?? '';
      if (!type.toLowerCase().startsWith('application/json')) {
        return next(new AppError('json_required', 'Envie Content-Type: application/json', 415));
      }
    }
    next();
  });

  const requireUser = (req: Request) => {
    const user = currentUser(req, service);
    if (!user) throw new AppError('login_required', 'Entre com Twitch ou Discord para votar', 401);
    return user;
  };

  // ---------- sessão

  router.get('/me', (req, res) => {
    const user = currentUser(req, service);
    res.json({
      user,
      isAdmin: isAdmin(user, config),
      providers: enabledProviders(config),
      bots: { twitch: config.twitch.bot?.channel ?? null, discord: config.discord.bot !== null },
    });
  });

  // ---------- Steam

  router.get('/steam/search', steamLimiter, async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.slice(0, 80) : '';
    const results = await service.searchSteam(q, 10);
    // Marca o que já está na fila para o front mostrar "Votar" em vez de "Pedir".
    const user = currentUser(req, service);
    res.json({
      results: results.map((r) => {
        const game = service.getGame(r.appid, user?.id);
        return { ...r, inQueue: Boolean(game), status: game?.status ?? null, votes: game?.votes ?? 0, hasVoted: game?.hasVoted ?? false };
      }),
    });
  });

  router.get('/steam/app/:appid', steamLimiter, async (req, res) => {
    const user = currentUser(req, service);
    res.json({ game: await service.previewGame(parseAppid(req.params.appid), user?.id) });
  });

  // ---------- fila / ranking

  router.get('/games', (req, res) => {
    const status = parseStatus(req.query.status) ?? 'pendente';
    const limit = Number(req.query.limit) || 100;
    const user = currentUser(req, service);
    res.json({ games: service.listGames({ status, userId: user?.id, limit }) });
  });

  router.get('/games/:appid', (req, res) => {
    const user = currentUser(req, service);
    const game = service.getGame(parseAppid(req.params.appid), user?.id);
    if (!game) throw new AppError('not_in_queue', 'Esse jogo ainda não foi pedido', 404);
    res.json({ game });
  });

  /** Pedir e votar são a mesma ação: se o jogo não está na fila, entra; e o voto é registrado. */
  router.post('/games/:appid/vote', voteLimiter, async (req, res) => {
    const user = requireUser(req);
    const result = await service.requestAndVote(parseAppid(req.params.appid), user.id, 'web');
    res.status(result.created ? 201 : 200).json({ ...result, alreadyVoted: !result.newVote });
  });

  router.delete('/games/:appid/vote', voteLimiter, (req, res) => {
    const user = requireUser(req);
    const appid = parseAppid(req.params.appid);
    const removed = service.unvote(appid, user.id);
    res.json({ removed, game: service.getGame(appid, user.id) });
  });

  router.patch('/games/:appid', (req, res) => {
    const user = requireUser(req);
    if (!isAdmin(user, config)) throw new AppError('forbidden', 'Só o streamer pode alterar o status', 403);
    const status = parseStatus((req.body as { status?: unknown } | undefined)?.status);
    if (!status) throw new AppError('invalid_status', `Status deve ser: ${GAME_STATUSES.join(', ')}`);
    res.json({ game: service.setStatus(parseAppid(req.params.appid), status) });
  });

  // ---------- tempo real (Server-Sent Events) para o site e o overlay do OBS

  router.get('/stream', (req, res) => {
    res.set({
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    res.flushHeaders();
    res.write('retry: 5000\n\n');

    const onChange = (payload: { status: GameStatus }) => {
      res.write(`event: ranking\ndata: ${JSON.stringify(payload)}\n\n`);
    };
    service.events.on(RANKING_CHANGED, onChange);
    const heartbeat = setInterval(() => res.write(': ping\n\n'), 25_000);

    req.on('close', () => {
      clearInterval(heartbeat);
      service.events.off(RANKING_CHANGED, onChange);
    });
  });

  router.use((_req, _res, next) => next(new AppError('not_found', 'Rota não encontrada', 404)));

  return router;
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message } });
    return;
  }
  if (err instanceof SteamError && err.notFound) {
    res.status(404).json({ error: { code: 'steam_not_found', message: 'Jogo não encontrado na Steam' } });
    return;
  }
  if (err instanceof SteamError) {
    res.status(502).json({ error: { code: 'steam_unavailable', message: 'A Steam não respondeu. Tente de novo em instantes.' } });
    return;
  }
  const status = (err as { status?: number })?.status;
  if (status && status >= 400 && status < 500) {
    res.status(status).json({ error: { code: 'bad_request', message: (err as Error).message } });
    return;
  }
  console.error('[erro]', err);
  res.status(500).json({ error: { code: 'internal', message: 'Erro interno' } });
}

function parseAppid(value: unknown): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new AppError('invalid_appid', 'AppID inválido');
  return n;
}

function parseStatus(value: unknown): GameStatus | null {
  return typeof value === 'string' && (GAME_STATUSES as readonly string[]).includes(value) ? (value as GameStatus) : null;
}
