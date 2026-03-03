/**
 * DonutDemand Stock + Prices Bot — Single File (discord.js v14)
 *
 * Commands:
 *  - /stock show
 *  - /stock channel (admin)        -> set stock auto-update channel
 *  - /prices show
 *  - /prices channel (admin)       -> set prices auto-update channel
 *  - /settings show (admin)
 *  - /settings set_channel (admin) -> type: stock | prices
 *
 * Auto:
 *  - Every 1 minute: fetch Base44 products and update the pinned-style message in each configured channel.
 *
 * ENV:
 *  - TOKEN=discord_bot_token
 *  - BASE44_API_KEY=your_base44_api_key
 *  - BASE44_BASE_URL=https://donutdemand.net
 *  - BASE44_PRODUCTS_ENDPOINT=/api/products   (optional override)
 *  - UPDATE_INTERVAL_MS=60000                 (optional)
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
const store = loadStore();

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

/* -------------------- FETCH -------------------- */
async function fetchImpl() {
  if (typeof fetch === "function") return fetch;
  // fallback for older runtimes
  const mod = await import("node-fetch");
  return mod.default;
}

function safeNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function cleanStr(v) {
  if (v == null) return "";
  return String(v).trim();
}

/**
 * Normalizes a Base44-ish product shape into:
 * { id, name, stock, price }
 *
 * This is written to tolerate different schemas:
 * - name: name | title | productName
 * - stock: stock | quantity | qty | inventory | inStock (boolean)
 * - price: price | cost | amount | value
 */
function normalizeProduct(p) {
  const id =
    cleanStr(p?.id) ||
    cleanStr(p?._id) ||
    cleanStr(p?.uuid) ||
    cleanStr(p?.key) ||
    cleanStr(p?.slug) ||
    "";

  const name =
    cleanStr(p?.name) ||
    cleanStr(p?.title) ||
    cleanStr(p?.productName) ||
    cleanStr(p?.label) ||
    (id ? id : "Unknown");

  // stock can be boolean or number
  let stock = safeNum(p?.stock);
  if (stock == null) stock = safeNum(p?.quantity);
  if (stock == null) stock = safeNum(p?.qty);
  if (stock == null) stock = safeNum(p?.inventory);

  if (stock == null && typeof p?.inStock === "boolean") {
    stock = p.inStock ? 1 : 0;
  }
  if (stock == null) stock = 0;

  let price = safeNum(p?.price);
  if (price == null) price = safeNum(p?.cost);
  if (price == null) price = safeNum(p?.amount);
  if (price == null) price = safeNum(p?.value);

  return { id, name, stock, price };
}

async function fetchBase44Products() {
  if (!BASE44_BASE_URL) throw new Error("Missing BASE44_BASE_URL");
  const f = await fetchImpl();

  const url = BASE44_BASE_URL + BASE44_PRODUCTS_ENDPOINT;

  const headers = {
    "Content-Type": "application/json",
  };

  // Common patterns: Bearer token or X-API-Key
  if (BASE44_API_KEY) {
    headers["Authorization"] = `Bearer ${BASE44_API_KEY}`;
    headers["X-API-Key"] = BASE44_API_KEY;
  }

  const res = await f(url, { method: "GET", headers });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Base44 fetch failed (${res.status}): ${text.slice(0, 200)}`);
  }

  const data = await res.json();

  // tolerate: {items:[]}, {data:[]}, [] etc
  const arr =
    Array.isArray(data) ? data :
    Array.isArray(data?.items) ? data.items :
    Array.isArray(data?.data) ? data.data :
    Array.isArray(data?.results) ? data.results :
    [];

  return arr.map(normalizeProduct);
}

/* -------------------- EMBEDS (YOUR REQUEST) -------------------- */
/**
 * Stock embed rules:
 * - Only list items with stock > 0
 * - Each line only has bold product name and bold stock number
 * - Bottom note: "All items not listed are out of stock."
 */
function buildStockEmbed(products, guildName) {
  const inStock = (products || [])
    .filter((p) => (safeNum(p.stock) ?? 0) > 0)
    .sort((a, b) => {
      const sd = (b.stock || 0) - (a.stock || 0);
      if (sd !== 0) return sd;
      return a.name.localeCompare(b.name);
    });

  const lines = inStock.map((p) => `**${escapeMd(p.name)}**  **${p.stock}**`);

  // Only "name + stock/price in bold", nothing else — so keep it minimal.
  // We include ONLY the required bottom note for stock.
  const description =
    (lines.length ? lines.join("\n") : "") +
    (lines.length ? "\n\n" : "") +
    "*All items not listed are out of stock.*";

  return new EmbedBuilder()
    .setTitle("📦 Live Stock")
    .setDescription(description)
    .setColor(0xff3b3b);
}

/**
 * Prices embed rules:
 * - List products with a valid price (or all products; but price-only lines are what you want)
 * - Each line only has bold product name and bold price
 * - No extra bottom note
 */
function buildPricesEmbed(products, guildName) {
  const list = (products || [])
    .filter((p) => safeNum(p.price) != null)
    .sort((a, b) => a.name.localeCompare(b.name));

  const lines = list.map((p) => `**${escapeMd(p.name)}**  **${formatPrice(p.price)}**`);

  const description = lines.length ? lines.join("\n") : "**No prices found.**";

  return new EmbedBuilder()
    .setTitle("💲 Live Prices")
    .setDescription(description)
    .setColor(0xffc107);
}

function formatPrice(n) {
  const num = safeNum(n);
  if (num == null) return "N/A";
  // keep simple; if you want currency symbol, keep it consistent:
  // If you do NOT want "$", remove it below.
  return `$${num.toFixed(2)}`;
}

function escapeMd(s) {
  // minimal escaping to prevent formatting breaks
  return String(s).replace(/([*_`~|>])/g, "\\$1");
}

/* -------------------- HASHING + MESSAGE UPDATE -------------------- */
function hashText(s) {
  return crypto.createHash("sha256").update(String(s)).digest("hex");
}

async function ensureMessage(channel, lastMessageId, payload) {
  // Try edit existing message; if missing, send a new one.
  if (lastMessageId) {
    try {
      const msg = await channel.messages.fetch(lastMessageId);
      await msg.edit(payload);
      return msg.id;
    } catch {
      // fall through to send new
    }
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
    if (ch && ch.isTextBased && ch.type !== ChannelType.DM) {
      const embed = buildStockEmbed(products, guild.name);
      const textForHash = embed.data?.description || "";
      const h = hashText(textForHash);

      if (h !== s.lastStockHash) {
        const messageId = await ensureMessage(ch, s.lastStockMessageId, { embeds: [embed] });
        s.lastStockMessageId = messageId;
        s.lastStockHash = h;
      }
    }
  }

  // PRICES
  if (s.pricesChannelId) {
    const ch = await guild.channels.fetch(s.pricesChannelId).catch(() => null);
    if (ch && ch.isTextBased && ch.type !== ChannelType.DM) {
      const embed = buildPricesEmbed(products, guild.name);
      const textForHash = embed.data?.description || "";
      const h = hashText(textForHash);

      if (h !== s.lastPricesHash) {
        const messageId = await ensureMessage(ch, s.lastPricesMessageId, { embeds: [embed] });
        s.lastPricesMessageId = messageId;
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
const commands = [
  new SlashCommandBuilder()
    .setName("stock")
    .setDescription("Show live stock (or set auto-update channel)")
    .addSubcommand((sc) =>
      sc
        .setName("show")
        .setDescription("Show live stock now")
    )
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
    .addSubcommand((sc) =>
      sc
        .setName("show")
        .setDescription("Show live prices now")
    )
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
    .setDescription("View or change bot settings (admins)")
    .addSubcommand((sc) =>
      sc.setName("show").setDescription("Show current settings")
    )
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
].map((c) => c.toJSON());

async function registerGlobal() {
  const rest = new REST({ version: "10" }).setToken(TOKEN);
  const appId = client.application?.id || client.user?.id;
  if (!appId) throw new Error("Missing application id (login not ready?)");

  await rest.put(Routes.applicationCommands(appId), { body: commands });
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
