import { describe, expect, it } from 'vitest';
import { SteamClient, SteamError, type FetchLike } from '../src/steam.js';

/** fetch falso que responde de acordo com um trecho da URL. */
function fakeFetch(routes: Record<string, unknown | ((url: string) => unknown)>) {
  const calls: string[] = [];
  const fn: FetchLike = async (url) => {
    calls.push(url);
    const key = Object.keys(routes).find((k) => url.includes(k));
    if (!key) return new Response('not found', { status: 404 });
    const value = routes[key];
    const body = typeof value === 'function' ? (value as (u: string) => unknown)(url) : value;
    if (body instanceof Response) return body;
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { fn, calls };
}

const HADES_DETAILS = {
  '1145360': {
    success: true,
    data: {
      type: 'game',
      name: 'Hades',
      is_free: false,
      header_image: 'https://cdn/hades.jpg',
      short_description: 'Desafie o deus dos mortos &amp; escape do Submundo.',
      genres: [{ id: '1', description: 'Ação' }, { id: '25', description: 'Aventura' }],
      price_overview: { final_formatted: 'R$ 47,49' },
    },
  },
};

describe('SteamClient', () => {
  it('busca jogos e ignora pacotes/bundles', async () => {
    const { fn, calls } = fakeFetch({
      '/api/storesearch/': {
        total: 3,
        items: [
          { type: 'app', id: 1145360, name: 'Hades', tiny_image: 'https://cdn/h.jpg', price: { currency: 'BRL', initial: 4749, final: 4749 } },
          { type: 'sub', id: 999, name: 'Hades + Trilha Sonora' },
          { type: 'app', id: 1145350, name: 'Hades II' },
        ],
      },
    });
    const steam = new SteamClient({ fetch: fn });

    const results = await steam.search('hades');

    expect(results.map((r) => r.appid)).toEqual([1145360, 1145350]);
    expect(results[0]?.priceText).toMatch(/R\$\s?47,49/);
    expect(results[1]?.priceText).toBeNull();
    expect(calls[0]).toContain('term=hades');
    expect(calls[0]).toContain('cc=BR');
  });

  it('não chama a Steam para termos curtos e usa cache em buscas repetidas', async () => {
    const { fn, calls } = fakeFetch({ '/api/storesearch/': { items: [] } });
    const steam = new SteamClient({ fetch: fn });

    expect(await steam.search('h')).toEqual([]);
    await steam.search('Hades');
    await steam.search('  hades ');
    expect(calls).toHaveLength(1);
  });

  it('junta detalhes, avaliações, jogadores agora e posição no top 100', async () => {
    const { fn } = fakeFetch({
      '/api/appdetails': HADES_DETAILS,
      '/appreviews/1145360': { success: 1, query_summary: { review_score_desc: 'Extremamente positivas', total_positive: 980, total_reviews: 1000 } },
      GetNumberOfCurrentPlayers: { response: { player_count: 4321, result: 1 } },
      GetMostPlayedGames: { response: { ranks: [{ rank: 1, appid: 730 }, { rank: 42, appid: 1145360 }] } },
    });
    const steam = new SteamClient({ fetch: fn });

    expect(await steam.getGame(1145360)).toEqual({
      appid: 1145360,
      name: 'Hades',
      headerImage: 'https://cdn/hades.jpg',
      shortDescription: 'Desafie o deus dos mortos & escape do Submundo.',
      genres: ['Ação', 'Aventura'],
      priceText: 'R$ 47,49',
      isFree: false,
      reviewScoreDesc: 'Extremamente positivas',
      reviewPositive: 980,
      reviewTotal: 1000,
      currentPlayers: 4321,
      topRank: 42,
    });
  });

  it('dados extras são opcionais: se falharem, o jogo ainda é retornado', async () => {
    const { fn } = fakeFetch({
      '/api/appdetails': HADES_DETAILS,
      '/appreviews/': new Response('erro', { status: 500 }),
      GetNumberOfCurrentPlayers: () => {
        throw new Error('timeout');
      },
      GetMostPlayedGames: { response: { ranks: [] } },
    });
    const steam = new SteamClient({ fetch: fn });

    const game = await steam.getGame(1145360);
    expect(game.name).toBe('Hades');
    expect(game.reviewTotal).toBeNull();
    expect(game.currentPlayers).toBeNull();
    expect(game.topRank).toBeNull();
  });

  it('recusa AppID inexistente ou que não é jogo (DLC, trilha sonora...)', async () => {
    const { fn } = fakeFetch({
      'appids=1&': { '1': { success: false } },
      'appids=2&': { '2': { success: true, data: { type: 'dlc', name: 'Uma DLC' } } },
      GetMostPlayedGames: { response: { ranks: [] } },
    });
    const steam = new SteamClient({ fetch: fn });

    await expect(steam.getGame(1)).rejects.toMatchObject({ name: 'SteamError', notFound: true });
    await expect(steam.getGame(2)).rejects.toThrow(/não é um jogo/);
  });

  it('o ranking de mais jogados é baixado uma vez e reaproveitado', async () => {
    const { fn, calls } = fakeFetch({
      '/api/appdetails': (url: string) => {
        const id = url.match(/appids=(\d+)/)![1]!;
        return { [id]: { success: true, data: { type: 'game', name: `Jogo ${id}` } } };
      },
      GetMostPlayedGames: { response: { ranks: [{ rank: 3, appid: 2 }] } },
    });
    const steam = new SteamClient({ fetch: fn });

    const [a, b] = await Promise.all([steam.getGame(1), steam.getGame(2)]);
    expect(a.topRank).toBeNull();
    expect(b.topRank).toBe(3);
    expect(calls.filter((c) => c.includes('GetMostPlayedGames'))).toHaveLength(1);
  });

  it('erros de rede viram SteamError', async () => {
    const steam = new SteamClient({
      fetch: async () => {
        throw new TypeError('fetch failed');
      },
    });
    await expect(steam.search('hades')).rejects.toBeInstanceOf(SteamError);
  });
});
