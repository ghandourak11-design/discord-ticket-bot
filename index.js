/**
 * DonutDemand Bot — Full (Rewritten + “no handler missing” + no “app didn’t respond”)
 *
 * ✅ Global slash commands (registered globally)
 * ✅ Commands SHOW to everyone by default (no default_member_permissions set)
 * ✅ /stop + /resume: visible to everyone, ONLY OWNER_ID can run
 * ✅ Blocked guilds: all commands/buttons/modals blocked with public reply:
 *    "Adam has restricted commands in your server."
 * ✅ /panel set|post|show|reset (ADMIN only) — per-guild JSON config
 * ✅ Tickets: panel buttons -> modal -> creates ticket channel w/ perms
 * ✅ /close: in ticket channel; opener or staff/admin; DMs opener embed; deletes channel
 * ✅ Invites tracking (persistent JSON) + min_invites for giveaways
 * ✅ Automod link blocker (bypass: admin or role named "automod")
 * ✅ Giveaways: /giveaway + Join/Leave button + auto end + /giveaway_end + /giveaway_reroll
 *
 * ENV:
 *  TOKEN=...
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

const AUTOMOD_ROLE_NAME = "automod";

/** Bot owner (Adam) */
const OWNER_ID = "1456326972631154786";
const ONLY_OWNER_MESSAGE = "Only Adam can use this command.";
const RESTRICT_MESSAGE = "Adam has restricted commands in your server.";

/** Optional: links in close-DM embed (only works in your main server) */
const VOUCHES_CHANNEL_ID = "1474606921305821466";
const WELCOME_CHANNEL_ID = "1474606890842329169";

/** Staff roles (your main server role IDs) */
const STAFF_ROLE_IDS = [
  "1465888170531881123",
  "1457184344538874029",
  "1456504229148758229",
  "1464012365472337990",
];

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
  memberInviter: {}, // memberId -> inviterId
  invitedMembers: {}, // inviterId -> [memberId]
  inviteOwners: {}, // inviteCode -> inviterId
});
invitesData.inviterStats ??= {};
invitesData.memberInviter ??= {};
invitesData.invitedMembers ??= {};
invitesData.inviteOwners ??= {};
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
function getPanelConfig(guildId) {
  return panelStore.byGuild[guildId] || DEFAULT_PANEL_CONFIG;
}

/** Restrictions per guild */
const restrictionsData = loadJson(RESTRICTIONS_FILE, { blockedGuilds: {} });
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

/* ===================== SAFE ACK HELPERS ===================== */

async function safeDeferReply(interaction, opts = {}) {
  try {
    if (!interaction.isRepliable()) return false;
    if (interaction.deferred || interaction.replied) return true;
    await interaction.deferReply(opts);
    return true;
  } catch {
    return false;
  }
}

async function safeReply(interaction, payload) {
  try {
    if (!interaction.isRepliable()) return;
    if (interaction.deferred || interaction.replied) return await interaction.editReply(payload);
    return await interaction.reply(payload);
  } catch {}
}

async function safeDeferUpdate(interaction) {
  try {
    if (interaction.deferred || interaction.replied) return true;
    await interaction.deferUpdate();
    return true;
  } catch {
    return false;
  }
}

async function safeFollowUp(interaction, payload) {
  try {
    return await interaction.followUp(payload);
  } catch {}
}

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

function memberHasAnyRole(member, roleIds) {
  if (!member) return false;
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

  const me = await guild.members.fetchMe().catch(() => null);
  if (!me || !me.permissions.has(PermissionsBitField.Flags.ManageRoles)) return null;

  role = await guild.roles
    .create({
      name: AUTOMOD_ROLE_NAME,
      permissions: [],
      mentionable: false,
      hoist: false,
      reason: "Auto-created for link bypass",
    })
    .catch(() => null);

  return role;
}

/* ===================== INVITES ===================== */

function ensureInviterStats(inviterId) {
  if (!inviterId) return null;
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
  if (!s) return 0;
  const base = (s.joins || 0) + (s.rejoins || 0) - (s.left || 0);
  return Math.max(0, base + (s.manual || 0));
}

/* ===================== INVITE CACHE ===================== */

const invitesCache = new Map(); // guildId -> Map(code->uses)

async function refreshGuildInvites(guild) {
  const invites = await guild.invites.fetch().catch(() => null);
  if (!invites) return null;

  const map = new Map();
  invites.forEach((inv) => map.set(inv.code, inv.uses ?? 0));
  invitesCache.set(guild.id, map);
  return invites;
}

/* ===================== PANEL VALIDATION/BUILD ===================== */

function validatePanelConfig(cfg) {
  if (!cfg || typeof cfg !== "object") return { ok: false, msg: "Config must be a JSON object." };

  const embed = cfg.embed || {};
  const modal = cfg.modal || {};
  const tickets = Array.isArray(cfg.tickets) ? cfg.tickets : null;

  if (!tickets || tickets.length < 1) return { ok: false, msg: "Config must include tickets: [...] with at least 1 type." };
  if (tickets.length > 5) return { ok: false, msg: "Max 5 ticket types (one button row)." };

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

  const seen = new Set();
  for (const t of tickets) {
    const id = String(t.id || "").trim();
    const label = String(t.label || "").trim();
    const category = String(t.category || "").trim();
    const key = String(t.key || "").trim();
    if (!id || id.length > 100) return { ok: false, msg: "Each ticket needs id (<= 100 chars)." };
    if (seen.has(id)) return { ok: false, msg: `Duplicate ticket id: ${id}` };
    seen.add(id);
    if (!label || label.length > 80) return { ok: false, msg: "Each ticket needs label (<= 80 chars)." };
    if (!category || category.length > 100) return { ok: false, msg: "Each ticket needs category (<= 100 chars)." };
    if (!key || key.length > 60) return { ok: false, msg: "Each ticket needs key (<= 60 chars)." };

    const b = t.button || {};
    const bLabel = String(b.label || "").trim();
    if (!bLabel || bLabel.length > 80) return { ok: false, msg: "Each ticket.button needs label (<= 80 chars)." };

    const style = String(b.style || "Primary");
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
  for (const t of (config.tickets || []).slice(0, 5)) {
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
  if (!cat) cat = await guild.channels.create({ name, type: ChannelType.GuildCategory }).catch(() => null);
  return cat;
}

/** Topic: opener:<id>;created:<ms>;type:<ticketId> */
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

  // These channel mentions only work in your main guild; if user isn’t there, it’s harmless text.
  const usefulLinks =
    `• Welcome: <#${WELCOME_CHANNEL_ID}>\n` +
    `• Vouches: <#${VOUCHES_CHANNEL_ID}>\n` +
    `• Need more help? Open a new ticket from the panel.`;

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
      { name: "Useful Links", value: usefulLinks, inline: false }
    )
    .setFooter({ text: "DonutDemand Support" });
}

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

  // NOTE: We DO NOT set default_member_permissions → commands show to everyone by default.
  // Server admins can still disable commands via Integrations; that cannot be overridden.

  const stopCmd = new SlashCommandBuilder()
    .setName("stop")
    .setDescription("Owner only: disable the bot in a server.")
    .setDMPermission(false)
    .addStringOption((o) => o.setName("server_id").setDescription("Guild/Server ID").setRequired(true));

  const resumeCmd = new SlashCommandBuilder()
    .setName("resume")
    .setDescription("Owner only: re-enable the bot in a server.")
    .setDMPermission(false)
    .addStringOption((o) => o.setName("server_id").setDescription("Guild/Server ID").setRequired(true));

  const panelCmd = new SlashCommandBuilder()
    .setName("panel")
    .setDescription("Admin: configure and post the ticket panel.")
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
          o
            .setName("channel")
            .setDescription("Channel to post in (optional)")
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(false)
        )
    )
    .addSubcommand((sub) => sub.setName("show").setDescription("Show current saved panel config (ephemeral)."))
    .addSubcommand((sub) => sub.setName("reset").setDescription("Reset panel config back to default."));

  const closeCmd = new SlashCommandBuilder()
    .setName("close")
    .setDescription("Close the current ticket (DMs opener).")
    .setDMPermission(false)
    .addStringOption((o) => o.setName("reason").setDescription("Reason").setRequired(true));

  const vouchesCmd = new SlashCommandBuilder()
    .setName("vouches")
    .setDescription("Counts recent messages in the vouches channel (approx).")
    .setDMPermission(false);

  const giveawayCmd = new SlashCommandBuilder()
    .setName("giveaway")
    .setDescription("Start a giveaway with a join button.")
    .setDMPermission(false)
    .addStringOption((o) => o.setName("duration").setDescription("e.g. 30m 1h 2d").setRequired(true))
    .addIntegerOption((o) => o.setName("winners").setDescription("How many winners").setMinValue(1).setRequired(true))
    .addStringOption((o) => o.setName("prize").setDescription("Prize").setRequired(true))
    .addIntegerOption((o) =>
      o.setName("min_invites").setDescription("Minimum invites to join (optional)").setMinValue(0).setRequired(false)
    );

  const giveawayEndCmd = new SlashCommandBuilder()
    .setName("giveaway_end")
    .setDescription("End a giveaway early by message ID.")
    .setDMPermission(false)
    .addStringOption((o) => o.setName("message_id").setDescription("Giveaway message ID").setRequired(true));

  const giveawayRerollCmd = new SlashCommandBuilder()
    .setName("giveaway_reroll")
    .setDescription("Reroll winners by giveaway message ID.")
    .setDMPermission(false)
    .addStringOption((o) => o.setName("message_id").setDescription("Giveaway message ID").setRequired(true));

  const commands = [stopCmd, resumeCmd, panelCmd, closeCmd, vouchesCmd, giveawayCmd, giveawayEndCmd, giveawayRerollCmd].map(
    (c) => c.toJSON()
  );

  const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

  const appId = client.application?.id || client.user?.id;
  if (!appId) throw new Error("Application ID not ready (client not ready).");

  await rest.put(Routes.applicationCommands(appId), { body: commands });
  console.log("✅ GLOBAL slash commands registered");
}

/* ===================== READY ===================== */

client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag} (${client.user.id})`);
  await client.application.fetch().catch(() => {});

  try {
    await registerSlashCommandsGlobal();
  } catch (e) {
    console.log("❌ Slash register failed:", e.message);
  }

  for (const guild of client.guilds.cache.values()) {
    try {
      await ensureAutoModRole(guild);
    } catch {}
    try {
      await refreshGuildInvites(guild);
    } catch {}
  }

  // Reschedule active giveaways
  for (const mid of Object.keys(giveawayData.giveaways)) {
    const gw = giveawayData.giveaways[mid];
    if (gw && !gw.ended) scheduleGiveawayEnd(mid);
  }
});

/* ===================== INVITE TRACKING EVENTS ===================== */

client.on("guildCreate", async (guild) => {
  try {
    await ensureAutoModRole(guild);
  } catch {}
  try {
    await refreshGuildInvites(guild);
  } catch {}
});

client.on("inviteCreate", async (invite) => {
  try {
    invitesData.inviteOwners[invite.code] = invite.inviter?.id || null;
    saveInvites();
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
    const before = invitesCache.get(guild.id) || new Map();
    const invites = await refreshGuildInvites(guild);
    if (!invites) return;

    let used = null;
    invites.forEach((inv) => {
      const prev = before.get(inv.code) ?? 0;
      const now = inv.uses ?? 0;
      if (now > prev) used = inv;
    });

    if (!used) return;

    const inviterId = used.inviter?.id || invitesData.inviteOwners[used.code];
    if (!inviterId) return;

    // If this member was seen before, treat as rejoin
    const wasSeenBefore = Boolean(invitesData.memberInviter[member.id]);

    invitesData.memberInviter[member.id] = inviterId;
    invitesData.invitedMembers[inviterId] ??= [];
    if (!invitesData.invitedMembers[inviterId].includes(member.id)) {
      invitesData.invitedMembers[inviterId].push(member.id);
    }

    const stats = ensureInviterStats(inviterId);
    if (wasSeenBefore) stats.rejoins += 1;
    else stats.joins += 1;

    saveInvites();
  } catch {}
});

client.on("guildMemberRemove", async (member) => {
  try {
    const inviterId = invitesData.memberInviter[member.id];
    if (!inviterId) return;
    const stats = ensureInviterStats(inviterId);
    if (!stats) return;
    stats.left += 1;
    saveInvites();
  } catch {}
});

/* ===================== INTERACTIONS ===================== */

client.on("interactionCreate", async (interaction) => {
  try {
    // ===== BLOCKED GUILD: block everything except OWNER /resume & /stop
    if (interaction.guildId && isGuildBlocked(interaction.guildId)) {
      const isOwnerCmd =
        interaction.isChatInputCommand() &&
        (interaction.commandName === "resume" || interaction.commandName === "stop") &&
        interaction.user.id === OWNER_ID;

      if (!isOwnerCmd) {
        if (interaction.isButton()) {
          await safeDeferUpdate(interaction);
          return;
        }
        if (interaction.isModalSubmit() || interaction.isChatInputCommand()) {
          await safeDeferReply(interaction, { ephemeral: true });
          return safeReply(interaction, { content: RESTRICT_MESSAGE, ephemeral: false });
        }
      }
    }

    // ===== BUTTONS
    if (interaction.isButton()) {
      await safeDeferUpdate(interaction);

      // Ticket button -> show modal
      if (interaction.customId.startsWith("ticket:")) {
        const typeId = interaction.customId.split(":")[1];
        const cfg = getPanelConfig(interaction.guild.id);
        const t = resolveTicketType(cfg, typeId);
        if (!t) return safeFollowUp(interaction, { content: "Unknown ticket type.", ephemeral: true });

        const existing = findOpenTicketChannel(interaction.guild, interaction.user.id);
        if (existing) {
          return safeFollowUp(interaction, { content: `You already have an open ticket: <#${existing.id}>`, ephemeral: true });
        }

        const modal = new ModalBuilder()
          .setCustomId(`ticket_modal:${t.id}`)
          .setTitle(String(cfg.modal?.title || "Ticket Info").slice(0, 45));

        const mc = new TextInputBuilder()
          .setCustomId("mc_username")
          .setLabel(String(cfg.modal?.mcLabel || "Minecraft username").slice(0, 45))
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        const need = new TextInputBuilder()
          .setCustomId("need")
          .setLabel(String(cfg.modal?.needLabel || "What do you need?").slice(0, 45))
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(mc), new ActionRowBuilder().addComponents(need));

        return interaction.showModal(modal).catch(() => {});
      }

      // Giveaway join/leave
      if (interaction.customId.startsWith("gw_join:")) {
        const messageId = interaction.customId.split(":")[1];
        const gw = giveawayData.giveaways[messageId];
        if (!gw) return safeFollowUp(interaction, { content: "Giveaway not found.", ephemeral: true });
        if (gw.ended) return safeFollowUp(interaction, { content: "That giveaway already ended.", ephemeral: true });

        const needInv = gw.minInvites || 0;
        if (needInv > 0) {
          const invCount = invitesStillInServer(interaction.user.id);
          if (invCount < needInv) {
            return safeFollowUp(interaction, {
              content: `You need **${needInv}** invites to enter. You currently have **${invCount}**.`,
              ephemeral: true,
            });
          }
        }

        const idx = gw.entries.indexOf(interaction.user.id);
        if (idx >= 0) gw.entries.splice(idx, 1);
        else gw.entries.push(interaction.user.id);
        saveGiveaways();

        const channel = await client.channels.fetch(gw.channelId).catch(() => null);
        if (channel) {
          const msg = await channel.messages.fetch(gw.messageId).catch(() => null);
          if (msg) await msg.edit({ embeds: [makeGiveawayEmbed(gw)], components: [giveawayRow(gw)] }).catch(() => {});
        }

        return safeFollowUp(interaction, { content: idx >= 0 ? "✅ You left the giveaway." : "✅ You joined the giveaway.", ephemeral: true });
      }

      return;
    }

    // ===== MODALS
    if (interaction.isModalSubmit()) {
      await safeDeferReply(interaction, { ephemeral: true });

      if (!interaction.customId.startsWith("ticket_modal:")) {
        return safeReply(interaction, { content: "Unknown modal.", ephemeral: true });
      }

      const typeId = interaction.customId.split(":")[1];
      const cfg = getPanelConfig(interaction.guild.id);
      const t = resolveTicketType(cfg, typeId);
      if (!t) return safeReply(interaction, { content: "Unknown ticket type.", ephemeral: true });

      const mcName = (interaction.fields.getTextInputValue("mc_username") || "Unknown").slice(0, 100);
      const need = (interaction.fields.getTextInputValue("need") || "No details.").slice(0, 1000);

      const guild = interaction.guild;

      const existing = findOpenTicketChannel(guild, interaction.user.id);
      if (existing) {
        return safeReply(interaction, { content: `You already have an open ticket: <#${existing.id}>`, ephemeral: true });
      }

      const cat = await getOrCreateCategory(guild, t.category);
      if (!cat) return safeReply(interaction, { content: "I couldn’t create/find the ticket category.", ephemeral: true });

      const createdAt = Date.now();
      const chName = `ticket-${cleanName(interaction.user.username)}-${cleanName(t.key)}`.slice(0, 90);

      const overwrites = [
        { id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
        {
          id: interaction.user.id,
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.ReadMessageHistory,
            PermissionsBitField.Flags.AttachFiles,
          ],
        },
      ];

      // Add staff roles (if they exist in this guild, overwrites will just fail silently otherwise)
      for (const rid of STAFF_ROLE_IDS) {
        overwrites.push({
          id: rid,
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.ReadMessageHistory,
            PermissionsBitField.Flags.ManageMessages,
          ],
        });
      }

      const channel = await guild.channels
        .create({
          name: chName,
          type: ChannelType.GuildText,
          parent: cat.id,
          topic: `opener:${interaction.user.id};created:${createdAt};type:${t.id}`,
          permissionOverwrites: overwrites,
          reason: `Ticket opened by ${interaction.user.tag}`,
        })
        .catch(() => null);

      if (!channel) return safeReply(interaction, { content: "I couldn’t create the ticket channel (missing permissions?).", ephemeral: true });

      const openerEmbed = new EmbedBuilder()
        .setTitle(`New Ticket — ${t.label}`)
        .setColor(0x2b2d31)
        .addFields(
          { name: "User", value: `<@${interaction.user.id}> (${interaction.user.tag})`, inline: false },
          { name: "Minecraft", value: mcName, inline: true },
          { name: "Need", value: need.slice(0, 1024), inline: false }
        )
        .setFooter({ text: "Use /close to close this ticket." });

      await channel.send({ content: `<@${interaction.user.id}>`, embeds: [openerEmbed] }).catch(() => {});
      return safeReply(interaction, { content: `✅ Ticket created: <#${channel.id}>`, ephemeral: true });
    }

    // ===== SLASH COMMANDS (NO "handler missing" possible)
    if (interaction.isChatInputCommand()) {
      const name = interaction.commandName;
      const sub = interaction.options.getSubcommand(false);

      // Always ACK immediately to avoid "Application did not respond"
      // /giveaway posts publicly but we still defer ephemeral so you don't spam
      await safeDeferReply(interaction, { ephemeral: true });

      switch (name) {
        case "stop": {
          if (interaction.user.id !== OWNER_ID) return safeReply(interaction, { content: ONLY_OWNER_MESSAGE, ephemeral: true });

          const gid = interaction.options.getString("server_id", true).trim();
          if (!/^\d{10,25}$/.test(gid)) return safeReply(interaction, { content: "Invalid server ID.", ephemeral: true });

          restrictionsData.blockedGuilds[gid] = { blockedAt: Date.now(), blockedBy: interaction.user.id };
          saveRestrictions();
          return safeReply(interaction, { content: `✅ Bot disabled in server: **${gid}**`, ephemeral: true });
        }

        case "resume": {
          if (interaction.user.id !== OWNER_ID) return safeReply(interaction, { content: ONLY_OWNER_MESSAGE, ephemeral: true });

          const gid = interaction.options.getString("server_id", true).trim();
          if (!/^\d{10,25}$/.test(gid)) return safeReply(interaction, { content: "Invalid server ID.", ephemeral: true });

          delete restrictionsData.blockedGuilds[gid];
          saveRestrictions();
          return safeReply(interaction, { content: `✅ Bot re-enabled in server: **${gid}**`, ephemeral: true });
        }

        case "panel": {
          const member = await interaction.guild.members.fetch(interaction.user.id);
          if (!member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return safeReply(interaction, { content: "Admins only.", ephemeral: true });
          }

          if (sub === "show") {
            const cfg = getPanelConfig(interaction.guild.id);
            const json = JSON.stringify(cfg, null, 2);
            if (json.length > 1800) return safeReply(interaction, { content: "Config too large to show here.", ephemeral: true });
            return safeReply(interaction, { content: "```json\n" + json + "\n```", ephemeral: true });
          }

          if (sub === "reset") {
            delete panelStore.byGuild[interaction.guild.id];
            savePanelStore();
            return safeReply(interaction, { content: "✅ Panel config reset to default.", ephemeral: true });
          }

          if (sub === "set") {
            const raw = interaction.options.getString("json", true);
            if (raw.length > 6000) return safeReply(interaction, { content: "❌ JSON too long.", ephemeral: true });

            let cfg;
            try {
              cfg = JSON.parse(raw);
            } catch {
              return safeReply(interaction, { content: "❌ Invalid JSON.", ephemeral: true });
            }

            const v = validatePanelConfig(cfg);
            if (!v.ok) return safeReply(interaction, { content: `❌ ${v.msg}`, ephemeral: true });

            panelStore.byGuild[interaction.guild.id] = cfg;
            savePanelStore();
            return safeReply(interaction, { content: "✅ Saved panel config for this server.", ephemeral: true });
          }

          if (sub === "post") {
            const cfg = getPanelConfig(interaction.guild.id);
            const targetChannel = interaction.options.getChannel("channel", false) || interaction.channel;

            if (!targetChannel || targetChannel.type !== ChannelType.GuildText) {
              return safeReply(interaction, { content: "Invalid channel.", ephemeral: true });
            }

            const v = validatePanelConfig(cfg);
            if (!v.ok) return safeReply(interaction, { content: `❌ Saved config invalid: ${v.msg}`, ephemeral: true });

            await targetChannel.send(buildTicketPanelMessage(cfg));
            return safeReply(interaction, { content: "✅ Posted ticket panel.", ephemeral: true });
          }

          return safeReply(interaction, { content: "Unknown /panel subcommand.", ephemeral: true });
        }

        case "close": {
          const reason = interaction.options.getString("reason", true);

          const channel = interaction.channel;
          if (!channel || channel.type !== ChannelType.GuildText) {
            return safeReply(interaction, { content: "Use this in a server text channel.", ephemeral: true });
          }
          if (!isTicketChannel(channel)) {
            return safeReply(interaction, { content: "This is not a ticket channel.", ephemeral: true });
          }

          const meta = getTicketMetaFromTopic(channel.topic);
          const openerId = meta?.openerId;

          const member = await interaction.guild.members.fetch(interaction.user.id);
          const allowed = openerId === interaction.user.id || isStaff(member);
          if (!allowed) return safeReply(interaction, { content: "Only the opener or staff can close this ticket.", ephemeral: true });

          const opener = openerId ? await interaction.guild.members.fetch(openerId).catch(() => null) : null;

          const cfg = getPanelConfig(interaction.guild.id);
          const t = resolveTicketType(cfg, meta?.typeId);

          const dmEmbed = buildCloseDmEmbed({
            guild: interaction.guild,
            ticketChannelName: `#${channel.name}`,
            ticketTypeLabel: t?.label || "Unknown",
            openedAtMs: meta?.createdAt,
            closedByTag: interaction.user.tag,
            reason,
          });

          if (opener?.user) opener.user.send({ embeds: [dmEmbed] }).catch(() => {});

          await safeReply(interaction, { content: "✅ Closing ticket...", ephemeral: true });
          setTimeout(() => channel.delete(`Ticket closed by ${interaction.user.tag}: ${reason}`).catch(() => {}), 1200);
          return;
        }

        case "vouches": {
          // This is approximate and capped so it won’t hang.
          const ch = await client.channels.fetch(VOUCHES_CHANNEL_ID).catch(() => null);
          if (!ch || ch.type !== ChannelType.GuildText) {
            return safeReply(interaction, { content: "Vouches channel not found (this server may not be your main one).", ephemeral: true });
          }

          let count = 0;
          let lastId = null;

          for (let i = 0; i < 15; i++) {
            const batch = await ch.messages.fetch({ limit: 100, before: lastId || undefined }).catch(() => null);
            if (!batch || batch.size === 0) break;

            count += batch.filter((m) => !m.author.bot && (m.content?.trim()?.length || m.attachments.size)).size;
            lastId = batch.last().id;
          }

          return safeReply(interaction, { content: `📩 Vouches (approx): **${count}**`, ephemeral: false });
        }

        case "giveaway": {
          const durationStr = interaction.options.getString("duration", true);
          const winners = interaction.options.getInteger("winners", true);
          const prize = interaction.options.getString("prize", true);
          const minInvites = interaction.options.getInteger("min_invites", false) ?? 0;

          const ms = parseDurationToMs(durationStr);
          if (!ms) return safeReply(interaction, { content: "Invalid duration. Examples: `30m` `1h` `2d`", ephemeral: true });

          const gw = {
            channelId: interaction.channelId,
            messageId: null,
            hostId: interaction.user.id,
            prize,
            winners,
            minInvites,
            endsAt: Date.now() + ms,
            ended: false,
            entries: [],
            lastWinners: [],
          };

          // Post giveaway publicly
          const msg = await interaction.channel
            .send({ embeds: [makeGiveawayEmbed({ ...gw, messageId: "pending" })], components: [giveawayRow({ ...gw, messageId: "pending" })] })
            .catch(() => null);

          if (!msg) return safeReply(interaction, { content: "Could not post giveaway message (missing send perms?).", ephemeral: true });

          gw.messageId = msg.id;
          giveawayData.giveaways[msg.id] = gw;
          saveGiveaways();
          scheduleGiveawayEnd(msg.id);

          await msg.edit({ embeds: [makeGiveawayEmbed(gw)], components: [giveawayRow(gw)] }).catch(() => {});
          return safeReply(interaction, { content: "✅ Giveaway started.", ephemeral: true });
        }

        case "giveaway_end": {
          const mid = interaction.options.getString("message_id", true).trim();
          const gw = giveawayData.giveaways[mid];
          if (!gw) return safeReply(interaction, { content: "Giveaway not found.", ephemeral: true });

          const member = await interaction.guild.members.fetch(interaction.user.id);
          const allowed = gw.hostId === interaction.user.id || isStaff(member);
          if (!allowed) return safeReply(interaction, { content: "Only the host or staff can end this giveaway.", ephemeral: true });

          const res = await endGiveaway(mid, interaction.user.id);
          return safeReply(interaction, { content: res.ok ? "✅ Ended." : `❌ ${res.msg}`, ephemeral: true });
        }

        case "giveaway_reroll": {
          const mid = interaction.options.getString("message_id", true).trim();
          const gw = giveawayData.giveaways[mid];
          if (!gw) return safeReply(interaction, { content: "Giveaway not found.", ephemeral: true });

          const member = await interaction.guild.members.fetch(interaction.user.id);
          const allowed = gw.hostId === interaction.user.id || isStaff(member);
          if (!allowed) return safeReply(interaction, { content: "Only the host or staff can reroll this giveaway.", ephemeral: true });

          const res = await rerollGiveaway(mid, interaction.user.id);
          return safeReply(interaction, { content: res.ok ? "✅ Rerolled." : `❌ ${res.msg}`, ephemeral: true });
        }

        default:
          // This should never happen with this file unless Discord has old cached commands.
          return safeReply(interaction, { content: `Unknown command received: ${name}`, ephemeral: true });
      }
    }
  } catch (e) {
    console.error("interactionCreate error:", e);
    try {
      await safeReply(interaction, { content: "Error handling that interaction.", ephemeral: true });
    } catch {}
  }
});

/* ===================== MESSAGE HANDLER (AUTOMOD LINK BLOCKER) ===================== */

client.on("messageCreate", async (message) => {
  try {
    if (!message.guild || message.author.bot) return;

    // Blocked guild behavior
    if (isGuildBlocked(message.guild.id)) {
      if (message.content.startsWith("/")) message.channel.send(RESTRICT_MESSAGE).catch(() => {});
      return;
    }

    if (containsLink(message.content)) {
      const member = message.member;
      if (!member) return;

      const isAdmin = member.permissions.has(PermissionsBitField.Flags.Administrator);
      const automodRole = message.guild.roles.cache.find((r) => r.name.toLowerCase() === AUTOMOD_ROLE_NAME);
      const hasBypass = automodRole ? member.roles.cache.has(automodRole.id) : false;

      if (!isAdmin && !hasBypass) {
        await message.delete().catch(() => {});
        message.channel
          .send(`🚫 ${member}, links aren’t allowed unless you have the **${AUTOMOD_ROLE_NAME}** role.`)
          .then((m) => setTimeout(() => m.delete().catch(() => {}), 5000))
          .catch(() => {});
      }
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
