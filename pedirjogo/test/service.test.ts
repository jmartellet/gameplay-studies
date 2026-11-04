import { describe, expect, it, vi } from 'vitest';
import { AppError, RANKING_CHANGED } from '../src/service.js';
import { setup } from './helpers.js';

describe('RequestService', () => {
  it('pedir um jogo coloca na fila com o voto de quem pediu', async () => {
    const { service, user } = setup();
    const ana = user('ana');

    const result = await service.requestAndVote(20, ana.id, 'web');

    expect(result.created).toBe(true);
    expect(result.newVote).toBe(true);
    expect(result.game).toMatchObject({ appid: 20, name: 'Hades', votes: 1, position: 1, hasVoted: true, requestedBy: 'ana' });
    expect(result.game.steam.reviewPercent).toBe(90);
  });

  it('bloqueia voto duplicado da mesma pessoa', async () => {
    const { service, user } = setup();
    const ana = user('ana');

    await service.requestAndVote(20, ana.id, 'web');
    const again = await service.requestAndVote(20, ana.id, 'twitch');

    expect(again.created).toBe(false);
    expect(again.newVote).toBe(false);
    expect(again.game.votes).toBe(1);
    expect(service.vote(20, ana.id, 'discord')).toBe(false);
  });

  it('o banco garante o bloqueio mesmo sem passar pelo serviço', async () => {
    const { db, service, user } = setup();
    const ana = user('ana');
    await service.requestAndVote(20, ana.id, 'web');

    expect(() =>
      db.prepare('INSERT INTO votes (game_appid, user_id, source, created_at) VALUES (20, ?, ?, 0)').run(ana.id, 'web'),
    ).toThrow(/UNIQUE|PRIMARY KEY/);
  });

  it('a mesma conta votando pelo site e pelo chat é a mesma pessoa', async () => {
    const { service } = setup();
    const viaSite = service.upsertUser({ provider: 'twitch', providerId: '123', username: 'ana', displayName: 'Ana' });
    const viaChat = service.upsertUser({ provider: 'twitch', providerId: '123', username: 'ana', displayName: 'AnaGamer' });

    expect(viaChat.id).toBe(viaSite.id);
    expect(viaChat.displayName).toBe('AnaGamer');
  });

  it('ordena por votos e, no empate, por quem foi pedido primeiro', async () => {
    const { service, user } = setup();
    const [a, b, c] = [user('a'), user('b'), user('c')];

    await service.requestAndVote(10, a.id, 'web'); // CS: 1 voto, pedido primeiro
    await service.requestAndVote(20, a.id, 'web'); // Hades: 3 votos
    await service.requestAndVote(20, b.id, 'web');
    await service.requestAndVote(20, c.id, 'web');
    await service.requestAndVote(30, b.id, 'web'); // Balatro: 1 voto, pedido depois

    const ranking = service.listGames({ userId: b.id });
    expect(ranking.map((g) => [g.name, g.votes, g.position])).toEqual([
      ['Hades', 3, 1],
      ['Counter-Strike', 1, 2],
      ['Balatro', 1, 3],
    ]);
    expect(ranking.map((g) => g.hasVoted)).toEqual([true, false, true]);
  });

  it('remove voto e reflete no ranking', async () => {
    const { service, user } = setup();
    const ana = user('ana');
    await service.requestAndVote(20, ana.id, 'web');

    expect(service.unvote(20, ana.id)).toBe(true);
    expect(service.unvote(20, ana.id)).toBe(false);
    expect(service.getGame(20)?.votes).toBe(0);
  });

  it('não aceita votos em jogos já jogados ou recusados', async () => {
    const { service, user } = setup();
    const [ana, bia] = [user('ana'), user('bia')];
    await service.requestAndVote(20, ana.id, 'web');
    service.setStatus(20, 'jogado');

    await expect(service.requestAndVote(20, bia.id, 'web')).rejects.toMatchObject({ code: 'closed', status: 409 });
    expect(() => service.unvote(20, ana.id)).toThrow(AppError);
    expect(service.listGames({ status: 'pendente' })).toHaveLength(0);
    expect(service.listGames({ status: 'jogado' })[0]?.name).toBe('Hades');
  });

  it('retorna 404 amigável para AppID que não existe na Steam', async () => {
    const { service, user } = setup();
    await expect(service.requestAndVote(999, user('ana').id, 'web')).rejects.toMatchObject({
      code: 'steam_not_found',
      status: 404,
    });
  });

  it('pedidos simultâneos do mesmo jogo fazem uma única chamada à Steam', async () => {
    const { service, steam, user } = setup();
    const users = ['a', 'b', 'c', 'd', 'e'].map((n) => user(n));

    const results = await Promise.all(users.map((u) => service.requestAndVote(30, u.id, 'twitch')));

    expect(steam.calls.getGame).toBe(1);
    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(service.getGame(30)?.votes).toBe(5);
  });

  it('usa o cache do banco e só volta à Steam quando os dados ficam velhos', async () => {
    let now = 1_000_000;
    const { service, steam, user } = setup({ now: () => now });
    const ana = user('ana');

    await service.requestAndVote(20, ana.id, 'web');
    await service.ensureGame(20);
    expect(steam.calls.getGame).toBe(1);

    steam.catalog[20] = { ...steam.catalog[20]!, currentPlayers: 99_999 };
    now += 7 * 60 * 60_000; // 7h depois
    expect(await service.refreshStale()).toBe(1);
    expect(steam.calls.getGame).toBe(2);
    expect(service.getGame(20)?.steam.currentPlayers).toBe(99_999);
  });

  it('mantém dados antigos se a Steam cair na hora de atualizar', async () => {
    let now = 1_000_000;
    const { service, steam, user } = setup({ now: () => now });
    await service.requestAndVote(20, user('ana').id, 'web');

    now += 7 * 60 * 60_000;
    steam.failNext = true;
    await expect(service.ensureGame(20)).resolves.toBeUndefined();
    expect(service.getGame(20)?.name).toBe('Hades');
  });

  it('entende nome, AppID e link da Steam', async () => {
    const { service } = setup();
    expect(await service.resolveAppId('hades')).toBe(20);
    expect(await service.resolveAppId('1145360')).toBe(1145360);
    expect(await service.resolveAppId('https://store.steampowered.com/app/1145360/Hades/')).toBe(1145360);
    expect(await service.resolveAppId('jogo que não existe')).toBeNull();
    expect(await service.resolveAppId('   ')).toBeNull();
  });

  it('avisa quando o ranking muda (para o tempo real)', async () => {
    const { service, user } = setup();
    const listener = vi.fn();
    service.events.on(RANKING_CHANGED, listener);

    await service.requestAndVote(20, user('ana').id, 'web');
    service.setStatus(20, 'jogado');

    expect(listener).toHaveBeenCalledWith({ status: 'pendente' });
    expect(listener).toHaveBeenCalledWith({ status: 'jogado' });
  });
});
