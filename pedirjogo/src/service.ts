import { EventEmitter } from 'node:events';
import type { DB } from './db.js';
import { SteamClient, SteamError, type SteamGameInfo, type SteamSearchResult } from './steam.js';

export type Provider = 'twitch' | 'discord';
export type VoteSource = 'web' | Provider;
export type GameStatus = 'pendente' | 'jogado' | 'recusado';
export const GAME_STATUSES: readonly GameStatus[] = ['pendente', 'jogado', 'recusado'];

export class AppError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export interface User {
  id: number;
  provider: Provider;
  providerId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface UserInput {
  provider: Provider;
  providerId: string;
  username: string;
  displayName?: string | null;
  avatarUrl?: string | null;
}

export interface RankedGame {
  appid: number;
  name: string;
  headerImage: string | null;
  shortDescription: string | null;
  genres: string[];
  priceText: string | null;
  isFree: boolean;
  status: GameStatus;
  votes: number;
  /** Posição na fila entre os jogos com o mesmo status. */
  position: number;
  hasVoted: boolean;
  requestedBy: string | null;
  createdAt: number;
  steam: {
    url: string;
    reviewScoreDesc: string | null;
    reviewPercent: number | null;
    reviewTotal: number | null;
    currentPlayers: number | null;
    topRank: number | null;
    updatedAt: number;
  };
}

export interface RequestResult {
  game: RankedGame;
  /** O jogo entrou na fila agora (primeiro pedido). */
  created: boolean;
  /** O voto foi registrado agora (false = a pessoa já tinha votado). */
  newVote: boolean;
}

/** Só o que o serviço precisa da Steam — facilita usar um dublê nos testes. */
export type SteamSource = Pick<SteamClient, 'getGame' | 'search'>;

export interface ServiceOptions {
  /** Depois de quanto tempo os dados da Steam de um jogo são considerados velhos. */
  staleAfterMs?: number;
  now?: () => number;
}

/** Evento emitido sempre que o ranking muda (usado pelo SSE do site/overlay). */
export const RANKING_CHANGED = 'ranking-changed';

export class RequestService {
  readonly events: EventEmitter;
  private readonly staleAfterMs: number;
  private readonly now: () => number;
  private readonly inflight = new Map<number, Promise<void>>();

  constructor(
    private readonly db: DB,
    private readonly steam: SteamSource,
    opts: ServiceOptions & { events?: EventEmitter } = {},
  ) {
    this.events = opts.events ?? new EventEmitter();
    this.events.setMaxListeners(0);
    this.staleAfterMs = opts.staleAfterMs ?? 6 * 60 * 60_000;
    this.now = opts.now ?? Date.now;
  }

  // ------------------------------------------------------------------ usuários

  upsertUser(input: UserInput): User {
    const row = this.db
      .prepare(
        `INSERT INTO users (provider, provider_id, username, display_name, avatar_url, created_at)
         VALUES (@provider, @providerId, @username, @displayName, @avatarUrl, @now)
         ON CONFLICT (provider, provider_id) DO UPDATE SET
           username     = excluded.username,
           display_name = excluded.display_name,
           avatar_url   = COALESCE(excluded.avatar_url, users.avatar_url)
         RETURNING *`,
      )
      .get({
        provider: input.provider,
        providerId: input.providerId,
        username: input.username,
        displayName: input.displayName?.trim() || input.username,
        avatarUrl: input.avatarUrl ?? null,
        now: this.now(),
      }) as UserRow;
    return mapUser(row);
  }

  getUser(id: number): User | null {
    const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
    return row ? mapUser(row) : null;
  }

  // ------------------------------------------------------------------ Steam

  searchSteam(term: string, limit?: number): Promise<SteamSearchResult[]> {
    return this.steam.search(term, limit);
  }

  /**
   * Prévia de um jogo sem colocá-lo na fila: usa o banco se já existir, senão a Steam.
   * Serve para o link `?jogo=APPID` que os bots mandam no chat.
   */
  async previewGame(appid: number, userId?: number | null): Promise<RankedGame | (SteamGameInfo & { inQueue: false })> {
    assertAppid(appid);
    const existing = this.getGame(appid, userId);
    if (existing) return existing;
    const info = await this.steam.getGame(appid);
    return { ...info, inQueue: false };
  }

  /** Aceita nome, AppID ou link da loja. Retorna null se nada for encontrado. */
  async resolveAppId(query: string): Promise<number | null> {
    const q = query.trim();
    if (!q) return null;
    const fromUrl = q.match(/store\.steampowered\.com\/app\/(\d+)/i);
    if (fromUrl?.[1]) return Number(fromUrl[1]);
    if (/^\d{1,9}$/.test(q)) return Number(q);
    const [first] = await this.steam.search(q, 1);
    return first?.appid ?? null;
  }

  /**
   * Garante que o jogo está no banco com dados da Steam recentes.
   * Requisições simultâneas para o mesmo AppID compartilham a mesma chamada à Steam.
   */
  async ensureGame(appid: number): Promise<void> {
    assertAppid(appid);
    const row = this.db.prepare('SELECT steam_updated_at FROM games WHERE appid = ?').get(appid) as
      | { steam_updated_at: number }
      | undefined;
    if (row && this.now() - row.steam_updated_at < this.staleAfterMs) return;

    const pending = this.inflight.get(appid);
    if (pending) return pending;

    const task = (async () => {
      let info: SteamGameInfo;
      try {
        info = await this.steam.getGame(appid);
      } catch (err) {
        // Jogo já está na fila e a Steam falhou? Mantém os dados antigos.
        if (row) return;
        if (err instanceof SteamError && err.notFound) {
          throw new AppError('steam_not_found', 'Jogo não encontrado na Steam', 404);
        }
        throw err;
      }
      this.saveSteamInfo(info);
    })().finally(() => this.inflight.delete(appid));

    this.inflight.set(appid, task);
    return task;
  }

  /** Atualiza em segundo plano os jogos pendentes com dados mais velhos. */
  async refreshStale(limit = 20): Promise<number> {
    const rows = this.db
      .prepare(
        `SELECT appid FROM games WHERE status = 'pendente' AND steam_updated_at < ?
         ORDER BY steam_updated_at ASC LIMIT ?`,
      )
      .all(this.now() - this.staleAfterMs, limit) as { appid: number }[];

    let refreshed = 0;
    for (const { appid } of rows) {
      try {
        await this.ensureGame(appid);
        refreshed++;
      } catch {
        /* tenta de novo no próximo ciclo */
      }
    }
    if (refreshed > 0) this.emitChange('pendente');
    return refreshed;
  }

  // ------------------------------------------------------------------ pedidos e votos

  /**
   * Fluxo principal: "quero esse jogo". Coloca o jogo na fila (se ainda não estiver)
   * e registra o voto de quem pediu. Pedir de novo um jogo já pedido = votar nele.
   */
  async requestAndVote(appid: number, userId: number, source: VoteSource): Promise<RequestResult> {
    assertAppid(appid);
    const existed = this.gameExists(appid);
    await this.ensureGame(appid);

    let created = false;
    if (!existed) {
      const res = this.db
        .prepare('UPDATE games SET requested_by = ? WHERE appid = ? AND requested_by IS NULL')
        .run(userId, appid);
      created = res.changes === 1;
    }

    const newVote = this.insertVote(appid, userId, source);
    const game = this.getGame(appid, userId)!;
    this.emitChange(game.status);
    return { game, created, newVote };
  }

  /** Vota em um jogo que já está na fila. Retorna false se a pessoa já tinha votado. */
  vote(appid: number, userId: number, source: VoteSource): boolean {
    assertAppid(appid);
    if (!this.gameExists(appid)) throw new AppError('not_in_queue', 'Esse jogo ainda não foi pedido', 404);
    const newVote = this.insertVote(appid, userId, source);
    if (newVote) this.emitChange('pendente');
    return newVote;
  }

  unvote(appid: number, userId: number): boolean {
    assertAppid(appid);
    const status = this.statusOf(appid);
    if (!status) throw new AppError('not_in_queue', 'Esse jogo não está na fila', 404);
    if (status !== 'pendente') throw new AppError('closed', 'A votação desse jogo já foi encerrada', 409);
    const res = this.db.prepare('DELETE FROM votes WHERE game_appid = ? AND user_id = ?').run(appid, userId);
    if (res.changes > 0) this.emitChange(status);
    return res.changes > 0;
  }

  setStatus(appid: number, status: GameStatus): RankedGame {
    assertAppid(appid);
    if (!GAME_STATUSES.includes(status)) throw new AppError('invalid_status', 'Status inválido');
    const previous = this.statusOf(appid);
    if (!previous) throw new AppError('not_in_queue', 'Esse jogo não está na fila', 404);
    this.db.prepare('UPDATE games SET status = ? WHERE appid = ?').run(status, appid);
    this.emitChange(previous);
    if (previous !== status) this.emitChange(status);
    return this.getGame(appid)!;
  }

  // ------------------------------------------------------------------ leitura

  listGames(opts: { status?: GameStatus; userId?: number | null; limit?: number } = {}): RankedGame[] {
    const status = opts.status ?? 'pendente';
    const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
    const rows = this.db
      .prepare(`${RANKED_SQL} ORDER BY r.position LIMIT @limit`)
      .all({ status, userId: opts.userId ?? -1, limit }) as RankedRow[];
    return rows.map(mapRanked);
  }

  getGame(appid: number, userId?: number | null): RankedGame | null {
    const status = this.statusOf(appid);
    if (!status) return null;
    const row = this.db
      .prepare(`${RANKED_SQL} WHERE r.appid = @appid`)
      .get({ status, userId: userId ?? -1, appid }) as RankedRow | undefined;
    return row ? mapRanked(row) : null;
  }

  // ------------------------------------------------------------------ internos

  private insertVote(appid: number, userId: number, source: VoteSource): boolean {
    const status = this.statusOf(appid);
    if (status && status !== 'pendente') {
      throw new AppError('closed', `Esse jogo já foi marcado como ${status}`, 409);
    }
    // A PRIMARY KEY (game_appid, user_id) faz o bloqueio de duplicados;
    // INSERT OR IGNORE transforma o conflito em "0 linhas alteradas".
    const res = this.db
      .prepare('INSERT OR IGNORE INTO votes (game_appid, user_id, source, created_at) VALUES (?, ?, ?, ?)')
      .run(appid, userId, source, this.now());
    return res.changes === 1;
  }

  private saveSteamInfo(info: SteamGameInfo): void {
    this.db
      .prepare(
        `INSERT INTO games (appid, name, header_image, short_description, genres, price_text, is_free,
           review_score_desc, review_positive, review_total, current_players, top_rank,
           steam_updated_at, created_at)
         VALUES (@appid, @name, @headerImage, @shortDescription, @genres, @priceText, @isFree,
           @reviewScoreDesc, @reviewPositive, @reviewTotal, @currentPlayers, @topRank, @now, @now)
         ON CONFLICT (appid) DO UPDATE SET
           name = excluded.name, header_image = excluded.header_image,
           short_description = excluded.short_description, genres = excluded.genres,
           price_text = excluded.price_text, is_free = excluded.is_free,
           review_score_desc = excluded.review_score_desc, review_positive = excluded.review_positive,
           review_total = excluded.review_total, current_players = excluded.current_players,
           top_rank = excluded.top_rank, steam_updated_at = excluded.steam_updated_at`,
      )
      .run({
        ...info,
        genres: JSON.stringify(info.genres),
        isFree: info.isFree ? 1 : 0,
        now: this.now(),
      });
  }

  private gameExists(appid: number): boolean {
    return this.statusOf(appid) !== null;
  }

  private statusOf(appid: number): GameStatus | null {
    const row = this.db.prepare('SELECT status FROM games WHERE appid = ?').get(appid) as
      | { status: GameStatus }
      | undefined;
    return row?.status ?? null;
  }

  private emitChange(status: GameStatus): void {
    this.events.emit(RANKING_CHANGED, { status });
  }
}

// ---------------------------------------------------------------------- SQL e mapeamento

/**
 * Ranking: mais votos primeiro; empate → quem foi pedido antes.
 * ROW_NUMBER() dá a posição na fila sem precisar calcular no JavaScript.
 */
const RANKED_SQL = `
WITH counts AS (
  SELECT game_appid, COUNT(*) AS votes FROM votes GROUP BY game_appid
),
ranked AS (
  SELECT g.*, COALESCE(c.votes, 0) AS votes,
         ROW_NUMBER() OVER (ORDER BY COALESCE(c.votes, 0) DESC, g.created_at ASC, g.appid ASC) AS position
  FROM games g
  LEFT JOIN counts c ON c.game_appid = g.appid
  WHERE g.status = @status
)
SELECT r.*, u.display_name AS requested_by_name,
       EXISTS (SELECT 1 FROM votes v WHERE v.game_appid = r.appid AND v.user_id = @userId) AS has_voted
FROM ranked r
LEFT JOIN users u ON u.id = r.requested_by`;

interface UserRow {
  id: number;
  provider: Provider;
  provider_id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
}

interface RankedRow {
  appid: number;
  name: string;
  header_image: string | null;
  short_description: string | null;
  genres: string;
  price_text: string | null;
  is_free: number;
  review_score_desc: string | null;
  review_positive: number | null;
  review_total: number | null;
  current_players: number | null;
  top_rank: number | null;
  steam_updated_at: number;
  status: GameStatus;
  created_at: number;
  votes: number;
  position: number;
  has_voted: number;
  requested_by_name: string | null;
}

function mapUser(row: UserRow): User {
  return {
    id: row.id,
    provider: row.provider,
    providerId: row.provider_id,
    username: row.username,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
  };
}

function mapRanked(row: RankedRow): RankedGame {
  const percent =
    row.review_total && row.review_positive !== null
      ? Math.round((row.review_positive / row.review_total) * 100)
      : null;
  return {
    appid: row.appid,
    name: row.name,
    headerImage: row.header_image,
    shortDescription: row.short_description,
    genres: safeJsonArray(row.genres),
    priceText: row.price_text,
    isFree: row.is_free === 1,
    status: row.status,
    votes: row.votes,
    position: row.position,
    hasVoted: row.has_voted === 1,
    requestedBy: row.requested_by_name,
    createdAt: row.created_at,
    steam: {
      url: SteamClient.storeUrl(row.appid),
      reviewScoreDesc: row.review_score_desc,
      reviewPercent: percent,
      reviewTotal: row.review_total,
      currentPlayers: row.current_players,
      topRank: row.top_rank,
      updatedAt: row.steam_updated_at,
    },
  };
}

function safeJsonArray(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function assertAppid(appid: number): void {
  if (!Number.isInteger(appid) || appid <= 0) throw new AppError('invalid_appid', 'AppID inválido');
}
