/**
 * Cliente da Steam.
 *
 * A Steam não tem uma API pública oficial para "buscar jogo por nome", então usamos
 * os endpoints JSON que a própria loja usa (store.steampowered.com/api/...) mais os
 * endpoints públicos da Web API que não exigem chave:
 *
 *  - Busca:          store.steampowered.com/api/storesearch
 *  - Detalhes:       store.steampowered.com/api/appdetails
 *  - Avaliações:     store.steampowered.com/appreviews/{appid}?json=1
 *  - Jogando agora:  api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1
 *  - Mais jogados:   api.steampowered.com/ISteamChartsService/GetMostPlayedGames/v1 (top 100)
 *
 * Endpoints da loja não são documentados e têm limite de requisições, por isso tudo
 * aqui passa por cache em memória e o RequestService ainda guarda o resultado no SQLite.
 */

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface SteamSearchResult {
  appid: number;
  name: string;
  image: string | null;
  priceText: string | null;
}

export interface SteamGameInfo {
  appid: number;
  name: string;
  headerImage: string | null;
  shortDescription: string | null;
  genres: string[];
  priceText: string | null;
  isFree: boolean;
  reviewScoreDesc: string | null;
  reviewPositive: number | null;
  reviewTotal: number | null;
  currentPlayers: number | null;
  /** Posição no top 100 de mais jogados da Steam (null = fora do top 100). */
  topRank: number | null;
}

export class SteamError extends Error {
  constructor(
    message: string,
    readonly notFound = false,
  ) {
    super(message);
    this.name = 'SteamError';
  }
}

export interface SteamClientOptions {
  fetch?: FetchLike;
  country?: string;
  language?: string;
  timeoutMs?: number;
  now?: () => number;
}

const STORE = 'https://store.steampowered.com';
const API = 'https://api.steampowered.com';

export class SteamClient {
  private readonly fetchFn: FetchLike;
  private readonly country: string;
  private readonly language: string;
  private readonly timeoutMs: number;
  private readonly now: () => number;

  private readonly searchCache: TtlCache<SteamSearchResult[]>;
  private readonly gameCache: TtlCache<SteamGameInfo>;
  private ranks: { at: number; byAppid: Map<number, number> } | null = null;
  private ranksInflight: Promise<Map<number, number>> | null = null;

  constructor(opts: SteamClientOptions = {}) {
    this.fetchFn = opts.fetch ?? ((input, init) => fetch(input, init));
    this.country = (opts.country ?? 'BR').toUpperCase();
    this.language = opts.language ?? 'brazilian';
    this.timeoutMs = opts.timeoutMs ?? 8000;
    this.now = opts.now ?? Date.now;
    this.searchCache = new TtlCache(5 * 60_000, this.now);
    this.gameCache = new TtlCache(10 * 60_000, this.now);
  }

  static storeUrl(appid: number): string {
    return `${STORE}/app/${appid}/`;
  }

  /** Busca jogos por nome. Só devolve itens do tipo "app" (ignora pacotes/bundles). */
  async search(term: string, limit = 10): Promise<SteamSearchResult[]> {
    const q = term.trim();
    if (q.length < 2) return [];

    const key = q.toLowerCase();
    const cached = this.searchCache.get(key);
    if (cached) return cached.slice(0, limit);

    const url = `${STORE}/api/storesearch/?term=${encodeURIComponent(q)}&cc=${this.country}&l=${this.language}`;
    const data = await this.getJson<StoreSearchResponse>(url);

    const results = (data.items ?? [])
      .filter((item) => item.type === 'app' && Number.isInteger(item.id))
      .map((item) => ({
        appid: item.id,
        name: item.name,
        image: item.tiny_image ?? null,
        priceText: formatSearchPrice(item.price),
      }));

    this.searchCache.set(key, results);
    return results.slice(0, limit);
  }

  /**
   * Junta detalhes da loja + avaliações + jogadores agora + posição no ranking.
   * Só os detalhes são obrigatórios; o resto é "melhor esforço" (vira null se falhar).
   */
  async getGame(appid: number): Promise<SteamGameInfo> {
    const cached = this.gameCache.get(String(appid));
    if (cached) return cached;

    const [details, reviews, players, topRank] = await Promise.all([
      this.appDetails(appid),
      bestEffort(this.reviews(appid)),
      bestEffort(this.currentPlayers(appid)),
      bestEffort(this.topRank(appid)),
    ]);

    const info: SteamGameInfo = {
      appid,
      name: details.name,
      headerImage: details.header_image ?? null,
      shortDescription: details.short_description ? decodeEntities(details.short_description) : null,
      genres: (details.genres ?? []).map((g) => g.description),
      priceText: details.is_free ? 'Gratuito' : (details.price_overview?.final_formatted ?? null),
      isFree: Boolean(details.is_free),
      reviewScoreDesc: reviews?.review_score_desc ?? null,
      reviewPositive: reviews?.total_positive ?? null,
      reviewTotal: reviews?.total_reviews ?? null,
      currentPlayers: players ?? null,
      topRank: topRank ?? null,
    };

    this.gameCache.set(String(appid), info);
    return info;
  }

  private async appDetails(appid: number): Promise<AppDetailsData> {
    const url = `${STORE}/api/appdetails?appids=${appid}&cc=${this.country}&l=${this.language}`;
    const data = await this.getJson<Record<string, { success: boolean; data?: AppDetailsData }>>(url);
    const entry = data?.[String(appid)];
    if (!entry?.success || !entry.data) {
      throw new SteamError(`AppID ${appid} não encontrado na Steam`, true);
    }
    if (entry.data.type !== 'game') {
      throw new SteamError(`AppID ${appid} não é um jogo (tipo: ${entry.data.type})`, true);
    }
    return entry.data;
  }

  private async reviews(appid: number): Promise<ReviewSummary | null> {
    const url = `${STORE}/appreviews/${appid}?json=1&language=all&purchase_type=all&num_per_page=0`;
    const data = await this.getJson<{ success: number; query_summary?: ReviewSummary }>(url);
    return data.success === 1 ? (data.query_summary ?? null) : null;
  }

  private async currentPlayers(appid: number): Promise<number | null> {
    const url = `${API}/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?appid=${appid}`;
    const data = await this.getJson<{ response?: { player_count?: number; result?: number } }>(url);
    return data.response?.result === 1 ? (data.response.player_count ?? null) : null;
  }

  private async topRank(appid: number): Promise<number | null> {
    const ranks = await this.mostPlayedRanks();
    return ranks.get(appid) ?? null;
  }

  /** Top 100 mais jogados — uma requisição serve para todos os jogos, cache de 1h. */
  private async mostPlayedRanks(): Promise<Map<number, number>> {
    if (this.ranks && this.now() - this.ranks.at < 60 * 60_000) return this.ranks.byAppid;
    if (this.ranksInflight) return this.ranksInflight;

    this.ranksInflight = (async () => {
      const url = `${API}/ISteamChartsService/GetMostPlayedGames/v1/`;
      const data = await this.getJson<{ response?: { ranks?: { rank: number; appid: number }[] } }>(url);
      const byAppid = new Map((data.response?.ranks ?? []).map((r) => [r.appid, r.rank] as const));
      this.ranks = { at: this.now(), byAppid };
      return byAppid;
    })().finally(() => {
      this.ranksInflight = null;
    });

    return this.ranksInflight;
  }

  private async getJson<T>(url: string): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchFn(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      throw new SteamError(`Falha ao falar com a Steam: ${(err as Error).message}`);
    }
    if (!res.ok) throw new SteamError(`A Steam respondeu HTTP ${res.status}`);
    return (await res.json()) as T;
  }
}

// ---------- tipos das respostas da Steam (só os campos que usamos) ----------

interface StoreSearchResponse {
  total?: number;
  items?: {
    type: string;
    id: number;
    name: string;
    tiny_image?: string;
    price?: { currency: string; initial: number; final: number };
  }[];
}

interface AppDetailsData {
  type: string;
  name: string;
  is_free?: boolean;
  header_image?: string;
  short_description?: string;
  genres?: { id: string; description: string }[];
  price_overview?: { final_formatted?: string };
}

interface ReviewSummary {
  review_score_desc?: string;
  total_positive?: number;
  total_reviews?: number;
}

// ---------- utilitários ----------

function formatSearchPrice(price?: { currency: string; final: number }): string | null {
  if (!price) return null;
  try {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: price.currency }).format(price.final / 100);
  } catch {
    return null;
  }
}

function decodeEntities(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

async function bestEffort<T>(promise: Promise<T>): Promise<T | null> {
  try {
    return await promise;
  } catch {
    return null;
  }
}

class TtlCache<T> {
  private readonly map = new Map<string, { at: number; value: T }>();

  constructor(
    private readonly ttlMs: number,
    private readonly now: () => number,
    private readonly maxEntries = 500,
  ) {}

  get(key: string): T | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (this.now() - hit.at > this.ttlMs) {
      this.map.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key: string, value: T): void {
    if (this.map.size >= this.maxEntries) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(key, { at: this.now(), value });
  }
}
