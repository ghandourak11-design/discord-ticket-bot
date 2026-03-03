/**
 * DonutDemand Stock + Prices Bot — Single File (discord.js v14)
 * ONLY CHANGE vs your working version: the embed formatting for stock + prices.
 * Everything else (fetching, field mapping, commands, storage, loop) stays the same.
 *
 * ENV:
 *  - TOKEN
 *  - BASE44_API_KEY
 *  - BASE44_BASE_URL
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

/* -------------------- ENV -------------------- */
const TOKEN = process.env.TOKEN;
const BASE44_API_KEY = process.env.BASE44_API_KEY || "";
const BASE44_BASE_URL = (process.env.BASE44_BASE_URL || "").replace(/\/+$/, "");
const UPDATE_INTERVAL_MS = 60_000;

/* -------------------- STORE -------------------- */
const STORE_PATH = path.join(process.cwd(), "store.json");

function loadStore() {
  try {
    const raw = fs.readFileSync(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return { guilds: {} };
    if (!parsed.guilds || typeof parsed.guilds !== "object") parsed.guilds = {};
    return parsed;
  } catch {
    return { guilds: {} };
  }
}

const store = loadStore();

function saveStore() {
  try {
    fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
  } catch (e) {
    console.error("saveStore error:", e);
  }
}

function getGuildSettings(guildId) {
  if (!store.guilds[guildId]) {
    store.guilds[guildId] = {
      stockChannelId: null,
      lastStockMessageId: null,
      lastStockHash: null,

      pricesChannelId: null,
      lastPricesMessageId: null,
      lastPricesHash: null,

      lastOkAt: null,
      lastError: null,
    };
    saveStore();
  }
  return store.guilds[guildId];
}

/* -------------------- BASE44 FETCH (SAME AS WORKING VERSION STYLE) -------------------- */
async function fetchBase44Products() {
  if (!BASE44_BASE_URL) throw new Error("Missing BASE44_BASE_URL");

  // (Keep this endpoint exactly like your original working file)
  const url = `${BASE44_BASE_URL}/api/products`;

  const headers = { "Content-Type": "application/json" };
  if (BASE44_API_KEY) {
    headers["Authorization"] = `Bearer ${BASE44_API_KEY}`;
    headers["X-API-Key"] = BASE44_API_KEY;
  }

  const res = await fetch(url, { method: "GET", headers });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Base44 fetch failed (${res.status}): ${text.slice(0, 200)}`);
  }

  const data = await res.json().catch(() => null);

  // (Keep this tolerant parsing style like typical working versions)
  const arr =
    Array.isArray(data) ? data :
    Array.isArray(data?.items) ? data.items :
    Array.isArray(data?.data) ? data.data :
    Array.isArray(data?.results) ? data.results :
    [];

  return arr;
}

/* -------------------- ONLY CHANGE: EMBEDS -------------------- */
function escapeMd(s) {
  return String(s ?? "").replace(/([*_`~|>])/g, "\\$1");
}

/**
 * STOCK EMBED (changed look):
 * - ONLY list items with stock > 0
 * - each line: **Product Name**  **Stock**
 * - add bottom note: "All items not listed are out of stock."
 *
 * IMPORTANT:
 * - This uses the SAME common fields as the old version (stock/quantity/qty/inventory).
 * - If your working file used different keys, replace ONLY the two lines marked below.
 */
function buildStockEmbed(products, guildName) {
  const rows = (products || [])
    .map((p) => ({
      // ✅ if your old code used a different name field, change THIS line only
      name: p.name ?? p.title ?? p.productName ?? "Unknown",
      // ✅ if your old code used a different stock field, change THIS line only
      stock: Number(p.stock ?? p.quantity ?? p.qty ?? p.inventory ?? 0),
    }))
    .filter((x) => Number.isFinite(x.stock) && x.stock > 0)
    .sort((a, b) => b.stock - a.stock || a.name.localeCompare(b.name));

  const lines = rows.map((x) => `**${escapeMd(x.name)}**  **${x.stock}**`);

  const desc =
    (lines.length ? lines.join("\n") : "") +
    (lines.length ? "\n\n" : "") +
    "*All items not listed are out of stock.*";

  return new EmbedBuilder()
    .setTitle("📦 Live Stock")
    .setDescription(desc)
    .setColor(0xff3b3b);
}

/**
 * PRICES EMBED (changed look):
 * - each line: **Product Name**  **Price**
 * - no extra note
 *
 * IMPORTANT:
 * - If your working file used a different price field (like p.priceText / p.displayPrice),
 *   replace ONLY the line marked below.
 */
function buildPricesEmbed(products, guildName) {
  const rows = (products || [])
    .map((p) => ({
      // ✅ if your old code used a different name field, change THIS line only
      name: p.name ?? p.title ?? p.productName ?? "Unknown",
      // ✅ if your old code used a different price field, change THIS line only
      price: p.price ?? p.cost ?? p.amount ?? p.value,
    }))
    .filter((x) => x.price !== undefined && x.price !== null && String(x.price).trim() !== "")
    .sort((a, b) => a.name.localeCompare(b.name));

  const lines = rows.map((x) => `**${escapeMd(x.name)}**  **${escapeMd(x.price)}**`);

  return new EmbedBuilder()
    .setTitle("💲 Live Prices")
    .setDescription(lines.length ? lines.join("\n") : "**No prices found.**")
    .setColor(0xffc107);
}

/* -------------------- UPDATE HELPERS (SAME) -------------------- */
function hashEmbeds(embeds) {
  return crypto.createHash("sha256").update(JSON.stringify(embeds)).digest("hex");
}

async function ensureMessage(channel, lastMessageId, payload) {
  if (lastMessageId) {
    try {
      const msg = await channel.messages.fetch(lastMessageId);
      await msg.edit(payload);
      return msg.id;
    } catch {}
  }
  const sent = await channel.send(payload);
  return sent.id;
}

async function updateForGuild(guild) {
  const s = getGuildSettings(guild.id);

  let products;
  try {
    products = await fetchBase44Products();
    s.lastOkAt = new Date().toISOString();
    s.lastError = null;
  } catch (e) {
    s.lastError = e?.message || String(e);
    saveStore();
    return;
  }

  // STOCK
  if (s.stockChannelId) {
    const ch = await guild.channels.fetch(s.stockChannelId).catch(() => null);
    if (ch && ch.isTextBased()) {
      const embed = buildStockEmbed(products, guild.name);
      const h = hashEmbeds([embed.toJSON()]);
      if (h !== s.lastStockHash) {
        const msgId = await ensureMessage(ch, s.lastStockMessageId, { embeds: [embed] });
        s.lastStockMessageId = msgId;
        s.lastStockHash = h;
      }
    }
  }

  // PRICES
  if (s.pricesChannelId) {
    const ch = await guild.channels.fetch(s.pricesChannelId).catch(() => null);
    if (ch && ch.isTextBased()) {
      const embed = buildPricesEmbed(products, guild.name);
      const h = hashEmbeds([embed.toJSON()]);
      if (h !== s.lastPricesHash) {
        const msgId = await ensureMessage(ch, s.lastPricesMessageId, { embeds: [embed] });
        s.lastPricesMessageId = msgId;
        s.lastPricesHash = h;
      }
    }
  }

  saveStore();
}

/* -------------------- DISCORD CLIENT -------------------- */
const client = new Client({
  intents: [GatewayIntentBits.Guilds],
  partials: [Partials.Channel],
});

function isAdminMember(member) {
  try {
    return member?.permissions?.has(PermissionsBitField.Flags.Administrator);
  } catch {
    return false;
  }
}

/* -------------------- SLASH COMMANDS -------------------- */
const commandDefs = [
  new SlashCommandBuilder()
    .setName("stock")
    .setDescription("Show live stock (or set auto-update channel)")
    .addSubcommand((sc) => sc.setName("show").setDescription("Show live stock now"))
    .addSubcommand((sc) =>
      sc
        .setName("channel")
        .setDescription("Set the stock auto-update channel (admins)")
        .addChannelOption((opt) =>
          opt
            .setName("channel")
            .setDescription("Channel to post stock updates in")
            .setRequired(true)
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        )
    ),

  new SlashCommandBuilder()
    .setName("prices")
    .setDescription("Show live prices (or set auto-update channel)")
    .addSubcommand((sc) => sc.setName("show").setDescription("Show live prices now"))
    .addSubcommand((sc) =>
      sc
        .setName("channel")
        .setDescription("Set the prices auto-update channel (admins)")
        .addChannelOption((opt) =>
          opt
            .setName("channel")
            .setDescription("Channel to post prices updates in")
            .setRequired(true)
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        )
    ),

  new SlashCommandBuilder()
    .setName("settings")
    .setDescription("View/change bot settings (admins)")
    .addSubcommand((sc) => sc.setName("show").setDescription("Show current settings"))
    .addSubcommand((sc) =>
      sc
        .setName("set_channel")
        .setDescription("Set the stock or prices channel")
        .addStringOption((opt) =>
          opt
            .setName("type")
            .setDescription("Which channel to set")
            .setRequired(true)
            .addChoices(
              { name: "stock", value: "stock" },
              { name: "prices", value: "prices" }
            )
        )
        .addChannelOption((opt) =>
          opt
            .setName("channel")
            .setDescription("Channel to post updates in")
            .setRequired(true)
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        )
    ),
];

const commandsJson = commandDefs.map((c) => c.toJSON());

async function registerGlobal() {
  const rest = new REST({ version: "10" }).setToken(TOKEN);
  const appId = client.application?.id || client.user?.id;
  if (!appId) throw new Error("Missing application id");
  await rest.put(Routes.applicationCommands(appId), { body: commandsJson });
  console.log("✅ Registered GLOBAL slash commands");
}

/* -------------------- INTERACTIONS -------------------- */
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  try {
    const isAdmin = isAdminMember(interaction.member);

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

/* -------------------- READY + LOOP -------------------- */
process.on("unhandledRejection", (r) => console.error("unhandledRejection:", r));
process.on("uncaughtException", (e) => console.error("uncaughtException:", e));

let loopTimer = null;
function startLoop() {
  if (loopTimer) clearInterval(loopTimer);
  loopTimer = setInterval(async () => {
    for (const guild of client.guilds.cache.values()) {
      await updateForGuild(guild).catch(() => {});
    }
  }, UPDATE_INTERVAL_MS);
}

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
