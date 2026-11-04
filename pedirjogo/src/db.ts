import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export type DB = Database.Database;

/**
 * Modelo de dados:
 * - users: uma linha por conta (Twitch ou Discord). A mesma identidade é usada
 *   no site (OAuth) e nos bots (o chat já entrega o ID do usuário).
 * - games: jogos que entraram na fila + cache dos dados da Steam.
 * - votes: a PRIMARY KEY (game_appid, user_id) é o que bloqueia voto duplicado,
 *   direto no banco — não depende de checagem na aplicação.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  provider      TEXT    NOT NULL CHECK (provider IN ('twitch', 'discord')),
  provider_id   TEXT    NOT NULL,
  username      TEXT    NOT NULL,
  display_name  TEXT    NOT NULL,
  avatar_url    TEXT,
  created_at    INTEGER NOT NULL,
  UNIQUE (provider, provider_id)
);

CREATE TABLE IF NOT EXISTS games (
  appid              INTEGER PRIMARY KEY,
  name               TEXT    NOT NULL,
  header_image       TEXT,
  short_description  TEXT,
  genres             TEXT    NOT NULL DEFAULT '[]',
  price_text         TEXT,
  is_free            INTEGER NOT NULL DEFAULT 0,
  review_score_desc  TEXT,
  review_positive    INTEGER,
  review_total       INTEGER,
  current_players    INTEGER,
  top_rank           INTEGER,
  steam_updated_at   INTEGER NOT NULL,
  status             TEXT    NOT NULL DEFAULT 'pendente'
                     CHECK (status IN ('pendente', 'jogado', 'recusado')),
  requested_by       INTEGER REFERENCES users (id) ON DELETE SET NULL,
  created_at         INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS votes (
  game_appid  INTEGER NOT NULL REFERENCES games (appid) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  source      TEXT    NOT NULL CHECK (source IN ('web', 'twitch', 'discord')),
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (game_appid, user_id)
);

CREATE INDEX IF NOT EXISTS idx_games_status ON games (status);
CREATE INDEX IF NOT EXISTS idx_votes_user ON votes (user_id);
`;

export function openDatabase(file: string): DB {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}
