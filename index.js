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
const BASE44_ENDPOINT = `https://app.base44.com/api/apps/${BASE44_APP_ID}/entities/Product`;

// ================= CLIENT =================

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
  partials: [Partials.Channel],
});

// ================= FILE STORAGE =================

const DATA_DIR = __dirname;

function loadJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
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
  stockStore.byGuild[guildId] ??= { channelId: null, messageId: null };
  saveJson(STOCK_FILE, stockStore);
  return stockStore.byGuild[guildId];
}
function saveStock() {
  saveJson(STOCK_FILE, stockStore);
}

// ---------- PRICES ----------
const PRICES_FILE = path.join(DATA_DIR, "prices.json");
const pricesStore = loadJson(PRICES_FILE, { byGuild: {} });
pricesStore.byGuild ??= {};
saveJson(PRICES_FILE, pricesStore);

function getPrices(guildId) {
  pricesStore.byGuild[guildId] ??= { channelId: null, messageId: null };
  saveJson(PRICES_FILE, pricesStore);
  return pricesStore.byGuild[guildId];
}
function savePrices() {
  saveJson(PRICES_FILE, pricesStore);
}

// ================= BASE44 =================

async function fetchProducts() {
  const res = await fetch(BASE44_ENDPOINT, {
    headers: {
      api_key: process.env.BASE44_API_KEY,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Base44 API error ${res.status}: ${t}`);
  }

  return await res.json();
}

// ================= EMBEDS =================

function getCategoryKey(p) {
  // Try common fields first
  const raw =
    (p?.category ?? p?.type ?? p?.group ?? p?.collection ?? "").toString().toLowerCase();

  const name = (p?.name ?? "").toString().toLowerCase();

  const s = `${raw} ${name}`;

  if (s.includes("bundle")) return "bundles";
  if (s.includes("crate")) return "crates";
  return "items";
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

  const sections = { items: [], bundles: [], crates: [] };

  for (const p of products) {
    const name = p.name || "Unnamed";
    const qty = Number(p.quantity ?? 0);

    if (!Number.isFinite(qty) || qty <= 0) continue; // only in-stock

    const key = getCategoryKey(p);
    sections[key].push(`**${name}**  **${qty}**`);
  }

  let desc = "";

  if (sections.items.length) desc += "**1. Items**\n" + sections.items.join("\n") + "\n\n";
  if (sections.bundles.length) desc += "**2. Bundles**\n" + sections.bundles.join("\n") + "\n\n";
  if (sections.crates.length) desc += "**3. Crates**\n" + sections.crates.join("\n") + "\n\n";

  desc += "*All items not listed are out of stock.*";

  embed.setDescription(desc);
  return embed;
}

function buildPricesEmbed(products) {
  const embed = new EmbedBuilder()
    .setTitle("🍩 DonutDemand Live Prices")
    .setColor(0xed4245)
    .setTimestamp();

  if (!Array.isArray(products) || !products.length) {
    embed.setDescription("No prices listed.");
    return embed;
  }

  const sections = { items: [], bundles: [], crates: [] };

  for (const p of products) {
    const name = p.name || "Unnamed";
    const price = p.price;

    if (price === undefined || price === null || String(price).trim() === "") continue;

    const priceText = String(price).startsWith("$") ? String(price) : `$${price}`;
    const key = getCategoryKey(p);

    sections[key].push(`**${name}**  **${priceText}**`);
  }

  let desc = "";

  if (sections.items.length) desc += "**1. Items**\n" + sections.items.join("\n") + "\n\n";
  if (sections.bundles.length) desc += "**2. Bundles**\n" + sections.bundles.join("\n") + "\n\n";
  if (sections.crates.length) desc += "**3. Crates**\n" + sections.crates.join("\n") + "\n\n";

  embed.setDescription(desc.length ? desc.trim() : "No prices listed.");
  return embed;
}

// ================= UPDATE MESSAGES =================

async function updateStockMessage(guild) {
  const cfg = getStock(guild.id);
  if (!cfg.channelId) return;

  const channel = await guild.channels.fetch(cfg.channelId).catch(() => null);
  if (!channel || channel.type !== ChannelType.GuildText) return;

  const products = await fetchProducts().catch(() => null);
  if (!products) return;

  const embed = buildStockEmbed(products);

  let msg = null;
  if (cfg.messageId) msg = await channel.messages.fetch(cfg.messageId).catch(() => null);

  if (!msg) {
    const sent = await channel.send({ embeds: [embed] });
    cfg.messageId = sent.id;
    saveStock();
  } else {
    await msg.edit({ embeds: [embed] }).catch(() => {});
  }
}

async function updatePricesMessage(guild) {
  const cfg = getPrices(guild.id);
  if (!cfg.channelId) return;

  const channel = await guild.channels.fetch(cfg.channelId).catch(() => null);
  if (!channel || channel.type !== ChannelType.GuildText) return;

  const products = await fetchProducts().catch(() => null);
  if (!products) return;

  const embed = buildPricesEmbed(products);

  let msg = null;
  if (cfg.messageId) msg = await channel.messages.fetch(cfg.messageId).catch(() => null);

  if (!msg) {
    const sent = await channel.send({ embeds: [embed] });
    cfg.messageId = sent.id;
    savePrices();
  } else {
    await msg.edit({ embeds: [embed] }).catch(() => {});
  }
}

// ================= COMMANDS =================

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const isAdmin = interaction.member?.permissions?.has(PermissionsBitField.Flags.Administrator);
  if (!isAdmin) return interaction.reply({ content: "Admins only.", ephemeral: true });

  // ---------- STOCK ----------
  if (interaction.commandName === "stock") {
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

  // ---------- PRICES ----------
  if (interaction.commandName === "prices") {
    const sub = interaction.options.getSubcommand();

    if (sub === "set_channel") {
      const channel = interaction.options.getChannel("channel");
      const cfg = getPrices(interaction.guild.id);
      cfg.channelId = channel.id;
      cfg.messageId = null;
      savePrices();
      return interaction.reply({ content: `✅ Prices channel set to ${channel}`, ephemeral: true });
    }

    if (sub === "post") {
      await updatePricesMessage(interaction.guild);
      return interaction.reply({ content: "✅ Prices updated.", ephemeral: true });
    }
  }
});

// ================= SLASH COMMAND REGISTRATION =================

async function registerCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName("stock")
      .setDescription("Stock system")
      .addSubcommand((s) =>
        s
          .setName("set_channel")
          .setDescription("Set stock channel")
          .addChannelOption((o) =>
            o
              .setName("channel")
              .setDescription("Text channel")
              .addChannelTypes(ChannelType.GuildText)
              .setRequired(true)
          )
      )
      .addSubcommand((s) => s.setName("post").setDescription("Post stock immediately")),

    new SlashCommandBuilder()
      .setName("prices")
      .setDescription("Prices system")
      .addSubcommand((s) =>
        s
          .setName("set_channel")
          .setDescription("Set prices channel")
          .addChannelOption((o) =>
            o
              .setName("channel")
              .setDescription("Text channel")
              .addChannelTypes(ChannelType.GuildText)
              .setRequired(true)
          )
      )
      .addSubcommand((s) => s.setName("post").setDescription("Post prices immediately")),
  ].map((c) => c.toJSON());

  const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

  await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
}

// ================= READY =================

client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);

  await registerCommands();

  setInterval(async () => {
    for (const guild of client.guilds.cache.values()) {
      await updateStockMessage(guild).catch(() => {});
      await updatePricesMessage(guild).catch(() => {});
    }
  }, 60 * 1000);
});

// ================= LOGIN =================

client.login(process.env.TOKEN);
