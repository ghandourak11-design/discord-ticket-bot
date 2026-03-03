/**
 * DonutDemand Stock + Prices Bot — Single File (discord.js v14)
 * (keeps your working env names: BASE44_API_KEY, BASE44_BASE_URL, TOKEN, REGISTER_SCOPE)
 *
 * Commands:
 *  - /stock show
 *  - /stock channel (admin)
 *  - /prices show
 *  - /prices channel (admin)
 *  - /settings show (admin)
 *  - /settings set_channel (admin) -> type: stock | prices
 *
 * Auto:
 *  - Every 1 minute: fetch Base44 Product entities and update:
 *      - Stock message (in stock channel)
 *      - Prices message (in prices channel)
 *
 * ENV:
 *  - TOKEN=discord_bot_token
 *  - BASE44_API_KEY=your_base44_api_key
 *  - BASE44_BASE_URL=https://donutdemand.net
 * Optional:
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

/* -------------------- BASE44 FETCH (keep it simple, like your working version) -------------------- */
async function fetchBase44Products() {
  if (!BASE44_BASE_URL) throw new Error("Missing BASE44_BASE_URL");

  // IMPORTANT: keep endpoint generic; many Base44 sites expose /api/products
  // If YOUR working file used a different endpoint, put it back here.
  const url = `${BASE44_BASE_URL}/api/products`;

  const headers = { "Content-Type": "application/json" };
  if (BASE44_API_KEY) {
    // send both common styles (safe)
    headers["Authorization"] = `Bearer ${BASE44_API_KEY}`;
    headers["X-API-Key"] = BASE44_API_KEY;
  }

  const res = await fetch(url, { method: "GET", headers });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Base44 fetch failed (${res.status}): ${text.slice(0, 200)}`);
  }

  const data = await res.json().catch(() => null);

  // tolerate common shapes
  const arr =
    Array.isArray(data) ? data :
    Array.isArray(data?.items) ? data.items :
    Array.isArray(data?.data) ? data.data :
    Array.isArray(data?.results) ? data.results :
    [];

  // return raw products; embed builders will normalize
  return arr;
}

/* -------------------- EMBED HELPERS -------------------- */
function escapeMd(s) {
  return String(s ?? "").replace(/([*_`~|>])/g, "\\$1");
}
function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function getName(p) {
  return (
    p?.name ??
    p?.title ??
    p?.productName ??
    p?.label ??
    p?.Name ??
    p?.Title ??
    "Unknown"
  );
}
function getStock(p) {
  // try lots of keys; if boolean inStock exists, convert to 1/0
  let s = num(p?.stock);
  if (s == null) s = num(p?.quantity);
  if (s == null) s = num(p?.qty);
  if (s == null) s = num(p?.inventory);
  if (s == null && typeof p?.inStock === "boolean") s = p.inStock ? 1 : 0;
  if (s == null) s = 0;
  return s;
}
function getPrice(p) {
  let pr = num(p?.price);
  if (pr == null) pr = num(p?.cost);
  if (pr == null) pr = num(p?.amount);
  if (pr == null) pr = num(p?.value);
  return pr;
}
function formatPrice(n) {
  const v = num(n);
  if (v == null) return "N/A";
  return `$${v.toFixed(2)}`;
}

/* -------------------- NEW EMBEDS (exactly what you asked) -------------------- */
/**
 * STOCK:
 * - ONLY list items with stock > 0
 * - each line: **Product Name**  **Stock**
 * - bottom note: "All items not listed are out of stock."
 */
function buildStockEmbed(products, guildName) {
  const inStock = (products || [])
    .map((p) => ({ name: getName(p), stock: getStock(p) }))
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

/**
 * PRICES:
 * - list items that have a valid price
 * - each line: **Product Name**  **$Price**
 * - no extra footer/note
 */
function buildPricesEmbed(products, guildName) {
  const list = (products || [])
    .map((p) => ({ name: getName(p), price: getPrice(p) }))
    .filter((p) => p.price != null)
    .sort((a, b) => a.name.localeCompare(b.name));

  const lines = list.map((p) => `**${escapeMd(p.name)}**  **${formatPrice(p.price)}**`);

  return new EmbedBuilder()
    .setTitle("💲 Live Prices")
    .setDescription(lines.length ? lines.join("\n") : "**No prices found.**")
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
      const embed = buildStockEmbed(products, guild.name);
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
