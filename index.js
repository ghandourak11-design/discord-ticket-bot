/**
 * DonutDemand Bot — Full
 *
 * Changes you requested:
 * ✅ /panel slash command (ADMIN only) replaces !ticketpanel
 *    - Fully configurable via ONE JSON string (stays under Discord option caps)
 *    - /panel set <json> saves config
 *    - /panel post [channel] posts the panel using saved config
 *
 * ✅ Ticket close DM is now a FULL EMBED (more like “real ticket bots”)
 *    - Includes server, ticket type, ticket name, closer, reason, opened time, closed time, next steps
 *
 * Notes on Discord caps:
 * - Slash commands have hard limits on number of options per command (max 25).
 * - To let you customize “everything” without hitting caps, /panel uses ONE string option: JSON config.
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
const GUILD_ID = process.env.GUILD_ID;

const AUTOMOD_ROLE_NAME = "automod";

/** Your updated IDs */
const CUSTOMER_ROLE_ID = "1474606828875677858";
const VOUCHES_CHANNEL_ID = "1474606921305821466";

/** unchanged */
const JOIN_LOG_CHANNEL_ID = "1461947323541225704";

// Staff roles that can SEE tickets + /link + giveaways + /close
const STAFF_ROLE_IDS = [
  "1465888170531881123",
  "1457184344538874029",
  "1456504229148758229",
  "1464012365472337990",
];

// ONLY these roles can /resetinvites (admins do NOT bypass unless also staff)
const RESETINVITES_ROLE_IDS = [...STAFF_ROLE_IDS];

/* ===================== DEFAULT PANEL CONFIG ===================== */
/**
 * You can override ALL of this with /panel set (JSON).
 * Limit: max 4 ticket types (keeps UI clean + safe with Discord component limits)
 */
const DEFAULT_PANEL_CONFIG = {
  embed: {
    title: "Tickets",
    description:
      "Open the right ticket type below.\n\n" +
      "🆘 Help & Support\n💰 Claim Order\n💸 Sell To Us\n🎁 Rewards",
    color: "#2b2d31",
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
      label: "Sell To Us",
      category: "Sell to Us",
      key: "sell-to-us",
      button: { label: "Sell To Us", style: "Secondary", emoji: "💸" },
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

const giveawayData = loadJson(GIVEAWAYS_FILE, { giveaways: {} });
giveawayData.giveaways ??= {};
saveJson(GIVEAWAYS_FILE, giveawayData);

/**
 * Panel config storage is per-guild:
 * { byGuild: { [guildId]: <config> } }
 */
const panelStore = loadJson(PANEL_FILE, { byGuild: {} });
panelStore.byGuild ??= {};
saveJson(PANEL_FILE, panelStore);

function saveInvites() {
  saveJson(INVITES_FILE, invitesData);
}
function saveGiveaways() {
  saveJson(GIVEAWAYS_FILE, giveawayData);
}
function savePanelStore() {
  saveJson(PANEL_FILE, panelStore);
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

// still in server ONLY
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
  if (tickets.length > 4) return { ok: false, msg: "Max 4 ticket types (Discord component + clean UI limit)." };

  const title = String(embed.title ?? "").trim();
  const desc = String(embed.description ?? "").trim();
  const color = String(embed.color ?? "").trim();

  if (!title || title.length > 256) return { ok: false, msg: "embed.title is required and must be <= 256 chars." };
  if (!desc || desc.length > 4000) return { ok: false, msg: "embed.description is required and must be <= 4000 chars." };
  if (color && !parseHexColor(color)) return { ok: false, msg: "embed.color must be a hex like #2b2d31." };

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

/* ===================== TICKETS ===================== */

async function getOrCreateCategory(guild, name) {
  let cat = guild.channels.cache.find((c) => c.type === ChannelType.GuildCategory && c.name === name);
  if (!cat) cat = await guild.channels.create({ name, type: ChannelType.GuildCategory });
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
  return {
    openerId: opener,
    createdAt: created ? Number(created) : null,
    typeId,
  };
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

    if (b.emoji) btn.setEmoji(String(b.emoji));
    row.addComponents(btn);
  }

  return { embeds: [embed], components: [row] };
}

function buildCloseDmEmbed({ guild, ticketChannelName, ticketTypeLabel, openedAtMs, closedByTag, reason }) {
  const openedUnix = openedAtMs ? Math.floor(openedAtMs / 1000) : null;
  const closedUnix = Math.floor(Date.now() / 1000);

  const e = new EmbedBuilder()
    .setTitle("Ticket Closed")
    .setColor(0xed4245)
    .setDescription("Your ticket has been closed. Details below:")
    .addFields(
      { name: "Server", value: `${guild.name}`, inline: true },
      { name: "Ticket", value: `${ticketChannelName}`, inline: true },
      { name: "Type", value: ticketTypeLabel || "Unknown", inline: true },
      { name: "Closed By", value: closedByTag || "Unknown", inline: true },
      { name: "Reason", value: String(reason || "No reason provided").slice(0, 1024), inline: false }
    )
    .addFields(
      { name: "Opened", value: openedUnix ? `<t:${openedUnix}:F> (<t:${openedUnix}:R>)` : "Unknown", inline: true },
      { name: "Closed", value: `<t:${closedUnix}:F> (<t:${closedUnix}:R>)`, inline: true }
    )
    .addFields({
      name: "Next Steps",
      value:
        "• If you still need help, open a new ticket from the ticket panel.\n" +
        "• If this was resolved, please consider leaving a vouch in the vouches channel.\n" +
        "• Keep your DMs open so you don’t miss updates.",
      inline: false,
    })
    .setFooter({ text: "DonutDemand Support" });

  return e;
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
  if (msg) {
    await msg.edit({ embeds: [makeGiveawayEmbed(gw)], components: [giveawayRow(gw)] }).catch(() => {});
  }

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

/* ===================== SLASH COMMAND REGISTRATION ===================== */

async function registerSlashCommands() {
  if (!process.env.TOKEN) throw new Error("Missing TOKEN");
  if (!GUILD_ID) throw new Error("Missing GUILD_ID");

  const embedCmd = new SlashCommandBuilder()
    .setName("embed")
    .setDescription("Send a custom embed (admin only).")
    .addChannelOption((o) =>
      o
        .setName("channel")
        .setDescription("Channel to send embed in (optional)")
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false)
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
        .addStringOption((o) =>
          o
            .setName("json")
            .setDescription("Panel config JSON (embed/title/buttons/categories/etc).")
            .setRequired(true)
        )
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
    .addSubcommand((sub) => sub.setName("show").setDescription("Show the current saved panel config (ephemeral)."))
    .addSubcommand((sub) => sub.setName("reset").setDescription("Reset panel config back to default."));

  const commands = [
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
        sub
          .setName("start")
          .setDescription("Start operation timer in this ticket.")
          .addStringOption((o) => o.setName("duration").setDescription("e.g. 10m, 1h, 2d").setRequired(true))
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
      .addIntegerOption((o) =>
        o
          .setName("min_invites")
          .setDescription("Minimum invites needed to join (optional)")
          .setMinValue(0)
          .setRequired(false)
      ),

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
  await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), { body: commands });
  console.log("✅ Slash commands registered");
}

/* ===================== READY ===================== */

client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  try {
    await registerSlashCommands();
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

  for (const messageId of Object.keys(giveawayData.giveaways || {})) {
    const gw = giveawayData.giveaways[messageId];
    if (gw && !gw.ended) scheduleGiveawayEnd(messageId);
  }
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
    const logChannel = await guild.channels.fetch(JOIN_LOG_CHANNEL_ID).catch(() => null);
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
    // Giveaway join button
    if (interaction.isButton() && interaction.customId.startsWith("gw_join:")) {
      const messageId = interaction.customId.split("gw_join:")[1];
      const gw = giveawayData.giveaways[messageId];
      if (!gw) return interaction.reply({ content: "This giveaway no longer exists.", ephemeral: true });
      if (gw.ended) return interaction.reply({ content: "This giveaway already ended.", ephemeral: true });

      const need = gw.minInvites || 0;
      if (need > 0) {
        const have = invitesStillInServer(interaction.user.id);
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

      return interaction.reply({
        content: idx === -1 ? "✅ Entered the giveaway!" : "✅ Removed your entry.",
        ephemeral: true,
      });
    }

    // Ticket buttons -> modal (uses CURRENT saved config)
    if (interaction.isButton() && interaction.customId.startsWith("ticket:")) {
      const typeId = interaction.customId.split("ticket:")[1];
      const config = getPanelConfig(interaction.guild.id);
      const ticketType = resolveTicketType(config, typeId);
      if (!ticketType) return interaction.reply({ content: "This ticket type no longer exists.", ephemeral: true });

      const existing = findOpenTicketChannel(interaction.guild, interaction.user.id);
      if (existing) {
        return interaction.reply({ content: `❌ You already have an open ticket: ${existing}`, ephemeral: true });
      }

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
      if (existing) {
        return interaction.editReply(`❌ You already have an open ticket: ${existing}`);
      }

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

      /* ---------- /panel ---------- */
      if (name === "panel") {
        const member = await interaction.guild.members.fetch(interaction.user.id);
        if (!member.permissions.has(PermissionsBitField.Flags.Administrator)) {
          return interaction.reply({ content: "Admins only.", ephemeral: true });
        }

        const sub = interaction.options.getSubcommand();

        if (sub === "show") {
          const cfg = getPanelConfig(interaction.guild.id);
          const json = JSON.stringify(cfg, null, 2);
          // keep reply safe size
          if (json.length > 1800) {
            return interaction.reply({ content: "Config is too large to display here. Use /panel reset or re-set it.", ephemeral: true });
          }
          return interaction.reply({ content: "```json\n" + json + "\n```", ephemeral: true });
        }

        if (sub === "reset") {
          delete panelStore.byGuild[interaction.guild.id];
          savePanelStore();
          return interaction.reply({ content: "✅ Panel config reset to default.", ephemeral: true });
        }

        if (sub === "set") {
          const raw = interaction.options.getString("json", true);

          // Extra safety: don’t let someone paste a novel
          if (raw.length > 6000) {
            return interaction.reply({ content: "❌ JSON too long. Keep it under ~6000 characters.", ephemeral: true });
          }

          let cfg;
          try {
            cfg = JSON.parse(raw);
          } catch {
            return interaction.reply({ content: "❌ Invalid JSON. Make sure it’s valid JSON format.", ephemeral: true });
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

          if (!targetChannel || targetChannel.type !== ChannelType.GuildText) {
            return interaction.reply({ content: "Invalid channel.", ephemeral: true });
          }

          const v = validatePanelConfig(cfg);
          if (!v.ok) return interaction.reply({ content: `❌ Saved config is invalid: ${v.msg}`, ephemeral: true });

          const msgPayload = buildTicketPanelMessage(cfg);
          await targetChannel.send(msgPayload);

          return interaction.reply({ content: "✅ Posted ticket panel.", ephemeral: true });
        }
      }

      /* ---------- /embed ---------- */
      if (name === "embed") {
        const member = await interaction.guild.members.fetch(interaction.user.id);
        if (!member.permissions.has(PermissionsBitField.Flags.Administrator)) {
          return interaction.reply({ content: "Only administrators can use /embed.", ephemeral: true });
        }

        const targetChannel = interaction.options.getChannel("channel", false) || interaction.channel;
        if (!targetChannel || targetChannel.type !== ChannelType.GuildText) {
          return interaction.reply({ content: "Invalid channel.", ephemeral: true });
        }

        const title = interaction.options.getString("title", false);
        const description = interaction.options.getString("description", false);
        const colorInput = interaction.options.getString("color", false);
        const url = interaction.options.getString("url", false);
        const thumbnail = interaction.options.getString("thumbnail", false);
        const image = interaction.options.getString("image", false);

        if (!title && !description && !thumbnail && !image) {
          return interaction.reply({ content: "Provide at least title/description/image/thumbnail.", ephemeral: true });
        }

        const embed = new EmbedBuilder();
        if (title) embed.setTitle(String(title).slice(0, 256));
        if (description) embed.setDescription(String(description).slice(0, 4096));
        if (url) embed.setURL(url);

        const c = parseHexColor(colorInput);
        embed.setColor(c !== null ? c : 0x2b2d31);

        if (thumbnail) embed.setThumbnail(thumbnail);
        if (image) embed.setImage(image);

        await interaction.reply({ content: "✅ Sent embed.", ephemeral: true });
        await targetChannel.send({ embeds: [embed] });
        return;
      }

      /* ---------- /vouches ---------- */
      if (name === "vouches") {
        await interaction.deferReply();

        const channel = await interaction.guild.channels.fetch(VOUCHES_CHANNEL_ID).catch(() => null);
        if (!channel || channel.type !== ChannelType.GuildText) {
          return interaction.editReply("Couldn't find the vouches channel.");
        }

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
        const count = invitesStillInServer(user.id);
        return interaction.reply(`📨 **${user.tag}** has **${count}** invites still in the server.`);
      }

      /* ---------- /generate ---------- */
      if (name === "generate") {
        const me = await interaction.guild.members.fetchMe();
        const canCreate = interaction.channel.permissionsFor(me)?.has(PermissionsBitField.Flags.CreateInstantInvite);
        if (!canCreate) {
          return interaction.reply({ content: "❌ I need **Create Invite** permission in this channel.", ephemeral: true });
        }

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
          content: `✅ Your personal invite link (credited to you):\n${invite.url}\n\nTip: tap-and-hold → Copy Link`,
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
        if (!invites) {
          return interaction.reply({ content: "❌ I need invite permissions to verify invite codes.", ephemeral: true });
        }

        const found = invites.find((inv) => inv.code === code);
        if (!found) {
          return interaction.reply({ content: "❌ That invite code wasn’t found in this server.", ephemeral: true });
        }

        invitesData.inviteOwners[code] = interaction.user.id;
        saveInvites();

        return interaction.reply({ content: `✅ Linked invite **${code}** to you.`, ephemeral: true });
      }

      /* ---------- /addinvites ---------- */
      if (name === "addinvites") {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
          return interaction.reply({ content: "Only administrators can use this.", ephemeral: true });
        }
        const user = interaction.options.getUser("user", true);
        const amount = interaction.options.getInteger("amount", true);

        const s = ensureInviterStats(user.id);
        s.manual += amount;
        saveInvites();

        return interaction.reply(`✅ Added **${amount}** invites to **${user.tag}**.`);
      }

      /* ---------- /resetinvites ---------- */
      if (name === "resetinvites") {
        const member = await interaction.guild.members.fetch(interaction.user.id);
        const allowed = memberHasAnyRole(member, RESETINVITES_ROLE_IDS);
        if (!allowed) {
          return interaction.reply({ content: "You don't have permission to use this.", ephemeral: true });
        }

        const user = interaction.options.getUser("user", true);
        invitesData.inviterStats[user.id] = { joins: 0, rejoins: 0, left: 0, manual: 0 };
        delete invitesData.invitedMembers[user.id];
        saveInvites();

        return interaction.reply(`✅ Reset invite stats for **${user.tag}**.`);
      }

      /* ---------- /resetall ---------- */
      if (name === "resetall") {
        const member = await interaction.guild.members.fetch(interaction.user.id);
        if (!member.permissions.has(PermissionsBitField.Flags.Administrator)) {
          return interaction.reply({ content: "Only administrators can use this.", ephemeral: true });
        }

        invitesData.inviterStats = {};
        invitesData.memberInviter = {};
        invitesData.inviteOwners = {};
        invitesData.invitedMembers = {};
        saveInvites();

        return interaction.reply("✅ Reset invite stats for **everyone** in this server.");
      }

      /* ---------- /close ---------- */
      if (name === "close") {
        const channel = interaction.channel;
        if (!isTicketChannel(channel)) {
          return interaction.reply({ content: "Use **/close** inside a ticket channel.", ephemeral: true });
        }

        const meta = getTicketMetaFromTopic(channel.topic);
        const openerId = meta?.openerId;
        const openedAt = meta?.createdAt;
        const config = getPanelConfig(interaction.guild.id);
        const t = resolveTicketType(config, meta?.typeId);
        const ticketTypeLabel = t?.label || "Unknown";

        const reason = interaction.options.getString("reason", true);

        const member = await interaction.guild.members.fetch(interaction.user.id);
        const isOpener = interaction.user.id === openerId;
        const canClose = isOpener || isStaff(member);

        if (!canClose) {
          return interaction.reply({ content: "Only the opener or staff can close this.", ephemeral: true });
        }

        // cancel operation timer if running
        if (activeOperations.has(channel.id)) {
          clearTimeout(activeOperations.get(channel.id));
          activeOperations.delete(channel.id);
        }

        // DM embed to opener
        try {
          const openerUser = await client.users.fetch(openerId);
          const dmEmbed = buildCloseDmEmbed({
            guild: interaction.guild,
            ticketChannelName: channel.name,
            ticketTypeLabel,
            openedAtMs: openedAt,
            closedByTag: interaction.user.tag,
            reason,
          });

          await openerUser.send({ embeds: [dmEmbed] });
        } catch {}

        await interaction.reply({ content: "Closing ticket in 3 seconds...", ephemeral: true });
        setTimeout(() => channel.delete().catch(() => {}), 3000);
        return;
      }

      /* ---------- /link ---------- */
      if (name === "link") {
        const member = await interaction.guild.members.fetch(interaction.user.id);
        if (!isStaff(member)) return interaction.reply({ content: "No permission.", ephemeral: true });

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
            `**Active invited members (still credited):**\n${listText}\n\n` +
            `**Invite link(s) they use:**\n${inviteLinks}`,
        });
      }

      /* ---------- /operation ---------- */
      if (name === "operation") {
        const member = await interaction.guild.members.fetch(interaction.user.id);
        if (!member.permissions.has(PermissionsBitField.Flags.Administrator)) {
          return interaction.reply({ content: "Admins only.", ephemeral: true });
        }

        if (!isTicketChannel(interaction.channel)) {
          return interaction.reply({ content: "Use /operation inside a ticket channel.", ephemeral: true });
        }

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

        const openerMember = await interaction.guild.members.fetch(openerId).catch(() => null);
        if (!openerMember) return interaction.reply({ content: "Couldn't fetch ticket opener.", ephemeral: true });

        const botMe = await interaction.guild.members.fetchMe();
        if (!botMe.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
          return interaction.reply({ content: "I need **Manage Roles** permission.", ephemeral: true });
        }

        const role = await interaction.guild.roles.fetch(CUSTOMER_ROLE_ID).catch(() => null);
        if (!role) return interaction.reply({ content: "Customer role not found (wrong role ID?).", ephemeral: true });

        if (role.position >= botMe.roles.highest.position) {
          return interaction.reply({
            content: "Move the bot role above the customer role in Server Settings → Roles.",
            ephemeral: true,
          });
        }

        await openerMember.roles.add(role, `Customer role given by /operation from ${interaction.user.tag}`).catch(() => {});

        await interaction.channel
          .send(`<@${openerId}> please go to <#${VOUCHES_CHANNEL_ID}> and drop a vouch for us. Thank you!`)
          .catch(() => {});

        // restart timer if already exists
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
        const member = await interaction.guild.members.fetch(interaction.user.id);
        if (!isStaff(member)) return interaction.reply({ content: "No permission.", ephemeral: true });

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
        const member = await interaction.guild.members.fetch(interaction.user.id);
        if (!isStaff(member)) return interaction.reply({ content: "No permission.", ephemeral: true });

        const raw = interaction.options.getString("message", true);
        const messageId = extractMessageId(raw);
        if (!messageId) return interaction.reply({ content: "Invalid message ID/link.", ephemeral: true });

        await interaction.deferReply({ ephemeral: true });
        const res = await endGiveaway(messageId, interaction.user.id);
        return interaction.editReply(res.ok ? "✅ Giveaway ended." : `❌ ${res.msg}`);
      }

      /* ---------- /reroll ---------- */
      if (name === "reroll") {
        const member = await interaction.guild.members.fetch(interaction.user.id);
        if (!isStaff(member)) return interaction.reply({ content: "No permission.", ephemeral: true });

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

/* ===================== MESSAGE HANDLER (AUTOMOD + ADMIN ! COMMANDS + STICKY) ===================== */

client.on("messageCreate", async (message) => {
  try {
    if (!message.guild || message.author.bot) return;

    // automod link blocker
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

    // Admin-only ! commands (kept)
    if (message.content.startsWith(PREFIX)) {
      if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return;

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
        if (!me.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
          return message.reply("❌ I need **Moderate Members** permission to timeout users.");
        }

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

client.login(process.env.TOKEN);

/* ===================== HOW TO USE /panel (EXAMPLE JSON) ===================== */
/**
 * /panel set json:{
 *   "embed":{"title":"Support","description":"Choose a ticket type below.","color":"#5865F2"},
 *   "modal":{"title":"Ticket Info","mcLabel":"Minecraft IGN","needLabel":"Explain what you need"},
 *   "tickets":[
 *     {"id":"ticket_support","label":"Help & Support","category":"Help & Support","key":"help-support",
 *      "button":{"label":"Support","style":"Primary","emoji":"🆘"}},
 *     {"id":"ticket_claim","label":"Claim Order","category":"Claim Order","key":"claim-order",
 *      "button":{"label":"Claim","style":"Success","emoji":"💰"}}
 *   ]
 * }
 *
 * /panel post (optional channel)
 */
