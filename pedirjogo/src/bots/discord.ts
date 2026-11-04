import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import type { Config } from '../config.js';
import type { RankedGame, RequestService } from '../service.js';
import { describeOutcome, describeTop, gameLink, performRequest, truncate, type RequestOutcome } from './commands.js';

/**
 * Slash commands (não precisam do intent privilegiado de "Message Content").
 * Registre com `npm run discord:register` sempre que mudar algo aqui.
 */
export const discordCommands = [
  new SlashCommandBuilder()
    .setName('pedirjogo')
    .setDescription('Peça (ou vote em) um jogo da Steam para a live')
    .addStringOption((opt) =>
      opt.setName('jogo').setDescription('Nome do jogo, AppID ou link da Steam').setRequired(true).setAutocomplete(true),
    ),
  new SlashCommandBuilder().setName('top').setDescription('Mostra o top 5 da fila de jogos'),
  new SlashCommandBuilder().setName('fila').setDescription('Link da página de votação'),
].map((cmd) => cmd.toJSON());

const COLORS = { ok: 0x7c5cff, warn: 0xf5a524, error: 0xef4444 } as const;

export async function startDiscordBot(config: Config, service: RequestService): Promise<Client | null> {
  const bot = config.discord.bot;
  if (!bot) return null;

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      // Autocomplete: enquanto a pessoa digita, mostramos resultados da Steam.
      if (interaction.isAutocomplete()) {
        const focused = interaction.options.getFocused().trim();
        const results = focused.length < 2 ? [] : await service.searchSteam(focused, 10).catch(() => []);
        await interaction.respond(
          results.map((r) => ({
            name: truncate(r.priceText ? `${r.name} — ${r.priceText}` : r.name, 100),
            value: String(r.appid),
          })),
        );
        return;
      }

      if (!interaction.isChatInputCommand()) return;
      switch (interaction.commandName) {
        case 'pedirjogo':
          return await handlePedirJogo(interaction, service, config.baseUrl);
        case 'top':
          return await handleTop(interaction, service, config.baseUrl);
        case 'fila':
          return await interaction.reply({
            content: `Peça e vote nos jogos da live: ${config.baseUrl}`,
            components: [linkRow('Abrir fila', config.baseUrl)],
          });
      }
    } catch (err) {
      console.error('[discord] erro ao processar interação:', err);
      if (interaction.isRepliable()) {
        const payload = { content: 'Deu ruim aqui 😵 tenta de novo daqui a pouco.' };
        if (interaction.deferred || interaction.replied) await interaction.editReply(payload).catch(() => {});
        else await interaction.reply({ ...payload, ephemeral: true }).catch(() => {});
      }
    }
  });

  client.once(Events.ClientReady, (c) => console.log(`[discord] bot conectado como ${c.user.tag}`));
  await client.login(bot.token);
  return client;
}

async function handlePedirJogo(interaction: ChatInputCommandInteraction, service: RequestService, baseUrl: string) {
  await interaction.deferReply();
  const query = interaction.options.getString('jogo', true);
  const outcome = await performRequest(service, {
    provider: 'discord',
    providerId: interaction.user.id,
    username: interaction.user.username,
    displayName: interaction.user.globalName ?? interaction.user.username,
    avatarUrl: interaction.user.displayAvatarURL({ size: 64 }),
  }, query);

  if (!('game' in outcome)) {
    await interaction.editReply({ content: `${interaction.user} ${describeOutcome(outcome, baseUrl)}` });
    return;
  }
  await interaction.editReply({
    embeds: [gameEmbed(outcome.game, outcome, interaction.user.toString(), baseUrl)],
    components: [linkRow('Ver na fila', gameLink(baseUrl, outcome.game.appid), outcome.game.steam.url)],
  });
}

async function handleTop(interaction: ChatInputCommandInteraction, service: RequestService, baseUrl: string) {
  const games = service.listGames({ limit: 5 });
  if (games.length === 0) {
    await interaction.reply({ content: describeTop(games, baseUrl) });
    return;
  }
  const embed = new EmbedBuilder()
    .setColor(COLORS.ok)
    .setTitle('🏆 Top da fila de jogos')
    .setURL(baseUrl)
    .setDescription(
      games.map((g) => `**${g.position}.** [${g.name}](${gameLink(baseUrl, g.appid)}) — ${g.votes} voto${g.votes === 1 ? '' : 's'}`).join('\n'),
    );
  if (games[0]?.headerImage) embed.setThumbnail(games[0].headerImage);
  await interaction.reply({ embeds: [embed], components: [linkRow('Votar', baseUrl)] });
}

function gameEmbed(game: RankedGame, outcome: RequestOutcome, mention: string, baseUrl: string): EmbedBuilder {
  const titles: Record<RequestOutcome['kind'], string> = {
    created: '🎮 Novo pedido na fila!',
    voted: '👍 Voto registrado',
    already_voted: '✋ Você já votou nesse',
    closed: '🔒 Votação encerrada',
    not_found: '',
    steam_down: '',
  };
  const embed = new EmbedBuilder()
    .setColor(outcome.kind === 'closed' ? COLORS.warn : COLORS.ok)
    .setAuthor({ name: titles[outcome.kind] })
    .setTitle(game.name)
    .setURL(gameLink(baseUrl, game.appid))
    .setDescription(`${mention} ${describeOutcome(outcome, baseUrl).replace(/ → .*$/, '')}`)
    .addFields(
      { name: 'Fila', value: `#${game.position} · ${game.votes} voto${game.votes === 1 ? '' : 's'}`, inline: true },
      { name: 'Steam', value: steamSummary(game), inline: true },
    );
  if (game.headerImage) embed.setImage(game.headerImage);
  return embed;
}

function steamSummary(game: RankedGame): string {
  const parts = [
    game.steam.reviewPercent !== null ? `${game.steam.reviewPercent}% positivas` : game.steam.reviewScoreDesc,
    game.steam.currentPlayers !== null ? `${game.steam.currentPlayers.toLocaleString('pt-BR')} jogando` : null,
    game.steam.topRank !== null ? `#${game.steam.topRank} mais jogados` : null,
    game.priceText,
  ].filter(Boolean);
  return parts.length ? parts.join('\n') : '—';
}

function linkRow(label: string, url: string, steamUrl?: string) {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(label).setURL(url),
  );
  if (steamUrl) row.addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Página na Steam').setURL(steamUrl));
  return row;
}
