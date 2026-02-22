/**
 * DonutDemand Bot — Single File (discord.js v14)
 *
 * ✅ GLOBAL slash commands (work in every server)
 * ✅ NO hardcoded role/channel IDs (all per-server via /settings)
 * ✅ OWNER override (bot owner can run everything anywhere)
 * ✅ /stop <server_id> + /resume <server_id> (OWNER only)
 *
 * NEW CHANGES YOU ASKED FOR:
 * ✅ Ticket panel: Rewards ticket blocked unless:
 *    - user has 5+ invites
 *    - AND user joined server 2+ hours ago
 *
 * ✅ /operation: NO LONGER auto-deletes/closes the ticket.
 *    It now:
 *    - gives customer role
 *    - asks for vouch in vouches channel
 *    - optional timer just sends a reminder message (does NOT delete)
 *
 * Features:
 *  - /settings (Admin only) to configure:
 *      • staff roles (can view/close tickets, run staff cmds)
 *      • vouches channel
 *      • join log channel
 *      • customer role (for /operation)
 *      • automod link blocker toggle + bypass role name
 *  - Tickets:
 *      • /panel (Admin) to configure/post ticket panel (4 buttons max)
 *      • Modal asks: Minecraft username + What do you need?
 *      • 1 open ticket per user
 *      • Categories auto-created by name per ticket type
 *      • /close inside ticket (opener or staff/admin)
 *      • DM embed on close
 *  - Invites tracking (best-effort; requires Manage Guild + Manage Channels/Invites perms)
 *      • /generate, /linkinvite, /invites, /addinvites, /resetinvites, /resetall, /link
 *  - Giveaways:
 *      • /giveaway, /end, /reroll (staff/admin)
 *  - Automod (optional):
 *      • blocks links unless admin OR has bypass role (name configurable)
 *  - Prefix admin tools:
 *      • !stick / !unstick / !mute / !ban / !kick / !purge
 *
 * ENV:
 *   TOKEN=your_bot_token
 *
 * Intents to enable in Dev Portal:
 *   - Server Members Intent
 *   - Message Content Intent
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

/* ===================== BASICS ===================== */

const PREFIX = "!";
const OWNER_ID = "1456326972631154786"; // bot owner (Adam)

function isOwner(userId) {
  return String(userId) === OWNER_ID;
}

/* ===================== FILE STORAGE ===================== */

const DATA_DIR = __dirname;
const SETTINGS_FILE = path.join(DATA_DIR, "guild_settings.json");
const PANEL_FILE = path.join(DATA_DIR, "panel_config.json");
const INVITES_FILE = path.join(DATA_DIR, "invites_data.json");
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
    staffRoleIds: [], // roles that can view/close tickets + staff cmds
    vouchesChannelId: null,
    joinLogChannelId: null,
    customerRoleId: null, // for /operation
    automod: {
      enabled: true,
      bypassRoleName: "automod", // role name that bypasses link block
    },
  };
}

function getGuildSettings(guildId) {
  if (!settingsStore.byGuild[guildId]) {
    settingsStore.byGuild[guildId] = defaultGuildSettings();
    saveSettings();
  }
  // patch missing keys
  const s = settingsStore.byGuild[guildId];
  s.staffRoleIds ??= [];
  s.vouchesChannelId ??= null;
  s.joinLogChannelId ??= null;
  s.customerRoleId ??= null;
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
};

function getPanelConfig(guildId) {
  return panelStore.byGuild[guildId] || DEFAULT_PANEL_CONFIG;
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

function formatDuration(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

/* ===================== STOP/RESUME GATE ===================== */

async function denyIfStopped(interactionOrMessage) {
  const guildId = interactionOrMessage.guild?.id;
  if (!guildId) return false; // DMs ignored elsewhere
  if (!isStopped(guildId)) return false;

  const content = "Adam has restricted commands in your server.";
  if (interactionOrMessage.isChatInputCommand?.() || interactionOrMessage.isButton?.() || interactionOrMessage.isModalSubmit?.()) {
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

const invitesCache = new Map(); // guildId -> Map(code->uses)

async function refreshGuildInvites(guild) {
  const invites = await guild.invites.fetch().catch(() => null);
  if (!invites) return null;
  const map = new Map();
  invites.forEach((inv) => map.set(inv.code, inv.uses ?? 0));
  invitesCache.set(guild.id, map);
  return invites;
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
      { name: "Next Steps", value: nextSteps.join("\n"), inline: false }
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

/* ===================== SLASH COMMANDS (GLOBAL) ===================== */

function buildCommandsJSON() {
  const settingsCmd = new SlashCommandBuilder()
    .setName("settings")
    .setDescription("Admin: configure this bot for your server.")
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
            .addChoices({ name: "add", value: "add" }, { name: "remove", value: "remove" }, { name: "clear", value: "clear" })
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
        .addChannelOption((o) => o.setName("channel").setDescription("Text channel").addChannelTypes(ChannelType.GuildText).setRequired(true))
    )
    .addSubcommand((s) =>
      s
        .setName("set_customer_role")
        .setDescription("Set the customer role used by /operation.")
        .addRoleOption((o) => o.setName("role").setDescription("Customer role").setRequired(true))
    )
    .addSubcommand((s) =>
      s
        .setName("automod")
        .setDescription("Configure link blocker.")
        .addStringOption((o) =>
          o.setName("enabled").setDescription("Enable or disable automod").setRequired(true).addChoices({ name: "on", value: "on" }, { name: "off", value: "off" })
        )
        .addStringOption((o) =>
          o.setName("bypass_role_name").setDescription("Role NAME that bypasses link block (default: automod)").setRequired(false)
        )
    );

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

  const stopCmd = new SlashCommandBuilder().setName("stop").setDescription("OWNER: restrict bot commands in a server.").addStringOption((o) => o.setName("server_id").setDescription("Guild ID").setRequired(true));
  const resumeCmd = new SlashCommandBuilder().setName("resume").setDescription("OWNER: resume bot commands in a server.").addStringOption((o) => o.setName("server_id").setDescription("Guild ID").setRequired(true));

  const embedCmd = new SlashCommandBuilder()
    .setName("embed")
    .setDescription("Send a custom embed (admin only).")
    .addChannelOption((o) => o.setName("channel").setDescription("Channel to send embed in (optional)").addChannelTypes(ChannelType.GuildText).setRequired(false))
    .addStringOption((o) => o.setName("title").setDescription("Embed title").setRequired(false))
    .addStringOption((o) => o.setName("description").setDescription("Embed description").setRequired(false))
    .addStringOption((o) => o.setName("color").setDescription("Hex color like #ff0000").setRequired(false))
    .addStringOption((o) => o.setName("url").setDescription("Clickable title URL").setRequired(false))
    .addStringOption((o) => o.setName("thumbnail").setDescription("Thumbnail image URL").setRequired(false))
    .addStringOption((o) => o.setName("image").setDescription("Main image URL").setRequired(false));

  const invitesCmds = [
    new SlashCommandBuilder().setName("vouches").setDescription("Shows how many messages are in the vouches channel (configured in /settings)."),
    new SlashCommandBuilder().setName("invites").setDescription("Shows invites still in the server for a user.").addUserOption((o) => o.setName("user").setDescription("User").setRequired(true)),
    new SlashCommandBuilder().setName("generate").setDescription("Generate your personal invite link (credited to you)."),
    new SlashCommandBuilder().setName("linkinvite").setDescription("Link an existing invite code to yourself for invite credit.").addStringOption((o) => o.setName("code").setDescription("Invite code or discord.gg link").setRequired(true)),
    new SlashCommandBuilder().setName("addinvites").setDescription("Add invites to a user (manual). Admin only.").addUserOption((o) => o.setName("user").setDescription("User").setRequired(true)).addIntegerOption((o) => o.setName("amount").setDescription("Amount").setRequired(true)),
    new SlashCommandBuilder().setName("resetinvites").setDescription("Reset a user's invite stats. Staff role-locked.").addUserOption((o) => o.setName("user").setDescription("User").setRequired(true)),
    new SlashCommandBuilder().setName("resetall").setDescription("Reset invite stats for EVERYONE. Admin only."),
    new SlashCommandBuilder().setName("link").setDescription("Staff/Admin: show who a user invited + invite links they use.").addUserOption((o) => o.setName("user").setDescription("User to inspect").setRequired(true)),
  ];

  const closeCmd = new SlashCommandBuilder().setName("close").setDescription("Close the current ticket (DMs opener the reason).").addStringOption((o) => o.setName("reason").setDescription("Reason").setRequired(true));

  const opCmd = new SlashCommandBuilder()
    .setName("operation")
    .setDescription("Admin: give customer role + ask for vouch + optional reminder timer (does NOT close).")
    .addSubcommand((sub) => sub.setName("start").setDescription("Start operation in this ticket.").addStringOption((o) => o.setName("duration").setDescription("Optional reminder timer e.g. 10m, 1h, 2d").setRequired(false)))
    .addSubcommand((sub) => sub.setName("cancel").setDescription("Cancel operation reminder timer in this ticket."));

  const giveawayCmds = [
    new SlashCommandBuilder().setName("giveaway").setDescription("Start a giveaway with a join button.").addStringOption((o) => o.setName("duration").setDescription("e.g. 30m 1h 2d").setRequired(true)).addIntegerOption((o) => o.setName("winners").setDescription("How many winners").setRequired(true)).addStringOption((o) => o.setName("prize").setDescription("Prize").setRequired(true)).addIntegerOption((o) => o.setName("min_invites").setDescription("Minimum invites needed to join (optional)").setMinValue(0).setRequired(false)),
    new SlashCommandBuilder().setName("end").setDescription("End a giveaway early (staff/admin).").addStringOption((o) => o.setName("message").setDescription("Giveaway message ID or link").setRequired(true)),
    new SlashCommandBuilder().setName("reroll").setDescription("Reroll winners for a giveaway (staff/admin).").addStringOption((o) => o.setName("message").setDescription("Giveaway message ID or link").setRequired(true)),
  ];

  return [settingsCmd, panelCmd, stopCmd, resumeCmd, embedCmd, ...invitesCmds, closeCmd, opCmd, ...giveawayCmds].map((c) => c.toJSON());
}

async function registerSlashCommandsGlobal() {
  if (!process.env.TOKEN) throw new Error("Missing TOKEN");
  const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);
  const body = buildCommandsJSON();
  await rest.put(Routes.applicationCommands(client.user.id), { body });
  console.log("✅ GLOBAL slash commands registered (can take time to appear everywhere)");
}

/* ===================== READY ===================== */

client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  try {
    await registerSlashCommandsGlobal();
  } catch (e) {
    console.log("❌ Slash register failed:", e?.message || e);
  }

  for (const guild of client.guilds.cache.values()) {
    await refreshGuildInvites(guild).catch(() => {});
    getGuildSettings(guild.id);
  }
  for (const messageId of Object.keys(giveawayData.giveaways || {})) {
    const gw = giveawayData.giveaways[messageId];
    if (gw && !gw.ended) scheduleGiveawayEnd(messageId);
  }
});

client.on("guildCreate", async (guild) => {
  getGuildSettings(guild.id);
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
    if (!s.joinLogChannelId) return;

    const logChannel = await guild.channels.fetch(s.joinLogChannelId).catch(() => null);
    if (!logChannel || logChannel.type !== ChannelType.GuildText) return;

    const before = invitesCache.get(guild.id);
    if (!before) {
      await logChannel.send(`${member} joined. (Couldn't detect inviter — missing invite permissions)`);
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
      await logChannel.send(`${member} joined. (Couldn't detect invite used)`);
      return;
    }

    const linkedOwner = invitesData.inviteOwners?.[used.code];
    const creditedInviterId = linkedOwner || used.inviter?.id || null;

    if (!creditedInviterId) {
      await logChannel.send(`${member} has been invited by **Unknown** and now has **0** invites.`);
      return;
    }

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

    const still = invitesStillInServer(creditedInviterId);
    await logChannel.send(`${member} has been invited by <@${creditedInviterId}> and now has **${still}** invites.`);
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

/* ===================== INTERACTIONS ===================== */

client.on("interactionCreate", async (interaction) => {
  try {
    if (!interaction.guild) return; // ignore DMs

    const isOwnerCmd = interaction.isChatInputCommand() && (interaction.commandName === "stop" || interaction.commandName === "resume");
    if (!isOwnerCmd) {
      const blocked = await denyIfStopped(interaction);
      if (blocked) return;
    }

    // Giveaway join button
    if (interaction.isButton() && interaction.customId.startsWith("gw_join:")) {
      const messageId = interaction.customId.split("gw_join:")[1];
      const gw = giveawayData.giveaways[messageId];
      if (!gw) return interaction.reply({ content: "This giveaway no longer exists.", ephemeral: true });
      if (gw.ended) return interaction.reply({ content: "This giveaway already ended.", ephemeral: true });

      const need = gw.minInvites || 0;
      if (need > 0) {
        const have = invitesStillInServer(interaction.user.id);
        if (have < need) return interaction.reply({ content: `❌ Need **${need}** invites. You have **${have}**.`, ephemeral: true });
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

    // Ticket buttons -> modal
    if (interaction.isButton() && interaction.customId.startsWith("ticket:")) {
      const typeId = interaction.customId.split("ticket:")[1];
      const config = getPanelConfig(interaction.guild.id);
      const ticketType = resolveTicketType(config, typeId);
      if (!ticketType) return interaction.reply({ content: "This ticket type no longer exists.", ephemeral: true });

      // ✅ NEW: Rewards ticket requirements (5+ invites AND joined 2+ hours ago)
      if (ticketType.id === "ticket_rewards") {
        const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
        if (!member) return interaction.reply({ content: "❌ Couldn't read your server join info. Try again.", ephemeral: true });

        const haveInv = invitesStillInServer(interaction.user.id);
        const joinedAt = member.joinedAt ? member.joinedAt.getTime() : null;

        const needInv = 5;
        const needMs = 2 * 60 * 60 * 1000;

        if (haveInv < needInv) {
          return interaction.reply({
            content: `❌ You need **${needInv} invites** to open a Rewards ticket.\nYou currently have **${haveInv}**.`,
            ephemeral: true,
          });
        }

        if (!joinedAt || Date.now() - joinedAt < needMs) {
          const remaining = joinedAt ? needMs - (Date.now() - joinedAt) : needMs;
          return interaction.reply({
            content: `❌ You must be in the server for **2 hours** before opening a Rewards ticket.\nTime left: **${formatDuration(remaining)}**`,
            ephemeral: true,
          });
        }
      }

      const existing = findOpenTicketChannel(interaction.guild, interaction.user.id);
      if (existing) return interaction.reply({ content: `❌ You already have an open ticket: ${existing}`, ephemeral: true });

      const modal = new ModalBuilder().setCustomId(`ticket_modal:${ticketType.id}`).setTitle(String(config.modal?.title || "Ticket Info").slice(0, 45));

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

      const s = getGuildSettings(interaction.guild.id);

      const overwrites = [
        { id: interaction.guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
        {
          id: interaction.user.id,
          allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory],
        },
        ...(s.staffRoleIds || []).map((rid) => ({
          id: rid,
          allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory],
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
    if (!interaction.isChatInputCommand()) return;
    const name = interaction.commandName;

    /* ---------- /stop & /resume (OWNER only) ---------- */
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

    /* ---------- /settings (Admin only; OWNER override) ---------- */
    if (name === "settings") {
      const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
      if (!member || !isAdminOrOwner(member)) return interaction.reply({ content: "Admins only.", ephemeral: true });

      const sub = interaction.options.getSubcommand();
      const s = getGuildSettings(interaction.guild.id);

      if (sub === "show") {
        const safe = { staffRoleIds: s.staffRoleIds, vouchesChannelId: s.vouchesChannelId, joinLogChannelId: s.joinLogChannelId, customerRoleId: s.customerRoleId, automod: s.automod };
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

    /* ---------- /panel (Admin only; OWNER override) ---------- */
    if (name === "panel") {
      const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
      if (!member || !isAdminOrOwner(member)) return interaction.reply({ content: "Admins only.", ephemeral: true });

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
        try {
          cfg = JSON.parse(raw);
        } catch {
          return interaction.reply({ content: "❌ Invalid JSON.", ephemeral: true });
        }

        const v = validatePanelConfig(cfg);
        if (!v.ok) return interaction.reply({ content: `❌ ${v.msg}`, ephemeral: true });

        panelStore.byGuild[interaction.guild.id] = cfg;
        savePanelStore();
        return interaction.reply({ content: "✅ Saved panel config for this server.", ephemeral: true });
      }

      if (sub === "post") {
        const cfg = getPanelConfig(interaction.guild.id);
        const targetChannel = interaction.options.getChannel("channel", false) || interaction.channel;
        if (!targetChannel || targetChannel.type !== ChannelType.GuildText) return interaction.reply({ content: "Invalid channel.", ephemeral: true });

        const v = validatePanelConfig(cfg);
        if (!v.ok) return interaction.reply({ content: `❌ Saved config invalid: ${v.msg}`, ephemeral: true });

        await targetChannel.send(buildTicketPanelMessage(cfg));
        return interaction.reply({ content: "✅ Posted ticket panel.", ephemeral: true });
      }
    }

    /* ---------- /embed ---------- */
    if (name === "embed") {
      const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
      if (!member || (!isOwner(interaction.user.id) && !member.permissions.has(PermissionsBitField.Flags.Administrator))) {
        return interaction.reply({ content: "Admins only.", ephemeral: true });
      }

      const targetChannel = interaction.options.getChannel("channel", false) || interaction.channel;
      if (!targetChannel || targetChannel.type !== ChannelType.GuildText) return interaction.reply({ content: "Invalid channel.", ephemeral: true });

      const title = interaction.options.getString("title", false);
      const description = interaction.options.getString("description", false);
      const colorInput = interaction.options.getString("color", false);
      const url = interaction.options.getString("url", false);
      const thumbnail = interaction.options.getString("thumbnail", false);
      const image = interaction.options.getString("image", false);

      if (!title && !description && !thumbnail && !image) return interaction.reply({ content: "Provide at least title/description/image/thumbnail.", ephemeral: true });

      const e = new EmbedBuilder();
      if (title) e.setTitle(String(title).slice(0, 256));
      if (description) e.setDescription(String(description).slice(0, 4096));
      if (url) e.setURL(url);
      const c = parseHexColor(colorInput);
      e.setColor(c !== null ? c : 0x2b2d31);
      if (thumbnail) e.setThumbnail(thumbnail);
      if (image) e.setImage(image);

      await interaction.reply({ content: "✅ Sent embed.", ephemeral: true });
      await targetChannel.send({ embeds: [e] });
      return;
    }

    /* ---------- /vouches ---------- */
    if (name === "vouches") {
      const s = getGuildSettings(interaction.guild.id);
      if (!s.vouchesChannelId) return interaction.reply({ content: "Set vouches channel first: `/settings set_channel type:vouches channel:#...`", ephemeral: true });

      await interaction.deferReply({ ephemeral: true });
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

    /* ---------- /invites ---------- */
    if (name === "invites") {
      const user = interaction.options.getUser("user", true);
      return interaction.reply({ content: `📨 **${user.tag}** has **${invitesStillInServer(user.id)}** invites still in the server.`, ephemeral: true });
    }

    /* ---------- /generate ---------- */
    if (name === "generate") {
      const me = await interaction.guild.members.fetchMe();
      const canCreate = interaction.channel.permissionsFor(me)?.has(PermissionsBitField.Flags.CreateInstantInvite);
      if (!canCreate) return interaction.reply({ content: "❌ I need **Create Invite** permission in this channel.", ephemeral: true });

      const invite = await interaction.channel.createInvite({ maxAge: 0, maxUses: 0, unique: true, reason: `Invite generated for ${interaction.user.tag}` });
      invitesData.inviteOwners[invite.code] = interaction.user.id;
      saveInvites();

      const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel("Open Invite").setURL(invite.url));
      return interaction.reply({ content: `✅ Your personal invite link (credited to you):\n${invite.url}`, components: [row], ephemeral: true });
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

    /* ---------- /addinvites ---------- */
    if (name === "addinvites") {
      const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
      if (!member || (!isOwner(interaction.user.id) && !member.permissions.has(PermissionsBitField.Flags.Administrator))) {
        return interaction.reply({ content: "Admins only.", ephemeral: true });
      }

      const user = interaction.options.getUser("user", true);
      const amount = interaction.options.getInteger("amount", true);

      const st = ensureInviterStats(user.id);
      st.manual += amount;
      saveInvites();
      return interaction.reply({ content: `✅ Added **${amount}** invites to **${user.tag}**.`, ephemeral: true });
    }

    /* ---------- /resetinvites ---------- */
    if (name === "resetinvites") {
      const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
      if (!member || (!isOwner(interaction.user.id) && !isStaff(member))) {
        return interaction.reply({ content: "Staff only (configure staff roles in /settings).", ephemeral: true });
      }

      const user = interaction.options.getUser("user", true);
      invitesData.inviterStats[user.id] = { joins: 0, rejoins: 0, left: 0, manual: 0 };
      delete invitesData.invitedMembers[user.id];
      saveInvites();
      return interaction.reply({ content: `✅ Reset invite stats for **${user.tag}**.`, ephemeral: true });
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

      if (guildInvites) guildInvites.forEach((inv) => { if (inv.inviter?.id === target.id) codes.add(inv.code); });
      for (const [code, ownerId] of Object.entries(invitesData.inviteOwners || {})) if (ownerId === target.id) codes.add(code);

      const codeList = [...codes].slice(0, 15);
      const inviteLinks = codeList.length ? codeList.map((c) => `https://discord.gg/${c}`).join("\n") : "None found.";

      const listText = activeInvited.length ? activeInvited.slice(0, 30).map((x, i) => `${i + 1}. ${x.tag} (code: ${x.code})`).join("\n") : "No active invited members found.";

      return interaction.reply({
        ephemeral: true,
        content: `**Invites for:** ${target.tag}\n\n**Active invited members (still credited):**\n${listText}\n\n**Invite link(s) they use:**\n${inviteLinks}`,
      });
    }

    /* ---------- /close ---------- */
    if (name === "close") {
      const channel = interaction.channel;
      if (!isTicketChannel(channel)) return interaction.reply({ content: "Use **/close** inside a ticket channel.", ephemeral: true });

      const meta = getTicketMetaFromTopic(channel.topic);
      const openerId = meta?.openerId;

      const config = getPanelConfig(interaction.guild.id);
      const t = resolveTicketType(config, meta?.typeId);
      const ticketTypeLabel = t?.label || "Unknown";
      const reason = interaction.options.getString("reason", true);

      const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
      const canClose = isOwner(interaction.user.id) || interaction.user.id === openerId || isStaff(member);
      if (!canClose) return interaction.reply({ content: "Only the opener or staff can close this.", ephemeral: true });

      if (activeOperations.has(channel.id)) {
        clearTimeout(activeOperations.get(channel.id));
        activeOperations.delete(channel.id);
      }

      const s = getGuildSettings(interaction.guild.id);

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
              vouchesChannelId: s.vouchesChannelId,
            }),
          ],
        });
      } catch {}

      await interaction.reply({ content: "Closing ticket in 3 seconds...", ephemeral: true });
      setTimeout(() => channel.delete().catch(() => {}), 3000);
      return;
    }

    /* ---------- /operation (UPDATED) ---------- */
    if (name === "operation") {
      const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
      if (!member || (!isOwner(interaction.user.id) && !member.permissions.has(PermissionsBitField.Flags.Administrator))) {
        return interaction.reply({ content: "Admins only.", ephemeral: true });
      }
      if (!isTicketChannel(interaction.channel)) return interaction.reply({ content: "Use /operation inside a ticket channel.", ephemeral: true });

      const sub = interaction.options.getSubcommand();

      if (sub === "cancel") {
        if (!activeOperations.has(interaction.channel.id)) return interaction.reply({ content: "No active operation reminder timer in this ticket.", ephemeral: true });
        clearTimeout(activeOperations.get(interaction.channel.id));
        activeOperations.delete(interaction.channel.id);
        return interaction.reply({ content: "🛑 Operation reminder cancelled.", ephemeral: true });
      }

      const durationStr = interaction.options.getString("duration", false);
      const ms = durationStr ? parseDurationToMs(durationStr) : null;
      if (durationStr && !ms) return interaction.reply({ content: "Invalid duration. Use 10m, 1h, 2d.", ephemeral: true });

      const meta = getTicketMetaFromTopic(interaction.channel.topic);
      const openerId = meta?.openerId;
      if (!openerId) return interaction.reply({ content: "Couldn't find ticket opener.", ephemeral: true });

      const s = getGuildSettings(interaction.guild.id);
      if (!s.customerRoleId) return interaction.reply({ content: "Set customer role first: `/settings set_customer_role role:@Role`", ephemeral: true });

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
        await interaction.channel.send(`<@${openerId}> please go to <#${s.vouchesChannelId}> and drop a vouch for us. Thank you!`).catch(() => {});
      } else {
        await interaction.channel.send(`<@${openerId}> please drop a vouch for us in the vouches channel. Thank you!`).catch(() => {});
      }

      // If a timer is provided, it ONLY sends a reminder (does not close/delete)
      if (activeOperations.has(interaction.channel.id)) {
        clearTimeout(activeOperations.get(interaction.channel.id));
        activeOperations.delete(interaction.channel.id);
      }

      if (ms) {
        const channelId = interaction.channel.id;
        const timeout = setTimeout(async () => {
          try {
            const ch = await client.channels.fetch(channelId).catch(() => null);
            if (!ch || ch.type !== ChannelType.GuildText) return;
            await ch.send(`⏰ Reminder: operation timer ended. If everything is done, staff can close this ticket with **/close**.`).catch(() => {});
          } catch {}
          activeOperations.delete(channelId);
        }, ms);

        activeOperations.set(interaction.channel.id, timeout);
        return interaction.reply({ content: `✅ Operation started. Reminder in **${durationStr}** (ticket will NOT auto-close).`, ephemeral: true });
      }

      return interaction.reply({ content: "✅ Operation started (no timer). Ticket will NOT auto-close.", ephemeral: true });
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

/* ===================== MESSAGE HANDLER (AUTOMOD + ADMIN ! COMMANDS + STICKY) ===================== */

client.on("messageCreate", async (message) => {
  try {
    if (!message.guild || message.author.bot) return;

    if (!isOwner(message.author.id) && isStopped(message.guild.id)) {
      await message.channel.send("Adam has restricted commands in your server.").catch(() => {});
      return;
    }

    const s = getGuildSettings(message.guild.id);

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

      if (cmd === "stick") {
        if (!text || !text.trim()) return message.reply("Usage: `!stick <message>`");

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
        if (!userId) return message.reply("Usage: `!mute <@user|id>`");

        const target = await message.guild.members.fetch(userId).catch(() => null);
        if (!target) return message.reply("❌ I can't find that user in this server.");

        const me = await message.guild.members.fetchMe();
        if (!me.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
          return message.reply("❌ I need **Moderate Members** permission to timeout users.");
        }

        const ms = 5 * 60 * 1000;
        await target.timeout(ms, `Timed out by ${message.author.tag} (5 minutes)`).catch(() => {});
        await message.channel.send(`${target.user} was timed out for **5 min**.`).catch(() => {});
        return;
      }

      if (cmd === "ban") {
        const userId = arg1?.match(/\d{10,25}/)?.[0];
        if (!userId) return message.reply("Usage: `!ban <@user|id>`");

        const target = await message.guild.members.fetch(userId).catch(() => null);
        if (!target) return message.reply("❌ I can't find that user in this server.");

        await target.ban({ reason: `Banned by ${message.author.tag}` }).catch(() => {});
        await message.channel.send(`${target.user} was banned.`).catch(() => {});
        return;
      }

      if (cmd === "kick") {
        const userId = arg1?.match(/\d{10,25}/)?.[0];
        if (!userId) return message.reply("Usage: `!kick <@user|id>`");

        const target = await message.guild.members.fetch(userId).catch(() => null);
        if (!target) return message.reply("❌ I can't find that user in this server.");

        await target.kick(`Kicked by ${message.author.tag}`).catch(() => {});
        await message.channel.send(`${target.user} was kicked.`).catch(() => {});
        return;
      }

      if (cmd === "purge") {
        const amount = parseInt(arg1, 10);
        if (!amount || amount < 1) return message.reply("Usage: `!purge <amount>` (1-100)");

        const toDelete = Math.min(100, amount + 1);
        await message.channel.bulkDelete(toDelete, true).catch(async () => {
          await message.reply("❌ I can’t bulk delete messages older than 14 days.");
        });
        return;
      }
    }

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
  console.error("❌ Missing TOKEN in .env");
  process.exit(1);
}

client.login(process.env.TOKEN);

/**
 * IMPORTANT FOR / COMMANDS TO SHOW UP:
 * Invite scopes:
 * ✅ bot
 * ✅ applications.commands
 */
