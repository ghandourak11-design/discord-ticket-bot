require("dotenv").config();

const fs = require("fs");
const path = require("path");
const {
  Client,
  GatewayIntentBits,
  Partials,
  PermissionsBitField,
  ChannelType,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  REST,
  Routes,
  SlashCommandBuilder,
} = require("discord.js");

// ================= BASIC =================

if (!process.env.TOKEN) {
  console.error("Missing TOKEN");
  process.exit(1);
}

if (!process.env.BASE44_API_KEY) {
  console.error("Missing BASE44_API_KEY");
  process.exit(1);
}

const BASE44_APP_ID = "698bba4e9e06a075e7c32be6";
const BASE44_ENDPOINT =
  `https://app.base44.com/api/apps/${BASE44_APP_ID}/entities/Product`;

// ================= CLIENT =================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildInvites,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel]
});

// ================= FILE STORAGE =================

const DATA_DIR = __dirname;

function loadJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}
function saveJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// ---------- STOCK ----------
const STOCK_FILE = path.join(DATA_DIR, "stock.json");
const stockStore = loadJson(STOCK_FILE, { byGuild: {} });
stockStore.byGuild ??= {};
saveJson(STOCK_FILE, stockStore);

function getStock(guildId) {
  stockStore.byGuild[guildId] ??= {
    channelId: null,
    messageId: null
  };
  saveJson(STOCK_FILE, stockStore);
  return stockStore.byGuild[guildId];
}
function saveStock() {
  saveJson(STOCK_FILE, stockStore);
}

// ================= STOCK SYSTEM =================

async function fetchStock() {
  const res = await fetch(BASE44_ENDPOINT, {
    headers: {
      "api_key": process.env.BASE44_API_KEY,
      "Content-Type": "application/json"
    }
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Stock API error ${res.status}: ${t}`);
  }

  return await res.json();
}

function buildStockEmbed(products) {
  const embed = new EmbedBuilder()
    .setTitle("🍩 DonutDemand Live Stock")
    .setColor(0xed4245)
    .setTimestamp();

  if (!Array.isArray(products) || !products.length) {
    embed.setDescription("*All items not listed are out of stock.*");
    return embed;
  }

  const lines = [];

  for (const p of products) {
    const name = p.name || "Unnamed";
    const qty = Number(p.quantity ?? 0);

    if (!Number.isFinite(qty) || qty <= 0) continue;

    lines.push(`**${name}**  **${qty}**`);
  }

  const desc =
    (lines.length ? lines.join("\n") : "") +
    (lines.length ? "\n\n" : "") +
    "*All items not listed are out of stock.*";

  embed.setDescription(desc);
  return embed;
}

async function updateStockMessage(guild) {
  const cfg = getStock(guild.id);
  if (!cfg.channelId) return;

  const channel = await guild.channels.fetch(cfg.channelId).catch(() => null);
  if (!channel || channel.type !== ChannelType.GuildText) return;

  const products = await fetchStock().catch(() => null);
  if (!products) return;

  const embed = buildStockEmbed(products);

  let msg;
  if (cfg.messageId)
    msg = await channel.messages.fetch(cfg.messageId).catch(() => null);

  if (!msg) {
    const sent = await channel.send({ embeds: [embed] });
    cfg.messageId = sent.id;
    saveStock();
  } else {
    await msg.edit({ embeds: [embed] }).catch(() => {});
  }
}

// ================= COMMANDS =================

client.on("interactionCreate", async interaction => {

  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "stock") {

    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator))
      return interaction.reply({ content: "Admins only.", ephemeral: true });

    const sub = interaction.options.getSubcommand();

    if (sub === "set_channel") {
      const channel = interaction.options.getChannel("channel");
      const cfg = getStock(interaction.guild.id);
      cfg.channelId = channel.id;
      cfg.messageId = null;
      saveStock();
      return interaction.reply({ content: `✅ Stock channel set to ${channel}`, ephemeral: true });
    }

    if (sub === "post") {
      await updateStockMessage(interaction.guild);
      return interaction.reply({ content: "✅ Stock updated.", ephemeral: true });
    }
  }
});

// ================= SLASH COMMAND REGISTRATION =================

async function registerCommands() {

  const commands = [

    new SlashCommandBuilder()
      .setName("stock")
      .setDescription("Stock system")
      .addSubcommand(s =>
        s.setName("set_channel")
          .setDescription("Set stock channel")
          .addChannelOption(o =>
            o.setName("channel")
              .setDescription("Text channel")
              .addChannelTypes(ChannelType.GuildText)
              .setRequired(true)
          )
      )
      .addSubcommand(s =>
        s.setName("post")
          .setDescription("Post stock immediately")
      )

  ].map(c => c.toJSON());

  const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

  await rest.put(
    Routes.applicationCommands(client.user.id),
    { body: commands }
  );
}

// ================= READY =================

client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);

  await registerCommands();

  setInterval(async () => {
    for (const guild of client.guilds.cache.values()) {
      await updateStockMessage(guild).catch(() => {});
    }
  }, 60 * 1000);
});

// ================= LOGIN =================

client.login(process.env.TOKEN);
