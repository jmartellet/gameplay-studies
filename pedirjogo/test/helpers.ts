import { openDatabase } from '../src/db.js';
import { RequestService } from '../src/service.js';
import { SteamError, type SteamGameInfo, type SteamSearchResult } from '../src/steam.js';

export function fakeGame(appid: number, overrides: Partial<SteamGameInfo> = {}): SteamGameInfo {
  return {
    appid,
    name: `Jogo ${appid}`,
    headerImage: `https://img.example/${appid}.jpg`,
    shortDescription: 'Um jogo de teste',
    genres: ['Ação', 'Indie'],
    priceText: 'R$ 49,99',
    isFree: false,
    reviewScoreDesc: 'Muito positivas',
    reviewPositive: 90,
    reviewTotal: 100,
    currentPlayers: 1234,
    topRank: null,
    ...overrides,
  };
}

/** Dublê da Steam: catálogo em memória + contador de chamadas. */
export class FakeSteam {
  calls = { getGame: 0, search: 0 };
  failNext = false;
  constructor(
    public catalog: Record<number, SteamGameInfo> = {},
    public searchIndex: Record<string, SteamSearchResult[]> = {},
  ) {}

  async getGame(appid: number): Promise<SteamGameInfo> {
    this.calls.getGame++;
    if (this.failNext) {
      this.failNext = false;
      throw new SteamError('Steam fora do ar');
    }
    const game = this.catalog[appid];
    if (!game) throw new SteamError(`AppID ${appid} não encontrado na Steam`, true);
    return game;
  }

  async search(term: string, limit = 10): Promise<SteamSearchResult[]> {
    this.calls.search++;
    return (this.searchIndex[term.toLowerCase()] ?? []).slice(0, limit);
  }
}

export function setup(opts: { now?: () => number } = {}) {
  const db = openDatabase(':memory:');
  const steam = new FakeSteam(
    { 10: fakeGame(10, { name: 'Counter-Strike' }), 20: fakeGame(20, { name: 'Hades' }), 30: fakeGame(30, { name: 'Balatro' }) },
    { hades: [{ appid: 20, name: 'Hades', image: null, priceText: 'R$ 47,49' }] },
  );
  let clock = 1_700_000_000_000;
  const now = opts.now ?? (() => (clock += 1000));
  const service = new RequestService(db, steam, { now });
  const user = (name: string, provider: 'twitch' | 'discord' = 'twitch') =>
    service.upsertUser({ provider, providerId: `${provider}-${name}`, username: name, displayName: name });
  return { db, steam, service, user };
}
