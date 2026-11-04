import tmi from 'tmi.js';
import type { Config } from '../config.js';
import type { ChatUser } from './commands.js';

type Handler = (message: string, user: ChatUser) => Promise<string | null>;

/**
 * Bot do chat da Twitch (IRC via tmi.js).
 * O `user-id` que vem nas tags da mensagem é o mesmo ID que o login com Twitch no site
 * devolve — então quem vota pelo chat e pelo site é a mesma pessoa no banco.
 */
export async function startTwitchBot(config: Config, handle: Handler): Promise<tmi.Client | null> {
  const bot = config.twitch.bot;
  if (!bot) return null;

  const client = new tmi.Client({
    options: { skipUpdatingEmotesets: true },
    connection: { reconnect: true, secure: true },
    identity: {
      username: bot.username,
      password: bot.token.startsWith('oauth:') ? bot.token : `oauth:${bot.token}`,
    },
    channels: [bot.channel],
  });

  client.on('message', (channel, tags, message, self) => {
    if (self || !message.startsWith('!')) return;
    const userId = tags['user-id'];
    const login = tags.username;
    if (!userId || !login) return;

    handle(message, {
      provider: 'twitch',
      providerId: userId,
      username: login,
      displayName: tags['display-name'] || login,
    })
      .then((reply) => (reply ? client.say(channel, reply) : undefined))
      .catch((err: unknown) => console.error('[twitch] erro ao processar comando:', err));
  });

  client.on('connected', () => console.log(`[twitch] bot conectado em #${bot.channel}`));
  client.on('disconnected', (reason) => console.warn(`[twitch] desconectado: ${reason}`));

  await client.connect();
  return client;
}
