/**
 * FULL index.js — updated with:
 * ✅ Admin /embed (full embed builder)
 * ✅ Tickets (1 open per user, modal questions, staff-view perms, /close)
 * ✅ Invites tracking + /generate + /linkinvite + join log
 * ✅ Automod link-blocker with auto-created "automod" role
 * ✅ Admin ! commands: !ticketpanel !stick !unstick !ban !kick !purge !mute (5 min timeout)
 * ✅ Giveaway system REVAMP:
 *    - Red embed
 *    - New button style + emoji
 *    - /giveaway includes optional min_invites requirement to join
 *    - /reroll and /end commands
 *
 * ENV:
 *   TOKEN=...
 *   GUILD_ID=...
 *
 * Intents to enable in Dev Portal:
 *   - Server Members Intent
 *   - Message Content Intent
 *
 * Recommended Bot Permissions:
 *   - Manage Server (to fetch invites)
 *   - Create Instant Invite (for /generate)
 *   - Manage Roles (create automod role)
 *   - Manage Channels (tickets)
 *   - Manage Messages (purge + sticky)
 *   - Moderate Members (timeout for !mute)
 *   - Kick Members / Ban Members (if using !kick/!ban)
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

const VOUCHES_CHANNEL_ID = "1455198053546983454";
const JOIN_LOG_CHANNEL_ID = "1461947323541225704";

// Staff roles that can SEE tickets and can /close + giveaway controls
const STAFF_ROLE_IDS = [
  "1465888170531881123",
  "1457184344538874029",
  "1456504229148758229",
  "1464012365472337990",
];

// ONLY these roles can /resetinvites (admins do NOT bypass unless they also have one of these roles)
const RESETINVITES_ROLE_IDS = [
  "1465888170531881123",
  "1457184344538874029",
  "1456504229148758229",
  "1464012365472337990",
];

const TICKET_TYPES = {
  ticket_support: { label: "Help & Support", category: "Help & Support", key: "help-support" },
  ticket_claim: { label: "Claim Order", category: "Claim Order", key: "claim-order" },
  ticket_sell: { label: "Sell To Us", category: "Sell to Us", key: "sell-to-us" },
  ticket_rewards: { label: "Rewards", category: "Rewards", key: "rewards" },
};

const TICKET_PANEL_TEXT =
  "🆘 | Help & Support Ticket\n" +
  "If you need help with anything, create a support ticket.\n\n" +
  "💰 | Claim Order\n" +
  "If you have placed an order and are waiting to receive it please open this ticket.\n\n" +
  "💸| Sell To us\n" +
  "Want to make some real cash of the donutsmp? Open a ticket and sell to us here.\n\n" +
  "🎁 | Claim Rewards Ticket\n" +
  "Looking to claim rewards, make this ticket.";

/* ===================== STORAGE ===================== */

const DATA_DIR = __dirname;
const INVITES_FILE = path.join(DATA_DIR, "invites_data.json");
const GIVEAWAYS_FILE = path.join(DATA_DIR, "giveaways_data.json");

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
  inviteOwners: {}, // inviteCode -> userId (custom credit owner for /generate and /linkinvite)
});

const giveawayData = loadJson(GIVEAWAYS_FILE, {
  giveaways: {}, // messageId -> giveaway object
});

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
  const mention = arg.match(/^<@!?(\d{10,25})>$/);
  if (mention) return mention[1];
  const id = arg.match(/^(\d{10,25})$/);
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
  return input
    .trim()
    .replace(/^https?:\/\/(www\.)?(discord\.gg|discord\.com\/invite)\//i, "")
    .replace(/[\s/]+/g, "")
    .slice(0, 64);
}

function parseHexColor(input) {
  if (!input) return null;
  let s = String(input).trim();
  if (s.startsWith("#")) s = s.slice(1);
  if (s.startsWith("0x")) s = s.slice(2);
  if (!/^[0-9a-fA-F]{6}$/.test(s)) return null;
  return parseInt(s, 16);
}

function extractMessageId(input) {
  if (!input) return null;
  const s = String(input).trim();
  // message link ends with /<channelId>/<messageId>
  const m1 = s.match(/\/(\d{10,25})$/);
  if (m1) return m1[1];
  const m2 = s.match(/^(\d{10,25})$/);
  if (m2) return m2[1];
  return null;
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

function saveInvites() {
  saveJson(INVITES_FILE, invitesData);
}
function saveGiveaways() {
  saveJson(GIVEAWAYS_FILE, giveawayData);
}

function memberHasAnyRole(member, roleIds) {
  return roleIds.some((rid) => member.roles.cache.has(rid));
}

function isStaff(member) {
  if (!member) return false;
  if (member.permissions.has(PermissionsBitField.Flags.Administrator)) return true;
  return memberHasAnyRole(member, STAFF_ROLE_IDS);
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

/* ===================== GIVEAWAYS (REVAMP) ===================== */

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

function makeGiveawayEmbedV2(gw) {
  const endUnix = Math.floor(gw.endsAt / 1000);
  const minInv = gw.minInvites && gw.minInvites > 0 ? `\nMin invites to join: **${gw.minInvites}**` : "";
  const status = gw.ended ? "\n**STATUS: ENDED**" : "";

  return new EmbedBuilder()
    .setTitle(`🎁 GIVEAWAY — ${gw.prize}`)
    .setColor(0xed4245) // Discord red
    .setDescription(
      `Ends: <t:${endUnix}:R> (<t:${endUnix}:F>)\n` +
        `Hosted by: <@${gw.hostId}>\n` +
        `Entries: **${gw.entries.length}**\n` +
        `Winners: **${gw.winners}**` +
        minInv +
        status
    )
    .setFooter({ text: `Giveaway ID: ${gw.messageId}` });
}

function giveawayRowV2(gw) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`gw2_join:${gw.messageId}`)
      .setStyle(ButtonStyle.Success) // different from previous (green)
      .setEmoji("🎊") // different logo
      .setLabel(gw.ended ? "Giveaway Ended" : "Join / Leave")
      .setDisabled(Boolean(gw.ended))
  );
}

async function endGiveawayNow(messageId, endedByUserId = null) {
  const gw = giveawayData.giveaways[messageId];
  if (!gw || gw.ended) return { ok: false, msg: "Giveaway not found or already ended." };

  gw.ended = true;
  saveGiveaways();

  const channel = await client.channels.fetch(gw.channelId).catch(() => null);
  if (!channel) return { ok: false, msg: "Channel not found." };

  const msg = await channel.messages.fetch(gw.messageId).catch(() => null);
  if (msg) {
    await msg.edit({
      embeds: [makeGiveawayEmbedV2(gw)],
      components: [giveawayRowV2(gw)],
    }).catch(() => {});
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
    .send(
      `🎉 Giveaway ended${endedBy}! Winners for **${gw.prize}**: ${winners.map((id) => `<@${id}>`).join(", ")}`
    )
    .catch(() => {});

  return { ok: true, msg: "Ended with winners." };
}

async function rerollGiveawayNow(messageId, rerolledByUserId = null) {
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

function scheduleGiveawayEndV2(messageId) {
  const gw = giveawayData.giveaways[messageId];
  if (!gw || gw.ended) return;

  const delay = gw.endsAt - Date.now();
  if (delay <= 0) return endGiveawayNow(messageId);

  const MAX = 2_147_483_647;
  setTimeout(() => {
    const g = giveawayData.giveaways[messageId];
    if (!g || g.ended) return;
    if (g.endsAt - Date.now() > MAX) return scheduleGiveawayEndV2(messageId);
    endGiveawayNow(messageId).catch(() => {});
  }, Math.min(delay, MAX));
}

/* ===================== TICKETS ===================== */

async function getOrCreateCategory(guild, name) {
  let cat = guild.channels.cache.find((c) => c.type === ChannelType.GuildCategory && c.name === name);
  if (!cat) cat = await guild.channels.create({ name, type: ChannelType.GuildCategory });
  return cat;
}

function getOpenerIdFromTopic(topic) {
  if (!topic) return null;
  const m = topic.match(/opener:(\d{10,25})/i);
  return m ? m[1] : null;
}

function isTicketChannel(channel) {
  return channel && channel.type === ChannelType.GuildText && Boolean(getOpenerIdFromTopic(channel.topic));
}

function findOpenTicketChannel(guild, openerId) {
  return guild.channels.cache.find((c) => {
    if (c.type !== ChannelType.GuildText) return false;
    return c.topic && c.topic.includes(`opener:${openerId}`);
  });
}

/* ===================== STICKY ===================== */

const stickyByChannel = new Map(); // channelId -> { content, messageId }

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
        .setDescription("Channel to send the embed in (optional)")
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false)
    )
    .addStringOption((o) => o.setName("title").setDescription("Embed title").setRequired(false))
    .addStringOption((o) => o.setName("description").setDescription("Embed description").setRequired(false))
    .addStringOption((o) => o.setName("color").setDescription("Hex color like #ff0000").setRequired(false))
    .addStringOption((o) => o.setName("url").setDescription("Title link URL").setRequired(false))
    .addStringOption((o) => o.setName("author_name").setDescription("Author name").setRequired(false))
    .addStringOption((o) => o.setName("author_icon").setDescription("Author icon URL").setRequired(false))
    .addStringOption((o) => o.setName("author_url").setDescription("Author URL").setRequired(false))
    .addStringOption((o) => o.setName("footer_text").setDescription("Footer text").setRequired(false))
    .addStringOption((o) => o.setName("footer_icon").setDescription("Footer icon URL").setRequired(false))
    .addStringOption((o) => o.setName("thumbnail_url").setDescription("Thumbnail image URL").setRequired(false))
    .addStringOption((o) => o.setName("image_url").setDescription("Main image URL").setRequired(false))
    .addAttachmentOption((o) => o.setName("thumbnail").setDescription("Thumbnail (upload)").setRequired(false))
    .addAttachmentOption((o) => o.setName("image").setDescription("Image (upload)").setRequired(false))
    // up to 5 fields
    .addStringOption((o) => o.setName("field1_name").setDescription("Field 1 name").setRequired(false))
    .addStringOption((o) => o.setName("field1_value").setDescription("Field 1 value").setRequired(false))
    .addBooleanOption((o) => o.setName("field1_inline").setDescription("Field 1 inline?").setRequired(false))
    .addStringOption((o) => o.setName("field2_name").setDescription("Field 2 name").setRequired(false))
    .addStringOption((o) => o.setName("field2_value").setDescription("Field 2 value").setRequired(false))
    .addBooleanOption((o) => o.setName("field2_inline").setDescription("Field 2 inline?").setRequired(false))
    .addStringOption((o) => o.setName("field3_name").setDescription("Field 3 name").setRequired(false))
    .addStringOption((o) => o.setName("field3_value").setDescription("Field 3 value").setRequired(false))
    .addBooleanOption((o) => o.setName("field3_inline").setDescription("Field 3 inline?").setRequired(false))
    .addStringOption((o) => o.setName("field4_name").setDescription("Field 4 name").setRequired(false))
    .addStringOption((o) => o.setName("field4_value").setDescription("Field 4 value").setRequired(false))
    .addBooleanOption((o) => o.setName("field4_inline").setDescription("Field 4 inline?").setRequired(false))
    .addStringOption((o) => o.setName("field5_name").setDescription("Field 5 name").setRequired(false))
    .addStringOption((o) => o.setName("field5_value").setDescription("Field 5 value").setRequired(false))
    .addBooleanOption((o) => o.setName("field5_inline").setDescription("Field 5 inline?").setRequired(false));

  const giveawayCmd = new SlashCommandBuilder()
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
    );

  const commands = [
    embedCmd,

    new SlashCommandBuilder().setName("vouches").setDescription("Shows how many vouches this server has."),

    new SlashCommandBuilder()
      .setName("invites")
      .setDescription("Shows invites still in the server for a user.")
      .addUserOption((o) => o.setName("user").setDescription("User").setRequired(true)),

    new SlashCommandBuilder()
      .setName("generate")
      .setDescription("Generate your personal invite link (credited to you in our invites)."),

    new SlashCommandBuilder()
      .setName("linkinvite")
      .setDescription("Link an existing invite code to yourself for invite credit.")
      .addStringOption((o) => o.setName("code").setDescription("Invite code or full discord.gg link").setRequired(true)),

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

    giveawayCmd,

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

  // reschedule giveaways
  for (const messageId of Object.keys(giveawayData.giveaways || {})) {
    const gw = giveawayData.giveaways[messageId];
    if (gw && !gw.ended) scheduleGiveawayEndV2(messageId);
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

    // Credit owner of invite code if linked; otherwise credit invite.inviter
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
    saveInvites();
  } catch {}
});

/* ===================== INTERACTIONS ===================== */

client.on("interactionCreate", async (interaction) => {
  try {
    /* ---------- Giveaway Join Button (V2) ---------- */
    if (interaction.isButton() && interaction.customId.startsWith("gw2_join:")) {
      const messageId = interaction.customId.split("gw2_join:")[1];
      const gw = giveawayData.giveaways[messageId];
      if (!gw) return interaction.reply({ content: "This giveaway no longer exists.", ephemeral: true });
      if (gw.ended) return interaction.reply({ content: "This giveaway already ended.", ephemeral: true });

      // Invite requirement
      const need = gw.minInvites || 0;
      if (need > 0) {
        const have = invitesStillInServer(interaction.user.id);
        if (have < need) {
          return interaction.reply({
            content: `❌ You need **${need}** invites to join this giveaway. You have **${have}**.`,
            ephemeral: true,
          });
        }
      }

      const userId = interaction.user.id;
      const idx = gw.entries.indexOf(userId);

      if (idx === -1) gw.entries.push(userId);
      else gw.entries.splice(idx, 1);

      saveGiveaways();

      // update message embed
      try {
        const channel = await client.channels.fetch(gw.channelId);
        const msg = await channel.messages.fetch(gw.messageId);
        await msg.edit({
          embeds: [makeGiveawayEmbedV2(gw)],
          components: [giveawayRowV2(gw)],
        });
      } catch {}

      return interaction.reply({
        content: idx === -1 ? "✅ Entered the giveaway!" : "✅ Removed your entry.",
        ephemeral: true,
      });
    }

    /* ---------- Ticket Buttons -> Modal ---------- */
    if (interaction.isButton() && interaction.customId in TICKET_TYPES) {
      const existing = findOpenTicketChannel(interaction.guild, interaction.user.id);
      if (existing) {
        return interaction.reply({ content: `❌ You already have an open ticket: ${existing}`, ephemeral: true });
      }

      const modal = new ModalBuilder()
        .setCustomId(`ticket_modal:${interaction.customId}`)
        .setTitle("Ticket Information");

      const mcInput = new TextInputBuilder()
        .setCustomId("mc")
        .setLabel("What is your Minecraft username?")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(32);

      const needInput = new TextInputBuilder()
        .setCustomId("need")
        .setLabel("What do you need?")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(1000);

      modal.addComponents(
        new ActionRowBuilder().addComponents(mcInput),
        new ActionRowBuilder().addComponents(needInput)
      );

      return interaction.showModal(modal);
    }

    /* ---------- Ticket Modal Submit -> Create Ticket ---------- */
    if (interaction.isModalSubmit() && interaction.customId.startsWith("ticket_modal:")) {
      await interaction.deferReply({ ephemeral: true });

      const existing = findOpenTicketChannel(interaction.guild, interaction.user.id);
      if (existing) {
        return interaction.editReply(`❌ You already have an open ticket: ${existing}`);
      }

      const buttonId = interaction.customId.split("ticket_modal:")[1];
      const type = TICKET_TYPES[buttonId];
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

      const channel = await interaction.guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        parent: category.id,
        topic: `opener:${interaction.user.id}`,
        permissionOverwrites: overwrites,
      });

      const embed = new EmbedBuilder()
        .setTitle(`${type.label} (${interaction.user.username})`)
        .addFields(
          { name: "Minecraft Username", value: (mc || "N/A").slice(0, 64), inline: true },
          { name: "Discord User", value: interaction.user.tag, inline: true },
          { name: "What they need", value: (need || "N/A").slice(0, 1024), inline: false }
        )
        .setColor(0x2b2d31);

      await channel.send({ content: `${interaction.user}`, embeds: [embed] });
      return interaction.editReply(`✅ Ticket created: ${channel}`);
    }

    /* ---------- Slash Commands ---------- */
    if (interaction.isChatInputCommand()) {
      const name = interaction.commandName;

      // /embed (admin-only)
      if (name === "embed") {
        const member = await interaction.guild.members.fetch(interaction.user.id);
        if (!member.permissions.has(PermissionsBitField.Flags.Administrator)) {
          return interaction.reply({ content: "Only administrators can use /embed.", ephemeral: true });
        }

        const targetChannel = interaction.options.getChannel("channel", false) || interaction.channel;
        if (!targetChannel || targetChannel.type !== ChannelType.GuildText) {
          return interaction.reply({ content: "Invalid channel.", ephemeral: true });
        }

        const me = await interaction.guild.members.fetchMe();
        const perms = targetChannel.permissionsFor(me);
        if (!perms?.has(PermissionsBitField.Flags.SendMessages)) {
          return interaction.reply({ content: "I can't send messages in that channel.", ephemeral: true });
        }

        const title = interaction.options.getString("title", false);
        const description = interaction.options.getString("description", false);
        const colorInput = interaction.options.getString("color", false);
        const url = interaction.options.getString("url", false);

        const authorName = interaction.options.getString("author_name", false);
        const authorIcon = interaction.options.getString("author_icon", false);
        const authorUrl = interaction.options.getString("author_url", false);

        const footerText = interaction.options.getString("footer_text", false);
        const footerIcon = interaction.options.getString("footer_icon", false);

        const thumbUrl = interaction.options.getString("thumbnail_url", false);
        const imageUrl = interaction.options.getString("image_url", false);

        const thumbAttach = interaction.options.getAttachment("thumbnail", false);
        const imageAttach = interaction.options.getAttachment("image", false);

        const fields = [];
        for (let i = 1; i <= 5; i++) {
          const n = interaction.options.getString(`field${i}_name`, false);
          const v = interaction.options.getString(`field${i}_value`, false);
          if (!n && !v) continue;
          if (!n || !v) {
            return interaction.reply({ content: `Field ${i} needs BOTH name and value.`, ephemeral: true });
          }
          const inline = interaction.options.getBoolean(`field${i}_inline`, false) ?? false;
          fields.push({ name: String(n).slice(0, 256), value: String(v).slice(0, 1024), inline });
        }

        if (!title && !description && fields.length === 0) {
          return interaction.reply({
            content: "You must provide at least a title, description, or a field.",
            ephemeral: true,
          });
        }

        const embed = new EmbedBuilder();
        if (title) embed.setTitle(String(title).slice(0, 256));
        if (description) embed.setDescription(String(description).slice(0, 4096));
        if (url) embed.setURL(url);

        const color = parseHexColor(colorInput);
        embed.setColor(color !== null ? color : 0x2b2d31);

        if (authorName) {
          embed.setAuthor({
            name: String(authorName).slice(0, 256),
            iconURL: authorIcon || undefined,
            url: authorUrl || undefined,
          });
        }

        if (footerText) {
          embed.setFooter({
            text: String(footerText).slice(0, 2048),
            iconURL: footerIcon || undefined,
          });
        }

        const finalThumb = thumbAttach?.url || thumbUrl;
        const finalImage = imageAttach?.url || imageUrl;
        if (finalThumb) embed.setThumbnail(finalThumb);
        if (finalImage) embed.setImage(finalImage);
        if (fields.length) embed.addFields(fields);

        await interaction.reply({ content: "✅ Sent embed.", ephemeral: true });
        await targetChannel.send({ embeds: [embed] });
        return;
      }

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

      if (name === "invites") {
        const user = interaction.options.getUser("user", true);
        const count = invitesStillInServer(user.id);
        return interaction.reply(`📨 **${user.tag}** has **${count}** invites still in the server.`);
      }

      if (name === "generate") {
        const me = await interaction.guild.members.fetchMe();
        const canCreate = interaction.channel.permissionsFor(me)?.has(PermissionsBitField.Flags.CreateInstantInvite);
        if (!canCreate) {
          return interaction.reply({
            content: "❌ I need **Create Invite** permission in this channel to generate an invite.",
            ephemeral: true,
          });
        }

        const invite = await interaction.channel.createInvite({
          maxAge: 0,
          maxUses: 0,
          unique: true,
          reason: `Invite generated for ${interaction.user.tag}`,
        });

        invitesData.inviteOwners ??= {};
        invitesData.inviteOwners[invite.code] = interaction.user.id;
        saveInvites();

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel("Open Invite").setURL(invite.url)
        );

        return interaction.reply({
          content:
            `✅ Here’s your personal invite link (credited to you in OUR invites system):\n${invite.url}\n\n` +
            `Tip: Right-click / tap-and-hold → **Copy Link**.`,
          components: [row],
          ephemeral: true,
        });
      }

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

        invitesData.inviteOwners ??= {};
        invitesData.inviteOwners[code] = interaction.user.id;
        saveInvites();

        return interaction.reply({
          content: `✅ Linked invite **${code}** to you. Joins using it will count toward your invites.`,
          ephemeral: true,
        });
      }

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

      if (name === "resetinvites") {
        const member = await interaction.guild.members.fetch(interaction.user.id);
        const allowed = memberHasAnyRole(member, RESETINVITES_ROLE_IDS);
        if (!allowed) {
          return interaction.reply({ content: "You don't have permission to use this.", ephemeral: true });
        }

        const user = interaction.options.getUser("user", true);
        invitesData.inviterStats[user.id] = { joins: 0, rejoins: 0, left: 0, manual: 0 };
        saveInvites();

        return interaction.reply(`✅ Reset invite stats for **${user.tag}**.`);
      }

      if (name === "resetall") {
        const member = await interaction.guild.members.fetch(interaction.user.id);
        if (!member.permissions.has(PermissionsBitField.Flags.Administrator)) {
          return interaction.reply({ content: "Only administrators can use this.", ephemeral: true });
        }

        invitesData.inviterStats = {};
        invitesData.memberInviter = {};
        saveInvites();

        return interaction.reply("✅ Reset invite stats for **everyone** in this server.");
      }

      if (name === "close") {
        const channel = interaction.channel;
        if (!isTicketChannel(channel)) {
          return interaction.reply({ content: "Use **/close** inside a ticket channel.", ephemeral: true });
        }

        const openerId = getOpenerIdFromTopic(channel.topic);
        const reason = interaction.options.getString("reason", true);

        const member = await interaction.guild.members.fetch(interaction.user.id);
        const isOpener = interaction.user.id === openerId;
        const canClose = isOpener || isStaff(member);

        if (!canClose) {
          return interaction.reply({ content: "Only the opener or staff can close this.", ephemeral: true });
        }

        try {
          const openerUser = await client.users.fetch(openerId);
          await openerUser.send(
            `Your ticket **${channel.name}** was closed by **${interaction.user.tag}**.\nReason: ${reason}`
          );
        } catch {}

        await interaction.reply({ content: "Closing ticket in 3 seconds...", ephemeral: true });
        setTimeout(() => channel.delete().catch(() => {}), 3000);
        return;
      }

      // GIVEAWAY (revamped)
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
        if (minInvites < 0) return interaction.reply({ content: "min_invites must be 0 or higher.", ephemeral: true });

        // Create placeholder, then send message, then store by messageId
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

        // Send the giveaway message
        const sent = await interaction.reply({
          embeds: [makeGiveawayEmbedV2({ ...gw, messageId: "pending" })],
          components: [giveawayRowV2({ ...gw, messageId: "pending" })],
          fetchReply: true,
        });

        gw.messageId = sent.id;
        giveawayData.giveaways[gw.messageId] = gw;
        saveGiveaways();

        // Edit once to show real ID
        await sent.edit({
          embeds: [makeGiveawayEmbedV2(gw)],
          components: [giveawayRowV2(gw)],
        }).catch(() => {});

        scheduleGiveawayEndV2(gw.messageId);
        return;
      }

      // /end (staff/admin)
      if (name === "end") {
        const member = await interaction.guild.members.fetch(interaction.user.id);
        if (!isStaff(member)) return interaction.reply({ content: "No permission.", ephemeral: true });

        const raw = interaction.options.getString("message", true);
        const messageId = extractMessageId(raw);
        if (!messageId) return interaction.reply({ content: "Invalid message ID/link.", ephemeral: true });

        await interaction.deferReply({ ephemeral: true });
        const res = await endGiveawayNow(messageId, interaction.user.id);
        return interaction.editReply(res.ok ? "✅ Giveaway ended." : `❌ ${res.msg}`);
      }

      // /reroll (staff/admin)
      if (name === "reroll") {
        const member = await interaction.guild.members.fetch(interaction.user.id);
        if (!isStaff(member)) return interaction.reply({ content: "No permission.", ephemeral: true });

        const raw = interaction.options.getString("message", true);
        const messageId = extractMessageId(raw);
        if (!messageId) return interaction.reply({ content: "Invalid message ID/link.", ephemeral: true });

        await interaction.deferReply({ ephemeral: true });
        const res = await rerollGiveawayNow(messageId, interaction.user.id);
        return interaction.editReply(res.ok ? "✅ Rerolled winners." : `❌ ${res.msg}`);
      }

      return interaction.reply({ content: "That slash command isn’t enabled right now.", ephemeral: true });
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

    // Admin-only ! commands
    if (message.content.startsWith(PREFIX)) {
      if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return;

      const parts = message.content.slice(PREFIX.length).trim().split(/\s+/);
      const cmd = (parts.shift() || "").toLowerCase();
      const text = message.content.slice(PREFIX.length + cmd.length + 1);
      const arg1 = parts[0];

      if (cmd === "ticketpanel") {
        const embed = new EmbedBuilder().setTitle("Tickets").setDescription(TICKET_PANEL_TEXT).setColor(0x2b2d31);

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("ticket_support").setLabel("Help & Support").setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId("ticket_claim").setLabel("Claim Order").setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId("ticket_sell").setLabel("Sell To Us").setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId("ticket_rewards").setLabel("Rewards").setStyle(ButtonStyle.Danger)
        );

        await message.channel.send({ embeds: [embed], components: [row] });
      }

      // Sticky
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

      // !mute (5 minutes timeout)
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

      // Ban/Kick/Purge
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

    // Sticky behavior after every message
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
