import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { createApp } from '../src/server.js';
import type { FetchLike } from '../src/steam.js';
import { setup } from './helpers.js';

const config = loadConfig({
  NODE_ENV: 'test',
  BASE_URL: 'http://localhost:3000',
  SESSION_SECRET: 'segredo-de-teste-com-tamanho',
  TWITCH_CLIENT_ID: 'twitch-id',
  TWITCH_CLIENT_SECRET: 'twitch-secret',
  DISCORD_CLIENT_ID: 'discord-id',
  DISCORD_CLIENT_SECRET: 'discord-secret',
  ADMIN_TWITCH_LOGINS: 'streamer',
});

/** Simula as APIs da Twitch/Discord durante o OAuth. */
const oauthFetch: FetchLike = async (url, init) => {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  if (url.includes('/oauth2/token')) {
    const code = new URLSearchParams(String(init?.body)).get('code');
    return code === 'invalido' ? json({ message: 'invalid code' }, 400) : json({ access_token: `token-${code}` });
  }
  if (url.startsWith('https://api.twitch.tv/helix/users')) {
    const token = new Headers(init?.headers).get('authorization')!.replace('Bearer token-', '');
    return json({ data: [{ id: `id-${token}`, login: token, display_name: token.toUpperCase(), profile_image_url: null }] });
  }
  if (url.startsWith('https://discord.com/api/users/@me')) {
    return json({ id: '42', username: 'dev', global_name: 'Dev', avatar: 'abc' });
  }
  return json({}, 404);
};

function makeApp() {
  const ctx = setup();
  const app = createApp({ config, service: ctx.service, fetch: oauthFetch });
  return { ...ctx, app };
}

/** Faz o fluxo OAuth completo e devolve um "agente" com o cookie de sessão. */
async function login(app: ReturnType<typeof makeApp>['app'], provider: 'twitch' | 'discord', code: string) {
  const agent = request.agent(app);
  const start = await agent.get(`/auth/${provider}?returnTo=/?jogo=20`).expect(302);
  const state = new URL(start.headers.location!).searchParams.get('state');
  const cb = await agent.get(`/auth/${provider}/callback?code=${code}&state=${state}`).expect(302);
  expect(cb.headers.location).toBe('/?jogo=20');
  return agent;
}

describe('API HTTP', () => {
  it('lista a fila sem login e informa os provedores disponíveis', async () => {
    const { app } = makeApp();
    await request(app).get('/api/games').expect(200, { games: [] });
    const me = await request(app).get('/api/me').expect(200);
    expect(me.body).toMatchObject({ user: null, isAdmin: false, providers: ['twitch', 'discord'] });
  });

  it('exige login para votar', async () => {
    const { app } = makeApp();
    const res = await request(app).post('/api/games/20/vote').set('content-type', 'application/json').send({}).expect(401);
    expect(res.body.error.code).toBe('login_required');
  });

  it('login com Twitch → vota → voto duplicado é bloqueado', async () => {
    const { app } = makeApp();
    const agent = await login(app, 'twitch', 'ana');

    const me = await agent.get('/api/me').expect(200);
    expect(me.body.user).toMatchObject({ provider: 'twitch', username: 'ana', displayName: 'ANA' });

    const first = await agent.post('/api/games/20/vote').set('content-type', 'application/json').send({}).expect(201);
    expect(first.body).toMatchObject({ created: true, newVote: true, alreadyVoted: false, game: { votes: 1, hasVoted: true } });

    const second = await agent.post('/api/games/20/vote').set('content-type', 'application/json').send({}).expect(200);
    expect(second.body).toMatchObject({ created: false, alreadyVoted: true, game: { votes: 1 } });

    const removed = await agent.delete('/api/games/20/vote').set('content-type', 'application/json').expect(200);
    expect(removed.body).toMatchObject({ removed: true, game: { votes: 0, hasVoted: false } });
  });

  it('login com Discord também funciona e conta como outra pessoa', async () => {
    const { app } = makeApp();
    const ana = await login(app, 'twitch', 'ana');
    const dev = await login(app, 'discord', 'qualquer');

    await ana.post('/api/games/20/vote').set('content-type', 'application/json').send({}).expect(201);
    const res = await dev.post('/api/games/20/vote').set('content-type', 'application/json').send({}).expect(200);
    expect(res.body.game.votes).toBe(2);
  });

  it('rejeita callback com state inválido (proteção CSRF do OAuth)', async () => {
    const { app } = makeApp();
    const agent = request.agent(app);
    await agent.get('/auth/twitch').expect(302);
    const res = await agent.get('/auth/twitch/callback?code=ana&state=forjado').expect(400);
    expect(res.body.error.code).toBe('oauth_state');
  });

  it('não permite open redirect no returnTo', async () => {
    const { app } = makeApp();
    const agent = request.agent(app);
    const start = await agent.get('/auth/twitch?returnTo=//site-malicioso.com').expect(302);
    const state = new URL(start.headers.location!).searchParams.get('state');
    const cb = await agent.get(`/auth/twitch/callback?code=ana&state=${state}`).expect(302);
    expect(cb.headers.location).toBe('/');
  });

  it('exige JSON em requisições que alteram dados', async () => {
    const { app } = makeApp();
    const agent = await login(app, 'twitch', 'ana');
    await agent.post('/api/games/20/vote').type('form').send('x=1').expect(415);
  });

  it('só o streamer altera status', async () => {
    const { app } = makeApp();
    const ana = await login(app, 'twitch', 'ana');
    const streamer = await login(app, 'twitch', 'streamer');
    await ana.post('/api/games/20/vote').set('content-type', 'application/json').send({}).expect(201);

    await ana.patch('/api/games/20').send({ status: 'jogado' }).expect(403);
    await streamer.patch('/api/games/20').send({ status: 'invalido' }).expect(400);
    const ok = await streamer.patch('/api/games/20').send({ status: 'jogado' }).expect(200);
    expect(ok.body.game.status).toBe('jogado');

    const queue = await request(app).get('/api/games').expect(200);
    expect(queue.body.games).toHaveLength(0);
    const played = await request(app).get('/api/games?status=jogado').expect(200);
    expect(played.body.games[0].name).toBe('Hades');
  });

  it('busca na Steam marca o que já está na fila', async () => {
    const { app } = makeApp();
    const ana = await login(app, 'twitch', 'ana');
    await ana.post('/api/games/20/vote').set('content-type', 'application/json').send({}).expect(201);

    const res = await ana.get('/api/steam/search?q=hades').expect(200);
    expect(res.body.results).toEqual([
      expect.objectContaining({ appid: 20, name: 'Hades', inQueue: true, votes: 1, hasVoted: true, status: 'pendente' }),
    ]);
  });

  it('prévia de jogo fora da fila vem da Steam; AppID inválido dá 400', async () => {
    const { app } = makeApp();
    const res = await request(app).get('/api/steam/app/30').expect(200);
    expect(res.body.game).toMatchObject({ name: 'Balatro', inQueue: false });
    await request(app).get('/api/steam/app/abc').expect(400);
    await request(app).get('/api/steam/app/999').expect(404);
  });

  it('serve o front-end e o overlay', async () => {
    const { app } = makeApp();
    const page = await request(app).get('/').expect(200);
    expect(page.text).toContain('Qual jogo você quer ver na stream?');
    await request(app).get('/overlay').expect(200);
  });
});
