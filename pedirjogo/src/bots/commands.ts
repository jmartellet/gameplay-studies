import { AppError, type Provider, type RankedGame, type RequestService } from '../service.js';
import { SteamError } from '../steam.js';

/**
 * Lógica de comandos compartilhada entre os bots. Fica separada do tmi.js/discord.js
 * para poder ser testada sem conectar em nada.
 */

export interface ChatUser {
  provider: Provider;
  providerId: string;
  username: string;
  displayName: string;
  avatarUrl?: string | null;
}

export type RequestOutcome =
  | { kind: 'not_found'; query: string }
  | { kind: 'closed'; game: RankedGame }
  | { kind: 'steam_down' }
  | { kind: 'created' | 'voted' | 'already_voted'; game: RankedGame };

export function gameLink(baseUrl: string, appid: number): string {
  return `${baseUrl.replace(/\/+$/, '')}/?jogo=${appid}`;
}

/** Resolve o texto do usuário (nome, AppID ou link), coloca na fila e registra o voto. */
export async function performRequest(service: RequestService, chatUser: ChatUser, query: string): Promise<RequestOutcome> {
  let appid: number | null;
  try {
    appid = await service.resolveAppId(query);
  } catch (err) {
    if (err instanceof SteamError) return { kind: 'steam_down' };
    throw err;
  }
  if (!appid) return { kind: 'not_found', query };

  const user = service.upsertUser(chatUser);
  try {
    const result = await service.requestAndVote(appid, user.id, chatUser.provider);
    const kind = result.created ? 'created' : result.newVote ? 'voted' : 'already_voted';
    return { kind, game: result.game };
  } catch (err) {
    if (err instanceof AppError && err.code === 'closed') {
      const game = service.getGame(appid);
      if (game) return { kind: 'closed', game };
    }
    if (err instanceof AppError && err.code === 'steam_not_found') return { kind: 'not_found', query };
    if (err instanceof SteamError) return { kind: 'steam_down' };
    throw err;
  }
}

const STATUS_TEXT = { pendente: 'está na fila', jogado: 'já foi jogado na live', recusado: 'foi recusado pelo streamer' } as const;

export function describeOutcome(outcome: RequestOutcome, baseUrl: string): string {
  switch (outcome.kind) {
    case 'not_found':
      return `não achei "${truncate(outcome.query, 40)}" na Steam. Tenta o nome em inglês ou o link da loja.`;
    case 'steam_down':
      return 'a Steam não respondeu agora, tenta de novo em alguns segundos.';
    case 'closed':
      return `${outcome.game.name} ${STATUS_TEXT[outcome.game.status]} 👀`;
    case 'created':
      return `pediu ${outcome.game.name}! Entrou na fila em #${outcome.game.position} → ${gameLink(baseUrl, outcome.game.appid)}`;
    case 'voted':
      return `votou em ${outcome.game.name}: ${plural(outcome.game.votes, 'voto')}, #${outcome.game.position} na fila → ${gameLink(baseUrl, outcome.game.appid)}`;
    case 'already_voted':
      return `você já votou em ${outcome.game.name} (${plural(outcome.game.votes, 'voto')}, #${outcome.game.position}) → ${gameLink(baseUrl, outcome.game.appid)}`;
  }
}

export function describeTop(games: RankedGame[], baseUrl: string): string {
  if (games.length === 0) return `A fila está vazia! Peça um jogo com !pedirjogo <nome> → ${baseUrl}`;
  const list = games.map((g) => `${g.position}. ${g.name} (${g.votes})`).join(' · ');
  return `🏆 Top da fila: ${list} → ${baseUrl}`;
}

export interface ChatHandlerDeps {
  service: RequestService;
  baseUrl: string;
  cooldownMs?: number;
  now?: () => number;
}

/**
 * Cria o handler de mensagens do chat (Twitch). Comandos:
 *   !pedirjogo            → link da página de votação
 *   !pedirjogo <jogo>     → pede/vota no jogo e responde com o link direto dele
 *   !votar <jogo>         → mesmo que !pedirjogo <jogo>
 *   !top / !fila          → top 3 da fila
 *
 * Retorna o texto da resposta ou null quando não deve responder.
 */
export function createChatCommandHandler(deps: ChatHandlerDeps) {
  const { service, baseUrl } = deps;
  const cooldownMs = deps.cooldownMs ?? 10_000;
  const now = deps.now ?? Date.now;
  const lastUse = new Map<string, number>();

  return async function handle(message: string, chatUser: ChatUser): Promise<string | null> {
    const match = message.trim().match(/^!(\S+)(?:\s+([\s\S]+))?$/);
    if (!match?.[1]) return null;
    const command = match[1].toLowerCase();
    const arg = match[2]?.trim() ?? '';
    if (!['pedirjogo', 'votar', 'top', 'fila'].includes(command)) return null;

    // Cooldown por pessoa: evita flood e protege o limite de requisições da Steam.
    const key = `${chatUser.provider}:${chatUser.providerId}`;
    const last = lastUse.get(key);
    if (last !== undefined && now() - last < cooldownMs) return null;
    lastUse.set(key, now());
    if (lastUse.size > 5000) lastUse.clear();

    const mention = `@${chatUser.displayName}`;

    if (command === 'top' || command === 'fila') {
      return describeTop(service.listGames({ limit: 3 }), baseUrl);
    }
    if (!arg) {
      return command === 'votar'
        ? `${mention} use !votar <nome do jogo>`
        : `${mention} peça e vote nos jogos da live aqui: ${baseUrl} (ou digite !pedirjogo <nome do jogo>)`;
    }

    const outcome = await performRequest(service, chatUser, arg);
    return `${mention} ${describeOutcome(outcome, baseUrl)}`;
  };
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
