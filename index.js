/**
 * DonutDemand Bot — Single File (discord.js v14)
 *
 * FEATURES (high level)
 * - Slash commands auto-register (global or guild)
 * - Ticket panel with modal -> ticket creation
 * - Ticket close via /close AND via Close Button (reason modal)
 * - Invites tracking + join log, linkinvite, generate, etc.
 * - Rewards ticket gate: (5+ invites) OR (joined within last 2 hours)
 * - /blacklist: users never earn invites (stays 0), join log flags it
 * - !calc + /calc: safe calculator with + - x / ^ parentheses
 * - Giveaways with join button, end, reroll
 * - Automod link blocker with bypass role name
 *
 * NEW (this rewrite)
 * - /leaderboard: top 10 inviters (by invites still in server)
 * - /settings set_rewards_webhook: save rewards webhook URL (per server)
 * - /panel rewards (admin): configure + post "Claim Rewards" panel (via modal)
 * - Claim Rewards button:
 *    - asks MC username + Discord username (via modal)
 *    - sends to webhook: discord user, mc user, discord name, invites at click time
 *    - THEN resets inviter’s invites (and cleans memberInviter refs)
 *    - replies ephemeral: invites reset, rewards paid to MC username after review
 */

try {
  require("dotenv").config({ quiet: true });
} catch {
  // ignore
}

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

/* ===================== CRASH PROTECTION ===================== */
process.on("unhandledRejection", (reason) => console.error("❌ unhandledRejection:", reason));
process.on("uncaughtException", (err) => console.error("❌ uncaughtException:", err));

/* ===================== BASICS ===================== */
const PREFIX = "!";
const OWNER_ID = "1456326972631154786"; // Adam

function isOwner(userId) {
  return String(userId) === String(OWNER_ID);
}

/* ===================== FILE STORAGE ===================== */
const DATA_DIR = __dirname;

const SETTINGS_FILE = path.join(DATA_DIR, "guild_settings.json");
const PANEL_FILE = path.join(DATA_DIR, "panel_config.json");
const INVITES_FILE = path.join(DATA_DIR, "invites_data.json");
const INVITES_BACKUP_FILE = path.join(DATA_DIR, "invites_backup.json");
const GIVEAWAYS_FILE = path.join(DATA_DIR, "giveaways_data.json");
const BOT_STATE_FILE = path.join(DATA_DIR, "bot_state.json");

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

/* Stores */
const settingsStore = loadJson(SETTINGS_FILE, { byGuild: {} });
settingsStore.byGuild ??= {};
saveJson(SETTINGS_FILE, settingsStore);

const panelStore = loadJson(PANEL_FILE, { byGuild: {} });
panelStore.byGuild ??= {};
saveJson(PANEL_FILE, panelStore);

const invitesData = loadJson(INVITES_FILE, {
  inviterStats: {},
  memberInviter: {},
  inviteOwners: {},
  invitedMembers: {},
});
invitesData.inviterStats ??= {};
invitesData.memberInviter ??= {};
invitesData.inviteOwners ??= {};
invitesData.invitedMembers ??= {};
saveJson(INVITES_FILE, invitesData);

const giveawayData = loadJson(GIVEAWAYS_FILE, { giveaways: {} });
giveawayData.giveaways ??= {};
saveJson(GIVEAWAYS_FILE, giveawayData);

const botState = loadJson(BOT_STATE_FILE, { stoppedGuilds: {} });
botState.stoppedGuilds ??= {};
saveJson(BOT_STATE_FILE, botState);

function saveSettings() {
  saveJson(SETTINGS_FILE, settingsStore);
}
function savePanelStore() {
  saveJson(PANEL_FILE, panelStore);
}
function saveInvites() {
  saveJson(INVITES_FILE, invitesData);
}
function saveGiveaways() {
  saveJson(GIVEAWAYS_FILE, giveawayData);
}
function saveBotState() {
  saveJson(BOT_STATE_FILE, botState);
}

/* ===================== DEFAULTS ===================== */
function defaultGuildSettings() {
  return {
    staffRoleIds: [],
    vouchesChannelId: null,
    joinLogChannelId: null,
    customerRoleId: null,

    // invite blacklist by userId (string)
    invitesBlacklist: [],

    // NEW: rewards webhook (per-guild)
    rewardsWebhookUrl: null,

    automod: {
      enabled: true,
      bypassRoleName: "automod",
    },
  };
}

function getGuildSettings(guildId) {
  if (!settingsStore.byGuild[guildId]) {
    settingsStore.byGuild[guildId] = defaultGuildSettings();
    saveSettings();
  }
  const s = settingsStore.byGuild[guildId];
  s.staffRoleIds ??= [];
  s.vouchesChannelId ??= null;
  s.joinLogChannelId ??= null;
  s.customerRoleId ??= null;
  s.invitesBlacklist ??= [];
  s.rewardsWebhookUrl ??= null;
  s.automod ??= { enabled: true, bypassRoleName: "automod" };
  s.automod.enabled ??= true;
  s.automod.bypassRoleName ??= "automod";
  return s;
}

function isStopped(guildId) {
  return Boolean(botState.stoppedGuilds?.[guildId]);
}

/* ===================== PANEL CONFIG (DEFAULT) ===================== */
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

  // NEW: optional rewards panel config (admin-managed)
  rewardsPanel: {
    text: null, // string
  },
};

function getPanelConfig(guildId) {
  // Keep backward compatibility with older saved configs
  const cfg = panelStore.byGuild[guildId] || DEFAULT_PANEL_CONFIG;

  // Ensure rewardsPanel exists without breaking existing configs
  cfg.rewardsPanel ??= { text: null };
  cfg.rewardsPanel.text ??= null;

  return cfg;
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

/* ===================== SMALL HELPERS ===================== */
function parseHexColor(input) {
  if (!input) return null;
  let s = String(input).trim();
  if (s.startsWith("#")) s = s.slice(1);
  if (s.startsWith("0x")) s = s.slice(2);
  if (!/^[0-9a-fA-F]{6}$/.test(s)) return null;
  return parseInt(s, 16);
}

function normalizeButtonStyle(style) {
  const s = String(style || "").toLowerCase();
  if (s === "primary") return ButtonStyle.Primary;
  if (s === "secondary") return ButtonStyle.Secondary;
  if (s === "success") return ButtonStyle.Success;
  if (s === "danger") return ButtonStyle.Danger;
  return ButtonStyle.Primary;
}

function cleanName(str) {
  return (str || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 24);
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

function memberHasAnyRole(member, roleIds) {
  if (!member || !roleIds?.length) return false;
  return roleIds.some((rid) => member.roles.cache.has(rid));
}

function isStaff(member) {
  if (!member) return false;
  if (isOwner(member.id)) return true;
  if (member.permissions.has(PermissionsBitField.Flags.Administrator)) return true;
  const s = getGuildSettings(member.guild.id);
  return memberHasAnyRole(member, s.staffRoleIds);
}

function isAdminOrOwner(member) {
  if (!member) return false;
  if (isOwner(member.id)) return true;
  return member.permissions.has(PermissionsBitField.Flags.Administrator);
}

function isValidWebhookUrl(url) {
  if (!url) return false;
  const s = String(url).trim();
  if (!/^https:\/\/(canary\.|ptb\.)?discord\.com\/api\/webhooks\/\d+\/[\w-]+/i.test(s)) return false;
  return true;
}

async function sendWebhook(webhookUrl, payload) {
  // Node 18+ has global fetch; Node 22 definitely does.
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Webhook failed (${res.status}) ${text?.slice(0, 200) || ""}`);
  }
}

/* ===================== STOP/RESUME GATE ===================== */
async function denyIfStopped(interactionOrMessage) {
  const guildId = interactionOrMessage.guild?.id;
  if (!guildId) return false;
  if (!isStopped(guildId)) return false;

  const content = "Adam has restricted commands in your server.";

  if (
    interactionOrMessage.isChatInputCommand?.() ||
    interactionOrMessage.isButton?.() ||
    interactionOrMessage.isModalSubmit?.()
  ) {
    try {
      if (interactionOrMessage.deferred || interactionOrMessage.replied) {
        await interactionOrMessage.followUp({ content, ephemeral: true }).catch(() => {});
      } else {
        await interactionOrMessage.reply({ content, ephemeral: true }).catch(() => {});
      }
    } catch {}
    return true;
  }

  try {
    await interactionOrMessage.channel?.send(content).catch(() => {});
  } catch {}
  return true;
}

/* ===================== INVITE BLACKLIST ===================== */
function isBlacklistedInviter(guildId, userId) {
  const s = getGuildSettings(guildId);
  return (s.invitesBlacklist || []).includes(String(userId));
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

// Guild-aware (returns 0 if blacklisted)
function invitesStillInServerForGuild(guildId, inviterId) {
  if (isBlacklistedInviter(guildId, inviterId)) return 0;
  return invitesStillInServer(inviterId);
}

const invitesCache = new Map(); // guildId -> Map(code->uses)

async function refreshGuildInvites(guild) {
  const invites = await guild.invites.fetch().catch(() => null);
  if (!invites) return null;
  const map = new Map();
  invites.forEach((inv) => map.set(inv.code, inv.uses ?? 0));
  invitesCache.set(guild.id, map);
  return invites;
}

/* ===================== RESET INVITES (CLAIM REWARDS) ===================== */
function resetInvitesForUser(userId) {
  // wipe stats + invited members
  invitesData.inviterStats[userId] = { joins: 0, rejoins: 0, left: 0, manual: 0 };
  delete invitesData.invitedMembers[userId];

  // IMPORTANT: remove memberInviter mappings that point to this inviter,
  // otherwise future leaves would keep subtracting from a reset inviter.
  for (const [memberId, inviterId] of Object.entries(invitesData.memberInviter || {})) {
    if (String(inviterId) === String(userId)) {
      delete invitesData.memberInviter[memberId];
    }
  }

  saveInvites();
}

/* ===================== BACKUP / RESTORE (INVITES) ===================== */
function sanitizeInvitesDataForSave(obj) {
  return {
    inviterStats: obj?.inviterStats || {},
    memberInviter: obj?.memberInviter || {},
    inviteOwners: obj?.inviteOwners || {},
    invitedMembers: obj?.invitedMembers || {},
  };
}

function doBackupInvites() {
  const snapshot = sanitizeInvitesDataForSave(invitesData);
  saveJson(INVITES_BACKUP_FILE, snapshot);
  return snapshot;
}

function doRestoreInvites() {
  const restored = loadJson(INVITES_BACKUP_FILE, null);
  if (!restored) return { ok: false, msg: "No invites backup found (invites_backup.json missing)." };

  const snap = sanitizeInvitesDataForSave(restored);
  invitesData.inviterStats = snap.inviterStats;
  invitesData.memberInviter = snap.memberInviter;
  invitesData.inviteOwners = snap.inviteOwners;
  invitesData.invitedMembers = snap.invitedMembers;
  saveInvites();

  return { ok: true, msg: "Invites restored from invites_backup.json." };
}

/* ===================== TICKETS ===================== */
async function getOrCreateCategory(guild, name) {
  const safeName = String(name || "Tickets").slice(0, 90);
  let cat = guild.channels.cache.find((c) => c.type === ChannelType.GuildCategory && c.name === safeName);
  if (!cat) cat = await guild.channels.create({ name: safeName, type: ChannelType.GuildCategory });
  return cat;
}

/**
 * Topic format:
 * opener:<id>;created:<unixMs>;type:<ticketId>
 */
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

function buildTicketPanelMessage(config) {
  const c = parseHexColor(config.embed?.color) ?? 0xed4245;

  const embed = new EmbedBuilder()
    .setTitle(String(config.embed?.title || "Tickets").slice(0, 256))
    .setDescription(String(config.embed?.description || "Open a ticket below.").slice(0, 4000))
    .setColor(c)
    .setFooter({ text: "DonutDemand Support" })
    .setTimestamp();

  const row = new ActionRowBuilder();
  for (const t of config.tickets) {
    const b = t.button || {};
    const btn = new ButtonBuilder()
      .setCustomId(`ticket:${t.id}`)
      .setLabel(String(b.label || t.label).slice(0, 80))
      .setStyle(normalizeButtonStyle(b.style || "Primary"));
    if (b.emoji) btn.setEmoji(String(b.emoji).slice(0, 40));
    row.addComponents(btn);
  }

  return { embeds: [embed], components: [row] };
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

function buildCloseDmEmbed({ guild, ticketChannelName, ticketTypeLabel, openedAtMs, closedByTag, reason, vouchesChannelId }) {
  const openedUnix = openedAtMs ? Math.floor(openedAtMs / 1000) : null;
  const closedUnix = Math.floor(Date.now() / 1000);

  const nextSteps = [
    "• If you still need help, open a new ticket from the ticket panel.",
    "• Keep your DMs open so you don’t miss updates.",
  ];
  if (vouchesChannelId) nextSteps.splice(1, 0, `• Please consider leaving a vouch in <#${vouchesChannelId}>.`);

  return new EmbedBuilder()
    .setTitle("✅ Ticket Closed")
    .setColor(0xed4245)
    .setDescription("Your ticket has been closed. Here are the details:")
    .addFields(
      { name: "Server", value: `${guild.name}`, inline: true },
      { name: "Ticket", value: `${ticketChannelName}`, inline: true },
      { name: "Type", value: ticketTypeLabel || "Unknown", inline: true },
      { name: "Closed By", value: closedByTag || "Unknown", inline: true },
      { name: "Reason", value: String(reason || "No reason provided").slice(0, 1024), inline: false },
      { name: "Opened", value: openedUnix ? `<t:${openedUnix}:F> (<t:${openedUnix}:R>)` : "Unknown", inline: true },
      { name: "Closed", value: `<t:${closedUnix}:F> (<t:${closedUnix}:R>)`, inline: true },
      { name: "Next Steps", value: nextSteps.join("\n"), inline: false }
    )
    .setFooter({ text: "DonutDemand Support" })
    .setTimestamp();
}

/* ===================== REWARDS TICKET RULE ===================== */
function isRewardsTicket(ticketType) {
  if (!ticketType) return false;
  const id = String(ticketType.id || "").toLowerCase();
  const key = String(ticketType.key || "").toLowerCase();
  return id === "ticket_rewards" || key.includes("rewards");
}

function canOpenRewardsTicket(member) {
  const inv = invitesStillInServerForGuild(member.guild.id, member.id);
  if (inv >= 5) return { ok: true, reason: "has 5+ invites" };

  const joinedAt = member.joinedTimestamp || 0;
  const ageMs = Date.now() - joinedAt;
  const TWO_HOURS = 2 * 60 * 60 * 1000;

  if (joinedAt && ageMs <= TWO_HOURS) return { ok: true, reason: "joined within 2 hours" };

  return { ok: false, invites: inv };
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
    .setFooter({ text: `Giveaway Message ID: ${gw.messageId}` })
    .setTimestamp();
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
  if (delay <= 0) return void endGiveaway(messageId).catch(() => {});

  const MAX = 2_147_483_647;
  setTimeout(() => {
    const g = giveawayData.giveaways[messageId];
    if (!g || g.ended) return;
    if (g.endsAt - Date.now() > MAX) return scheduleGiveawayEnd(messageId);
    endGiveaway(messageId).catch(() => {});
  }, Math.min(delay, MAX));
}

/* ===================== SAFE CALCULATOR (!calc + /calc) ===================== */
function tokenizeCalc(input) {
  const s = String(input || "")
    .trim()
    .toLowerCase()
    .replace(/×/g, "x")
    .replace(/\s+/g, "")
    .replace(/x/g, "*");

  if (!s) return [];

  const tokens = [];
  let i = 0;

  const isDigit = (c) => c >= "0" && c <= "9";

  while (i < s.length) {
    const c = s[i];

    if (isDigit(c) || c === ".") {
      let j = i;
      let dot = 0;
      while (j < s.length && (isDigit(s[j]) || s[j] === ".")) {
        if (s[j] === ".") dot++;
        if (dot > 1) throw new Error("Invalid number");
        j++;
      }
      const numStr = s.slice(i, j);
      if (numStr === "." || numStr === "+." || numStr === "-.") throw new Error("Invalid number");
      const val = Number(numStr);
      if (!Number.isFinite(val)) throw new Error("Invalid number");
      tokens.push({ type: "num", v: val });
      i = j;
      continue;
    }

    if ("+-*/^()".includes(c)) {
      tokens.push({ type: "op", v: c });
      i++;
      continue;
    }

    throw new Error("Invalid character");
  }

  return tokens;
}

function toRpn(tokens) {
  const out = [];
  const ops = [];

  const prec = (op) => {
    if (op === "^") return 4;
    if (op === "*" || op === "/") return 3;
    if (op === "+" || op === "-") return 2;
    return 0;
  };

  const rightAssoc = (op) => op === "^";

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];

    if (t.type === "num") {
      out.push(t);
      continue;
    }

    const op = t.v;

    if (op === "(") {
      ops.push(op);
      continue;
    }

    if (op === ")") {
      while (ops.length && ops[ops.length - 1] !== "(") {
        out.push({ type: "op", v: ops.pop() });
      }
      if (!ops.length || ops[ops.length - 1] !== "(") throw new Error("Mismatched parentheses");
      ops.pop();
      continue;
    }

    // unary minus -> inject 0
    if (op === "-") {
      const prev = i === 0 ? null : tokens[i - 1];
      const isUnary = !prev || (prev.type === "op" && prev.v !== ")") || (prev.type === "op" && prev.v === "(");
      if (isUnary) out.push({ type: "num", v: 0 });
    }

    while (ops.length) {
      const top = ops[ops.length - 1];
      if (top === "(") break;

      const pTop = prec(top);
      const pCur = prec(op);

      if ((rightAssoc(op) && pCur < pTop) || (!rightAssoc(op) && pCur <= pTop)) {
        out.push({ type: "op", v: ops.pop() });
      } else break;
    }

    ops.push(op);
  }

  while (ops.length) {
    const op = ops.pop();
    if (op === "(" || op === ")") throw new Error("Mismatched parentheses");
    out.push({ type: "op", v: op });
  }

  return out;
}

function evalRpn(rpn) {
  const stack = [];
  for (const t of rpn) {
    if (t.type === "num") {
      stack.push(t.v);
      continue;
    }
    const op = t.v;
    const b = stack.pop();
    const a = stack.pop();
    if (a === undefined || b === undefined) throw new Error("Invalid expression");

    let r;
    if (op === "+") r = a + b;
    else if (op === "-") r = a - b;
    else if (op === "*") r = a * b;
    else if (op === "/") r = a / b;
    else if (op === "^") r = Math.pow(a, b);
    else throw new Error("Bad operator");

    if (!Number.isFinite(r)) throw new Error("Invalid result");
    stack.push(r);
  }
  if (stack.length !== 1) throw new Error("Invalid expression");
  return stack[0];
}

function calcExpression(input) {
  const tokens = tokenizeCalc(input);
  if (!tokens.length) throw new Error("Empty");
  const rpn = toRpn(tokens);
  return evalRpn(rpn);
}

function formatCalcResult(n) {
  if (!Number.isFinite(n)) return null;
  const abs = Math.abs(n);
  if (abs !== 0 && (abs >= 1e12 || abs < 1e-9)) return n.toExponential(6);
  const s = String(n);
  if (s.includes(".") && s.length > 18) return Number(n.toFixed(10)).toString();
  return s;
}

/* ===================== REWARDS PANEL ===================== */
function buildRewardsPanelMessage(guildId, text) {
  const t = String(text || "Click the button below to claim rewards.").slice(0, 4000);

  const embed = new EmbedBuilder()
    .setTitle("🎁 Rewards Claim")
    .setColor(0xed4245)
    .setDescription(t)
    .setFooter({ text: "DonutDemand Rewards" })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("rewards_claim_btn").setStyle(ButtonStyle.Success).setLabel("Claim Rewards").setEmoji("🎁")
  );

  return { embeds: [embed], components: [row] };
}

/* ===================== SLASH COMMANDS REGISTRATION ===================== */
function buildCommandsJSON() {
  const settingsCmd = new SlashCommandBuilder()
    .setName("settings")
    .setDescription("Admin: configure this bot for your server.")
    .setDMPermission(false)
    .addSubcommand((s) => s.setName("show").setDescription("Show current settings (ephemeral)."))
    .addSubcommand((s) => s.setName("reset").setDescription("Reset settings to defaults."))
    .addSubcommand((s) =>
      s
        .setName("set_staff_role")
        .setDescription("Add or remove a staff role.")
        .addStringOption((o) =>
          o
            .setName("action")
            .setDescription("add/remove/clear")
            .setRequired(true)
            .addChoices(
              { name: "add", value: "add" },
              { name: "remove", value: "remove" },
              { name: "clear", value: "clear" }
            )
        )
        .addRoleOption((o) => o.setName("role").setDescription("Role to add/remove (not needed for clear).").setRequired(false))
    )
    .addSubcommand((s) =>
      s
        .setName("set_channel")
        .setDescription("Set bot channels.")
        .addStringOption((o) =>
          o
            .setName("type")
            .setDescription("Which channel setting?")
            .setRequired(true)
            .addChoices({ name: "vouches", value: "vouches" }, { name: "join_log", value: "join_log" })
        )
        .addChannelOption((o) =>
          o.setName("channel").setDescription("Text channel").addChannelTypes(ChannelType.GuildText).setRequired(true)
        )
    )
    .addSubcommand((s) =>
      s
        .setName("set_customer_role")
        .setDescription("Set the customer role used by /operation.")
        .addRoleOption((o) => o.setName("role").setDescription("Customer role").setRequired(true))
    )
    // NEW: rewards webhook setting
    .addSubcommand((s) =>
      s
        .setName("set_rewards_webhook")
        .setDescription("Set the rewards claim webhook URL (used by Claim Rewards panel).")
        .addStringOption((o) => o.setName("url").setDescription("Discord webhook URL").setRequired(true))
    )
    .addSubcommand((s) =>
      s
        .setName("automod")
        .setDescription("Configure link blocker.")
        .addStringOption((o) =>
          o
            .setName("enabled")
            .setDescription("Enable or disable automod")
            .setRequired(true)
            .addChoices({ name: "on", value: "on" }, { name: "off", value: "off" })
        )
        .addStringOption((o) =>
          o.setName("bypass_role_name").setDescription("Role NAME that bypasses link block (default: automod)").setRequired(false)
        )
    );

  const panelCmd = new SlashCommandBuilder()
    .setName("panel")
    .setDescription("Admin: configure and post panels.")
    .setDMPermission(false)
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
        .addChannelOption((o) =>
          o.setName("channel").setDescription("Channel to post in (optional)").addChannelTypes(ChannelType.GuildText).setRequired(false)
        )
    )
    .addSubcommand((sub) => sub.setName("show").setDescription("Show current saved ticket panel config (ephemeral)."))
    .addSubcommand((sub) => sub.setName("reset").setDescription("Reset ticket panel config back to default."))
    // NEW: rewards panel (admin only) config + post via modal
    .addSubcommand((sub) =>
      sub.setName("rewards").setDescription("Admin: post a Claim Rewards panel (asks what the panel should say).")
    );

  const stopCmd = new SlashCommandBuilder()
    .setName("stop")
    .setDescription("OWNER: restrict bot commands in a server.")
    .setDMPermission(false)
    .addStringOption((o) => o.setName("server_id").setDescription("Guild ID").setRequired(true));

  const resumeCmd = new SlashCommandBuilder()
    .setName("resume")
    .setDescription("OWNER: resume bot commands in a server.")
    .setDMPermission(false)
    .addStringOption((o) => o.setName("server_id").setDescription("Guild ID").setRequired(true));

  const syncCmd = new SlashCommandBuilder()
    .setName("sync")
    .setDescription("OWNER: fix commands for this server (and optionally clear).")
    .setDMPermission(false)
    .addStringOption((o) =>
      o
        .setName("mode")
        .setDescription("What to do")
        .setRequired(false)
        .addChoices(
          { name: "register_here", value: "register_here" },
          { name: "clear_here", value: "clear_here" },
          { name: "register_global", value: "register_global" },
          { name: "clear_global", value: "clear_global" }
        )
    );

  const backupCmd = new SlashCommandBuilder()
    .setName("backup")
    .setDescription("OWNER/ADMIN: Backup invites data to invites_backup.json")
    .setDMPermission(false);

  const restoreCmd = new SlashCommandBuilder()
    .setName("restore")
    .setDescription("OWNER/ADMIN: Restore invites data from invites_backup.json")
    .setDMPermission(false);

  const embedCmd = new SlashCommandBuilder()
    .setName("embed")
    .setDescription("Send a custom embed (admin only).")
    .setDMPermission(false)
    .addChannelOption((o) =>
      o.setName("channel").setDescription("Channel to send embed in (optional)").addChannelTypes(ChannelType.GuildText).setRequired(false)
    )
    .addStringOption((o) => o.setName("title").setDescription("Embed title").setRequired(false))
    .addStringOption((o) => o.setName("description").setDescription("Embed description").setRequired(false))
    .addStringOption((o) => o.setName("color").setDescription("Hex color like #ff0000").setRequired(false))
    .addStringOption((o) => o.setName("url").setDescription("Clickable title URL").setRequired(false))
    .addStringOption((o) => o.setName("thumbnail").setDescription("Thumbnail image URL").setRequired(false))
    .addStringOption((o) => o.setName("image").setDescription("Main image URL").setRequired(false));

  const calcCmd = new SlashCommandBuilder()
    .setName("calc")
    .setDescription("Calculate an expression. Supports + - x / ^ and parentheses.")
    .setDMPermission(false)
    .addStringOption((o) => o.setName("expression").setDescription("Example: (5x2)+3^2/3").setRequired(true));

  // NEW: leaderboard
  const leaderboardCmd = new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("Shows the top 10 inviters in this server.")
    .setDMPermission(false);

  const blacklistCmd = new SlashCommandBuilder()
    .setName("blacklist")
    .setDescription("Admin: blacklist users from earning invites (they always stay 0).")
    .setDMPermission(false)
    .addSubcommand((s) =>
      s
        .setName("add")
        .setDescription("Add a user to the invites blacklist.")
        .addUserOption((o) => o.setName("user").setDescription("User").setRequired(true))
    )
    .addSubcommand((s) =>
      s
        .setName("remove")
        .setDescription("Remove a user from the invites blacklist.")
        .addUserOption((o) => o.setName("user").setDescription("User").setRequired(true))
    )
    .addSubcommand((s) => s.setName("list").setDescription("Show blacklisted users for this server."));

  const invitesCmds = [
    new SlashCommandBuilder()
      .setName("vouches")
      .setDescription("Shows how many messages are in the vouches channel (configured in /settings).")
      .setDMPermission(false),

    new SlashCommandBuilder()
      .setName("invites")
      .setDescription("Shows invites still in the server for a user.")
      .setDMPermission(false)
      .addUserOption((o) => o.setName("user").setDescription("User").setRequired(true)),

    new SlashCommandBuilder()
      .setName("generate")
      .setDescription("Generate your personal invite link (credited to generator).")
      .setDMPermission(false),

    new SlashCommandBuilder()
      .setName("linkinvite")
      .setDescription("Link an existing invite code to yourself for invite credit.")
      .setDMPermission(false)
      .addStringOption((o) => o.setName("code").setDescription("Invite code or discord.gg link").setRequired(true)),

    new SlashCommandBuilder()
      .setName("addinvites")
      .setDescription("Add invites to a user (manual). Admin only.")
      .setDMPermission(false)
      .addUserOption((o) => o.setName("user").setDescription("User").setRequired(true))
      .addIntegerOption((o) => o.setName("amount").setDescription("Amount").setRequired(true)),

    new SlashCommandBuilder()
      .setName("resetinvites")
      .setDescription("Reset a user's invite stats. Staff role-locked.")
      .setDMPermission(false)
      .addUserOption((o) => o.setName("user").setDescription("User").setRequired(true)),

    new SlashCommandBuilder()
      .setName("resetall")
      .setDescription("Reset invite stats for EVERYONE. Admin only.")
      .setDMPermission(false),

    new SlashCommandBuilder()
      .setName("link")
      .setDescription("Staff/Admin: show who a user invited + invite links used.")
      .setDMPermission(false)
      .addUserOption((o) => o.setName("user").setDescription("User to inspect").setRequired(true)),
  ];

  const closeCmd = new SlashCommandBuilder()
    .setName("close")
    .setDescription("Close the current ticket (DMs opener the reason).")
    .setDMPermission(false)
    .addStringOption((o) => o.setName("reason").setDescription("Reason").setRequired(true));

  const opCmd = new SlashCommandBuilder()
    .setName("operation")
    .setDescription("Admin: give customer role + ping vouch now, close ticket after timer.")
    .setDMPermission(false)
    .addSubcommand((sub) =>
      sub
        .setName("start")
        .setDescription("Start operation timer in this ticket.")
        .addStringOption((o) => o.setName("duration").setDescription("e.g. 10m, 1h, 2d").setRequired(true))
    )
    .addSubcommand((sub) => sub.setName("cancel").setDescription("Cancel operation timer in this ticket."));

  const giveawayCmds = [
    new SlashCommandBuilder()
      .setName("giveaway")
      .setDescription("Start a giveaway with a join button.")
      .setDMPermission(false)
      .addStringOption((o) => o.setName("duration").setDescription("e.g. 30m 1h 2d").setRequired(true))
      .addIntegerOption((o) => o.setName("winners").setDescription("How many winners").setRequired(true))
      .addStringOption((o) => o.setName("prize").setDescription("Prize").setRequired(true))
      .addIntegerOption((o) =>
        o.setName("min_invites").setDescription("Minimum invites needed to join (optional)").setMinValue(0).setRequired(false)
      ),

    new SlashCommandBuilder()
      .setName("end")
      .setDescription("End a giveaway early (staff/admin).")
      .setDMPermission(false)
      .addStringOption((o) => o.setName("message").setDescription("Giveaway message ID or link").setRequired(true)),

    new SlashCommandBuilder()
      .setName("reroll")
      .setDescription("Reroll winners for a giveaway (staff/admin).")
      .setDMPermission(false)
      .addStringOption((o) => o.setName("message").setDescription("Giveaway message ID or link").setRequired(true)),
  ];

  return [
    settingsCmd,
    panelCmd,
    stopCmd,
    resumeCmd,
    syncCmd,
    backupCmd,
    restoreCmd,
    embedCmd,
    calcCmd,
    leaderboardCmd,
    blacklistCmd,
    ...invitesCmds,
    closeCmd,
    opCmd,
    ...giveawayCmds,
  ].map((c) => c.toJSON());
}

function getRest() {
  if (!process.env.TOKEN) throw new Error("Missing TOKEN");
  return new REST({ version: "10" }).setToken(process.env.TOKEN);
}

function getAppId() {
  return client.application?.id || client.user?.id || null;
}

async function registerGlobal() {
  const appId = getAppId();
  if (!appId) throw new Error("App ID not available yet (bot not ready).");
  const rest = getRest();
  await rest.put(Routes.applicationCommands(appId), { body: buildCommandsJSON() });
  console.log("✅ Registered GLOBAL slash commands");
}

async function registerGuild(guildId) {
  const appId = getAppId();
  if (!appId) throw new Error("App ID not available yet (bot not ready).");
  const rest = getRest();
  await rest.put(Routes.applicationGuildCommands(appId, guildId), { body: buildCommandsJSON() });
  console.log(`✅ Registered GUILD slash commands for guild ${guildId}`);
}

async function clearGlobal() {
  const appId = getAppId();
  if (!appId) throw new Error("App ID not available yet (bot not ready).");
  const rest = getRest();
  await rest.put(Routes.applicationCommands(appId), { body: [] });
  console.log("🧹 Cleared GLOBAL slash commands");
}

async function clearGuild(guildId) {
  const appId = getAppId();
  if (!appId) throw new Error("App ID not available yet (bot not ready).");
  const rest = getRest();
  await rest.put(Routes.applicationGuildCommands(appId, guildId), { body: [] });
  console.log(`🧹 Cleared GUILD slash commands for guild ${guildId}`);
}

async function autoRegisterOnStartup() {
  const scope = (process.env.REGISTER_SCOPE || "global").toLowerCase().trim();
  const devGuild = (process.env.DEV_GUILD_ID || "").trim();

  if (scope === "guild") {
    if (!/^\d{10,25}$/.test(devGuild)) throw new Error("REGISTER_SCOPE=guild requires DEV_GUILD_ID");
    await registerGuild(devGuild);
    return;
  }
  await registerGlobal();
}

/* ===================== READY ===================== */
client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  try {
    await client.application.fetch();
  } catch {}

  try {
    await autoRegisterOnStartup();
  } catch (e) {
    console.log("❌ Slash register failed:", e?.message || e);
  }

  for (const guild of client.guilds.cache.values()) {
    await refreshGuildInvites(guild).catch(() => {});
    getGuildSettings(guild.id);
    getPanelConfig(guild.id);
  }

  for (const messageId of Object.keys(giveawayData.giveaways || {})) {
    const gw = giveawayData.giveaways[messageId];
    if (gw && !gw.ended) scheduleGiveawayEnd(messageId);
  }
});

client.on("guildCreate", async (guild) => {
  getGuildSettings(guild.id);
  getPanelConfig(guild.id);
  await refreshGuildInvites(guild).catch(() => {});
});

/* ===================== INVITE EVENTS ===================== */
client.on("inviteCreate", async (invite) => {
  await refreshGuildInvites(invite.guild).catch(() => {});
});
client.on("inviteDelete", async (invite) => {
  await refreshGuildInvites(invite.guild).catch(() => {});
});

client.on("guildMemberAdd", async (member) => {
  try {
    const guild = member.guild;
    const s = getGuildSettings(guild.id);

    const logChannelId = s.joinLogChannelId;
    const logChannel = logChannelId ? await guild.channels.fetch(logChannelId).catch(() => null) : null;

    const before = invitesCache.get(guild.id);
    if (!before) {
      if (logChannel && logChannel.type === ChannelType.GuildText) {
        await logChannel.send(`${member} joined. (Couldn't detect inviter — missing invite permissions)`).catch(() => {});
      }
      await refreshGuildInvites(guild).catch(() => {});
      return;
    }

    const invites = await guild.invites.fetch().catch(() => null);
    if (!invites) return;

    let used = null;
    for (const inv of invites.values()) {
      const prev = before.get(inv.code) ?? 0;
      const now = inv.uses ?? 0;
      if (now > prev) {
        used = inv;
        break;
      }
    }

    const after = new Map();
    invites.forEach((inv) => after.set(inv.code, inv.uses ?? 0));
    invitesCache.set(guild.id, after);

    if (!used) {
      if (logChannel && logChannel.type === ChannelType.GuildText) {
        await logChannel.send(`${member} joined. (Couldn't detect invite used)`).catch(() => {});
      }
      return;
    }

    const linkedOwner = invitesData.inviteOwners?.[used.code];
    const creditedInviterId = linkedOwner || used.inviter?.id || null;

    if (!creditedInviterId) {
      if (logChannel && logChannel.type === ChannelType.GuildText) {
        await logChannel.send(`${member} has been invited by **Unknown** and now has **0** invites.`).catch(() => {});
      }
      return;
    }

    const blacklisted = isBlacklistedInviter(guild.id, creditedInviterId);

    // Only track credit + counts if NOT blacklisted
    if (!blacklisted) {
      const stats = ensureInviterStats(creditedInviterId);
      if (invitesData.memberInviter[member.id]) stats.rejoins += 1;
      else stats.joins += 1;

      invitesData.memberInviter[member.id] = creditedInviterId;

      invitesData.invitedMembers[creditedInviterId] ??= {};
      invitesData.invitedMembers[creditedInviterId][member.id] = {
        inviteCode: used.code,
        joinedAt: Date.now(),
        active: true,
        leftAt: null,
      };

      saveInvites();
    }

    const still = invitesStillInServerForGuild(guild.id, creditedInviterId);

    if (logChannel && logChannel.type === ChannelType.GuildText) {
      if (blacklisted) {
        await logChannel
          .send(`${member} has been invited by **blacklisted user** (<@${creditedInviterId}>) and now has **0** invites.`)
          .catch(() => {});
      } else {
        await logChannel
          .send(`${member} has been invited by <@${creditedInviterId}> and now has **${still}** invites.`)
          .catch(() => {});
      }
    }
  } catch {}
});

client.on("guildMemberRemove", async (member) => {
  try {
    const inviterId = invitesData.memberInviter[member.id];
    if (!inviterId) return;

    const stats = ensureInviterStats(inviterId);
    stats.left += 1;

    invitesData.invitedMembers[inviterId] ??= {};
    if (invitesData.invitedMembers[inviterId][member.id]) {
      invitesData.invitedMembers[inviterId][member.id].active = false;
      invitesData.invitedMembers[inviterId][member.id].leftAt = Date.now();
    }
    saveInvites();
  } catch {}
});

/* ===================== TICKET EMBED (COOL) + CLOSE BUTTON ===================== */
function buildTicketInsideEmbed({ typeLabel, user, mc, need, createdAtMs }) {
  const openedUnix = Math.floor((createdAtMs || Date.now()) / 1000);
  return new EmbedBuilder()
    .setTitle(`🎫 ${typeLabel} Ticket`)
    .setColor(0x2b2d31)
    .setDescription(
      `**Welcome, ${user}!**\n` +
        `A staff member will be with you soon.\n\n` +
        `🕒 **Opened:** <t:${openedUnix}:F> (<t:${openedUnix}:R>)`
    )
    .addFields(
      { name: "👤 User", value: `${user} (${user.tag})`, inline: true },
      { name: "🟩 Minecraft", value: (mc || "N/A").slice(0, 64), inline: true },
      { name: "📝 Request", value: (need || "N/A").slice(0, 1024), inline: false },
      { name: "✅ Tip", value: "Send any proof/screenshots here to speed things up.", inline: false }
    )
    .setFooter({ text: "DonutDemand Support • Use the button below to close when done" })
    .setTimestamp();
}

function buildTicketControlRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("ticket_close_btn").setStyle(ButtonStyle.Danger).setEmoji("🔒").setLabel("Close Ticket")
  );
}

async function closeTicketFlow({ channel, guild, closerUser, reason }) {
  if (!channel || !guild) return;

  if (activeOperations.has(channel.id)) {
    clearTimeout(activeOperations.get(channel.id));
    activeOperations.delete(channel.id);
  }

  const meta = getTicketMetaFromTopic(channel.topic);
  const openerId = meta?.openerId;

  const config = getPanelConfig(guild.id);
  const t = resolveTicketType(config, meta?.typeId);
  const ticketTypeLabel = t?.label || "Unknown";

  const s = getGuildSettings(guild.id);

  // DM opener (best-effort)
  try {
    if (openerId) {
      const openerUser = await client.users.fetch(openerId);
      await openerUser.send({
        embeds: [
          buildCloseDmEmbed({
            guild,
            ticketChannelName: channel.name,
            ticketTypeLabel,
            openedAtMs: meta?.createdAt,
            closedByTag: closerUser?.tag || "Unknown",
            reason,
            vouchesChannelId: s.vouchesChannelId,
          }),
        ],
      });
    }
  } catch {}

  // small message in ticket then delete
  try {
    await channel.send(`🔒 Ticket closing...`).catch(() => {});
  } catch {}

  setTimeout(() => {
    channel.delete().catch(() => {});
  }, 2500);
}

/* ===================== INTERACTIONS ===================== */
client.on("interactionCreate", async (interaction) => {
  try {
    if (!interaction.guild) return;

    const isOwnerCmd =
      interaction.isChatInputCommand() && ["stop", "resume", "sync", "backup", "restore"].includes(interaction.commandName);

    if (!isOwnerCmd) {
      const blocked = await denyIfStopped(interaction);
      if (blocked) return;
    }

    /* ---------- Giveaway join ---------- */
    if (interaction.isButton() && interaction.customId.startsWith("gw_join:")) {
      const messageId = interaction.customId.split("gw_join:")[1];
      const gw = giveawayData.giveaways[messageId];
      if (!gw) return interaction.reply({ content: "This giveaway no longer exists.", ephemeral: true });
      if (gw.ended) return interaction.reply({ content: "This giveaway already ended.", ephemeral: true });

      const need = gw.minInvites || 0;
      if (need > 0) {
        const have = invitesStillInServerForGuild(interaction.guild.id, interaction.user.id);
        if (have < need) {
          return interaction.reply({ content: `❌ Need **${need}** invites. You have **${have}**.`, ephemeral: true });
        }
      }

      const userId = interaction.user.id;
      const idx = gw.entries.indexOf(userId);
      if (idx === -1) gw.entries.push(userId);
      else gw.entries.splice(idx, 1);

      saveGiveaways();

      try {
        const channel = await client.channels.fetch(gw.channelId);
        const msg = await channel.messages.fetch(gw.messageId);
        await msg.edit({ embeds: [makeGiveawayEmbed(gw)], components: [giveawayRow(gw)] });
      } catch {}

      return interaction.reply({ content: idx === -1 ? "✅ Entered the giveaway!" : "✅ Removed your entry.", ephemeral: true });
    }

    /* ---------- Rewards claim button -> modal ---------- */
    if (interaction.isButton() && interaction.customId === "rewards_claim_btn") {
      const s = getGuildSettings(interaction.guild.id);
      if (!s.rewardsWebhookUrl) {
        return interaction.reply({
          content: "❌ Rewards webhook is not configured. Ask an admin to set it with /settings set_rewards_webhook.",
          ephemeral: true,
        });
      }

      const modal = new ModalBuilder().setCustomId("rewards_claim_modal").setTitle("Claim Rewards");

      const mcInput = new TextInputBuilder()
        .setCustomId("mc")
        .setLabel("Minecraft username")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(32);

      const dcInput = new TextInputBuilder()
        .setCustomId("discordname")
        .setLabel("Discord username (for payout log)")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(64);

      modal.addComponents(new ActionRowBuilder().addComponents(mcInput), new ActionRowBuilder().addComponents(dcInput));
      return interaction.showModal(modal);
    }

    /* ---------- Rewards claim modal submit ---------- */
    if (interaction.isModalSubmit() && interaction.customId === "rewards_claim_modal") {
      await interaction.deferReply({ ephemeral: true });

      const s = getGuildSettings(interaction.guild.id);
      const webhookUrl = s.rewardsWebhookUrl;

      if (!webhookUrl) {
        return interaction.editReply("❌ Rewards webhook is not configured. Ask an admin to set it with /settings set_rewards_webhook.");
      }

      const mc = (interaction.fields.getTextInputValue("mc") || "").trim();
      const discordName = (interaction.fields.getTextInputValue("discordname") || "").trim();

      if (!mc || !discordName) return interaction.editReply("❌ Please fill out all fields.");

      // compute invites BEFORE reset
      const invitesBefore = invitesStillInServerForGuild(interaction.guild.id, interaction.user.id);

      // send to webhook FIRST. If webhook fails, do NOT reset.
      const embed = new EmbedBuilder()
        .setTitle("🎁 Rewards Claim Submitted")
        .setColor(0xed4245)
        .addFields(
          { name: "Server", value: `${interaction.guild.name} (\`${interaction.guild.id}\`)`, inline: false },
          { name: "Discord User", value: `${interaction.user} — **${interaction.user.tag}** (\`${interaction.user.id}\`)`, inline: false },
          { name: "Minecraft Username", value: `\`${mc}\``, inline: true },
          { name: "Discord Username (provided)", value: `\`${discordName}\``, inline: true },
          { name: "Invites at Claim Time", value: `**${invitesBefore}**`, inline: true }
        )
        .setFooter({ text: "DonutDemand Rewards • Claim log" })
        .setTimestamp();

      try {
        await sendWebhook(webhookUrl, { embeds: [embed.toJSON()] });
      } catch (e) {
        return interaction.editReply(`❌ Failed to submit claim to webhook: ${String(e?.message || e).slice(0, 180)}`);
      }

      // reset invites AFTER successful webhook
      resetInvitesForUser(interaction.user.id);

      return interaction.editReply(
        `✅ Your claim was submitted.\nYour invites have been reset and the rewards will be paid to **${mc}** after an admin reviews it.`
      );
    }

    /* ---------- Ticket close button -> modal ---------- */
    if (interaction.isButton() && interaction.customId === "ticket_close_btn") {
      if (!isTicketChannel(interaction.channel)) {
        return interaction.reply({ content: "This button only works inside tickets.", ephemeral: true });
      }

      const meta = getTicketMetaFromTopic(interaction.channel.topic);
      const openerId = meta?.openerId;

      const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
      const canClose = isOwner(interaction.user.id) || interaction.user.id === openerId || isStaff(member);
      if (!canClose) return interaction.reply({ content: "Only the opener or staff can close this ticket.", ephemeral: true });

      const modal = new ModalBuilder().setCustomId("ticket_close_modal").setTitle("Close Ticket");
      const reasonInput = new TextInputBuilder()
        .setCustomId("reason")
        .setLabel("Reason for closing")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(400);

      modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
      return interaction.showModal(modal);
    }

    /* ---------- Close modal submit ---------- */
    if (interaction.isModalSubmit() && interaction.customId === "ticket_close_modal") {
      if (!isTicketChannel(interaction.channel)) {
        return interaction.reply({ content: "This only works inside tickets.", ephemeral: true });
      }

      const meta = getTicketMetaFromTopic(interaction.channel.topic);
      const openerId = meta?.openerId;

      const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
      const canClose = isOwner(interaction.user.id) || interaction.user.id === openerId || isStaff(member);
      if (!canClose) return interaction.reply({ content: "Only the opener or staff can close this ticket.", ephemeral: true });

      const reason = (interaction.fields.getTextInputValue("reason") || "").trim() || "No reason provided";

      await interaction.reply({ content: "✅ Closing ticket...", ephemeral: true });
      await closeTicketFlow({
        channel: interaction.channel,
        guild: interaction.guild,
        closerUser: interaction.user,
        reason,
      });
      return;
    }

    /* ---------- Ticket panel buttons -> modal ---------- */
    if (interaction.isButton() && interaction.customId.startsWith("ticket:")) {
      const typeId = interaction.customId.split("ticket:")[1];
      const config = getPanelConfig(interaction.guild.id);
      const ticketType = resolveTicketType(config, typeId);
      if (!ticketType) return interaction.reply({ content: "This ticket type no longer exists.", ephemeral: true });

      // Rewards ticket gate
      if (isRewardsTicket(ticketType)) {
        const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
        if (!member) return interaction.reply({ content: "Couldn't verify your server join/invites.", ephemeral: true });

        const gate = canOpenRewardsTicket(member);
        if (!gate.ok) {
          return interaction.reply({
            content:
              `❌ You can only open a Rewards ticket if you have **5+ invites** OR you joined **within the last 2 hours**.\n` +
              `You currently have **${gate.invites}** invites.`,
            ephemeral: true,
          });
        }
      }

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

    /* ---------- Rewards panel configure modal submit ---------- */
    if (interaction.isModalSubmit() && interaction.customId === "rewards_panel_modal") {
      const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
      if (!member || !isAdminOrOwner(member)) {
        return interaction.reply({ content: "Admins only.", ephemeral: true });
      }

      const text = (interaction.fields.getTextInputValue("text") || "").trim();
      if (!text) return interaction.reply({ content: "❌ Panel text cannot be empty.", ephemeral: true });

      const cfg = getPanelConfig(interaction.guild.id);
      cfg.rewardsPanel ??= { text: null };
      cfg.rewardsPanel.text = text.slice(0, 4000);

      // persist into panelStore
      panelStore.byGuild[interaction.guild.id] = cfg;
      savePanelStore();

      // post in the same channel the command was used in (stored on interaction message context via channel)
      const targetChannel = interaction.channel;
      if (!targetChannel || targetChannel.type !== ChannelType.GuildText) {
        return interaction.reply({ content: "❌ Invalid channel to post in.", ephemeral: true });
      }

      await targetChannel.send(buildRewardsPanelMessage(interaction.guild.id, cfg.rewardsPanel.text));
      return interaction.reply({ content: "✅ Posted Claim Rewards panel.", ephemeral: true });
    }

    /* ---------- Ticket modal submit ---------- */
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

      const s = getGuildSettings(interaction.guild.id);

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
        ...(s.staffRoleIds || []).map((rid) => ({
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

      const insideEmbed = buildTicketInsideEmbed({
        typeLabel: type.label,
        user: interaction.user,
        mc,
        need,
        createdAtMs: createdAt,
      });

      await channel.send({
        content: `${interaction.user} — ticket created ✅`,
        embeds: [insideEmbed],
        components: [buildTicketControlRow()],
      });

      return interaction.editReply(`✅ Ticket created: ${channel}`);
    }

    if (!interaction.isChatInputCommand()) return;
    const name = interaction.commandName;

    /* ---------- /sync (OWNER) ---------- */
    if (name === "sync") {
      if (!isOwner(interaction.user.id)) return interaction.reply({ content: "Only Adam can use this command.", ephemeral: true });

      const mode = interaction.options.getString("mode", false) || "register_here";
      await interaction.deferReply({ ephemeral: true });

      try {
        if (mode === "clear_here") {
          await clearGuild(interaction.guild.id);
          return interaction.editReply("🧹 Cleared THIS server commands. Now run /sync mode:register_here.");
        }
        if (mode === "register_here") {
          await registerGuild(interaction.guild.id);
          return interaction.editReply("✅ Re-registered commands for THIS server. Try /settings now.");
        }
        if (mode === "clear_global") {
          await clearGlobal();
          return interaction.editReply("🧹 Cleared GLOBAL commands.");
        }
        if (mode === "register_global") {
          await registerGlobal();
          return interaction.editReply("✅ Re-registered GLOBAL commands. (May take time to update everywhere)");
        }
      } catch (e) {
        return interaction.editReply(`❌ Sync failed: ${e?.message || e}`);
      }
    }

    /* ---------- /stop & /resume (OWNER) ---------- */
    if (name === "stop" || name === "resume") {
      if (!isOwner(interaction.user.id)) return interaction.reply({ content: "Only Adam can use this command.", ephemeral: true });

      const guildId = interaction.options.getString("server_id", true).trim();
      if (!/^\d{10,25}$/.test(guildId)) return interaction.reply({ content: "Invalid server ID.", ephemeral: true });

      if (name === "stop") {
        botState.stoppedGuilds[guildId] = true;
        saveBotState();
        return interaction.reply({ content: `✅ Bot commands restricted in server: ${guildId}`, ephemeral: true });
      } else {
        delete botState.stoppedGuilds[guildId];
        saveBotState();
        return interaction.reply({ content: `✅ Bot commands resumed in server: ${guildId}`, ephemeral: true });
      }
    }

    /* ---------- /backup (OWNER/ADMIN) ---------- */
    if (name === "backup") {
      const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
      if (!member || (!isOwner(interaction.user.id) && !member.permissions.has(PermissionsBitField.Flags.Administrator))) {
        return interaction.reply({ content: "Admins only.", ephemeral: true });
      }
      doBackupInvites();
      return interaction.reply({ content: "✅ Backed up invites to **invites_backup.json** (saved on your host)." });
    }

    /* ---------- /restore (OWNER/ADMIN) ---------- */
    if (name === "restore") {
      const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
      if (!member || (!isOwner(interaction.user.id) && !member.permissions.has(PermissionsBitField.Flags.Administrator))) {
        return interaction.reply({ content: "Admins only.", ephemeral: true });
      }
      const res = doRestoreInvites();
      return interaction.reply({ content: res.ok ? `✅ ${res.msg}` : `❌ ${res.msg}` });
    }

    /* ---------- /calc (NOT EPHEMERAL) ---------- */
    if (name === "calc") {
      const expr = interaction.options.getString("expression", true);
      try {
        const result = calcExpression(expr);
        const out = formatCalcResult(result);
        if (out === null) return interaction.reply("Invalid calculation.");
        return interaction.reply(`🧮 Result: **${out}**`);
      } catch {
        return interaction.reply("Invalid calculation format.");
      }
    }

    /* ---------- /leaderboard (PUBLIC) ---------- */
    if (name === "leaderboard") {
      await interaction.deferReply({ ephemeral: false });

      // Collect candidates from stored inviterStats keys.
      const ids = Object.keys(invitesData.inviterStats || {});
      if (!ids.length) return interaction.editReply("No invite data yet.");

      // Compute counts for this guild (blacklist-aware), sort desc
      const scored = ids
        .map((id) => ({ id, count: invitesStillInServerForGuild(interaction.guild.id, id) }))
        .filter((x) => x.count > 0) // hide zeros so it looks clean; remove this line if you want to show zeros too
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);

      if (!scored.length) return interaction.editReply("No inviters with invites yet.");

      // Resolve tags best-effort
      const lines = [];
      for (let i = 0; i < scored.length; i++) {
        const entry = scored[i];
        const member = await interaction.guild.members.fetch(entry.id).catch(() => null);
        const label = member ? `**${member.user.tag}**` : `<@${entry.id}>`;
        lines.push(`**${i + 1}.** ${label} — **${entry.count}** invite(s)`);
      }

      const embed = new EmbedBuilder()
        .setTitle("🏆 Invite Leaderboard — Top 10")
        .setColor(0xed4245)
        .setDescription(lines.join("\n"))
        .setFooter({ text: "Invites still in the server" })
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    }

    /* ---------- /blacklist (ADMIN/OWNER) NOT EPHEMERAL ---------- */
    if (name === "blacklist") {
      const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
      if (!member || (!isOwner(interaction.user.id) && !member.permissions.has(PermissionsBitField.Flags.Administrator))) {
        return interaction.reply({ content: "Admins only.", ephemeral: true });
      }

      const sub = interaction.options.getSubcommand();
      const s = getGuildSettings(interaction.guild.id);

      if (sub === "list") {
        const list = (s.invitesBlacklist || []).slice(0, 50);
        if (!list.length) return interaction.reply("Blacklist is empty.");
        return interaction.reply(`🚫 Blacklisted (invites never count):\n${list.map((id) => `• <@${id}> (\`${id}\`)`).join("\n")}`);
      }

      const user = interaction.options.getUser("user", true);

      if (sub === "add") {
        if (!s.invitesBlacklist.includes(String(user.id))) s.invitesBlacklist.push(String(user.id));
        saveSettings();

        // wipe their invite stats so they show 0 immediately
        resetInvitesForUser(user.id);

        return interaction.reply(`✅ Blacklisted ${user} — their invites will always stay **0**.`);
      }

      if (sub === "remove") {
        s.invitesBlacklist = (s.invitesBlacklist || []).filter((x) => String(x) !== String(user.id));
        saveSettings();
        return interaction.reply(`✅ Removed ${user} from blacklist.`);
      }
    }

    /* ---------- /settings ---------- */
    if (name === "settings") {
      const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
      if (!member || !isAdminOrOwner(member)) return interaction.reply({ content: "Admins only.", ephemeral: true });

      const sub = interaction.options.getSubcommand();
      const s = getGuildSettings(interaction.guild.id);

      if (sub === "show") {
        const safe = {
          staffRoleIds: s.staffRoleIds,
          vouchesChannelId: s.vouchesChannelId,
          joinLogChannelId: s.joinLogChannelId,
          customerRoleId: s.customerRoleId,
          invitesBlacklist: s.invitesBlacklist,
          rewardsWebhookUrl: s.rewardsWebhookUrl,
          automod: s.automod,
        };
        const json = JSON.stringify(safe, null, 2);
        return interaction.reply({ content: "```json\n" + json.slice(0, 1800) + "\n```", ephemeral: true });
      }

      if (sub === "reset") {
        settingsStore.byGuild[interaction.guild.id] = defaultGuildSettings();
        saveSettings();
        return interaction.reply({ content: "✅ Settings reset to defaults.", ephemeral: true });
      }

      if (sub === "set_staff_role") {
        const action = interaction.options.getString("action", true);
        const role = interaction.options.getRole("role", false);

        if (action === "clear") {
          s.staffRoleIds = [];
          saveSettings();
          return interaction.reply({ content: "✅ Cleared staff roles.", ephemeral: true });
        }
        if (!role) return interaction.reply({ content: "Pick a role.", ephemeral: true });

        s.staffRoleIds ??= [];

        if (action === "add") {
          if (!s.staffRoleIds.includes(role.id)) s.staffRoleIds.push(role.id);
          saveSettings();
          return interaction.reply({ content: `✅ Added staff role: ${role}`, ephemeral: true });
        }
        if (action === "remove") {
          s.staffRoleIds = s.staffRoleIds.filter((x) => x !== role.id);
          saveSettings();
          return interaction.reply({ content: `✅ Removed staff role: ${role}`, ephemeral: true });
        }
      }

      if (sub === "set_channel") {
        const type = interaction.options.getString("type", true);
        const channel = interaction.options.getChannel("channel", true);
        if (type === "vouches") s.vouchesChannelId = channel.id;
        if (type === "join_log") s.joinLogChannelId = channel.id;
        saveSettings();
        return interaction.reply({ content: `✅ Set **${type}** channel to ${channel}.`, ephemeral: true });
      }

      if (sub === "set_customer_role") {
        const role = interaction.options.getRole("role", true);
        s.customerRoleId = role.id;
        saveSettings();
        return interaction.reply({ content: `✅ Customer role set to ${role}.`, ephemeral: true });
      }

      // NEW: set rewards webhook
      if (sub === "set_rewards_webhook") {
        const url = interaction.options.getString("url", true).trim();
        if (!isValidWebhookUrl(url)) {
          return interaction.reply({
            content: "❌ That doesn't look like a valid Discord webhook URL. It should start with `https://discord.com/api/webhooks/...`",
            ephemeral: true,
          });
        }
        s.rewardsWebhookUrl = url;
        saveSettings();
        return interaction.reply({ content: "✅ Rewards webhook saved for this server.", ephemeral: true });
      }

      if (sub === "automod") {
        const enabled = interaction.options.getString("enabled", true) === "on";
        const bypassName = interaction.options.getString("bypass_role_name", false);
        s.automod.enabled = enabled;
        if (bypassName && bypassName.trim()) s.automod.bypassRoleName = bypassName.trim().slice(0, 50);
        saveSettings();
        return interaction.reply({
          content: `✅ Automod is now **${enabled ? "ON" : "OFF"}**.\nBypass role name: **${s.automod.bypassRoleName}**`,
          ephemeral: true,
        });
      }
    }

    /* ---------- /panel ---------- */
    if (name === "panel") {
      const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
      if (!member || !isAdminOrOwner(member)) return interaction.reply({ content: "Admins only.", ephemeral: true });

      const sub = interaction.options.getSubcommand();
      const cfg = getPanelConfig(interaction.guild.id);

      if (sub === "show") {
        const showCfg = {
          embed: cfg.embed,
          modal: cfg.modal,
          tickets: cfg.tickets,
          rewardsPanel: cfg.rewardsPanel,
        };
        const json = JSON.stringify(showCfg, null, 2);
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

        let newCfg;
        try {
          newCfg = JSON.parse(raw);
        } catch {
          return interaction.reply({ content: "❌ Invalid JSON.", ephemeral: true });
        }

        const v = validatePanelConfig(newCfg);
        if (!v.ok) return interaction.reply({ content: `❌ ${v.msg}`, ephemeral: true });

        // Preserve/merge rewards panel settings if not present
        newCfg.rewardsPanel ??= cfg.rewardsPanel ?? { text: null };

        panelStore.byGuild[interaction.guild.id] = newCfg;
        savePanelStore();
        return interaction.reply({ content: "✅ Saved ticket panel config for this server.", ephemeral: true });
      }

      if (sub === "post") {
        const targetChannel = interaction.options.getChannel("channel", false) || interaction.channel;
        if (!targetChannel || targetChannel.type !== ChannelType.GuildText)
          return interaction.reply({ content: "Invalid channel.", ephemeral: true });

        const v = validatePanelConfig(cfg);
        if (!v.ok) return interaction.reply({ content: `❌ Saved config invalid: ${v.msg}`, ephemeral: true });

        await targetChannel.send(buildTicketPanelMessage(cfg));
        return interaction.reply({ content: "✅ Posted ticket panel.", ephemeral: true });
      }

      // NEW: /panel rewards -> modal (ask what panel says) -> post panel -> save text
      if (sub === "rewards") {
        const modal = new ModalBuilder().setCustomId("rewards_panel_modal").setTitle("Rewards Panel");

        const input = new TextInputBuilder()
          .setCustomId("text")
          .setLabel("What should the rewards panel say?")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(4000);

        modal.addComponents(new ActionRowBuilder().addComponents(input));
        return interaction.showModal(modal);
      }
    }

    /* ---------- /embed ---------- */
    if (name === "embed") {
      const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
      if (!member || (!isOwner(interaction.user.id) && !member.permissions.has(PermissionsBitField.Flags.Administrator))) {
        return interaction.reply({ content: "Admins only.", ephemeral: true });
      }

      const targetChannel = interaction.options.getChannel("channel", false) || interaction.channel;
      if (!targetChannel || targetChannel.type !== ChannelType.GuildText)
        return interaction.reply({ content: "Invalid channel.", ephemeral: true });

      const title = interaction.options.getString("title", false);
      const description = interaction.options.getString("description", false);
      const colorInput = interaction.options.getString("color", false);
      const url = interaction.options.getString("url", false);
      const thumbnail = interaction.options.getString("thumbnail", false);
      const image = interaction.options.getString("image", false);

      if (!title && !description && !thumbnail && !image) {
        return interaction.reply({ content: "Provide at least title/description/image/thumbnail.", ephemeral: true });
      }

      const e = new EmbedBuilder();
      if (title) e.setTitle(String(title).slice(0, 256));
      if (description) e.setDescription(String(description).slice(0, 4096));
      if (url) e.setURL(url);

      const c = parseHexColor(colorInput);
      e.setColor(c !== null ? c : 0x2b2d31);

      if (thumbnail) e.setThumbnail(thumbnail);
      if (image) e.setImage(image);

      await targetChannel.send({ embeds: [e] });
      return interaction.reply({ content: "✅ Sent embed.", ephemeral: true });
    }

    /* ---------- /vouches (PUBLIC) ---------- */
    if (name === "vouches") {
      const s = getGuildSettings(interaction.guild.id);
      if (!s.vouchesChannelId) {
        return interaction.reply({ content: "Set vouches channel first: /settings set_channel type:vouches channel:#...", ephemeral: true });
      }

      await interaction.deferReply({ ephemeral: false });

      const channel = await interaction.guild.channels.fetch(s.vouchesChannelId).catch(() => null);
      if (!channel || channel.type !== ChannelType.GuildText) return interaction.editReply("Couldn't find the vouches channel.");

      let total = 0;
      let lastId;

      while (true) {
        const msgs = await channel.messages.fetch({ limit: 100, before: lastId });
        total += msgs.size;
        if (msgs.size < 100) break;
        lastId = msgs.last()?.id;
        if (!lastId) break;
      }

      return interaction.editReply(`This server has **${total}** vouch message(s).`);
    }

    /* ---------- /invites (PUBLIC) ---------- */
    if (name === "invites") {
      const user = interaction.options.getUser("user", true);
      const blacklisted = isBlacklistedInviter(interaction.guild.id, user.id);
      const count = invitesStillInServerForGuild(interaction.guild.id, user.id);
      return interaction.reply({
        content: blacklisted
          ? `📨 **${user.tag}** is **blacklisted** — invites will always stay **0**.`
          : `📨 **${user.tag}** has **${count}** invites still in the server.`,
      });
    }

    /* ---------- /generate ---------- */
    if (name === "generate") {
      const me = await interaction.guild.members.fetchMe();
      const canCreate = interaction.channel.permissionsFor(me)?.has(PermissionsBitField.Flags.CreateInstantInvite);
      if (!canCreate) return interaction.reply({ content: "❌ I need **Create Invite** permission in this channel.", ephemeral: true });

      const invite = await interaction.channel.createInvite({
        maxAge: 0,
        maxUses: 0,
        unique: true,
        reason: `Invite generated for ${interaction.user.tag}`,
      });

      invitesData.inviteOwners[invite.code] = interaction.user.id;
      saveInvites();

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel("Open Invite").setURL(invite.url)
      );

      return interaction.reply({
        content: `✅ Your personal invite link (credited to you):\n${invite.url}`,
        components: [row],
        ephemeral: true,
      });
    }

    /* ---------- /linkinvite ---------- */
    if (name === "linkinvite") {
      const input = interaction.options.getString("code", true);
      const code = extractInviteCode(input);
      if (!code) return interaction.reply({ content: "❌ Invalid invite code.", ephemeral: true });

      const invites = await interaction.guild.invites.fetch().catch(() => null);
      if (!invites) return interaction.reply({ content: "❌ I need invite permissions to verify invite codes.", ephemeral: true });

      const found = invites.find((inv) => inv.code === code);
      if (!found) return interaction.reply({ content: "❌ That invite code wasn’t found in this server.", ephemeral: true });

      invitesData.inviteOwners[code] = interaction.user.id;
      saveInvites();

      return interaction.reply({ content: `✅ Linked invite **${code}** to you.`, ephemeral: true });
    }

    /* ---------- /addinvites (NOT EPHEMERAL, ADMIN ONLY) ---------- */
    if (name === "addinvites") {
      const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
      if (!member || (!isOwner(interaction.user.id) && !member.permissions.has(PermissionsBitField.Flags.Administrator))) {
        return interaction.reply({ content: "Admins only.", ephemeral: true });
      }

      const user = interaction.options.getUser("user", true);
      const amount = interaction.options.getInteger("amount", true);

      if (isBlacklistedInviter(interaction.guild.id, user.id)) {
        return interaction.reply(`❌ ${user} is blacklisted — their invites must stay at **0**.`);
      }

      const st = ensureInviterStats(user.id);
      st.manual += amount;
      saveInvites();

      return interaction.reply({ content: `✅ Added **${amount}** invites to **${user.tag}**.` });
    }

    /* ---------- /resetinvites (NOT EPHEMERAL, STAFF LOCKED) ---------- */
    if (name === "resetinvites") {
      const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
      if (!member || (!isOwner(interaction.user.id) && !isStaff(member))) {
        return interaction.reply({ content: "Staff only (configure staff roles in /settings).", ephemeral: true });
      }

      const user = interaction.options.getUser("user", true);
      resetInvitesForUser(user.id);

      return interaction.reply({ content: `✅ Reset invite stats for **${user.tag}**.` });
    }

    /* ---------- /resetall ---------- */
    if (name === "resetall") {
      const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
      if (!member || (!isOwner(interaction.user.id) && !member.permissions.has(PermissionsBitField.Flags.Administrator))) {
        return interaction.reply({ content: "Admins only.", ephemeral: true });
      }

      invitesData.inviterStats = {};
      invitesData.memberInviter = {};
      invitesData.inviteOwners = {};
      invitesData.invitedMembers = {};
      saveInvites();

      return interaction.reply({ content: "✅ Reset invite stats for **everyone** in this server.", ephemeral: true });
    }

    /* ---------- /link ---------- */
    if (name === "link") {
      const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
      if (!member || (!isOwner(interaction.user.id) && !isStaff(member))) {
        return interaction.reply({ content: "Staff only (configure staff roles in /settings).", ephemeral: true });
      }

      const target = interaction.options.getUser("user", true);
      const invitedMap = invitesData.invitedMembers?.[target.id] || {};
      const invitedIds = Object.keys(invitedMap);

      const activeInvited = [];
      for (const invitedId of invitedIds) {
        const rec = invitedMap[invitedId];
        if (!rec?.active) continue;
        const m = await interaction.guild.members.fetch(invitedId).catch(() => null);
        if (!m) continue;
        activeInvited.push({ tag: m.user.tag, code: rec.inviteCode || "unknown" });
      }

      const guildInvites = await interaction.guild.invites.fetch().catch(() => null);
      const codes = new Set();

      if (guildInvites) {
        guildInvites.forEach((inv) => {
          if (inv.inviter?.id === target.id) codes.add(inv.code);
        });
      }
      for (const [code, ownerId] of Object.entries(invitesData.inviteOwners || {})) {
        if (ownerId === target.id) codes.add(code);
      }

      const codeList = [...codes].slice(0, 15);
      const inviteLinks = codeList.length ? codeList.map((c) => `https://discord.gg/${c}`).join("\n") : "None found.";

      const listText = activeInvited.length
        ? activeInvited.slice(0, 30).map((x, i) => `${i + 1}. ${x.tag} (code: ${x.code})`).join("\n")
        : "No active invited members found.";

      return interaction.reply({
        ephemeral: true,
        content:
          `**Invites for:** ${target.tag}\n\n` +
          `• **Active invited members (still credited):**\n${listText}\n\n` +
          `• **Invite link(s) they use:**\n${inviteLinks}`,
      });
    }

    /* ---------- /close ---------- */
    if (name === "close") {
      const channel = interaction.channel;
      if (!isTicketChannel(channel)) return interaction.reply({ content: "Use **/close** inside a ticket channel.", ephemeral: true });

      const meta = getTicketMetaFromTopic(channel.topic);
      const openerId = meta?.openerId;

      const reason = interaction.options.getString("reason", true);

      const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
      const canClose = isOwner(interaction.user.id) || interaction.user.id === openerId || isStaff(member);
      if (!canClose) return interaction.reply({ content: "Only the opener or staff can close this.", ephemeral: true });

      await interaction.reply({ content: "✅ Closing ticket...", ephemeral: true });

      await closeTicketFlow({
        channel,
        guild: interaction.guild,
        closerUser: interaction.user,
        reason,
      });
      return;
    }

    /* ---------- /operation ---------- */
    if (name === "operation") {
      const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
      if (!member || (!isOwner(interaction.user.id) && !member.permissions.has(PermissionsBitField.Flags.Administrator))) {
        return interaction.reply({ content: "Admins only.", ephemeral: true });
      }

      if (!isTicketChannel(interaction.channel)) return interaction.reply({ content: "Use /operation inside a ticket channel.", ephemeral: true });

      const sub = interaction.options.getSubcommand();

      if (sub === "cancel") {
        if (!activeOperations.has(interaction.channel.id)) {
          return interaction.reply({ content: "No active operation timer in this ticket.", ephemeral: true });
        }
        clearTimeout(activeOperations.get(interaction.channel.id));
        activeOperations.delete(interaction.channel.id);
        return interaction.reply({ content: "🛑 Operation cancelled.", ephemeral: true });
      }

      const durationStr = interaction.options.getString("duration", true);
      const ms = parseDurationToMs(durationStr);
      if (!ms) return interaction.reply({ content: "Invalid duration. Use 10m, 1h, 2d.", ephemeral: true });

      const meta = getTicketMetaFromTopic(interaction.channel.topic);
      const openerId = meta?.openerId;
      if (!openerId) return interaction.reply({ content: "Couldn't find ticket opener.", ephemeral: true });

      const s = getGuildSettings(interaction.guild.id);
      if (!s.customerRoleId) return interaction.reply({ content: "Set customer role first: /settings set_customer_role role:@Role", ephemeral: true });

      const openerMember = await interaction.guild.members.fetch(openerId).catch(() => null);
      if (!openerMember) return interaction.reply({ content: "Couldn't fetch ticket opener.", ephemeral: true });

      const botMe = await interaction.guild.members.fetchMe();
      if (!botMe.permissions.has(PermissionsBitField.Flags.ManageRoles)) return interaction.reply({ content: "I need **Manage Roles** permission.", ephemeral: true });

      const role = await interaction.guild.roles.fetch(s.customerRoleId).catch(() => null);
      if (!role) return interaction.reply({ content: "Customer role not found (check /settings).", ephemeral: true });
      if (role.position >= botMe.roles.highest.position) {
        return interaction.reply({ content: "Move the bot role above the customer role in Server Settings → Roles.", ephemeral: true });
      }

      await openerMember.roles.add(role, `Customer role given by /operation from ${interaction.user.tag}`).catch(() => {});
      if (s.vouchesChannelId) {
        await interaction.channel
          .send(`<@${openerId}> please go to <#${s.vouchesChannelId}> and drop a vouch for us. Thank you!`)
          .catch(() => {});
      }

      // delete ticket after timer
      if (activeOperations.has(interaction.channel.id)) {
        clearTimeout(activeOperations.get(interaction.channel.id));
        activeOperations.delete(interaction.channel.id);
      }

      const channelId = interaction.channel.id;
      const timeout = setTimeout(async () => {
        const ch = await client.channels.fetch(channelId).catch(() => null);
        if (!ch || ch.type !== ChannelType.GuildText) return;
        ch.delete().catch(() => {});
        activeOperations.delete(channelId);
      }, ms);

      activeOperations.set(channelId, timeout);
      return interaction.reply({ content: `✅ Operation started. Ticket closes in **${durationStr}**.`, ephemeral: true });
    }

    /* ---------- Giveaways ---------- */
    if (name === "giveaway") {
      const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
      if (!member || (!isOwner(interaction.user.id) && !isStaff(member))) {
        return interaction.reply({ content: "Staff only (configure staff roles in /settings).", ephemeral: true });
      }

      const durationStr = interaction.options.getString("duration", true);
      const winners = interaction.options.getInteger("winners", true);
      const prize = interaction.options.getString("prize", true).trim();
      const minInvites = interaction.options.getInteger("min_invites", false) ?? 0;

      const ms = parseDurationToMs(durationStr);
      if (!ms) return interaction.reply({ content: "Invalid duration. Use 30m, 1h, 2d, etc.", ephemeral: true });
      if (winners < 1) return interaction.reply({ content: "Winners must be at least 1.", ephemeral: true });
      if (!prize) return interaction.reply({ content: "Prize cannot be empty.", ephemeral: true });

      const gw = {
        guildId: interaction.guild.id,
        channelId: interaction.channel.id,
        messageId: null,
        prize,
        winners,
        hostId: interaction.user.id,
        endsAt: Date.now() + ms,
        entries: [],
        ended: false,
        minInvites,
        lastWinners: [],
      };

      const sent = await interaction.reply({
        embeds: [makeGiveawayEmbed({ ...gw, messageId: "pending" })],
        components: [giveawayRow({ ...gw, messageId: "pending" })],
        fetchReply: true,
      });

      gw.messageId = sent.id;
      giveawayData.giveaways[gw.messageId] = gw;
      saveGiveaways();

      await sent.edit({ embeds: [makeGiveawayEmbed(gw)], components: [giveawayRow(gw)] }).catch(() => {});
      scheduleGiveawayEnd(gw.messageId);
      return;
    }

    if (name === "end") {
      const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
      if (!member || (!isOwner(interaction.user.id) && !isStaff(member))) {
        return interaction.reply({ content: "Staff only (configure staff roles in /settings).", ephemeral: true });
      }

      const raw = interaction.options.getString("message", true);
      const messageId = extractMessageId(raw);
      if (!messageId) return interaction.reply({ content: "Invalid message ID/link.", ephemeral: true });

      await interaction.deferReply({ ephemeral: true });
      const res = await endGiveaway(messageId, interaction.user.id);
      return interaction.editReply(res.ok ? "✅ Giveaway ended." : `❌ ${res.msg}`);
    }

    if (name === "reroll") {
      const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
      if (!member || (!isOwner(interaction.user.id) && !isStaff(member))) {
        return interaction.reply({ content: "Staff only (configure staff roles in /settings).", ephemeral: true });
      }

      const raw = interaction.options.getString("message", true);
      const messageId = extractMessageId(raw);
      if (!messageId) return interaction.reply({ content: "Invalid message ID/link.", ephemeral: true });

      await interaction.deferReply({ ephemeral: true });
      const res = await rerollGiveaway(messageId, interaction.user.id);
      return interaction.editReply(res.ok ? "✅ Rerolled winners." : `❌ ${res.msg}`);
    }
  } catch (e) {
    console.error("interaction error:", e);
    try {
      if (interaction?.isRepliable?.() && !interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: "Error handling that interaction.", ephemeral: true });
      }
    } catch {}
  }
});

/* ===================== MESSAGE HANDLER (AUTOMOD + PREFIX CMDS + STICKY + CALC) ===================== */
client.on("messageCreate", async (message) => {
  try {
    if (!message.guild || message.author.bot) return;

    if (!isOwner(message.author.id) && isStopped(message.guild.id)) {
      await message.channel.send("Adam has restricted commands in your server.").catch(() => {});
      return;
    }

    const s = getGuildSettings(message.guild.id);

    // Automod link blocker
    if (s.automod?.enabled && containsLink(message.content) && !isOwner(message.author.id)) {
      const member = message.member;
      if (member) {
        const isAdmin = member.permissions.has(PermissionsBitField.Flags.Administrator);
        const bypassRoleName = String(s.automod?.bypassRoleName || "automod").toLowerCase();
        const bypassRole = message.guild.roles.cache.find((r) => r.name.toLowerCase() === bypassRoleName);
        const hasBypass = bypassRole ? member.roles.cache.has(bypassRole.id) : false;

        if (!isAdmin && !hasBypass) {
          await message.delete().catch(() => {});
          message.channel
            .send(`🚫 ${member}, links aren’t allowed unless you have the **${bypassRoleName}** role.`)
            .then((m) => setTimeout(() => m.delete().catch(() => {}), 5000))
            .catch(() => {});
          return;
        }
      }
    }

    const canUsePrefix = isOwner(message.author.id) || message.member?.permissions?.has(PermissionsBitField.Flags.Administrator);

    if (message.content.startsWith(PREFIX) && canUsePrefix) {
      const parts = message.content.slice(PREFIX.length).trim().split(/\s+/);
      const cmd = (parts.shift() || "").toLowerCase();
      const arg1 = parts[0];
      const text = message.content.slice(PREFIX.length + cmd.length + 1);

      /* ---- !calc (NOT EPHEMERAL; it replies in channel) ---- */
      if (cmd === "calc") {
        if (!text || !text.trim()) {
          return message.reply("Usage: `!calc 10/2`, `!calc 5x6`, `!calc 2^5`, `!calc (5x2)+3`");
        }
        try {
          const result = calcExpression(text);
          const out = formatCalcResult(result);
          if (out === null) return message.reply("Invalid calculation.");
          return message.reply(`🧮 Result: **${out}**`);
        } catch {
          return message.reply("Invalid calculation format.");
        }
      }

      /* ---- existing prefix fallback: !sync ---- */
      if (cmd === "sync" && isOwner(message.author.id)) {
        const mode = (parts[0] || "register_here").toLowerCase();
        try {
          if (mode === "clear_here") {
            await clearGuild(message.guild.id);
            return message.reply("🧹 Cleared THIS server commands. Now do `!sync register_here`.");
          }
          if (mode === "register_here") {
            await registerGuild(message.guild.id);
            return message.reply("✅ Re-registered commands for THIS server. Try /settings now.");
          }
          if (mode === "clear_global") {
            await clearGlobal();
            return message.reply("🧹 Cleared GLOBAL commands.");
          }
          if (mode === "register_global") {
            await registerGlobal();
            return message.reply("✅ Re-registered GLOBAL commands.");
          }
        } catch (e) {
          return message.reply(`❌ Sync failed: ${e?.message || e}`);
        }
      }

      if (cmd === "stick") {
        if (!text || !text.trim()) return message.reply("Usage: !stick <message>");
        const old = stickyByChannel.get(message.channel.id);
        if (old?.messageId) await message.channel.messages.delete(old.messageId).catch(() => {});
        const sent = await message.channel.send(text);
        stickyByChannel.set(message.channel.id, { content: text, messageId: sent.id });
        await message.reply("✅ Sticky set for this channel.");
        return;
      }

      if (cmd === "unstick") {
        const old = stickyByChannel.get(message.channel.id);
        if (old?.messageId) await message.channel.messages.delete(old.messageId).catch(() => {});
        stickyByChannel.delete(message.channel.id);
        await message.reply("✅ Sticky removed for this channel.");
        return;
      }

      if (cmd === "mute") {
        const userId = arg1?.match(/\d{10,25}/)?.[0];
        if (!userId) return message.reply("Usage: !mute <@user|id>");
        const target = await message.guild.members.fetch(userId).catch(() => null);
        if (!target) return message.reply("❌ I can't find that user in this server.");

        const me = await message.guild.members.fetchMe();
        if (!me.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
          return message.reply("❌ I need **Moderate Members** permission to timeout users.");
        }

        await target.timeout(5 * 60 * 1000, `Timed out by ${message.author.tag} (5 minutes)`).catch(() => {});
        await message.channel.send(`${target.user} was timed out for **5 min**.`).catch(() => {});
        return;
      }

      if (cmd === "ban") {
        const userId = arg1?.match(/\d{10,25}/)?.[0];
        if (!userId) return message.reply("Usage: !ban <@user|id>");
        const target = await message.guild.members.fetch(userId).catch(() => null);
        if (!target) return message.reply("❌ I can't find that user in this server.");
        await target.ban({ reason: `Banned by ${message.author.tag}` }).catch(() => {});
        await message.channel.send(`${target.user} was banned.`).catch(() => {});
        return;
      }

      if (cmd === "kick") {
        const userId = arg1?.match(/\d{10,25}/)?.[0];
        if (!userId) return message.reply("Usage: !kick <@user|id>");
        const target = await message.guild.members.fetch(userId).catch(() => null);
        if (!target) return message.reply("❌ I can't find that user in this server.");
        await target.kick(`Kicked by ${message.author.tag}`).catch(() => {});
        await message.channel.send(`${target.user} was kicked.`).catch(() => {});
        return;
      }

      if (cmd === "purge") {
        const amount = parseInt(arg1, 10);
        if (!amount || amount < 1) return message.reply("Usage: !purge <amount> (1-100)");
        const toDelete = Math.min(100, amount + 1);
        await message.channel.bulkDelete(toDelete, true).catch(async () => {
          await message.reply("❌ I can’t bulk delete messages older than 14 days.");
        });
        return;
      }
    }

    // Sticky behavior
    const sticky = stickyByChannel.get(message.channel.id);
    if (sticky) {
      if (sticky.messageId && message.id === sticky.messageId) return;
      if (sticky.messageId) await message.channel.messages.delete(sticky.messageId).catch(() => {});
      const sent = await message.channel.send(sticky.content);
      stickyByChannel.set(message.channel.id, { content: sticky.content, messageId: sent.id });
    }
  } catch (e) {
    console.error("messageCreate error:", e);
  }
});

/* ===================== LOGIN ===================== */
if (!process.env.TOKEN) {
  console.error("❌ Missing TOKEN (set it in your host env vars or .env)");
  process.exit(1);
}

client.login(process.env.TOKEN);

/**
 * If /settings still doesn’t show:
 * - Run /sync mode:clear_here then /sync mode:register_here (owner)
 * OR prefix fallback:
 * - !sync clear_here then !sync register_here
 */
