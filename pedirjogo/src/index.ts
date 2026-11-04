import { loadConfig } from './config.js';
import { openDatabase } from './db.js';
import { SteamClient } from './steam.js';
import { RequestService } from './service.js';
import { createApp } from './server.js';
import { createChatCommandHandler } from './bots/commands.js';
import { startTwitchBot } from './bots/twitch.js';
import { startDiscordBot } from './bots/discord.js';

const config = loadConfig();
const db = openDatabase(config.databasePath);
const steam = new SteamClient({ country: config.steam.country, language: config.steam.language });
const service = new RequestService(db, steam);

const app = createApp({ config, service });
const server = app.listen(config.port, () => {
  console.log(`🎮 pedirjogo rodando em ${config.baseUrl} (porta ${config.port})`);
  const logins = [config.twitch.oauth && 'Twitch', config.discord.oauth && 'Discord'].filter(Boolean);
  console.log(`   login: ${logins.length ? logins.join(' + ') : 'nenhum provedor configurado (veja o .env.example)'}`);
});

// Bots: cada um só sobe se as variáveis dele estiverem no .env. Se um falhar, o site continua no ar.
const chatHandler = createChatCommandHandler({ service, baseUrl: config.baseUrl, cooldownMs: config.chatCooldownMs });
const twitchBot = await startTwitchBot(config, chatHandler).catch((err: unknown) => {
  console.error('[twitch] não foi possível conectar o bot:', err);
  return null;
});
const discordBot = await startDiscordBot(config, service).catch((err: unknown) => {
  console.error('[discord] não foi possível conectar o bot:', err);
  return null;
});

// Mantém os dados da Steam (avaliações, jogadores agora, ranking) atualizados.
const refreshTimer = setInterval(() => {
  service.refreshStale().catch((err: unknown) => console.error('[steam] falha ao atualizar dados:', err));
}, 30 * 60_000);
refreshTimer.unref();

async function shutdown(signal: string) {
  console.log(`\n${signal} recebido, encerrando...`);
  clearInterval(refreshTimer);
  await Promise.allSettled([twitchBot?.disconnect(), discordBot?.destroy()]);
  server.close(() => {
    db.close();
    process.exit(0);
  });
  // SSE mantém conexões abertas; não espera para sempre.
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
