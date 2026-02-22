/**
 * DonutDemand Bot — Full (discord.js v14)
 *
 * ✅ GLOBAL slash commands (works in every server)
 * ✅ /settings (ADMIN) + /settungs (ADMIN alias) to configure EVERYTHING per-server:
 *    - channels: welcome, joinlog, vouches
 *    - roles: customer
 *    - staff roles list (who can view tickets / close / giveaways / link)
 *    - automod role name (default "automod")
 *    - ticket panel config (embed + buttons + categories)
 *
 * ✅ Tickets:
 *   - Panel buttons open a modal (Minecraft username + what you need)
 *   - 1 open ticket per user
 *   - Staff roles can view tickets
 *
 * ✅ /close:
 *   - opener OR staff/admin
 *   - DMs opener a proper "ticket closed" embed
 *   - deletes ticket after 3 seconds
 *
 * ✅ Owner controls:
 *   - Bot Owner ID = 1456326972631154786
 *   - Owner can use ANY command anywhere, regardless of server perms/roles
 *   - /stop <server_id>  (owner only) disables commands in that server
 *   - /resume <server_id> (owner only) re-enables
 *   - When stopped: any command used posts a PUBLIC message in that channel:
 *       "Adam has restricted commands in your server"
 *
 * ✅ Invites (persistent JSON):
 *   - /generate, /linkinvite, /invites, /link, /addinvites, /resetinvites, /resetall
 *
 * ✅ Automod:
 *   - blocks links unless Admin OR has bypass role (configurable role name; auto-created if possible)
 *
 * ✅ Giveaways:
 *   - /giveaway, /end, /reroll with join button
 *
 * ✅ Prefix admin commands:
 *   - !stick / !unstick / !mute / !ban / !kick / !purge
 *
 * ENV:
 *   TOKEN=...
 *
 * Dev Portal Intents to enable:
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

/* ===================== CORE CONFIG ===================== */

const PREFIX = "!";
const OWNER_ID = "1456326972631154786"; // Adam (bot owner)

/* ===================== STORAGE ===================== */

const DATA_DIR = __dirname;
const INVITES_FILE = path.join(DATA_DIR, "invites_data.json");
const GIVEAWAYS_FILE = path.join(DATA_DIR, "giveaways_data.json");
const SETTINGS_FILE = path.join(DATA_DIR, "settings_data.json");

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

/** Invites store */
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

/** Giveaways store */
const giveawayData = loadJson(GIVEAWAYS_FILE, { giveaways: {} });
giveawayData.giveaways ??= {};
saveJson(GIVEAWAYS_FILE, giveawayData);

/** Per-guild settings store */
const settingsStore = loadJson(SETTINGS_FILE, {
  guilds: {}, // guildId -> settings object
  stoppedGuilds: {}, // guildId -> { stoppedAt, stoppedBy }
});
settingsStore.guilds ??= {};
settingsStore.stoppedGuilds ??= {};
saveJson(SETTINGS_FILE, settingsStore);

function saveInvites() {
  saveJson(INVITES_FILE, invitesData);
}
function saveGiveaways() {
  saveJson(GIVEAWAYS_FILE, giveawayData);
}
function saveSettings() {
  saveJson(SETTINGS_FILE, settingsStore);
}

/* ===================== DEFAULT SETTINGS ===================== */

const DEFAULT_TICKET_PANEL = {
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

const DEFAULT_GUILD_SETTINGS = {
  channels: {
    welcome: null, // channelId
    joinlog: null, // channelId
    vouches: null, // channelId
  },
  roles: {
    customer: null, // roleId
  },
  staffRoleIds: [], // array roleIds
  automodRoleName: "automod",
  ticketPanel: DEFAULT_TICKET_PANEL,
};

function getGuildSettings(guildId) {
  const s = settingsStore.guilds[guildId];
  if (!s) return structuredClone(DEFAULT_GUILD_SETTINGS);

  // shallow normalize
  s.channels ??= {};
  s.roles ??= {};
  s.staffRoleIds ??= [];
  s.automodRoleName ??= "automod";
  s.ticketPanel ??= structuredClone(DEFAULT_TICKET_PANEL);
  return s;
}

function setGuildSettings(guildId, newSettings) {
  settingsStore.guilds[guildId] = newSettings;
  saveSettings();
}

function isGuildStopped(guildId) {
  return Boolean(settingsStore.stoppedGuilds[guildId]);
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

function normalizeButtonStyle(style) {
  const s = String(style || "").toLowerCase();
  if (s === "primary") return ButtonStyle.Primary;
  if (s === "secondary") return ButtonStyle.Secondary;
  if (s === "success") return ButtonStyle.Success;
  if (s === "danger") return ButtonStyle.Danger;
  return ButtonStyle.Primary;
}

function isOwner(userId) {
  return String(userId) === OWNER_ID;
}

function isAdminOrOwner(interaction) {
  if (isOwner(interaction.user.id)) return true;
  return interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator) ?? false;
}

function hasAnyRole(member, roleIds) {
  if (!member || !roleIds?.length) return false;
  return roleIds.some((rid) => member.roles.cache.has(rid));
}

function isStaff(member, guildSettings) {
  if (!member) return false;
  if (member.permissions.has(PermissionsBitField.Flags.Administrator)) return true;
  return hasAnyRole(member, guildSettings.staffRoleIds || []);
}

/* ===================== AUTOMOD ROLE ===================== */

async function ensureAutoModRole(guild, roleName) {
  const name = String(roleName || "automod").trim() || "automod";
  let role = guild.roles.cache.find((r) => r.name.toLowerCase() === name.toLowerCase());
  if (role) return role;

  const me = await guild.members.fetchMe();
  if (!me.permissions.has(PermissionsBitField.Flags.ManageRoles)) return null;

  role = await guild.roles.create({
    name,
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

/* ===================== TICKETS ===================== */

async function getOrCreateCategory(guild, name) {
  const n = String(name || "Tickets").trim().slice(0, 100) || "Tickets";
  let cat = guild.channels.cache.find((c) => c.type === ChannelType.GuildCategory && c.name === n);
  if (!cat) cat = await guild.channels.create({ name: n, type: ChannelType.GuildCategory });
  return cat;
}

/**
 * Topic format:
 * opener:<id>;created:<unixMs>;type:<ticketTypeId>
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

function resolveTicketType(guildSettings, typeId) {
  return (guildSettings.ticketPanel?.tickets || []).find((t) => t.id === typeId) || null;
}

function validateTicketPanelConfig(cfg) {
  if (!cfg || typeof cfg !== "object") return { ok: false, msg: "Panel config must be a JSON object." };

  const embed = cfg.embed || {};
  const modal = cfg.modal || {};
  const tickets = Array.isArray(cfg.tickets) ? cfg.tickets : null;

  if (!tickets || tickets.length < 1) return { ok: false, msg: "Config must include tickets: [...] with at least 1 type." };
  if (tickets.length > 5) return { ok: false, msg: "Max 5 ticket types (Discord max buttons in one row is 5)." };

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
    if (!/^[a-z0-9_\-]+$/.test(id)) return { ok: false, msg: `ticket.id "${id}" must be only a-z 0-9 _ -` };
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

function buildTicketPanelMessage(guildSettings) {
  const cfg = guildSettings.ticketPanel || DEFAULT_TICKET_PANEL;
  const c = parseHexColor(cfg.embed?.color) ?? 0x2b2d31;

  const embed = new EmbedBuilder()
    .setTitle(String(cfg.embed?.title || "Tickets").slice(0, 256))
    .setDescription(String(cfg.embed?.description || "Open a ticket below.").slice(0, 4000))
    .setColor(c);

  const row = new ActionRowBuilder();
  for (const t of cfg.tickets || []) {
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

function buildCloseDmEmbed({ guild, ticketChannelName, ticketTypeLabel, openedAtMs, closedByTag, reason, vouchesChannelId }) {
  const openedUnix = openedAtMs ? Math.floor(openedAtMs / 1000) : null;
  const closedUnix = Math.floor(Date.now() / 1000);

  const nextSteps = [
    "• If you still need help, open a new ticket from the ticket panel.",
    vouchesChannelId ? `• Consider leaving a vouch in <#${vouchesChannelId}>.` : "• Consider leaving a vouch in the server vouches channel.",
    "• Keep your DMs open so you don’t miss updates.",
  ].join("\n");

  return new EmbedBuilder()
    .setTitle("Ticket Closed")
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
      { name: "Next Steps", value: nextSteps.slice(0, 1024), inline: false }
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

async function registerGlobalSlashCommands() {
  if (!process.env.TOKEN) throw new Error("Missing TOKEN");

  // Settings command (and alias /settungs)
  const settingsCmd = new SlashCommandBuilder()
    .setName("settings")
    .setDescription("Admin: configure bot settings for this server.")
    .addSubcommand((s) => s.setName("view").setDescription("View current settings (ephemeral)."))
    .addSubcommand((s) =>
      s
        .setName("channel")
        .setDescription("Set a channel setting.")
        .addStringOption((o) =>
          o
            .setName("key")
            .setDescription("Which channel setting")
            .setRequired(true)
            .addChoices(
              { name: "welcome", value: "welcome" },
              { name: "joinlog", value: "joinlog" },
              { name: "vouches", value: "vouches" }
            )
        )
        .addChannelOption((o) =>
          o
            .setName("channel")
            .setDescription("Target channel (text channel)")
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
    )
    .addSubcommand((s) =>
      s
        .setName("role")
        .setDescription("Set a role setting.")
        .addStringOption((o) =>
          o.setName("key").setDescription("Which role setting").setRequired(true).addChoices({ name: "customer", value: "customer" })
        )
        .addRoleOption((o) => o.setName("role").setDescription("Role").setRequired(true))
    )
    .addSubcommand((s) =>
      s
        .setName("staff-add")
        .setDescription("Add a staff role (can view tickets, close tickets, giveaways, /link).")
        .addRoleOption((o) => o.setName("role").setDescription("Role").setRequired(true))
    )
    .addSubcommand((s) =>
      s
        .setName("staff-remove")
        .setDescription("Remove a staff role.")
        .addRoleOption((o) => o.setName("role").setDescription("Role").setRequired(true))
    )
    .addSubcommand((s) => s.setName("staff-list").setDescription("List staff roles."))
    .addSubcommand((s) =>
      s
        .setName("automod-role-name")
        .setDescription("Set the automod bypass role name (default: automod).")
        .addStringOption((o) => o.setName("name").setDescription("Role name").setRequired(true))
    )
    .addSubcommand((s) =>
      s
        .setName("panel-post")
        .setDescription("Post the ticket panel in a channel.")
        .addChannelOption((o) =>
          o.setName("channel").setDescription("Channel (optional, defaults to current)").addChannelTypes(ChannelType.GuildText).setRequired(false)
        )
    )
    .addSubcommand((s) =>
      s
        .setName("panel-set")
        .setDescription("Set ticket panel config using JSON.")
        .addStringOption((o) => o.setName("json").setDescription("Panel JSON").setRequired(true))
    )
    .addSubcommand((s) => s.setName("panel-show").setDescription("Show the saved ticket panel JSON (ephemeral)."))
    .addSubcommand((s) => s.setName("panel-reset").setDescription("Reset ticket panel back to default."));

  const settungsCmd = new SlashCommandBuilder()
    .setName("settungs")
    .setDescription("Alias of /settings (Admin).")
    .addSubcommand((s) => s.setName("view").setDescription("View current settings (ephemeral)."))
    .addSubcommand((s) =>
      s
        .setName("channel")
        .setDescription("Set a channel setting.")
        .addStringOption((o) =>
          o
            .setName("key")
            .setDescription("Which channel setting")
            .setRequired(true)
            .addChoices(
              { name: "welcome", value: "welcome" },
              { name: "joinlog", value: "joinlog" },
              { name: "vouches", value: "vouches" }
            )
        )
        .addChannelOption((o) =>
          o
            .setName("channel")
            .setDescription("Target channel (text channel)")
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
    )
    .addSubcommand((s) =>
      s
        .setName("role")
        .setDescription("Set a role setting.")
        .addStringOption((o) =>
          o.setName("key").setDescription("Which role setting").setRequired(true).addChoices({ name: "customer", value: "customer" })
        )
        .addRoleOption((o) => o.setName("role").setDescription("Role").setRequired(true))
    )
    .addSubcommand((s) =>
      s
        .setName("staff-add")
        .setDescription("Add a staff role (can view tickets, close tickets, giveaways, /link).")
        .addRoleOption((o) => o.setName("role").setDescription("Role").setRequired(true))
    )
    .addSubcommand((s) =>
      s
        .setName("staff-remove")
        .setDescription("Remove a staff role.")
        .addRoleOption((o) => o.setName("role").setDescription("Role").setRequired(true))
    )
    .addSubcommand((s) => s.setName("staff-list").setDescription("List staff roles."))
    .addSubcommand((s) =>
      s
        .setName("automod-role-name")
        .setDescription("Set the automod bypass role name (default: automod).")
        .addStringOption((o) => o.setName("name").setDescription("Role name").setRequired(true))
    )
    .addSubcommand((s) =>
      s
        .setName("panel-post")
        .setDescription("Post the ticket panel in a channel.")
        .addChannelOption((o) =>
          o.setName("channel").setDescription("Channel (optional, defaults to current)").addChannelTypes(ChannelType.GuildText).setRequired(false)
        )
    )
    .addSubcommand((s) =>
      s
        .setName("panel-set")
        .setDescription("Set ticket panel config using JSON.")
        .addStringOption((o) => o.setName("json").setDescription("Panel JSON").setRequired(true))
    )
    .addSubcommand((s) => s.setName("panel-show").setDescription("Show the saved ticket panel JSON (ephemeral)."))
    .addSubcommand((s) => s.setName("panel-reset").setDescription("Reset ticket panel back to default."));

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

  const stopCmd = new SlashCommandBuilder()
    .setName("stop")
    .setDescription("Owner: disable commands in a server.")
    .addStringOption((o) => o.setName("server_id").setDescription("Guild/Server ID").setRequired(true));

  const resumeCmd = new SlashCommandBuilder()
    .setName("resume")
    .setDescription("Owner: re-enable commands in a server.")
    .addStringOption((o) => o.setName("server_id").setDescription("Guild/Server ID").setRequired(true));

  const commands = [
    settingsCmd,
    settungsCmd,

    stopCmd,
    resumeCmd,

    embedCmd,

    new SlashCommandBuilder().setName("vouches").setDescription("Shows how many vouches this server has (uses /settings vouches channel)."),

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
      .setDescription("Reset a user's invite stats. Staff/Admin.")
      .addUserOption((o) => o.setName("user").setDescription("User").setRequired(true)),

    new SlashCommandBuilder().setName("resetall").setDescription("Reset invite stats for EVERYONE. Admin only."),

    new SlashCommandBuilder()
      .setName("close")
      .setDescription("Close the current ticket (DMs opener).")
      .addStringOption((o) => o.setName("reason").setDescription("Reason").setRequired(true)),

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

  // Clear + re-register (prevents “ghost commands” + fixes missing commands)
  await rest.put(Routes.applicationCommands(client.user.id), { body: [] });
  await rest.put(Routes.applicationCommands(client.user.id), { body: commands });

  console.log("✅ GLOBAL slash commands registered (may take time to appear everywhere)");
}

/* ===================== READY ===================== */

client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  try {
    await registerGlobalSlashCommands();
  } catch (e) {
    console.log("❌ Slash register failed:", e?.message || e);
  }

  // prepare per guild
  for (const guild of client.guilds.cache.values()) {
    const s = getGuildSettings(guild.id);
    try {
      await ensureAutoModRole(guild, s.automodRoleName);
    } catch {}
    try {
      await refreshGuildInvites(guild);
    } catch {}
  }

  for (const messageId of Object.keys(giveawayData.giveaways || {})) {
    const gw = giveawayData.giveaways[messageId];
    if (gw && !gw.ended) scheduleGiveawayEnd(messageId);
  }
});

client.on("guildCreate", async (guild) => {
  const s = getGuildSettings(guild.id);
  try {
    await ensureAutoModRole(guild, s.automodRoleName);
  } catch {}
  try {
    await refreshGuildInvites(guild);
  } catch {}
});

/* ===================== INVITE EVENTS + JOIN/LEAVE ===================== */

client.on("inviteCreate", async (invite) => {
  try {
    await refreshGuildInvites(invite.guild);
  } catch {}
});
client.on("inviteDelete", async (invite) => {
  try {
    await refreshGuildInvites(invite.guild);
  } catch {}
});

client.on("guildMemberAdd", async (member) => {
  try {
    const guild = member.guild;
    const gs = getGuildSettings(guild.id);

    const joinLogId = gs.channels?.joinlog;
    if (!joinLogId) return;

    const logChannel = await guild.channels.fetch(joinLogId).catch(() => null);
    if (!logChannel || logChannel.type !== ChannelType.GuildText) return;

    const before = invitesCache.get(guild.id);
    if (!before) {
      await logChannel.send(`${member} joined. (Couldn't detect inviter — missing invite permissions)`);
      return;
    }

    const invites = await guild.invites.fetch();
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
  } catch (e) {
    console.log("Join log error:", e.message);
  }
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
    // Only handle guild interactions for most commands
    const inGuild = Boolean(interaction.guildId);

    // If guild is stopped, block EVERYTHING except stop/resume, and still show message publicly.
    if (interaction.isChatInputCommand() && inGuild) {
      const cmd = interaction.commandName;
      const stopped = isGuildStopped(interaction.guildId);

      if (stopped && cmd !== "stop" && cmd !== "resume") {
        // public message in the channel
        if (interaction.channel && interaction.channel.type === ChannelType.GuildText) {
          interaction.channel.send("Adam has restricted commands in your server").catch(() => {});
        }
        return interaction.reply({ content: "Commands are restricted in this server.", ephemeral: true });
      }
    }

    /* ---------- Giveaway join button ---------- */
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

    /* ---------- Ticket buttons -> modal ---------- */
    if (interaction.isButton() && interaction.customId.startsWith("ticket:")) {
      if (!interaction.guild) return interaction.reply({ content: "Tickets only work in servers.", ephemeral: true });

      const typeId = interaction.customId.split("ticket:")[1];
      const gs = getGuildSettings(interaction.guild.id);
      const ticketType = resolveTicketType(gs, typeId);
      if (!ticketType) return interaction.reply({ content: "This ticket type no longer exists.", ephemeral: true });

      const existing = findOpenTicketChannel(interaction.guild, interaction.user.id);
      if (existing) return interaction.reply({ content: `❌ You already have an open ticket: ${existing}`, ephemeral: true });

      const modal = new ModalBuilder()
        .setCustomId(`ticket_modal:${ticketType.id}`)
        .setTitle(String(gs.ticketPanel?.modal?.title || "Ticket Info").slice(0, 45));

      const mcInput = new TextInputBuilder()
        .setCustomId("mc")
        .setLabel(String(gs.ticketPanel?.modal?.mcLabel || "What is your Minecraft username?").slice(0, 45))
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(32);

      const needInput = new TextInputBuilder()
        .setCustomId("need")
        .setLabel(String(gs.ticketPanel?.modal?.needLabel || "What do you need?").slice(0, 45))
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(1000);

      modal.addComponents(new ActionRowBuilder().addComponents(mcInput), new ActionRowBuilder().addComponents(needInput));
      return interaction.showModal(modal);
    }

    /* ---------- Ticket modal submit -> create ticket ---------- */
    if (interaction.isModalSubmit() && interaction.customId.startsWith("ticket_modal:")) {
      if (!interaction.guild) return interaction.reply({ content: "Tickets only work in servers.", ephemeral: true });

      await interaction.deferReply({ ephemeral: true });

      const existing = findOpenTicketChannel(interaction.guild, interaction.user.id);
      if (existing) return interaction.editReply(`❌ You already have an open ticket: ${existing}`);

      const typeId = interaction.customId.split("ticket_modal:")[1];
      const gs = getGuildSettings(interaction.guild.id);
      const type = resolveTicketType(gs, typeId);
      if (!type) return interaction.editReply("Invalid ticket type.");

      const mc = (interaction.fields.getTextInputValue("mc") || "").trim();
      const need = (interaction.fields.getTextInputValue("need") || "").trim();

      const category = await getOrCreateCategory(interaction.guild, type.category);
      const channelName = `${type.key}-${cleanName(interaction.user.username)}`.slice(0, 90);

      const overwrites = [
        { id: interaction.guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
        {
          id: interaction.user.id,
          allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory],
        },
        ...(gs.staffRoleIds || []).map((rid) => ({
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

    /* ---------- Slash commands ---------- */
    if (interaction.isChatInputCommand()) {
      const name = interaction.commandName;

      // Owner commands: /stop /resume (these must still "pop up" for others, but deny usage)
      if (name === "stop" || name === "resume") {
        const serverId = interaction.options.getString("server_id", true).trim();

        if (!isOwner(interaction.user.id)) {
          return interaction.reply({ content: "Only Adam can use this command.", ephemeral: true });
        }

        if (!/^\d{10,25}$/.test(serverId)) {
          return interaction.reply({ content: "Invalid server id.", ephemeral: true });
        }

        if (name === "stop") {
          settingsStore.stoppedGuilds[serverId] = { stoppedAt: Date.now(), stoppedBy: interaction.user.id };
          saveSettings();
          return interaction.reply({ content: `✅ Stopped commands in server: ${serverId}`, ephemeral: true });
        } else {
          delete settingsStore.stoppedGuilds[serverId];
          saveSettings();
          return interaction.reply({ content: `✅ Resumed commands in server: ${serverId}`, ephemeral: true });
        }
      }

      // From here on: if owner, always allowed.
      // If not owner: normal permission checks per command.
      const gs = interaction.guild ? getGuildSettings(interaction.guild.id) : null;

      /* ---------- /settings + /settungs ---------- */
      if (name === "settings" || name === "settungs") {
        if (!interaction.guild) return interaction.reply({ content: "Use this in a server.", ephemeral: true });
        if (!isAdminOrOwner(interaction)) return interaction.reply({ content: "Admins only.", ephemeral: true });

        const sub = interaction.options.getSubcommand();

        if (sub === "view") {
          const safe = {
            channels: gs.channels,
            roles: gs.roles,
            staffRoleIds: gs.staffRoleIds,
            automodRoleName: gs.automodRoleName,
            ticketPanel: gs.ticketPanel,
          };
          const json = JSON.stringify(safe, null, 2);
          if (json.length > 1800) {
            return interaction.reply({ content: "Settings are too large to display here. Use panel-show for panel JSON only.", ephemeral: true });
          }
          return interaction.reply({ content: "```json\n" + json + "\n```", ephemeral: true });
        }

        if (sub === "channel") {
          const key = interaction.options.getString("key", true);
          const ch = interaction.options.getChannel("channel", true);

          gs.channels ??= {};
          gs.channels[key] = ch.id;

          setGuildSettings(interaction.guild.id, gs);
          return interaction.reply({ content: `✅ Set channel **${key}** to ${ch}`, ephemeral: true });
        }

        if (sub === "role") {
          const key = interaction.options.getString("key", true);
          const role = interaction.options.getRole("role", true);

          gs.roles ??= {};
          gs.roles[key] = role.id;

          setGuildSettings(interaction.guild.id, gs);
          return interaction.reply({ content: `✅ Set role **${key}** to <@&${role.id}>`, ephemeral: true });
        }

        if (sub === "staff-add") {
          const role = interaction.options.getRole("role", true);
          gs.staffRoleIds ??= [];
          if (!gs.staffRoleIds.includes(role.id)) gs.staffRoleIds.push(role.id);
          setGuildSettings(interaction.guild.id, gs);
          return interaction.reply({ content: `✅ Added staff role <@&${role.id}>`, ephemeral: true });
        }

        if (sub === "staff-remove") {
          const role = interaction.options.getRole("role", true);
          gs.staffRoleIds ??= [];
          gs.staffRoleIds = gs.staffRoleIds.filter((id) => id !== role.id);
          setGuildSettings(interaction.guild.id, gs);
          return interaction.reply({ content: `✅ Removed staff role <@&${role.id}>`, ephemeral: true });
        }

        if (sub === "staff-list") {
          const list = (gs.staffRoleIds || []).map((id) => `<@&${id}>`).join("\n") || "None set.";
          return interaction.reply({ content: `**Staff roles:**\n${list}`, ephemeral: true });
        }

        if (sub === "automod-role-name") {
          const n = interaction.options.getString("name", true).trim().slice(1, 80);
          gs.automodRoleName = interaction.options.getString("name", true).trim().slice(0, 80) || "automod";
          setGuildSettings(interaction.guild.id, gs);
          try {
            await ensureAutoModRole(interaction.guild, gs.automodRoleName);
          } catch {}
          return interaction.reply({ content: `✅ Automod bypass role name set to **${gs.automodRoleName}**`, ephemeral: true });
        }

        if (sub === "panel-reset") {
          gs.ticketPanel = structuredClone(DEFAULT_TICKET_PANEL);
          setGuildSettings(interaction.guild.id, gs);
          return interaction.reply({ content: "✅ Ticket panel reset to default.", ephemeral: true });
        }

        if (sub === "panel-show") {
          const json = JSON.stringify(gs.ticketPanel || DEFAULT_TICKET_PANEL, null, 2);
          if (json.length > 1800) return interaction.reply({ content: "Panel JSON too large to show in Discord.", ephemeral: true });
          return interaction.reply({ content: "```json\n" + json + "\n```", ephemeral: true });
        }

        if (sub === "panel-set") {
          const raw = interaction.options.getString("json", true);
          if (raw.length > 6000) return interaction.reply({ content: "❌ JSON too long. Keep it under ~6000 chars.", ephemeral: true });

          let cfg;
          try {
            cfg = JSON.parse(raw);
          } catch {
            return interaction.reply({ content: "❌ Invalid JSON.", ephemeral: true });
          }

          const v = validateTicketPanelConfig(cfg);
          if (!v.ok) return interaction.reply({ content: `❌ ${v.msg}`, ephemeral: true });

          gs.ticketPanel = cfg;
          setGuildSettings(interaction.guild.id, gs);
          return interaction.reply({ content: "✅ Saved ticket panel config for this server.", ephemeral: true });
        }

        if (sub === "panel-post") {
          const targetChannel = interaction.options.getChannel("channel", false) || interaction.channel;
          if (!targetChannel || targetChannel.type !== ChannelType.GuildText) {
            return interaction.reply({ content: "Invalid channel.", ephemeral: true });
          }

          const v = validateTicketPanelConfig(gs.ticketPanel || DEFAULT_TICKET_PANEL);
          if (!v.ok) return interaction.reply({ content: `❌ Panel config invalid: ${v.msg}`, ephemeral: true });

          await targetChannel.send(buildTicketPanelMessage(gs));
          return interaction.reply({ content: "✅ Posted ticket panel.", ephemeral: true });
        }
      }

      /* ---------- /embed ---------- */
      if (name === "embed") {
        if (!interaction.guild) return interaction.reply({ content: "Use this in a server.", ephemeral: true });
        if (!isAdminOrOwner(interaction)) return interaction.reply({ content: "Admins only.", ephemeral: true });

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
        if (!interaction.guild) return interaction.reply({ content: "Use this in a server.", ephemeral: true });

        const vouchesId = gs?.channels?.vouches;
        if (!vouchesId) return interaction.reply({ content: "Vouches channel not set. Use /settings channel key=vouches.", ephemeral: true });

        await interaction.deferReply();

        const channel = await interaction.guild.channels.fetch(vouchesId).catch(() => null);
        if (!channel || channel.type !== ChannelType.GuildText) return interaction.editReply("Couldn't find the vouches channel (wrong id or not a text channel).");

        let total = 0;
        let lastId;
        while (true) {
          const msgs = await channel.messages.fetch({ limit: 100, before: lastId });
          total += msgs.size;
          if (msgs.size < 100) break;
          lastId = msgs.last()?.id;
          if (!lastId) break;
        }

        return interaction.editReply(`This server has **${total}** vouches.`);
      }

      /* ---------- /invites ---------- */
      if (name === "invites") {
        const user = interaction.options.getUser("user", true);
        return interaction.reply(`📨 **${user.tag}** has **${invitesStillInServer(user.id)}** invites still in the server.`);
      }

      /* ---------- /generate ---------- */
      if (name === "generate") {
        if (!interaction.guild) return interaction.reply({ content: "Use this in a server.", ephemeral: true });

        const me = await interaction.guild.members.fetchMe();
        const canCreate = interaction.channel?.permissionsFor(me)?.has(PermissionsBitField.Flags.CreateInstantInvite);
        if (!canCreate) return interaction.reply({ content: "❌ I need **Create Invite** permission in this channel.", ephemeral: true });

        const invite = await interaction.channel.createInvite({ maxAge: 0, maxUses: 0, unique: true, reason: `Invite generated for ${interaction.user.tag}` });
        invitesData.inviteOwners[invite.code] = interaction.user.id;
        saveInvites();

        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel("Open Invite").setURL(invite.url));
        return interaction.reply({ content: `✅ Your personal invite link (credited to you):\n${invite.url}`, components: [row], ephemeral: true });
      }

      /* ---------- /linkinvite ---------- */
      if (name === "linkinvite") {
        if (!interaction.guild) return interaction.reply({ content: "Use this in a server.", ephemeral: true });

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
        if (!interaction.guild) return interaction.reply({ content: "Use this in a server.", ephemeral: true });
        if (!isAdminOrOwner(interaction)) return interaction.reply({ content: "Admins only.", ephemeral: true });

        const user = interaction.options.getUser("user", true);
        const amount = interaction.options.getInteger("amount", true);

        const s = ensureInviterStats(user.id);
        s.manual += amount;
        saveInvites();

        return interaction.reply(`✅ Added **${amount}** invites to **${user.tag}**.`);
      }

      /* ---------- /resetinvites ---------- */
      if (name === "resetinvites") {
        if (!interaction.guild) return interaction.reply({ content: "Use this in a server.", ephemeral: true });

        // staff/admin/owner
        const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
        const allowed = isOwner(interaction.user.id) || (member && isStaff(member, gs)) || interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator);
        if (!allowed) return interaction.reply({ content: "Staff/Admin only.", ephemeral: true });

        const user = interaction.options.getUser("user", true);
        invitesData.inviterStats[user.id] = { joins: 0, rejoins: 0, left: 0, manual: 0 };
        delete invitesData.invitedMembers[user.id];
        saveInvites();
        return interaction.reply(`✅ Reset invite stats for **${user.tag}**.`);
      }

      /* ---------- /resetall ---------- */
      if (name === "resetall") {
        if (!interaction.guild) return interaction.reply({ content: "Use this in a server.", ephemeral: true });
        if (!isAdminOrOwner(interaction)) return interaction.reply({ content: "Admins only.", ephemeral: true });

        invitesData.inviterStats = {};
        invitesData.memberInviter = {};
        invitesData.inviteOwners = {};
        invitesData.invitedMembers = {};
        saveInvites();

        return interaction.reply("✅ Reset invite stats for **everyone** in this server.");
      }

      /* ---------- /close ---------- */
      if (name === "close") {
        if (!interaction.guild) return interaction.reply({ content: "Use this in a server.", ephemeral: true });

        const channel = interaction.channel;
        if (!isTicketChannel(channel)) return interaction.reply({ content: "Use **/close** inside a ticket channel.", ephemeral: true });

        const meta = getTicketMetaFromTopic(channel.topic);
        const openerId = meta?.openerId;

        const t = resolveTicketType(gs, meta?.typeId);
        const ticketTypeLabel = t?.label || "Unknown";
        const reason = interaction.options.getString("reason", true);

        const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
        const isOpener = interaction.user.id === openerId;
        const canClose = isOwner(interaction.user.id) || isOpener || (member && isStaff(member, gs));
        if (!canClose) return interaction.reply({ content: "Only the opener or staff can close this.", ephemeral: true });

        if (activeOperations.has(channel.id)) {
          clearTimeout(activeOperations.get(channel.id));
          activeOperations.delete(channel.id);
        }

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
                vouchesChannelId: gs.channels?.vouches || null,
              }),
            ],
          });
        } catch {}

        await interaction.reply({ content: "Closing ticket in 3 seconds...", ephemeral: true });
        setTimeout(() => channel.delete().catch(() => {}), 3000);
        return;
      }

      /* ---------- /link ---------- */
      if (name === "link") {
        if (!interaction.guild) return interaction.reply({ content: "Use this in a server.", ephemeral: true });

        const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
        if (!isOwner(interaction.user.id) && !(member && isStaff(member, gs))) return interaction.reply({ content: "Staff/Admin only.", ephemeral: true });

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

        const listText = activeInvited.length
          ? activeInvited.slice(0, 30).map((x, i) => `${i + 1}. ${x.tag} (code: ${x.code})`).join("\n")
          : "No active invited members found.";

        return interaction.reply({
          ephemeral: true,
          content:
            `**Invites for:** ${target.tag}\n\n` +
            `**Active invited members (still credited):**\n${listText}\n\n` +
            `**Invite link(s) they use:**\n${inviteLinks}`,
        });
      }

      /* ---------- /operation ---------- */
      if (name === "operation") {
        if (!interaction.guild) return interaction.reply({ content: "Use this in a server.", ephemeral: true });
        if (!isAdminOrOwner(interaction)) return interaction.reply({ content: "Admins only.", ephemeral: true });
        if (!isTicketChannel(interaction.channel)) return interaction.reply({ content: "Use /operation inside a ticket channel.", ephemeral: true });

        const sub = interaction.options.getSubcommand();

        if (sub === "cancel") {
          if (!activeOperations.has(interaction.channel.id)) return interaction.reply({ content: "No active operation timer in this ticket.", ephemeral: true });
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

        const openerMember = await interaction.guild.members.fetch(openerId).catch(() => null);
        if (!openerMember) return interaction.reply({ content: "Couldn't fetch ticket opener.", ephemeral: true });

        const customerRoleId = gs.roles?.customer;
        if (!customerRoleId) return interaction.reply({ content: "Customer role not set. Use /settings role key=customer.", ephemeral: true });

        const botMe = await interaction.guild.members.fetchMe();
        if (!botMe.permissions.has(PermissionsBitField.Flags.ManageRoles)) return interaction.reply({ content: "I need **Manage Roles** permission.", ephemeral: true });

        const role = await interaction.guild.roles.fetch(customerRoleId).catch(() => null);
        if (!role) return interaction.reply({ content: "Customer role not found (wrong role id).", ephemeral: true });

        if (role.position >= botMe.roles.highest.position) {
          return interaction.reply({ content: "Move the bot role above the customer role in Server Settings → Roles.", ephemeral: true });
        }

        await openerMember.roles.add(role, `Customer role given by /operation from ${interaction.user.tag}`).catch(() => {});

        // vouch ping if set
        const vouchesChannelId = gs.channels?.vouches;
        if (vouchesChannelId) {
          await interaction.channel
            .send(`<@${openerId}> please go to <#${vouchesChannelId}> and drop a vouch for us. Thank you!`)
            .catch(() => {});
        }

        if (activeOperations.has(interaction.channel.id)) {
          clearTimeout(activeOperations.get(interaction.channel.id));
          activeOperations.delete(interaction.channel.id);
        }

        const timeout = setTimeout(async () => {
          const ch = await client.channels.fetch(interaction.channel.id).catch(() => null);
          if (!ch || ch.type !== ChannelType.GuildText) return;
          ch.delete().catch(() => {});
          activeOperations.delete(interaction.channel.id);
        }, ms);

        activeOperations.set(interaction.channel.id, timeout);
        return interaction.reply({ content: `✅ Operation started. Ticket closes in **${durationStr}**.`, ephemeral: true });
      }

      /* ---------- /giveaway ---------- */
      if (name === "giveaway") {
        if (!interaction.guild) return interaction.reply({ content: "Use this in a server.", ephemeral: true });

        const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
        if (!isOwner(interaction.user.id) && !(member && isStaff(member, gs))) return interaction.reply({ content: "Staff/Admin only.", ephemeral: true });

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

      /* ---------- /end ---------- */
      if (name === "end") {
        if (!interaction.guild) return interaction.reply({ content: "Use this in a server.", ephemeral: true });

        const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
        if (!isOwner(interaction.user.id) && !(member && isStaff(member, gs))) return interaction.reply({ content: "Staff/Admin only.", ephemeral: true });

        const raw = interaction.options.getString("message", true);
        const messageId = extractMessageId(raw);
        if (!messageId) return interaction.reply({ content: "Invalid message ID/link.", ephemeral: true });

        await interaction.deferReply({ ephemeral: true });
        const res = await endGiveaway(messageId, interaction.user.id);
        return interaction.editReply(res.ok ? "✅ Giveaway ended." : `❌ ${res.msg}`);
      }

      /* ---------- /reroll ---------- */
      if (name === "reroll") {
        if (!interaction.guild) return interaction.reply({ content: "Use this in a server.", ephemeral: true });

        const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
        if (!isOwner(interaction.user.id) && !(member && isStaff(member, gs))) return interaction.reply({ content: "Staff/Admin only.", ephemeral: true });

        const raw = interaction.options.getString("message", true);
        const messageId = extractMessageId(raw);
        if (!messageId) return interaction.reply({ content: "Invalid message ID/link.", ephemeral: true });

        await interaction.deferReply({ ephemeral: true });
        const res = await rerollGiveaway(messageId, interaction.user.id);
        return interaction.editReply(res.ok ? "✅ Rerolled winners." : `❌ ${res.msg}`);
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

/* ===================== MESSAGE HANDLER (AUTOMOD + PREFIX ADMIN COMMANDS + STICKY) ===================== */

function parseUserId(arg) {
  if (!arg) return null;
  const mention = String(arg).match(/^<@!?(\d{10,25})>$/);
  if (mention) return mention[1];
  const id = String(arg).match(/^(\d{10,25})$/);
  if (id) return id[1];
  return null;
}

client.on("messageCreate", async (message) => {
  try {
    if (!message.guild || message.author.bot) return;

    const gs = getGuildSettings(message.guild.id);

    // automod link blocker
    if (containsLink(message.content)) {
      const member = message.member;
      if (member) {
        const isAdmin = member.permissions.has(PermissionsBitField.Flags.Administrator);
        const roleName = gs.automodRoleName || "automod";
        const automodRole = message.guild.roles.cache.find((r) => r.name.toLowerCase() === String(roleName).toLowerCase());
        const hasBypass = automodRole ? member.roles.cache.has(automodRole.id) : false;

        if (!isAdmin && !hasBypass) {
          await message.delete().catch(() => {});
          message.channel
            .send(`🚫 ${member}, links aren’t allowed unless you have the **${roleName}** role.`)
            .then((m) => setTimeout(() => m.delete().catch(() => {}), 5000))
            .catch(() => {});
          return;
        }
      }
    }

    // Admin-only prefix commands
    if (message.content.startsWith(PREFIX)) {
      if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator) && !isOwner(message.author.id)) return;

      const parts = message.content.slice(PREFIX.length).trim().split(/\s+/);
      const cmd = (parts.shift() || "").toLowerCase();
      const text = message.content.slice(PREFIX.length + cmd.length + 1);
      const arg1 = parts[0];

      if (cmd === "stick") {
        if (!text || !text.trim()) return message.reply("Usage: `!stick <message>`");

        const old = stickyByChannel.get(message.channel.id);
        if (old?.messageId) await message.channel.messages.delete(old.messageId).catch(() => {});

        const sent = await message.channel.send(text);
        stickyByChannel.set(message.channel.id, { content: text, messageId: sent.id });
        await message.reply("✅ Sticky set for this channel.");
      }

      if (cmd === "unstick") {
        const old = stickyByChannel.get(message.channel.id);
        if (old?.messageId) await message.channel.messages.delete(old.messageId).catch(() => {});
        stickyByChannel.delete(message.channel.id);
        await message.reply("✅ Sticky removed for this channel.");
      }

      if (cmd === "mute") {
        const userId = parseUserId(arg1);
        if (!userId) return message.reply("Usage: `!mute <@user|id>`");

        const target = await message.guild.members.fetch(userId).catch(() => null);
        if (!target) return message.reply("❌ I can't find that user in this server.");

        const me = await message.guild.members.fetchMe();
        if (!me.permissions.has(PermissionsBitField.Flags.ModerateMembers)) return message.reply("❌ I need **Moderate Members** permission.");

        const ms = 5 * 60 * 1000;
        await target.timeout(ms, `Timed out by ${message.author.tag} (5 minutes)`).catch(() => {
          message.reply("❌ I couldn't timeout them. (Missing permission or role too high)");
        });

        return message.channel.send(`${target.user} was timed out for **5 min**.`);
      }

      if (cmd === "ban") {
        const userId = parseUserId(arg1);
        if (!userId) return message.reply("Usage: `!ban <@user|id>`");

        const target = await message.guild.members.fetch(userId).catch(() => null);
        if (!target) return message.reply("❌ I can't find that user in this server.");

        await target.ban({ reason: `Banned by ${message.author.tag}` }).catch(() => {
          message.reply("❌ I couldn't ban them. (Missing permission or role too high)");
        });

        return message.channel.send(`${target.user} was banned.`);
      }

      if (cmd === "kick") {
        const userId = parseUserId(arg1);
        if (!userId) return message.reply("Usage: `!kick <@user|id>`");

        const target = await message.guild.members.fetch(userId).catch(() => null);
        if (!target) return message.reply("❌ I can't find that user in this server.");

        await target.kick(`Kicked by ${message.author.tag}`).catch(() => {
          message.reply("❌ I couldn't kick them. (Missing permission or role too high)");
        });

        return message.channel.send(`${target.user} was kicked.`);
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

    // sticky behavior
    const sticky = stickyByChannel.get(message.channel.id);
    if (sticky) {
      if (sticky.messageId && message.id === sticky.messageId) return;
      if (sticky.messageId) await message.channel.messages.delete(sticky.messageId).catch(() => {});
      const sent = await message.channel.send(sticky.content);
      stickyByChannel.set(message.channel.id, { content: sticky.content, messageId: sent.id });
    }
  } catch (e) {
    console.error(e);
  }
});

/* ===================== LOGIN ===================== */

if (!process.env.TOKEN) {
  console.error("❌ Missing TOKEN in .env");
  process.exit(1);
}

client.login(process.env.TOKEN);

/**
 * IMPORTANT: When you invite the bot, include scopes:
 * ✅ bot
 * ✅ applications.commands
 */
