/**
 * DonutDemand Stock + Prices Bot — Single File (discord.js v14)
 *
 * ✅ FIX IMPLEMENTED:
 * Your “everything out of stock / no prices listed” issue happens when the API returns
 * different field names (or nested fields) than the bot expects.
 *
 * This rewrite adds a robust normalizer that can read stock/price from MANY common
 * Base44 shapes (top-level, nested under fields/data, variants, etc).
 *
 * ALSO INCLUDED:
 *  - /base44debug (admin) -> shows keys + a trimmed example product so we can confirm mapping.
 *
 * Commands:
 *  - /stock show
 *  - /stock channel (admin)
 *  - /prices show
 *  - /prices channel (admin)
 *  - /settings show (admin)
 *  - /settings set_channel (admin) -> type: stock | prices
 *  - /base44debug (admin)
 *
 * Auto:
 *  - Every 1 minute: fetch Base44 products and update stock/prices messages in configured channels.
 *
 * ENV:
 *  - TOKEN=discord_bot_token
 *  - BASE44_API_KEY=your_base44_api_key
 *  - BASE44_BASE_URL=https://donutdemand.net
 * Optional:
 *  - BASE44_PRODUCTS_ENDPOINT=/api/products        (default)
 *  - UPDATE_INTERVAL_MS=60000
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
const BASE44_PRODUCTS_ENDPOINT = process.env.BASE44_PRODUCTS_ENDPOINT || "/api/products";
const UPDATE_INTERVAL_MS = Number(process.env.UPDATE_INTERVAL_MS || 60_000);

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

/* -------------------- BASE44 FETCH -------------------- */
async function fetchBase44Products() {
  if (!BASE44_BASE_URL) throw new Error("Missing BASE44_BASE_URL");

  const url = `${BASE44_BASE_URL}${BASE44_PRODUCTS_ENDPOINT.startsWith("/") ? "" : "/"}${BASE44_PRODUCTS_ENDPOINT}`;

  const headers = { "Content-Type": "application/json" };
  if (BASE44_API_KEY) {
    // send both common patterns (harmless if server ignores one)
    headers["Authorization"] = `Bearer ${BASE44_API_KEY}`;
    headers["X-API-Key"] = BASE44_API_KEY;
  }

  const res = await fetch(url, { method: "GET", headers });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Base44 fetch failed (${res.status}): ${text.slice(0, 200)}`);
  }

  const data = await res.json().catch(() => null);

  // tolerate many shapes: [], {items:[]}, {data:[]}, {results:[]}, {products:[]}
  const arr =
    Array.isArray(data) ? data :
    Array.isArray(data?.items) ? data.items :
    Array.isArray(data?.data) ? data.data :
    Array.isArray(data?.results) ? data.results :
    Array.isArray(data?.products) ? data.products :
    Array.isArray(data?.records) ? data.records :
    [];

  return arr;
}

/* -------------------- NORMALIZATION (FIX) -------------------- */
function escapeMd(s) {
  return String(s ?? "").replace(/([*_`~|>])/g, "\\$1");
}

function toNum(v) {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "string") {
    const t = v.trim();
    if (!t) return null;

    // handle "1,234"
    const cleaned = t.replace(/,/g, "");
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

// dot-path getter
function getPath(obj, pathStr) {
  try {
    const parts = pathStr.split(".");
    let cur = obj;
    for (const p of parts) {
      if (cur == null) return undefined;
      cur = cur[p];
    }
    return cur;
  } catch {
    return undefined;
  }
}

function firstDefined(values) {
  for (const v of values) {
    if (v !== undefined && v !== null) return v;
  }
  return undefined;
}

/**
 * Attempts to find a name, stock, price from a product object with lots of fallback keys/paths.
 */
function normalizeProduct(p) {
  // NAME candidates
  const name = String(
    firstDefined([
      p?.name,
      p?.title,
      p?.productName,
      p?.label,

      getPath(p, "fields.name"),
      getPath(p, "fields.title"),
      getPath(p, "fields.productName"),
      getPath(p, "fields.label"),

      getPath(p, "data.name"),
      getPath(p, "data.title"),
      getPath(p, "data.productName"),
      getPath(p, "data.label"),

      getPath(p, "attributes.name"),
      getPath(p, "attributes.title"),
    ]) ?? "Unknown"
  ).trim() || "Unknown";

  // STOCK candidates (numbers)
  const stockRaw = firstDefined([
    p?.stock,
    p?.quantity,
    p?.qty,
    p?.inventory,
    p?.inStock, // boolean sometimes

    getPath(p, "fields.stock"),
    getPath(p, "fields.quantity"),
    getPath(p, "fields.qty"),
    getPath(p, "fields.inventory"),
    getPath(p, "fields.inStock"),

    getPath(p, "data.stock"),
    getPath(p, "data.quantity"),
    getPath(p, "data.qty"),
    getPath(p, "data.inventory"),
    getPath(p, "data.inStock"),

    getPath(p, "attributes.stock"),
    getPath(p, "attributes.quantity"),
    getPath(p, "attributes.inventory"),

    // sometimes stock is inside a "variants[0]"
    Array.isArray(p?.variants) && p.variants[0] ? p.variants[0].stock : undefined,
    Array.isArray(p?.variants) && p.variants[0] ? p.variants[0].quantity : undefined,
    Array.isArray(getPath(p, "fields.variants")) && getPath(p, "fields.variants")[0]
      ? getPath(p, "fields.variants")[0].stock
      : undefined,
  ]);

  let stock = toNum(stockRaw);
  if (stock == null) stock = 0;

  // PRICE candidates (numbers)
  const priceRaw = firstDefined([
    p?.price,
    p?.cost,
    p?.amount,
    p?.value,

    getPath(p, "fields.price"),
    getPath(p, "fields.cost"),
    getPath(p, "fields.amount"),
    getPath(p, "fields.value"),

    getPath(p, "data.price"),
    getPath(p, "data.cost"),
    getPath(p, "data.amount"),
    getPath(p, "data.value"),

    getPath(p, "attributes.price"),
    getPath(p, "attributes.cost"),

    Array.isArray(p?.variants) && p.variants[0] ? p.variants[0].price : undefined,
    Array.isArray(p?.variants) && p.variants[0] ? p.variants[0].cost : undefined,
  ]);

  let price = toNum(priceRaw);

  // Heuristic: if price looks like cents (e.g. 2500), convert to dollars.
  // (Only if it's an integer >= 1000 and has no decimals.)
  if (price != null && Number.isInteger(price) && price >= 1000) {
    // this is a heuristic; if your prices are actually large, set your API to return dollars.
    price = price / 100;
  }

  return { name, stock, price };
}

function formatPrice(n) {
  if (n == null || !Number.isFinite(n)) return "N/A";
  return `$${n.toFixed(2)}`;
}

/* -------------------- EMBEDS (minimal + bold) -------------------- */
// STOCK:
// - list ONLY stock > 0
// - bottom note: "All items not listed are out of stock."
function buildStockEmbed(rawProducts) {
  const products = (rawProducts || []).map(normalizeProduct);

  const inStock = products
    .filter((p) => p.stock > 0)
    .sort((a, b) => b.stock - a.stock || a.name.localeCompare(b.name));

  const lines = inStock.map((p) => `**${escapeMd(p.name)}**  **${p.stock}**`);

  const description =
    (lines.length ? lines.join("\n") : "") +
    (lines.length ? "\n\n" : "") +
    "*All items not listed are out of stock.*";

  return new EmbedBuilder()
    .setTitle("📦 Live Stock")
    .setDescription(description)
    .setColor(0xff3b3b);
}

// PRICES:
// - list ONLY products with a valid price
function buildPricesEmbed(rawProducts) {
  const products = (rawProducts || []).map(normalizeProduct);

  const priced = products
    .filter((p) => p.price != null && Number.isFinite(p.price))
    .sort((a, b) => a.name.localeCompare(b.name));

  const lines = priced.map((p) => `**${escapeMd(p.name)}**  **${formatPrice(p.price)}**`);

  return new EmbedBuilder()
    .setTitle("💲 Live Prices")
    .setDescription(lines.length ? lines.join("\n") : "**No prices listed.**")
    .setColor(0xffc107);
}

/* -------------------- HASH + UPDATE -------------------- */
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
    console.error(`[Base44] ${guild.name} error:`, s.lastError);
    saveStore();
    return;
  }

  // STOCK auto message
  if (s.stockChannelId) {
    const ch = await guild.channels.fetch(s.stockChannelId).catch(() => null);
    if (ch && ch.isTextBased()) {
      const embed = buildStockEmbed(products);
      const h = hashEmbeds([embed.toJSON()]);

      if (h !== s.lastStockHash) {
        const msgId = await ensureMessage(ch, s.lastStockMessageId, { embeds: [embed] });
        s.lastStockMessageId = msgId;
        s.lastStockHash = h;
      }
    }
  }

  // PRICES auto message
  if (s.pricesChannelId) {
    const ch = await guild.channels.fetch(s.pricesChannelId).catch(() => null);
    if (ch && ch.isTextBased()) {
      const embed = buildPricesEmbed(products);
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

/* -------------------- DISCORD -------------------- */
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

/* -------------------- COMMANDS -------------------- */
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

  new SlashCommandBuilder()
    .setName("base44debug")
    .setDescription("Show Base44 product field keys (admin)"),
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

    if (interaction.commandName === "base44debug") {
      if (!isAdmin) return interaction.reply({ content: "Admins only.", ephemeral: true });

      await interaction.deferReply({ ephemeral: true });
      const products = await fetchBase44Products();

      const first = products?.[0];
      if (!first) return interaction.editReply("No products returned.");

      const keys = Object.keys(first).slice(0, 120);
      const trimmed = JSON.stringify(first, null, 2).slice(0, 1500);

      const normalized = normalizeProduct(first);
      const normStr = JSON.stringify(normalized, null, 2);

      return interaction.editReply(
        "Endpoint:\n```txt\n" +
          `${BASE44_BASE_URL}${BASE44_PRODUCTS_ENDPOINT}\n` +
          "```\n" +
          "Keys:\n```json\n" +
          JSON.stringify(keys, null, 2) +
          "\n```\n" +
          "First product (trimmed):\n```json\n" +
          trimmed +
          "\n```\n" +
          "Normalized (what the bot thinks):\n```json\n" +
          normStr +
          "\n```"
      );
    }

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
      const embed = buildStockEmbed(products);
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
      const embed = buildPricesEmbed(products);
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
          productsEndpoint: BASE44_PRODUCTS_ENDPOINT,
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

/* -------------------- LOOP -------------------- */
let loopTimer = null;

function startLoop() {
  if (loopTimer) clearInterval(loopTimer);

  loopTimer = setInterval(async () => {
    for (const guild of client.guilds.cache.values()) {
      await updateForGuild(guild).catch(() => {});
    }
  }, UPDATE_INTERVAL_MS);

  console.log(`⏱️ Auto-update loop started: every ${Math.round(UPDATE_INTERVAL_MS / 1000)}s`);
}

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
