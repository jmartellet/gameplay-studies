import 'dotenv/config';
import { z } from 'zod';

/** Variáveis vazias no .env (ex.: `TWITCH_CLIENT_ID=`) contam como "não configurado". */
const optional = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== '' ? v.trim() : undefined));

const csvLower = z
  .string()
  .optional()
  .transform((v) =>
    (v ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );

const DEV_SECRET = 'dev-secret-troque-isso-em-producao';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  BASE_URL: z.string().url().default('http://localhost:3000'),
  DATABASE_PATH: z.string().default('./data/pedirjogo.db'),
  SESSION_SECRET: z.string().min(16, 'SESSION_SECRET precisa de pelo menos 16 caracteres').default(DEV_SECRET),

  STEAM_COUNTRY: z.string().length(2).default('BR'),
  STEAM_LANGUAGE: z.string().default('brazilian'),

  TWITCH_CLIENT_ID: optional,
  TWITCH_CLIENT_SECRET: optional,
  TWITCH_BOT_USERNAME: optional,
  TWITCH_BOT_OAUTH_TOKEN: optional,
  TWITCH_CHANNEL: optional,

  DISCORD_CLIENT_ID: optional,
  DISCORD_CLIENT_SECRET: optional,
  DISCORD_BOT_TOKEN: optional,
  DISCORD_GUILD_ID: optional,

  ADMIN_TWITCH_LOGINS: csvLower,
  ADMIN_DISCORD_IDS: csvLower,

  CHAT_COOLDOWN_SECONDS: z.coerce.number().int().min(0).default(10),
});

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const e = schema.parse(env);
  const production = e.NODE_ENV === 'production';

  if (production && e.SESSION_SECRET === DEV_SECRET) {
    throw new Error('Defina SESSION_SECRET no ambiente de produção.');
  }

  return {
    env: e.NODE_ENV,
    production,
    port: e.PORT,
    baseUrl: e.BASE_URL.replace(/\/+$/, ''),
    databasePath: e.DATABASE_PATH,
    sessionSecret: e.SESSION_SECRET,
    steam: { country: e.STEAM_COUNTRY.toUpperCase(), language: e.STEAM_LANGUAGE },
    twitch: {
      oauth:
        e.TWITCH_CLIENT_ID && e.TWITCH_CLIENT_SECRET
          ? { clientId: e.TWITCH_CLIENT_ID, clientSecret: e.TWITCH_CLIENT_SECRET }
          : null,
      bot:
        e.TWITCH_BOT_USERNAME && e.TWITCH_BOT_OAUTH_TOKEN && e.TWITCH_CHANNEL
          ? {
              username: e.TWITCH_BOT_USERNAME,
              token: e.TWITCH_BOT_OAUTH_TOKEN,
              channel: e.TWITCH_CHANNEL.replace(/^#/, '').toLowerCase(),
            }
          : null,
    },
    discord: {
      oauth:
        e.DISCORD_CLIENT_ID && e.DISCORD_CLIENT_SECRET
          ? { clientId: e.DISCORD_CLIENT_ID, clientSecret: e.DISCORD_CLIENT_SECRET }
          : null,
      bot:
        e.DISCORD_BOT_TOKEN && e.DISCORD_CLIENT_ID
          ? { token: e.DISCORD_BOT_TOKEN, clientId: e.DISCORD_CLIENT_ID, guildId: e.DISCORD_GUILD_ID ?? null }
          : null,
    },
    admins: { twitchLogins: e.ADMIN_TWITCH_LOGINS, discordIds: e.ADMIN_DISCORD_IDS },
    chatCooldownMs: e.CHAT_COOLDOWN_SECONDS * 1000,
  };
}

export type Config = ReturnType<typeof loadConfig>;
