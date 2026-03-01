/**
 * DonutDemand Stock + Prices Bot — Single File (discord.js v14)
 * Commands:
 *  - /stock show
 *  - /stock channel (admin)              -> set stock channel
 *  - /prices show
 *  - /prices channel (admin)             -> set prices channel
 *  - /settings show (admin)
 *  - /settings set_channel (admin)       -> supports type: stock | prices
 *
 * Auto:
 *  - Every 1 minute, fetch Base44 Product entities and update:
 *      - Stock message (in stock channel)
 *      - Prices message (in prices channel)
 *
 * ENV:
 *  - TOKEN=discord_bot_token
 *  - BASE44_API_KEY=your_base44_api_key
 *  - BASE44_BASE_URL=https://donutdemand.net
 */

"use strict";

try {
  require("dotenv").config({ quiet: true });
} catch {}

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const {
  Client,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionsBitField,
  ChannelType,
  EmbedBuilder,
} = require("discord.js");

/* -------------------- CONFIG -------------------- */
const BASE44_APP_ID = "698bba4e9e06a075e7c32be6"; // hardcoded
const UPDATE_INTERVAL_MS = 60_000; // 1 min

const TOKEN = process.env.TOKEN;
const BASE44_API_KEY = process.env.BASE44_API_KEY;
const BASE44_BASE_URL = (process.env.BASE44_BASE_URL || "https://donutdemand.net").replace(/\/$/, "");

/* -------------------- STORAGE -------------------- */
const SETTINGS_FILE = path.join(__dirname, "stock_settings.json");

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

const store = loadJson(SETTINGS_FILE, { byGuild: {} });
store.byGuild ??= {};
saveJson(SETTINGS_FILE, store);

function getGuildSettings(guildId) {
  store.byGuild[guildId] ??= {
    // Stock
    stockChannelId: null,
    lastStockMessageId: null,
    lastStockHash: null,

    // Prices
    pricesChannelId: null,
    lastPricesMessageId: null,
    lastPricesHash: null,

    // Health
    lastOkAt: null,
    lastError: null,
  };
  return store.byGuild[guildId];
}
function saveStore() {
  saveJson(SETTINGS_FILE, store);
}

/* -------------------- DISCORD CLIENT -------------------- */
const client = new Client({
  intents: [GatewayIntentBits.Guilds],
  partials: [Partials.Channel],
});

/* -------------------- COMMANDS -------------------- */
function buildCommandsJSON() {
  const stockCmd = new SlashCommandBuilder()
    .setName("stock")
    .setDescription("Show current stock (and manage stock auto-updates).")
    .setDMPermission(false)
    .addSubcommand((s) => s.setName("show").setDescription("Show current stock in this channel."))
    .addSubcommand((s) =>
      s
        .setName("channel")
        .setDescription("Set the stock auto-update channel (admin).")
        .addChannelOption((o) =>
          o
            .setName("channel")
            .setDescription("Channel to post stock updates in")
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
    );

  const pricesCmd = new SlashCommandBuilder()
    .setName("prices")
    .setDescription("Show live prices (and manage prices auto-updates).")
    .setDMPermission(false)
    .addSubcommand((s) => s.setName("show").setDescription("Show current prices in this channel."))
    .addSubcommand((s) =>
      s
        .setName("channel")
        .setDescription("Set the prices auto-update channel (admin).")
        .addChannelOption((o) =>
          o
            .setName("channel")
            .setDescription("Channel to post price updates in")
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
    );

  const settingsCmd = new SlashCommandBuilder()
    .setName("settings")
    .setDescription("Admin: bot settings.")
    .setDMPermission(false)
    .addSubcommand((s) => s.setName("show").setDescription("Show current settings."))
    .addSubcommand((s) =>
      s
        .setName("set_channel")
        .setDescription("Set a bot channel setting.")
        .addStringOption((o) =>
          o
            .setName("type")
            .setDescription("Which channel setting to change?")
            .setRequired(true)
            .addChoices(
              { name: "stock", value: "stock" },
              { name: "prices", value: "prices" }
            )
        )
        .addChannelOption((o) =>
          o
            .setName("channel")
            .setDescription("Text channel")
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
    );

  return [stockCmd, pricesCmd, settingsCmd].map((c) => c.toJSON());
}

function getRest() {
  if (!TOKEN) throw new Error("Missing TOKEN env var.");
  return new REST({ version: "10" }).setToken(TOKEN);
}
function getAppId() {
  return client.application?.id || client.user?.id || null;
}

async function registerGlobal() {
  const appId = getAppId();
  if (!appId) throw new Error("App ID not ready yet.");
  const rest = getRest();
  await rest.put(Routes.applicationCommands(appId), { body: buildCommandsJSON() });
  console.log("✅ Registered GLOBAL slash commands");
}

/* -------------------- BASE44 FETCH -------------------- */
async function fetchBase44Products() {
  if (!BASE44_API_KEY) throw new Error("Missing BASE44_API_KEY env var.");

  const url = `${BASE44_BASE_URL}/api/apps/${BASE44_APP_ID}/entities/Product`;

  const res = await fetch(url, {
    headers: {
      api_key: BASE44_API_KEY,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Base44 request failed (${res.status}): ${text.slice(0, 200)}`);
  }

  const data = await res.json();

  // Base44 can return different shapes; normalize into an array
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.entities)) return data.entities;

  // last fallback: try to find first array in object
  for (const v of Object.values(data || {})) {
    if (Array.isArray(v)) return v;
  }

  return [];
}

/* -------------------- HELPERS -------------------- */
function normalizeCategory(raw) {
  const c = String(raw ?? "Other").trim();
  return c.length ? c : "Other";
}

function sortCategories(a, b) {
  const A = String(a || "");
  const B = String(b || "");
  const aIsItems = A.toLowerCase() === "items";
  const bIsItems = B.toLowerCase() === "items";
  if (aIsItems && !bIsItems) return -1; // Items first
  if (!aIsItems && bIsItems) return 1;
  return A.localeCompare(B);
}

function groupByCategory(products, mapper) {
  const groups = new Map();

  for (const p of products) {
    const category = normalizeCategory(p?.category);
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push(mapper(p));
  }

  // sort each group by name
  for (const [cat, items] of groups.entries()) {
    items.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    groups.set(cat, items);
  }

  // sort categories (Items first)
  return [...groups.entries()].sort((a, b) => sortCategories(a[0], b[0]));
}

function hashProducts(products) {
  const minimal = products
    .map((p) => ({
      name: String(p?.name ?? ""),
      quantity: Number(p?.quantity ?? p?.stock ?? p?.qty ?? 0) || 0,
      price: Number(p?.price ?? p?.priceUsd ?? p?.cost ?? p?.amount ?? NaN),
      category: normalizeCategory(p?.category),
    }))
    .sort((a, b) => (a.category + a.name).localeCompare(b.category + b.name));

  return crypto.createHash("sha256").update(JSON.stringify(minimal)).digest("hex");
}

function money(val) {
  const n = Number(val);
  if (!Number.isFinite(n)) return null;
  // if someone stores cents, you can change this later — keeping simple for now
  return `$${n.toFixed(2)}`;
}

function nowStampLine() {
  const ts = Math.floor(Date.now() / 1000);
  return `Updated: <t:${ts}:R> • <t:${ts}:t>`;
}

/* -------------------- EMBEDS -------------------- */
function buildStockEmbed(products, guildName) {
  const grouped = groupByCategory(products, (p) => {
    const name = String(p?.name ?? "Unnamed");
    const qtyRaw = p?.quantity ?? p?.stock ?? p?.qty ?? 0;
    const quantity = Number.isFinite(Number(qtyRaw)) ? Number(qtyRaw) : 0;
    return { name, quantity };
  });

  const embed = new EmbedBuilder()
    .setTitle("📦 Live Stock")
    .setDescription(`**${guildName}**\n${nowStampLine()}\n\nStock pulled from Base44.`)
    .setColor(0xed4245)
    .setTimestamp();

  if (!products.length) {
    embed.addFields({ name: "No products", value: "Nothing returned from Base44.", inline: false });
    embed.setFooter({ text: "Auto-updates every 1 minute" });
    return embed;
  }

  // chunk categories to fit field limit (1024)
  for (const [cat, items] of grouped) {
    const lines = items.map((x) => `• ${x.name} — **${x.quantity}**`);
    let value = lines.join("\n");

    if (value.length <= 1024) {
      embed.addFields({ name: cat, value, inline: false });
      continue;
    }

    let buf = "";
    let part = 1;
    for (const line of lines) {
      if ((buf + "\n" + line).length > 1024) {
        embed.addFields({ name: `${cat} (part ${part})`, value: buf || "-", inline: false });
        buf = line;
        part++;
      } else {
        buf = buf ? buf + "\n" + line : line;
      }
    }
    if (buf) embed.addFields({ name: `${cat} (part ${part})`, value: buf, inline: false });
  }

  embed.setFooter({ text: "Auto-updates every 1 minute • /stock show to post anywhere" });
  return embed;
}

function buildPricesEmbed(products, guildName) {
  const grouped = groupByCategory(products, (p) => {
    const name = String(p?.name ?? "Unnamed");
    const priceRaw = p?.price ?? p?.priceUsd ?? p?.cost ?? p?.amount ?? null;
    const price = money(priceRaw);
    return { name, price };
  });

  const embed = new EmbedBuilder()
    .setTitle("💸 Live Prices")
    .setDescription(`**${guildName}**\n${nowStampLine()}\n\nPrices pulled from Base44.`)
    .setColor(0x57f287)
    .setTimestamp();

  if (!products.length) {
    embed.addFields({ name: "No products", value: "Nothing returned from Base44.", inline: false });
    embed.setFooter({ text: "Auto-updates every 1 minute" });
    return embed;
  }

  for (const [cat, items] of grouped) {
    const lines = items.map((x) => `• ${x.name} — **${x.price ?? "N/A"}**`);
    let value = lines.join("\n");

    if (value.length <= 1024) {
      embed.addFields({ name: cat, value, inline: false });
      continue;
    }

    let buf = "";
    let part = 1;
    for (const line of lines) {
      if ((buf + "\n" + line).length > 1024) {
        embed.addFields({ name: `${cat} (part ${part})`, value: buf || "-", inline: false });
        buf = line;
        part++;
      } else {
        buf = buf ? buf + "\n" + line : line;
      }
    }
    if (buf) embed.addFields({ name: `${cat} (part ${part})`, value: buf, inline: false });
  }

  embed.setFooter({ text: "Auto-updates every 1 minute • /prices show to post anywhere" });
  return embed;
}

/* -------------------- UPDATE LOOPS -------------------- */
async function getTextChannel(guild, channelId) {
  if (!channelId) return null;
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel) return null;
  if (channel.type !== ChannelType.GuildText) return null;
  return channel;
}

async function upsertEmbedMessage(channel, lastMessageId, embed) {
  if (lastMessageId) {
    const msg = await channel.messages.fetch(lastMessageId).catch(() => null);
    if (msg) {
      await msg.edit({ embeds: [embed] }).catch(() => {});
      return msg.id;
    }
  }
  const sent = await channel.send({ embeds: [embed] });
  return sent.id;
}

async function updateForGuild(guild) {
  const s = getGuildSettings(guild.id);

  const stockChannel = await getTextChannel(guild, s.stockChannelId);
  const pricesChannel = await getTextChannel(guild, s.pricesChannelId);

  // If neither is configured, nothing to do
  if (!stockChannel && !pricesChannel) return;

  try {
    const products = await fetchBase44Products();
    const newHash = hashProducts(products);

    // STOCK
    if (stockChannel) {
      const shouldUpdateStock =
        !s.lastStockMessageId || !s.lastStockHash || s.lastStockHash !== newHash;

      if (shouldUpdateStock) {
        const stockEmbed = buildStockEmbed(products, guild.name);
        s.lastStockMessageId = await upsertEmbedMessage(stockChannel, s.lastStockMessageId, stockEmbed);
        s.lastStockHash = newHash;
      }
    } else if (s.stockChannelId) {
      s.lastError = "Stock channel not found or not a text channel.";
    }

    // PRICES
    if (pricesChannel) {
      const shouldUpdatePrices =
        !s.lastPricesMessageId || !s.lastPricesHash || s.lastPricesHash !== newHash;

      if (shouldUpdatePrices) {
        const pricesEmbed = buildPricesEmbed(products, guild.name);
        s.lastPricesMessageId = await upsertEmbedMessage(pricesChannel, s.lastPricesMessageId, pricesEmbed);
        s.lastPricesHash = newHash;
      }
    } else if (s.pricesChannelId) {
      s.lastError = "Prices channel not found or not a text channel.";
    }

    s.lastOkAt = Date.now();
    s.lastError = null;
    saveStore();
  } catch (e) {
    s.lastError = String(e?.message || e).slice(0, 300);
    saveStore();
  }
}

function startLoop() {
  setInterval(async () => {
    for (const guild of client.guilds.cache.values()) {
      await updateForGuild(guild).catch(() => {});
    }
  }, UPDATE_INTERVAL_MS);
}

/* -------------------- INTERACTIONS -------------------- */
client.on("interactionCreate", async (interaction) => {
  try {
    if (!interaction.isChatInputCommand()) return;
    if (!interaction.guild) return;

    const isAdmin = interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator);

    if (interaction.commandName === "stock") {
      const sub = interaction.options.getSubcommand();

      if (sub === "channel") {
        if (!isAdmin) return interaction.reply({ content: "Admins only.", ephemeral: true });

        const ch = interaction.options.getChannel("channel", true);
        const s = getGuildSettings(interaction.guild.id);

        s.stockChannelId = ch.id;
        s.lastStockMessageId = null;
        s.lastStockHash = null;
        saveStore();

        await interaction.reply({
          content: `✅ Stock channel set to ${ch}. I’ll auto-update every **1 minute**.`,
          ephemeral: true,
        });

        await updateForGuild(interaction.guild).catch(() => {});
        return;
      }

      // /stock show
      await interaction.deferReply({ ephemeral: false });
      const products = await fetchBase44Products();
      const embed = buildStockEmbed(products, interaction.guild.name);
      return interaction.editReply({ embeds: [embed] });
    }

    if (interaction.commandName === "prices") {
      const sub = interaction.options.getSubcommand();

      if (sub === "channel") {
        if (!isAdmin) return interaction.reply({ content: "Admins only.", ephemeral: true });

        const ch = interaction.options.getChannel("channel", true);
        const s = getGuildSettings(interaction.guild.id);

        s.pricesChannelId = ch.id;
        s.lastPricesMessageId = null;
        s.lastPricesHash = null;
        saveStore();

        await interaction.reply({
          content: `✅ Prices channel set to ${ch}. I’ll auto-update every **1 minute**.`,
          ephemeral: true,
        });

        await updateForGuild(interaction.guild).catch(() => {});
        return;
      }

      // /prices show
      await interaction.deferReply({ ephemeral: false });
      const products = await fetchBase44Products();
      const embed = buildPricesEmbed(products, interaction.guild.name);
      return interaction.editReply({ embeds: [embed] });
    }

    if (interaction.commandName === "settings") {
      if (!isAdmin) return interaction.reply({ content: "Admins only.", ephemeral: true });

      const sub = interaction.options.getSubcommand();
      const s = getGuildSettings(interaction.guild.id);

      if (sub === "show") {
        const pretty = {
          stockChannelId: s.stockChannelId,
          lastStockMessageId: s.lastStockMessageId,
          pricesChannelId: s.pricesChannelId,
          lastPricesMessageId: s.lastPricesMessageId,
          lastOkAt: s.lastOkAt,
          lastError: s.lastError,
          base44BaseUrl: BASE44_BASE_URL,
          appId: BASE44_APP_ID,
          intervalMs: UPDATE_INTERVAL_MS,
        };
        return interaction.reply({
          content: "```json\n" + JSON.stringify(pretty, null, 2).slice(0, 1900) + "\n```",
          ephemeral: true,
        });
      }

      if (sub === "set_channel") {
        const type = interaction.options.getString("type", true);
        const ch = interaction.options.getChannel("channel", true);

        if (type === "stock") {
          s.stockChannelId = ch.id;
          s.lastStockMessageId = null;
          s.lastStockHash = null;
          saveStore();

          await interaction.reply({ content: `✅ Stock channel set to ${ch}.`, ephemeral: true });
          await updateForGuild(interaction.guild).catch(() => {});
          return;
        }

        if (type === "prices") {
          s.pricesChannelId = ch.id;
          s.lastPricesMessageId = null;
          s.lastPricesHash = null;
          saveStore();

          await interaction.reply({ content: `✅ Prices channel set to ${ch}.`, ephemeral: true });
          await updateForGuild(interaction.guild).catch(() => {});
          return;
        }

        return interaction.reply({ content: "Unknown channel type.", ephemeral: true });
      }
    }
  } catch (e) {
    console.error("interaction error:", e);
    try {
      if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: "Error handling that command.", ephemeral: true });
      }
    } catch {}
  }
});

/* -------------------- READY -------------------- */
process.on("unhandledRejection", (r) => console.error("unhandledRejection:", r));
process.on("uncaughtException", (e) => console.error("uncaughtException:", e));

client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  try {
    await client.application.fetch();
  } catch {}

  try {
    await registerGlobal();
  } catch (e) {
    console.log("❌ Slash register failed:", e?.message || e);
  }

  // Immediate update for guilds that already have a channel set
  for (const guild of client.guilds.cache.values()) {
    await updateForGuild(guild).catch(() => {});
  }

  startLoop();
});

/* -------------------- LOGIN -------------------- */
if (!TOKEN) {
  console.error("❌ Missing TOKEN in env");
  process.exit(1);
}

client.login(TOKEN);
