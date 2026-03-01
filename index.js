/**
 * DonutDemand Stock Bot — Single File (discord.js v14)
 * Commands:
 *  - /stock
 *  - /stock channel (admin)  -> set stock channel
 *  - /settings show (admin)
 *  - /settings set_channel (admin) -> supports type: stock
 *
 * Auto:
 *  - Every 1 minute, fetch Base44 Product entities and update the stock message in the configured channel.
 *
 * ENV:
 *  - TOKEN=discord_bot_token
 *  - BASE44_API_KEY=your_base44_api_key
 *  - BASE44_BASE_URL=https://donutdemand.net        (or your Base44-hosted domain)
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
const BASE44_APP_ID = "698bba4e9e06a075e7c32be6"; // hardcoded (you said idc)
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
    stockChannelId: null,
    lastStockMessageId: null,
    lastStockHash: null,
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
    .addSubcommand((s) =>
      s.setName("show").setDescription("Show current stock in this channel.")
    )
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
            .addChoices({ name: "stock", value: "stock" })
        )
        .addChannelOption((o) =>
          o
            .setName("channel")
            .setDescription("Text channel")
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
    );

  return [stockCmd, settingsCmd].map((c) => c.toJSON());
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

function groupByCategory(products) {
  const groups = new Map();
  for (const p of products) {
    const name = String(p?.name ?? "Unnamed");
    const qtyRaw = p?.quantity ?? p?.stock ?? p?.qty ?? 0;
    const quantity = Number.isFinite(Number(qtyRaw)) ? Number(qtyRaw) : 0;
    const category = String(p?.category ?? "Other");

    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push({ name, quantity });
  }

  // sort each group by name
  for (const [cat, items] of groups.entries()) {
    items.sort((a, b) => a.name.localeCompare(b.name));
    groups.set(cat, items);
  }

  // sort categories
  return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

function hashProducts(products) {
  const minimal = products
    .map((p) => ({
      name: String(p?.name ?? ""),
      quantity: Number(p?.quantity ?? p?.stock ?? p?.qty ?? 0) || 0,
      category: String(p?.category ?? "Other"),
    }))
    .sort((a, b) => (a.category + a.name).localeCompare(b.category + b.name));

  return crypto.createHash("sha256").update(JSON.stringify(minimal)).digest("hex");
}

function buildStockEmbed(products, guildName) {
  const grouped = groupByCategory(products);

  const embed = new EmbedBuilder()
    .setTitle("📦 Stock Update")
    .setDescription(`Live stock pulled from Base44.\nServer: **${guildName}**`)
    .setColor(0xed4245)
    .setTimestamp();

  if (!products.length) {
    embed.addFields({ name: "No products", value: "Nothing returned from Base44.", inline: false });
    return embed;
  }

  // Discord embed field value limit is 1024. We'll chunk categories if needed.
  for (const [cat, items] of grouped) {
    const lines = items.map((x) => `• ${x.name} — **${x.quantity}**`);
    let value = lines.join("\n");
    if (value.length <= 1024) {
      embed.addFields({ name: cat, value, inline: false });
      continue;
    }

    // chunk the lines to fit
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

  embed.setFooter({ text: "Auto-updates every 1 minute" });
  return embed;
}

/* -------------------- STOCK UPDATE LOOP -------------------- */
async function updateStockForGuild(guild) {
  const s = getGuildSettings(guild.id);
  if (!s.stockChannelId) return;

  const channel = await guild.channels.fetch(s.stockChannelId).catch(() => null);
  if (!channel || channel.type !== ChannelType.GuildText) {
    s.lastError = "Stock channel not found or not a text channel.";
    saveStore();
    return;
  }

  try {
    const products = await fetchBase44Products();
    const newHash = hashProducts(products);

    // if nothing changed, do nothing
    if (s.lastStockHash && s.lastStockHash === newHash && s.lastStockMessageId) {
      s.lastOkAt = Date.now();
      s.lastError = null;
      saveStore();
      return;
    }

    const embed = buildStockEmbed(products, guild.name);

    // Try edit existing message
    if (s.lastStockMessageId) {
      const msg = await channel.messages.fetch(s.lastStockMessageId).catch(() => null);
      if (msg) {
        await msg.edit({ embeds: [embed] }).catch(() => {});
        s.lastStockHash = newHash;
        s.lastOkAt = Date.now();
        s.lastError = null;
        saveStore();
        return;
      }
    }

    // Otherwise send new message
    const sent = await channel.send({ embeds: [embed] });
    s.lastStockMessageId = sent.id;
    s.lastStockHash = newHash;
    s.lastOkAt = Date.now();
    s.lastError = null;
    saveStore();
  } catch (e) {
    s.lastError = String(e?.message || e).slice(0, 300);
    saveStore();
  }
}

function startStockLoop() {
  setInterval(async () => {
    for (const guild of client.guilds.cache.values()) {
      await updateStockForGuild(guild).catch(() => {});
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
        s.lastStockMessageId = null; // reset so it posts fresh
        s.lastStockHash = null;
        saveStore();

        await interaction.reply({ content: `✅ Stock channel set to ${ch}. I’ll auto-update every **1 minute**.`, ephemeral: true });
        // push an immediate update
        await updateStockForGuild(interaction.guild).catch(() => {});
        return;
      }

      // /stock show
      await interaction.deferReply({ ephemeral: false });
      const products = await fetchBase44Products();
      const embed = buildStockEmbed(products, interaction.guild.name);
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
          await updateStockForGuild(interaction.guild).catch(() => {});
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
    await updateStockForGuild(guild).catch(() => {});
  }

  startStockLoop();
});

/* -------------------- LOGIN -------------------- */
if (!TOKEN) {
  console.error("❌ Missing TOKEN in env");
  process.exit(1);
}

client.login(TOKEN);
