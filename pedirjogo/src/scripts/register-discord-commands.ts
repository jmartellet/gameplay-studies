/**
 * Registra os slash commands do bot no Discord.
 * - Com DISCORD_GUILD_ID: registra só no seu servidor (aparece na hora — ideal em desenvolvimento).
 * - Sem DISCORD_GUILD_ID: registra globalmente (pode levar alguns minutos para aparecer).
 */
import { REST, Routes } from 'discord.js';
import { loadConfig } from '../config.js';
import { discordCommands } from '../bots/discord.js';

const config = loadConfig();
const bot = config.discord.bot;
if (!bot) {
  console.error('Defina DISCORD_BOT_TOKEN e DISCORD_CLIENT_ID no .env antes de registrar os comandos.');
  process.exit(1);
}

const rest = new REST().setToken(bot.token);
const route = bot.guildId
  ? Routes.applicationGuildCommands(bot.clientId, bot.guildId)
  : Routes.applicationCommands(bot.clientId);

await rest.put(route, { body: discordCommands });
console.log(
  `✅ ${discordCommands.length} comandos registrados ${bot.guildId ? `no servidor ${bot.guildId}` : 'globalmente'}: ` +
    discordCommands.map((c) => `/${c.name}`).join(', '),
);
