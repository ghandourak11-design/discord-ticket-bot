/**
 * DonutDemand Bot — Full
 *
 * ✅ GLOBAL slash commands (work in EVERY server your bot is in)
 * ✅ Adam-only /stop <server_id> + /resume <server_id> (hard disables bot per server)
 *    - When disabled: any interaction/prefix command gets PUBLIC message:
 *      "Adam has restricted commands in your server."
 *
 * ✅ /panel (ADMIN only) — configure + post ticket panel per-server (JSON config)
 *    /panel set <json>
 *    /panel post [channel]
 *    /panel show
 *    /panel reset
 *
 * ✅ Tickets:
 *   - Button -> Modal (MC username + What do you need?)
 *   - Auto-create 1 category per ticket type
 *   - 1 open ticket per user
 *   - Staff roles can view tickets
 *   - /close: opener or staff/admin
 *     - DMs opener a detailed embed
 *     - deletes ticket after 3 seconds
 *
 * ✅ Invites (persistent JSON):
 *   - Tracks joins / rejoins / leaves / manual
 *   - /invites, /generate, /linkinvite, /link, /addinvites, /resetinvites, /resetall
 *
 * ✅ Automod:
 *   - Blocks links unless Admin OR has role named "automod" (auto-created if possible)
 *
 * ✅ Giveaways:
 *   - /giveaway, /end, /reroll with join button
 *
 * ✅ Prefix admin commands (Administrator only):
 *   - !stick / !unstick / !mute / !ban / !kick / !purge
 *
 * ENV:
 *  TOKEN=...
 *
 * Dev Portal Intents:
 *  - Server Members Intent
 *  - Message Content Intent
 *
 * NOTE:
 *  Invite bot with scopes:
 *   ✅ bot
 *   ✅ applications.commands
 */

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

/* ===================== CONFIG ===================== */

const PREFIX = "!";
const AUTOMOD_ROLE_NAME = "automod";

/** Adam-only owner lock */
const OWNER_ID = "1456326972631154786";
const RESTRICT_MESSAGE = "Adam has restricted commands in your server.";

/** Updated IDs */
const CUSTOMER_ROLE_ID = "1474606828875677858";
const VOUCHES_CHANNEL_ID = "1474606921305821466";
const WELCOME_CHANNEL_ID = "1474606890842329169"; // ✅ NEW welcome channel id

/** Staff roles */
const STAFF_ROLE_IDS = [
  "1465888170531881123",
  "1457184344538874029",
  "1456504229148758229",
  "1464012365472337990",
];

/** ONLY these roles can /resetinvites (admins do NOT bypass unless also staff) */
const RESETINVITES_ROLE_IDS = [...STAFF_ROLE_IDS];

/* ===================== DEFAULT PANEL CONFIG ===================== */

const DEFAULT_PANEL_CONFIG = {
  embed: {
    title: "Tickets",
    description:
      "🆘| Help & Support Ticket\nIf you need help with anything, create a support ticket.\n\n" +
      "💰| Claim Order\nIf you have placed an order and are waiting to receive it please open this ticket.\n\n" +
      "💸| Sell To us\nWant to make some real cash off the donutsmp? Open a ticket and sell to us here.\n\n" +
      "🎁| Claim Rewards Ticket\nLooking to claim rewards, make this ticket.",
    color: "#FF0000",
  },
  modal: {
    title: "Ticket Info",
    mcLabel: "What is your Minecraft username?",
    needLabel: "What do you need?",
  },
  tickets: [
    {
      id: "ticket_support",
      label: "Help & Support",
      category: "Help & Support",
      key: "help-support",
      button: { label: "Help & Support", style: "Primary", emoji: "🆘" },
    },
    {
      id: "ticket_claim",
      label: "Claim Order",
      category: "Claim Order",
      key: "claim-order",
      button: { label: "Claim Order", style: "Success", emoji: "💰" },
    },
    {
      id: "ticket_sell",
      label: "Sell To us",
      category: "Sell To us",
      key: "sell-to-us",
      button: { label: "Sell To us", style: "Secondary", emoji: "💸" },
    },
    {
      id: "ticket_rewards",
      label: "Rewards",
      category: "Rewards",
      key: "rewards",
      button: { label: "Rewards", style: "Danger", emoji: "🎁" },
    },
  ],
};

/* ===================== STORAGE ===================== */

const DATA_DIR = __dirname;

const INVITES_FILE = path.join(DATA_DIR, "invites_data.json");
const GIVEAWAYS_FILE = path.join(DATA_DIR, "giveaways_data.json");
const PANEL_FILE = path.join(DATA_DIR, "panel_config.json");
const RESTRICTIONS_FILE = path.join(DATA_DIR, "restricted_guilds.json");

function loadJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}
function saveJson(file, data) {
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error("Save failed:", file, e.message);
  }
}

/** Invites data */
const invitesData = loadJson(INVITES_FILE, {
  inviterStats: {}, // inviterId -> { joins, rejoins, left, manual }
  memberInviter: {}, // memberId -> creditedInviterId
  inviteOwners: {}, // inviteCode -> userId (custom credit owner)
  invitedMembers: {}, // inviterId -> { memberId: { inviteCode, joinedAt, active, leftAt } }
});
invitesData.inviterStats ??= {};
invitesData.memberInviter ??= {};
invitesData.inviteOwners ??= {};
invitesData.invitedMembers ??= {};
saveJson(INVITES_FILE, invitesData);

function saveInvites() {
  saveJson(INVITES_FILE, invitesData);
}

/** Giveaways data */
const giveawayData = loadJson(GIVEAWAYS_FILE, { giveaways: {} });
giveawayData.giveaways ??= {};
saveJson(GIVEAWAYS_FILE, giveawayData);

function saveGiveaways() {
  saveJson(GIVEAWAYS_FILE, giveawayData);
}

/** Panel config per guild */
const panelStore = loadJson(PANEL_FILE, { byGuild: {} });
panelStore.byGuild ??= {};
saveJson(PANEL_FILE, panelStore);

function savePanelStore() {
  saveJson(PANEL_FILE, panelStore);
}

/** Restrictions per guild */
const restrictionsData = loadJson(RESTRICTIONS_FILE, { blockedGuilds: {} });
// blockedGuilds: { [guildId]: { blockedAt: number, blockedBy: string } }
restrictionsData.blockedGuilds ??= {};
saveJson(RESTRICTIONS_FILE, restrictionsData);

function saveRestrictions() {
  saveJson(RESTRICTIONS_FILE, restrictionsData);
}
function isGuildBlocked(guildId) {
  return Boolean(restrictionsData.blockedGuilds?.[guildId]);
}

/* ===================== CLIENT ===================== */

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildInvites,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

/* ===================== HELPERS ===================== */

function cleanName(str) {
  return (str || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 24);
}

function parseUserId(arg) {
  if (!arg) return null;
  const mention = String(arg).match(/^<@!?(\d{10,25})>$/);
  if (mention) return mention[1];
  const id = String(arg).match(/^(\d{10,25})$/);
  if (id) return id[1];
  return null;
}

function containsLink(content) {
  if (!content) return false;
  const urlRegex = /(https?:\/\/\S+)|(www\.\S+)/i;
  const inviteRegex = /(discord\.gg\/\S+)|(discord\.com\/invite\/\S+)/i;
  return urlRegex.test(content) || inviteRegex.test(content);
}

function extractInviteCode(input) {
  if (!input) return null;
  return String(input)
    .trim()
    .replace(/^https?:\/\/(www\.)?(discord\.gg|discord\.com\/invite)\//i, "")
    .replace(/[\s/]+/g, "")
    .slice(0, 64);
}

function extractMessageId(input) {
  if (!input) return null;
  const s = String(input).trim();
  const m1 = s.match(/\/(\d{10,25})$/);
  if (m1) return m1[1];
  const m2 = s.match(/^(\d{10,25})$/);
  if (m2) return m2[1];
  return null;
}

function parseHexColor(input) {
  if (!input) return null;
  let s = String(input).trim();
  if (s.startsWith("#")) s = s.slice(1);
  if (s.startsWith("0x")) s = s.slice(2);
  if (!/^[0-9a-fA-F]{6}$/.test(s)) return null;
  return parseInt(s, 16);
}

function memberHasAnyRole(member, roleIds) {
  return roleIds.some((rid) => member.roles.cache.has(rid));
}

function isStaff(member) {
  if (!member) return false;
  if (member.permissions.has(PermissionsBitField.Flags.Administrator)) return true;
  return memberHasAnyRole(member, STAFF_ROLE_IDS);
}

async function ensureAutoModRole(guild) {
  let role = guild.roles.cache.find((r) => r.name.toLowerCase() === AUTOMOD_ROLE_NAME);
  if (role) return role;

  const me = await guild.members.fetchMe();
  if (!me.permissions.has(PermissionsBitField.Flags.ManageRoles)) return null;

  role = await guild.roles.create({
    name: AUTOMOD_ROLE_NAME,
    permissions: [],
    mentionable: false,
    hoist: false,
    reason: "Auto-created for link bypass",
  });

  return role;
}

/* ===================== INVITES ===================== */

function ensureInviterStats(inviterId) {
  if (!invitesData.inviterStats[inviterId]) {
    invitesData.inviterStats[inviterId] = { joins: 0, rejoins: 0, left: 0, manual: 0 };
  } else {
    const s = invitesData.inviterStats[inviterId];
    s.joins ??= 0;
    s.rejoins ??= 0;
    s.left ??= 0;
    s.manual ??= 0;
  }
  return invitesData.inviterStats[inviterId];
}

function invitesStillInServer(inviterId) {
  const s = ensureInviterStats(inviterId);
  const base = (s.joins || 0) + (s.rejoins || 0) - (s.left || 0);
  return Math.max(0, base + (s.manual || 0));
}

/* ===================== INVITE CACHE ===================== */

const invitesCache = new Map(); // guildId -> Map(code->uses)

async function refreshGuildInvites(guild) {
  const invites = await guild.invites.fetch();
  const map = new Map();
  invites.forEach((inv) => map.set(inv.code, inv.uses ?? 0));
  invitesCache.set(guild.id, map);
  return invites;
}

/* ===================== PANEL CONFIG ===================== */

function getPanelConfig(guildId) {
  return panelStore.byGuild[guildId] || DEFAULT_PANEL_CONFIG;
}

function normalizeButtonStyle(style) {
  const s = String(style || "").toLowerCase();
  if (s === "primary") return ButtonStyle.Primary;
  if (s === "secondary") return ButtonStyle.Secondary;
  if (s === "success") return ButtonStyle.Success;
  if (s === "danger") return ButtonStyle.Danger;
  return ButtonStyle.Primary;
}

function validatePanelConfig(cfg) {
  if (!cfg || typeof cfg !== "object") return { ok: false, msg: "Config must be a JSON object." };

  const embed = cfg.embed || {};
  const modal = cfg.modal || {};
  const tickets = Array.isArray(cfg.tickets) ? cfg.tickets : null;

  if (!tickets || tickets.length < 1) return { ok: false, msg: "Config must include tickets: [...] with at least 1 type." };
  if (tickets.length > 4) return { ok: false, msg: "Max 4 ticket types (fits in one button row)." };

  const title = String(embed.title ?? "").trim();
  const desc = String(embed.description ?? "").trim();
  const color = String(embed.color ?? "").trim();

  if (!title || title.length > 256) return { ok: false, msg: "embed.title is required and must be <= 256 chars." };
  if (!desc || desc.length > 4000) return { ok: false, msg: "embed.description is required and must be <= 4000 chars." };
  if (color && !parseHexColor(color)) return { ok: false, msg: "embed.color must be a hex like #FF0000." };

  const mTitle = String(modal.title ?? "Ticket Info");
  const mcLabel = String(modal.mcLabel ?? "What is your Minecraft username?");
  const needLabel = String(modal.needLabel ?? "What do you need?");

  if (mTitle.length < 1 || mTitle.length > 45) return { ok: false, msg: "modal.title must be 1-45 chars." };
  if (mcLabel.length < 1 || mcLabel.length > 45) return { ok: false, msg: "modal.mcLabel must be 1-45 chars." };
  if (needLabel.length < 1 || needLabel.length > 45) return { ok: false, msg: "modal.needLabel must be 1-45 chars." };

  const seenIds = new Set();
  for (const t of tickets) {
    const id = String(t.id || "").trim();
    const label = String(t.label || "").trim();
    const category = String(t.category || "").trim();
    const key = String(t.key || "").trim();

    if (!id || id.length > 100) return { ok: false, msg: "Each ticket needs id (<= 100 chars)." };
    if (seenIds.has(id)) return { ok: false, msg: `Duplicate ticket id: ${id}` };
    seenIds.add(id);

    if (!label || label.length > 80) return { ok: false, msg: "Each ticket needs label (<= 80 chars)." };
    if (!category || category.length > 100) return { ok: false, msg: "Each ticket needs category (<= 100 chars)." };
    if (!key || key.length > 60) return { ok: false, msg: "Each ticket needs key (<= 60 chars)." };

    const b = t.button || {};
    const bLabel = String(b.label || "").trim();
    if (!bLabel || bLabel.length > 80) return { ok: false, msg: "Each ticket.button needs label (<= 80 chars)." };

    const emoji = b.emoji ? String(b.emoji).trim() : "";
    if (emoji && emoji.length > 40) return { ok: false, msg: "ticket.button.emoji too long." };

    const style = b.style ? String(b.style).trim() : "Primary";
    if (!["Primary", "Secondary", "Success", "Danger"].includes(style)) {
      return { ok: false, msg: "ticket.button.style must be Primary/Secondary/Success/Danger." };
    }
  }

  return { ok: true, msg: "OK" };
}

function buildTicketPanelMessage(config) {
  const c = parseHexColor(config.embed?.color) ?? 0x2b2d31;
  const embed = new EmbedBuilder()
    .setTitle(String(config.embed?.title || "Tickets").slice(0, 256))
    .setDescription(String(config.embed?.description || "Open a ticket below.").slice(0, 4000))
    .setColor(c);

  const row = new ActionRowBuilder();
  for (const t of config.tickets) {
    const b = t.button || {};
    const btn = new ButtonBuilder()
      .setCustomId(`ticket:${t.id}`)
      .setLabel(String(b.label || t.label).slice(0, 80))
      .setStyle(normalizeButtonStyle(b.style || "Primary"));
    if (b.emoji) btn.setEmoji(String(b.emoji));
    row.addComponents(btn);
  }

  return { embeds: [embed], components: [row] };
}

/* ===================== TICKETS ===================== */

async function getOrCreateCategory(guild, name) {
  let cat = guild.channels.cache.find((c) => c.type === ChannelType.GuildCategory && c.name === name);
  if (!cat) cat = await guild.channels.create({ name, type: ChannelType.GuildCategory });
  return cat;
}

/** Topic format: opener:<id>;created:<unixMs>;type:<ticketId> */
function getTicketMetaFromTopic(topic) {
  if (!topic) return null;
  const opener = topic.match(/opener:(\d{10,25})/i)?.[1] || null;
  const created = topic.match(/created:(\d{10,20})/i)?.[1] || null;
  const typeId = topic.match(/type:([a-z0-9_\-]{1,100})/i)?.[1] || null;
  if (!opener) return null;
  return { openerId: opener, createdAt: created ? Number(created) : null, typeId };
}

function isTicketChannel(channel) {
  return channel && channel.type === ChannelType.GuildText && Boolean(getTicketMetaFromTopic(channel.topic)?.openerId);
}

function findOpenTicketChannel(guild, openerId) {
  return guild.channels.cache.find((c) => {
    if (c.type !== ChannelType.GuildText) return false;
    const meta = getTicketMetaFromTopic(c.topic);
    return meta?.openerId === openerId;
  });
}

function resolveTicketType(config, typeId) {
  return (config.tickets || []).find((t) => t.id === typeId) || null;
}

function buildCloseDmEmbed({ guild, ticketChannelName, ticketTypeLabel, openedAtMs, closedByTag, reason }) {
  const openedUnix = openedAtMs ? Math.floor(openedAtMs / 1000) : null;
  const closedUnix = Math.floor(Date.now() / 1000);

  return new EmbedBuilder()
    .setTitle("Ticket Closed")
    .setColor(0xed4245)
    .setDescription("Your ticket has been closed. Details below:")
    .addFields(
      { name: "Server", value: `${guild.name}`, inline: true },
      { name: "Ticket", value: `${ticketChannelName}`, inline: true },
      { name: "Type", value: ticketTypeLabel || "Unknown", inline: true },
      { name: "Closed By", value: closedByTag || "Unknown", inline: true },
      { name: "Reason", value: String(reason || "No reason provided").slice(0, 1024), inline: false },
      { name: "Opened", value: openedUnix ? `<t:${openedUnix}:F> (<t:${openedUnix}:R>)` : "Unknown", inline: true },
      { name: "Closed", value: `<t:${closedUnix}:F> (<t:${closedUnix}:R>)`, inline: true },
      {
        name: "Welcome / Info",
        value:
          `• Welcome channel: <#${WELCOME_CHANNEL_ID}>\n` +
          `• Leave a vouch in <#${VOUCHES_CHANNEL_ID}>\n` +
          `• If you still need help, open a new ticket from the panel.`,
        inline: false,
      }
    )
    .setFooter({ text: "DonutDemand Support" });
}

/* ===================== STICKY + OPERATION TIMERS ===================== */

const stickyByChannel = new Map(); // channelId -> { content, messageId }
const activeOperations = new Map(); // channelId -> timeout handle

/* ===================== GIVEAWAYS ===================== */

function parseDurationToMs(input) {
  if (!input) return null;
  const s = input.trim().toLowerCase().replace(/\s+/g, "");
  const re = /(\d+)(s|m|h|d)/g;
  let total = 0;
  let ok = false;
  let m;
  while ((m = re.exec(s))) {
    ok = true;
    const n = parseInt(m[1], 10);
    const u = m[2];
    if (u === "s") total += n * 1000;
    if (u === "m") total += n * 60 * 1000;
    if (u === "h") total += n * 60 * 60 * 1000;
    if (u === "d") total += n * 24 * 60 * 60 * 1000;
  }
  if (!ok || total <= 0) return null;
  return total;
}

function pickRandomWinners(arr, n) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}

function makeGiveawayEmbed(gw) {
  const endUnix = Math.floor(gw.endsAt / 1000);
  const minInv = gw.minInvites > 0 ? `\nMin invites to join: **${gw.minInvites}**` : "";
  const status = gw.ended ? "\n**STATUS: ENDED**" : "";

  return new EmbedBuilder()
    .setTitle(`🎁 GIVEAWAY — ${gw.prize}`)
    .setColor(0xed4245)
    .setDescription(
      `Ends: <t:${endUnix}:R> (<t:${endUnix}:F>)\n` +
        `Hosted by: <@${gw.hostId}>\n` +
        `Entries: **${gw.entries.length}**\n` +
        `Winners: **${gw.winners}**` +
        minInv +
        status
    )
    .setFooter({ text: `Giveaway Message ID: ${gw.messageId}` });
}

function giveawayRow(gw) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`gw_join:${gw.messageId}`)
      .setStyle(ButtonStyle.Success)
      .setEmoji("🎊")
      .setLabel(gw.ended ? "Giveaway Ended" : "Join / Leave")
      .setDisabled(Boolean(gw.ended))
  );
}

async function endGiveaway(messageId, endedByUserId = null) {
  const gw = giveawayData.giveaways[messageId];
  if (!gw || gw.ended) return { ok: false, msg: "Giveaway not found or already ended." };

  gw.ended = true;
  saveGiveaways();

  const channel = await client.channels.fetch(gw.channelId).catch(() => null);
  if (!channel) return { ok: false, msg: "Channel not found." };

  const msg = await channel.messages.fetch(gw.messageId).catch(() => null);
  if (msg) await msg.edit({ embeds: [makeGiveawayEmbed(gw)], components: [giveawayRow(gw)] }).catch(() => {});

  if (!gw.entries.length) {
    await channel.send(`No entries — giveaway for **${gw.prize}** ended with no winners.`).catch(() => {});
    return { ok: true, msg: "Ended (no entries)." };
  }

  const winnerCount = Math.max(1, Math.min(gw.winners, gw.entries.length));
  const winners = pickRandomWinners(gw.entries, winnerCount);
  gw.lastWinners = winners;
  saveGiveaways();

  const endedBy = endedByUserId ? ` (ended by <@${endedByUserId}>)` : "";
  await channel
    .send(`🎉 Giveaway ended${endedBy}! Winners for **${gw.prize}**: ${winners.map((id) => `<@${id}>`).join(", ")}`)
    .catch(() => {});
  return { ok: true, msg: "Ended with winners." };
}

async function rerollGiveaway(messageId, rerolledByUserId = null) {
  const gw = giveawayData.giveaways[messageId];
  if (!gw) return { ok: false, msg: "Giveaway not found." };
  if (!gw.entries.length) return { ok: false, msg: "No entries to reroll." };

  const channel = await client.channels.fetch(gw.channelId).catch(() => null);
  if (!channel) return { ok: false, msg: "Channel not found." };

  const winnerCount = Math.max(1, Math.min(gw.winners, gw.entries.length));
  const winners = pickRandomWinners(gw.entries, winnerCount);
  gw.lastWinners = winners;
  saveGiveaways();

  const by = rerolledByUserId ? ` by <@${rerolledByUserId}>` : "";
  await channel
    .send(`🔁 Reroll${by}! New winners for **${gw.prize}**: ${winners.map((id) => `<@${id}>`).join(", ")}`)
    .catch(() => {});
  return { ok: true, msg: "Rerolled." };
}

function scheduleGiveawayEnd(messageId) {
  const gw = giveawayData.giveaways[messageId];
  if (!gw || gw.ended) return;

  const delay = gw.endsAt - Date.now();
  if (delay <= 0) return endGiveaway(messageId).catch(() => {});

  const MAX = 2_147_483_647;
  setTimeout(() => {
    const g = giveawayData.giveaways[messageId];
    if (!g || g.ended) return;
    if (g.endsAt - Date.now() > MAX) return scheduleGiveawayEnd(messageId);
    endGiveaway(messageId).catch(() => {});
  }, Math.min(delay, MAX));
}

/* ===================== SLASH COMMAND REGISTRATION (GLOBAL) ===================== */

async function registerSlashCommandsGlobal() {
  if (!process.env.TOKEN) throw new Error("Missing TOKEN");

  const stopCmd = new SlashCommandBuilder()
    .setName("stop")
    .setDescription("Owner only: disable the bot in a server.")
    .addStringOption((o) => o.setName("server_id").setDescription("Guild/Server ID").setRequired(true));

  const resumeCmd = new SlashCommandBuilder()
    .setName("resume")
    .setDescription("Owner only: re-enable the bot in a server.")
    .addStringOption((o) => o.setName("server_id").setDescription("Guild/Server ID").setRequired(true));

  const embedCmd = new SlashCommandBuilder()
    .setName("embed")
    .setDescription("Send a custom embed (admin only).")
    .addChannelOption((o) =>
      o.setName("channel").setDescription("Channel to send embed in (optional)").addChannelTypes(ChannelType.GuildText).setRequired(false)
    )
    .addStringOption((o) => o.setName("title").setDescription("Embed title").setRequired(false))
    .addStringOption((o) => o.setName("description").setDescription("Embed description").setRequired(false))
    .addStringOption((o) => o.setName("color").setDescription("Hex color like #ff0000").setRequired(false))
    .addStringOption((o) => o.setName("url").setDescription("Clickable title URL").setRequired(false))
    .addStringOption((o) => o.setName("thumbnail").setDescription("Thumbnail image URL").setRequired(false))
    .addStringOption((o) => o.setName("image").setDescription("Main image URL").setRequired(false));

  const panelCmd = new SlashCommandBuilder()
    .setName("panel")
    .setDescription("Admin: configure and post the ticket panel.")
    .addSubcommand((sub) =>
      sub
        .setName("set")
        .setDescription("Save ticket panel config JSON for this server.")
        .addStringOption((o) => o.setName("json").setDescription("Panel config JSON.").setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName("post")
        .setDescription("Post the ticket panel using saved config.")
        .addChannelOption((o) => o.setName("channel").setDescription("Channel to post in (optional)").addChannelTypes(ChannelType.GuildText).setRequired(false))
    )
    .addSubcommand((sub) => sub.setName("show").setDescription("Show current saved panel config (ephemeral)."))
    .addSubcommand((sub) => sub.setName("reset").setDescription("Reset panel config back to default."));

  const commands = [
    stopCmd,
    resumeCmd,
    embedCmd,
    panelCmd,

    new SlashCommandBuilder()
      .setName("link")
      .setDescription("Staff/Admin: show who a user invited + invite links they use.")
      .addUserOption((o) => o.setName("user").setDescription("User to inspect").setRequired(true)),

    new SlashCommandBuilder()
      .setName("operation")
      .setDescription("Admin: give customer role + ping vouch now, close ticket after timer.")
      .addSubcommand((sub) =>
        sub.setName("start").setDescription("Start operation timer in this ticket.").addStringOption((o) => o.setName("duration").setDescription("e.g. 10m, 1h, 2d").setRequired(true))
      )
      .addSubcommand((sub) => sub.setName("cancel").setDescription("Cancel operation timer in this ticket.")),

    new SlashCommandBuilder().setName("vouches").setDescription("Shows how many vouches this server has."),

    new SlashCommandBuilder()
      .setName("invites")
      .setDescription("Shows invites still in the server for a user.")
      .addUserOption((o) => o.setName("user").setDescription("User").setRequired(true)),

    new SlashCommandBuilder().setName("generate").setDescription("Generate your personal invite link (credited to you)."),

    new SlashCommandBuilder()
      .setName("linkinvite")
      .setDescription("Link an existing invite code to yourself for invite credit.")
      .addStringOption((o) => o.setName("code").setDescription("Invite code or discord.gg link").setRequired(true)),

    new SlashCommandBuilder()
      .setName("addinvites")
      .setDescription("Add invites to a user (manual). Admin only.")
      .addUserOption((o) => o.setName("user").setDescription("User").setRequired(true))
      .addIntegerOption((o) => o.setName("amount").setDescription("Amount").setRequired(true)),

    new SlashCommandBuilder()
      .setName("resetinvites")
      .setDescription("Reset a user's invite stats. Role-locked.")
      .addUserOption((o) => o.setName("user").setDescription("User").setRequired(true)),

    new SlashCommandBuilder().setName("resetall").setDescription("Reset invite stats for EVERYONE. Admin only."),

    new SlashCommandBuilder()
      .setName("close")
      .setDescription("Close the current ticket (DMs opener the reason).")
      .addStringOption((o) => o.setName("reason").setDescription("Reason").setRequired(true)),

    new SlashCommandBuilder()
      .setName("giveaway")
      .setDescription("Start a giveaway with a join button.")
      .addStringOption((o) => o.setName("duration").setDescription("e.g. 30m 1h 2d").setRequired(true))
      .addIntegerOption((o) => o.setName("winners").setDescription("How many winners").setRequired(true))
      .addStringOption((o) => o.setName("prize").setDescription("Prize").setRequired(true))
      .addIntegerOption((o) => o.setName("min_invites").setDescription("Minimum invites needed to join (optional)").setMinValue(0).setRequired(false)),

    new SlashCommandBuilder()
      .setName("end")
      .setDescription("End a giveaway early (staff/admin).")
      .addStringOption((o) => o.setName("message").setDescription("Giveaway message ID or link").setRequired(true)),

    new SlashCommandBuilder()
      .setName("reroll")
      .setDescription("Reroll winners for a giveaway (staff/admin).")
      .addStringOption((o) => o.setName("message").setDescription("Giveaway message ID or link").setRequired(true)),
  ].map((c) => c.toJSON());

  const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);
  await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
  console.log("✅ GLOBAL slash commands registered");
}

/* ===================== READY ===================== */

client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  try {
    await registerSlashCommandsGlobal();
  } catch (e) {
    console.log("❌ Slash register failed:", e.message);
  }

  for (const guild of client.guilds.cache.values()) {
    try { await ensureAutoModRole(guild); } catch {}
    try { await refreshGuildInvites(guild); } catch {}
  }

  for (const messageId of Object.keys(giveawayData.giveaways || {})) {
    const gw = giveawayData.giveaways[messageId];
    if (gw && !gw.ended) scheduleGiveawayEnd(messageId);
  }
});

client.on("guildCreate", async (guild) => {
  try { await ensureAutoModRole(guild); } catch {}
  try { await refreshGuildInvites(guild); } catch {}
});

/* ===================== INTERACTIONS ===================== */

client.on("interactionCreate", async (interaction) => {
  try {
    // ====== GLOBAL GUILD BLOCKER ======
    if (interaction.guildId && isGuildBlocked(interaction.guildId)) {
      const isOwner = interaction.user?.id === OWNER_ID;
      const isStopOrResume =
        interaction.isChatInputCommand() &&
        (interaction.commandName === "stop" || interaction.commandName === "resume");

      if (!isOwner || !isStopOrResume) {
        if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
          return interaction.reply({ content: RESTRICT_MESSAGE, ephemeral: false }).catch(() => {});
        }
        interaction.channel?.send(RESTRICT_MESSAGE).catch(() => {});
        return;
      }
    }

    // Ticket buttons -> modal
    if (interaction.isButton() && interaction.customId.startsWith("ticket:")) {
      const typeId = interaction.customId.split("ticket:")[1];
      const config = getPanelConfig(interaction.guild.id);
      const ticketType = resolveTicketType(config, typeId);
      if (!ticketType) return interaction.reply({ content: "This ticket type no longer exists.", ephemeral: true });

      const existing = findOpenTicketChannel(interaction.guild, interaction.user.id);
      if (existing) return interaction.reply({ content: `❌ You already have an open ticket: ${existing}`, ephemeral: true });

      const modal = new ModalBuilder()
        .setCustomId(`ticket_modal:${ticketType.id}`)
        .setTitle(String(config.modal?.title || "Ticket Info").slice(0, 45));

      const mcInput = new TextInputBuilder()
        .setCustomId("mc")
        .setLabel(String(config.modal?.mcLabel || "What is your Minecraft username?").slice(0, 45))
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(32);

      const needInput = new TextInputBuilder()
        .setCustomId("need")
        .setLabel(String(config.modal?.needLabel || "What do you need?").slice(0, 45))
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(1000);

      modal.addComponents(new ActionRowBuilder().addComponents(mcInput), new ActionRowBuilder().addComponents(needInput));
      return interaction.showModal(modal);
    }

    // Ticket modal submit -> create ticket
    if (interaction.isModalSubmit() && interaction.customId.startsWith("ticket_modal:")) {
      await interaction.deferReply({ ephemeral: true });

      const existing = findOpenTicketChannel(interaction.guild, interaction.user.id);
      if (existing) return interaction.editReply(`❌ You already have an open ticket: ${existing}`);

      const typeId = interaction.customId.split("ticket_modal:")[1];
      const config = getPanelConfig(interaction.guild.id);
      const type = resolveTicketType(config, typeId);
      if (!type) return interaction.editReply("Invalid ticket type.");

      const mc = (interaction.fields.getTextInputValue("mc") || "").trim();
      const need = (interaction.fields.getTextInputValue("need") || "").trim();

      const category = await getOrCreateCategory(interaction.guild, type.category);
      const channelName = `${type.key}-${cleanName(interaction.user.username)}`.slice(0, 90);

      const overwrites = [
        { id: interaction.guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
        {
          id: interaction.user.id,
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.ReadMessageHistory,
          ],
        },
        ...STAFF_ROLE_IDS.map((rid) => ({
          id: rid,
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.ReadMessageHistory,
          ],
        })),
      ];

      const createdAt = Date.now();

      const channel = await interaction.guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        parent: category.id,
        topic: `opener:${interaction.user.id};created:${createdAt};type:${type.id}`,
        permissionOverwrites: overwrites,
      });

      const embed = new EmbedBuilder()
        .setTitle(`${type.label} (${interaction.user.username})`)
        .setColor(0x2b2d31)
        .addFields(
          { name: "Minecraft Username", value: (mc || "N/A").slice(0, 64), inline: true },
          { name: "Discord User", value: interaction.user.tag, inline: true },
          { name: "What they need", value: (need || "N/A").slice(0, 1024), inline: false }
        );

      await channel.send({ content: `${interaction.user}`, embeds: [embed] });
      return interaction.editReply(`✅ Ticket created: ${channel}`);
    }

    // Slash commands
    if (interaction.isChatInputCommand()) {
      const name = interaction.commandName;

      if (name === "stop") {
        if (interaction.user.id !== OWNER_ID) return interaction.reply({ content: "No permission.", ephemeral: true });
        const gid = interaction.options.getString("server_id", true).trim();
        if (!/^\d{10,25}$/.test(gid)) return interaction.reply({ content: "Invalid server ID.", ephemeral: true });
        restrictionsData.blockedGuilds[gid] = { blockedAt: Date.now(), blockedBy: interaction.user.id };
        saveRestrictions();
        return interaction.reply({ content: `✅ Bot disabled in server: **${gid}**`, ephemeral: true });
      }

      if (name === "resume") {
        if (interaction.user.id !== OWNER_ID) return interaction.reply({ content: "No permission.", ephemeral: true });
        const gid = interaction.options.getString("server_id", true).trim();
        if (!/^\d{10,25}$/.test(gid)) return interaction.reply({ content: "Invalid server ID.", ephemeral: true });
        delete restrictionsData.blockedGuilds[gid];
        saveRestrictions();
        return interaction.reply({ content: `✅ Bot re-enabled in server: **${gid}**`, ephemeral: true });
      }

      if (name === "panel") {
        const member = await interaction.guild.members.fetch(interaction.user.id);
        if (!member.permissions.has(PermissionsBitField.Flags.Administrator)) {
          return interaction.reply({ content: "Admins only.", ephemeral: true });
        }
        const sub = interaction.options.getSubcommand();

        if (sub === "show") {
          const cfg = getPanelConfig(interaction.guild.id);
          const json = JSON.stringify(cfg, null, 2);
          if (json.length > 1800) return interaction.reply({ content: "Config too large to show here.", ephemeral: true });
          return interaction.reply({ content: "```json\n" + json + "\n```", ephemeral: true });
        }

        if (sub === "reset") {
          delete panelStore.byGuild[interaction.guild.id];
          savePanelStore();
          return interaction.reply({ content: "✅ Panel config reset to default.", ephemeral: true });
        }

        if (sub === "set") {
          const raw = interaction.options.getString("json", true);
          if (raw.length > 6000) return interaction.reply({ content: "❌ JSON too long. Keep it under ~6000 chars.", ephemeral: true });

          let cfg;
          try { cfg = JSON.parse(raw); } catch { return interaction.reply({ content: "❌ Invalid JSON.", ephemeral: true }); }

          const v = validatePanelConfig(cfg);
          if (!v.ok) return interaction.reply({ content: `❌ ${v.msg}`, ephemeral: true });

          panelStore.byGuild[interaction.guild.id] = cfg;
          savePanelStore();
          return interaction.reply({ content: "✅ Saved panel config for this server.", ephemeral: true });
        }

        if (sub === "post") {
          const cfg = getPanelConfig(interaction.guild.id);
          const targetChannel = interaction.options.getChannel("channel", false) || interaction.channel;
          if (!targetChannel || targetChannel.type !== ChannelType.GuildText) {
            return interaction.reply({ content: "Invalid channel.", ephemeral: true });
          }
          const v = validatePanelConfig(cfg);
          if (!v.ok) return interaction.reply({ content: `❌ Saved config invalid: ${v.msg}`, ephemeral: true });

          await targetChannel.send(buildTicketPanelMessage(cfg));
          return interaction.reply({ content: "✅ Posted ticket panel.", ephemeral: true });
        }
      }

      if (name === "close") {
        const channel = interaction.channel;
        if (!isTicketChannel(channel)) {
          return interaction.reply({ content: "Use **/close** inside a ticket channel.", ephemeral: true });
        }

        const meta = getTicketMetaFromTopic(channel.topic);
        const openerId = meta?.openerId;

        const config = getPanelConfig(interaction.guild.id);
        const t = resolveTicketType(config, meta?.typeId);
        const ticketTypeLabel = t?.label || "Unknown";

        const reason = interaction.options.getString("reason", true);

        const member = await interaction.guild.members.fetch(interaction.user.id);
        const isOpener = interaction.user.id === openerId;
        const canClose = isOpener || isStaff(member);

        if (!canClose) return interaction.reply({ content: "Only the opener or staff can close this.", ephemeral: true });

        try {
          const openerUser = await client.users.fetch(openerId);
          await openerUser.send({
            embeds: [
              buildCloseDmEmbed({
                guild: interaction.guild,
                ticketChannelName: channel.name,
                ticketTypeLabel,
                openedAtMs: meta?.createdAt,
                closedByTag: interaction.user.tag,
                reason,
              }),
            ],
          });
        } catch {}

        await interaction.reply({ content: "Closing ticket in 3 seconds...", ephemeral: true });
        setTimeout(() => channel.delete().catch(() => {}), 3000);
        return;
      }
    }
  } catch (e) {
    console.error(e);
    try {
      if (interaction?.isRepliable?.() && !interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: "Error handling that interaction.", ephemeral: true });
      }
    } catch {}
  }
});

/* ===================== MESSAGE HANDLER (BLOCKER + AUTOMOD + PREFIX) ===================== */

client.on("messageCreate", async (message) => {
  try {
    if (!message.guild || message.author.bot) return;

    if (isGuildBlocked(message.guild.id)) {
      if (message.content.startsWith(PREFIX)) await message.channel.send(RESTRICT_MESSAGE).catch(() => {});
      return;
    }

    if (containsLink(message.content)) {
      const member = message.member;
      if (member) {
        const isAdmin = member.permissions.has(PermissionsBitField.Flags.Administrator);
        const automodRole = message.guild.roles.cache.find((r) => r.name.toLowerCase() === AUTOMOD_ROLE_NAME);
        const hasBypass = automodRole ? member.roles.cache.has(automodRole.id) : false;

        if (!isAdmin && !hasBypass) {
          await message.delete().catch(() => {});
          message.channel
            .send(`🚫 ${member}, links aren’t allowed unless you have the **${AUTOMOD_ROLE_NAME}** role.`)
            .then((m) => setTimeout(() => m.delete().catch(() => {}), 5000))
            .catch(() => {});
          return;
        }
      }
    }
  } catch (e) {
    console.error(e);
  }
});

/* ===================== LOGIN ===================== */

client.login(process.env.TOKEN);
