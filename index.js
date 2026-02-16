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

const VOUCHES_CHANNEL_ID = "1455198053546983454";
const JOIN_LOG_CHANNEL_ID = "1461947323541225704";

const STAFF_ROLE_IDS = [
  "1465888170531881123",
  "1457184344538874029",
  "1456504229148758229",
  "1464012365472337990",
];

const GUILD_ID = process.env.GUILD_ID;

/* ===================== STORAGE FILES ===================== */

const INVITES_FILE = path.join(__dirname, "invites_data.json");
const GIVEAWAYS_FILE = path.join(__dirname, "giveaways_data.json");

function loadJsonSafe(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}
function saveJsonSafe(file, data) {
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error("Failed saving", file, e.message);
  }
}

const invitesData = loadJsonSafe(INVITES_FILE, {
  inviterStats: {}, // inviterId -> { joins, rejoins, left, manual }
  memberInviter: {}, // memberId -> inviterId (first time)
});

const giveawayStore = loadJsonSafe(GIVEAWAYS_FILE, {
  giveaways: {}, // gwId -> gw data
});

/* ===================== CLIENT ===================== */

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildInvites,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

/* ===================== HELPERS ===================== */

function containsLink(content) {
  if (!content) return false;
  const urlRegex = /(https?:\/\/\S+)|(www\.\S+)/i;
  const discordInviteRegex = /(discord\.gg\/\S+)|(discord\.com\/invite\/\S+)/i;
  return urlRegex.test(content) || discordInviteRegex.test(content);
}

async function ensureAutoModRole(guild) {
  let role = guild.roles.cache.find((r) => r.name.toLowerCase() === AUTOMOD_ROLE_NAME);
  if (role) return role;

  const me = await guild.members.fetchMe();
  if (!me.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
    console.log(`❌ Missing Manage Roles in ${guild.name} (can't create automod role)`);
    return null;
  }

  role = await guild.roles.create({
    name: AUTOMOD_ROLE_NAME,
    permissions: [],
    mentionable: false,
    hoist: false,
    reason: "Auto-created for link bypass",
  });

  console.log(`✅ Created role "${AUTOMOD_ROLE_NAME}" in ${guild.name}`);
  return role;
}

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

function ensureInviter(inviterId) {
  if (!invitesData.inviterStats[inviterId]) {
    invitesData.inviterStats[inviterId] = { joins: 0, rejoins: 0, left: 0, manual: 0 };
  } else {
    invitesData.inviterStats[inviterId].joins ??= 0;
    invitesData.inviterStats[inviterId].rejoins ??= 0;
    invitesData.inviterStats[inviterId].left ??= 0;
    invitesData.inviterStats[inviterId].manual ??= 0;
  }
  return invitesData.inviterStats[inviterId];
}

// "Invites still in server" (joins + rejoins - left + manual)
function stillInServerCount(inviterId) {
  const s = ensureInviter(inviterId);
  const base = (s.joins || 0) + (s.rejoins || 0) - (s.left || 0);
  return Math.max(0, base + (s.manual || 0));
}

/* ===================== INVITE DETECTION CACHE ===================== */

const invitesCache = new Map(); // guildId -> Map(code -> uses)

async function refreshInvitesForGuild(guild) {
  const invites = await guild.invites.fetch();
  const m = new Map();
  invites.forEach((inv) => m.set(inv.code, inv.uses ?? 0));
  invitesCache.set(guild.id, m);
  return invites;
}

/* ===================== GIVEAWAY HELPERS ===================== */

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
  return new EmbedBuilder()
    .setTitle(gw.prize)
    .setColor(0x5865f2)
    .setDescription(
      `Ends: <t:${endUnix}:R> (<t:${endUnix}:F>)\n` +
        `Hosted by: <@${gw.hostId}>\n` +
        `Entries: **${gw.entries.length}**\n` +
        `Winners: **${gw.winners}**`
    );
}

async function endGiveaway(gwId) {
  const gw = giveawayStore.giveaways[gwId];
  if (!gw || gw.ended) return;

  gw.ended = true;
  saveJsonSafe(GIVEAWAYS_FILE, giveawayStore);

  try {
    const channel = await client.channels.fetch(gw.channelId);
    if (!channel) return;

    // disable button + update embed
    try {
      const msg = await channel.messages.fetch(gw.messageId);
      await msg.edit({
        embeds: [makeGiveawayEmbed(gw)],
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`gw_join:${gwId}`)
              .setEmoji("🎉")
              .setStyle(ButtonStyle.Primary)
              .setDisabled(true)
          ),
        ],
      });
    } catch {}

    if (gw.entries.length === 0) {
      await channel.send(`No entries — giveaway for **${gw.prize}** ended with no winners.`);
      return;
    }

    const winnerCount = Math.max(1, Math.min(gw.winners, gw.entries.length));
    const winners = pickRandomWinners(gw.entries, winnerCount);

    for (const userId of winners) {
      await channel.send(`Congratulations <@${userId}>! You won the **${gw.prize}**!`);
    }
  } catch (e) {
    console.error("Failed to end giveaway:", e.message);
  }
}

function scheduleGiveawayEnd(gwId) {
  const gw = giveawayStore.giveaways[gwId];
  if (!gw || gw.ended) return;

  const delay = gw.endsAt - Date.now();
  if (delay <= 0) return endGiveaway(gwId);

  const MAX = 2_147_483_647;
  setTimeout(() => {
    const g = giveawayStore.giveaways[gwId];
    if (!g || g.ended) return;
    if (g.endsAt - Date.now() > MAX) return scheduleGiveawayEnd(gwId);
    endGiveaway(gwId);
  }, Math.min(delay, MAX));
}

/* ===================== TICKETS ===================== */

const ticketButtons = {
  ticket_support: { label: "Help & Support", category: "Help & Support", key: "help-support" },
  ticket_claim: { label: "Claim Order", category: "Claim Order", key: "claim-order" },
  ticket_sell: { label: "Sell To Us", category: "Sell to Us", key: "sell-to-us" },
  ticket_rewards: { label: "Rewards", category: "Rewards", key: "rewards" },
};

async function getOrCreateCategory(guild, name) {
  let cat = guild.channels.cache.find(
    (c) => c.type === ChannelType.GuildCategory && c.name === name
  );
  if (!cat) {
    cat = await guild.channels.create({ name, type: ChannelType.GuildCategory });
  }
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

/* ===================== SLASH COMMANDS (REGISTER) ===================== */

async function registerSlashCommands() {
  if (!process.env.TOKEN) throw new Error("Missing TOKEN");
  if (!GUILD_ID) throw new Error("Missing GUILD_ID");

  const commands = [
    new SlashCommandBuilder()
      .setName("vouches")
      .setDescription("Shows how many messages are in the vouches channel."),

    new SlashCommandBuilder()
      .setName("close")
      .setDescription("Close the current ticket and DM the opener the reason.")
      .addStringOption((o) =>
        o.setName("reason").setDescription("Reason (DM'd to opener)").setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName("invites")
      .setDescription("Shows invites still in server for a user.")
      .addUserOption((o) => o.setName("user").setDescription("User").setRequired(true)),

    new SlashCommandBuilder()
      .setName("addinvites")
      .setDescription("Adds invites to a user's count (manual).")
      .addUserOption((o) => o.setName("user").setDescription("User").setRequired(true))
      .addIntegerOption((o) => o.setName("amount").setDescription("Amount").setRequired(true)),

    new SlashCommandBuilder()
      .setName("resetinvites")
      .setDescription("Resets a user's invite stats to 0.")
      .addUserOption((o) => o.setName("user").setDescription("User").setRequired(true)),

    new SlashCommandBuilder()
      .setName("giveaway")
      .setDescription("Start a giveaway with a join button.")
      .addStringOption((o) => o.setName("duration").setDescription("e.g. 30m 1h 2d").setRequired(true))
      .addIntegerOption((o) => o.setName("winners").setDescription("How many winners").setRequired(true))
      .addStringOption((o) => o.setName("prize").setDescription("Prize").setRequired(true)),
  ].map((c) => c.toJSON());

  const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);
  await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), { body: commands });

  console.log("✅ Slash commands registered (/vouches /close /invites /addinvites /resetinvites /giveaway)");
}

/* ===================== READY ===================== */

client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  // Register slash commands (fixes "Application did not respond" if old commands existed)
  try {
    await registerSlashCommands();
  } catch (e) {
    console.error("❌ Slash registration failed:", e.message);
  }

  // Ensure automod role + load invites cache
  for (const guild of client.guilds.cache.values()) {
    try {
      await ensureAutoModRole(guild);
    } catch {}
    try {
      await refreshInvitesForGuild(guild);
    } catch (e) {
      console.log(`⚠️ Invite fetch failed for ${guild.name} (need Manage Server): ${e.message}`);
    }
  }

  // Reschedule giveaways after restart
  try {
    for (const gwId of Object.keys(giveawayStore.giveaways || {})) {
      const gw = giveawayStore.giveaways[gwId];
      if (gw && !gw.ended) scheduleGiveawayEnd(gwId);
    }
  } catch {}
});

/* ===================== INVITE EVENTS + JOIN LOG ===================== */

client.on("inviteCreate", async (invite) => {
  try {
    await refreshInvitesForGuild(invite.guild);
  } catch {}
});
client.on("inviteDelete", async (invite) => {
  try {
    await refreshInvitesForGuild(invite.guild);
  } catch {}
});

client.on("guildMemberAdd", async (member) => {
  try {
    const guild = member.guild;
    const log = await guild.channels.fetch(JOIN_LOG_CHANNEL_ID).catch(() => null);
    if (!log || log.type !== ChannelType.GuildText) return;

    const before = invitesCache.get(guild.id);
    if (!before) {
      await log.send(`${member} joined. (Couldn't detect inviter — missing invite permissions)`);
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

    // refresh cache
    const after = new Map();
    invites.forEach((inv) => after.set(inv.code, inv.uses ?? 0));
    invitesCache.set(guild.id, after);

    if (!used || !used.inviter) {
      await log.send(`${member} has been invited by **Unknown** and now has **0** invites.`);
      return;
    }

    const inviterId = used.inviter.id;
    const stats = ensureInviter(inviterId);

    // track join vs rejoin
    if (invitesData.memberInviter[member.id]) stats.rejoins += 1;
    else stats.joins += 1;

    invitesData.memberInviter[member.id] = inviterId;
    saveJsonSafe(INVITES_FILE, invitesData);

    const still = stillInServerCount(inviterId);
    await log.send(`${member} has been invited by ${used.inviter} and now has **${still}** invites.`);
  } catch (e) {
    console.log("Join log error:", e.message);
  }
});

client.on("guildMemberRemove", async (member) => {
  try {
    const inviterId = invitesData.memberInviter[member.id];
    if (!inviterId) return;
    const stats = ensureInviter(inviterId);
    stats.left += 1;
    saveJsonSafe(INVITES_FILE, invitesData);
  } catch {}
});

/* ===================== INTERACTIONS ===================== */

client.on("interactionCreate", async (interaction) => {
  try {
    /* ---------- GIVEAWAY JOIN BUTTON ---------- */
    if (interaction.isButton() && interaction.customId.startsWith("gw_join:")) {
      const gwId = interaction.customId.split("gw_join:")[1];
      const gw = giveawayStore.giveaways[gwId];
      if (!gw) return interaction.reply({ content: "This giveaway no longer exists.", ephemeral: true });
      if (gw.ended) return interaction.reply({ content: "This giveaway already ended.", ephemeral: true });

      const userId = interaction.user.id;
      const idx = gw.entries.indexOf(userId);
      if (idx === -1) gw.entries.push(userId);
      else gw.entries.splice(idx, 1);

      saveJsonSafe(GIVEAWAYS_FILE, giveawayStore);

      // update message
      try {
        const channel = await client.channels.fetch(gw.channelId);
        const msg = await channel.messages.fetch(gw.messageId);
        await msg.edit({
          embeds: [makeGiveawayEmbed(gw)],
          components: [
            new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId(`gw_join:${gwId}`).setEmoji("🎉").setStyle(ButtonStyle.Primary)
            ),
          ],
        });
      } catch {}

      return interaction.reply({
        content: idx === -1 ? "✅ Entered the giveaway!" : "✅ Removed your entry.",
        ephemeral: true,
      });
    }

    /* ---------- TICKET BUTTON -> MODAL ---------- */
    if (interaction.isButton() && interaction.customId in ticketButtons) {
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

    /* ---------- TICKET MODAL SUBMIT -> CREATE CHANNEL ---------- */
    if (interaction.isModalSubmit() && interaction.customId.startsWith("ticket_modal:")) {
      await interaction.deferReply({ ephemeral: true });

      const buttonId = interaction.customId.split("ticket_modal:")[1];
      const info = ticketButtons[buttonId];
      if (!info) return interaction.editReply("Invalid ticket type.");

      const mc = interaction.fields.getTextInputValue("mc")?.trim() || "N/A";
      const need = interaction.fields.getTextInputValue("need")?.trim() || "N/A";

      const category = await getOrCreateCategory(interaction.guild, info.category);
      const channelName = `${info.key}-${cleanName(interaction.user.username)}`.slice(0, 90);

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
        .setTitle(`${info.label} (${interaction.user.username})`)
        .addFields(
          { name: "Minecraft Username", value: mc.slice(0, 64), inline: true },
          { name: "Discord User", value: interaction.user.tag, inline: true },
          { name: "What they need", value: need.slice(0, 1024), inline: false }
        )
        .setColor(0x2b2d31);

      await channel.send({ content: `${interaction.user}`, embeds: [embed] });
      return interaction.editReply(`✅ Ticket created: ${channel}`);
    }

    /* ---------- SLASH COMMANDS ---------- */
    if (interaction.isChatInputCommand()) {
      // Always respond quickly (prevents "application not responding")
      const name = interaction.commandName;

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
        const still = stillInServerCount(user.id);
        return interaction.reply(`📨 **${user.tag}** has **${still}** invites still in the server.`);
      }

      if (name === "addinvites") {
        // staff only (admin OR any staff role)
        const member = await interaction.guild.members.fetch(interaction.user.id);
        const isStaff =
          member.permissions.has(PermissionsBitField.Flags.Administrator) ||
          STAFF_ROLE_IDS.some((rid) => member.roles.cache.has(rid));

        if (!isStaff) return interaction.reply({ content: "No permission.", ephemeral: true });

        const user = interaction.options.getUser("user", true);
        const amount = interaction.options.getInteger("amount", true);

        const s = ensureInviter(user.id);
        s.manual += amount;
        saveJsonSafe(INVITES_FILE, invitesData);

        return interaction.reply(`✅ Added **${amount}** invites to **${user.tag}**.`);
      }

      if (name === "resetinvites") {
        const member = await interaction.guild.members.fetch(interaction.user.id);
        const isStaff =
          member.permissions.has(PermissionsBitField.Flags.Administrator) ||
          STAFF_ROLE_IDS.some((rid) => member.roles.cache.has(rid));

        if (!isStaff) return interaction.reply({ content: "No permission.", ephemeral: true });

        const user = interaction.options.getUser("user", true);
        invitesData.inviterStats[user.id] = { joins: 0, rejoins: 0, left: 0, manual: 0 };
        saveJsonSafe(INVITES_FILE, invitesData);

        return interaction.reply(`✅ Reset invite stats for **${user.tag}**.`);
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
        const isStaff =
          member.permissions.has(PermissionsBitField.Flags.Administrator) ||
          STAFF_ROLE_IDS.some((rid) => member.roles.cache.has(rid));

        if (!isOpener && !isStaff) {
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

      if (name === "giveaway") {
        const member = await interaction.guild.members.fetch(interaction.user.id);
        const isStaff =
          member.permissions.has(PermissionsBitField.Flags.Administrator) ||
          STAFF_ROLE_IDS.some((rid) => member.roles.cache.has(rid));

        if (!isStaff) return interaction.reply({ content: "No permission.", ephemeral: true });

        const durationStr = interaction.options.getString("duration", true);
        const winners = interaction.options.getInteger("winners", true);
        const prize = interaction.options.getString("prize", true).trim();

        const ms = parseDurationToMs(durationStr);
        if (!ms) return interaction.reply({ content: "Invalid duration. Use 30m, 1h, 2d, etc.", ephemeral: true });
        if (winners < 1) return interaction.reply({ content: "Winners must be at least 1.", ephemeral: true });
        if (!prize) return interaction.reply({ content: "Prize cannot be empty.", ephemeral: true });

        const gwId = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
        const gw = {
          id: gwId,
          guildId: interaction.guild.id,
          channelId: interaction.channel.id,
          messageId: null,
          prize,
          winners,
          hostId: interaction.user.id,
          endsAt: Date.now() + ms,
          entries: [],
          ended: false,
        };

        const msg = await interaction.reply({
          embeds: [makeGiveawayEmbed(gw)],
          components: [
            new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId(`gw_join:${gwId}`).setEmoji("🎉").setStyle(ButtonStyle.Primary)
            ),
          ],
          fetchReply: true,
        });

        gw.messageId = msg.id;
        giveawayStore.giveaways[gwId] = gw;
        saveJsonSafe(GIVEAWAYS_FILE, giveawayStore);

        scheduleGiveawayEnd(gwId);
        return;
      }

      // Any unknown slash command that still exists in Discord won't hang:
      return interaction.reply({ content: "That slash command isn't enabled in the bot right now.", ephemeral: true });
    }
  } catch (e) {
    console.error(e);
    // last-resort: never leave an interaction hanging
    try {
      if (interaction?.isRepliable?.() && !interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: "Error handling that interaction.", ephemeral: true });
      }
    } catch {}
  }
});

/* ===================== MESSAGE COMMANDS + AUTOMOD + STICKY ===================== */

// Sticky per channel: channelId -> { content, messageId }
const stickyByChannel = new Map();

client.on("messageCreate", async (message) => {
  try {
    if (!message.guild || message.author.bot) return;

    // Link blocker (bypass = admin OR role "automod")
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

      if (cmd === "embed") {
        if (!text || !text.trim()) return message.reply("Usage: `!embed <text>`");
        const embed = new EmbedBuilder().setDescription(text).setColor(0x2b2d31);
        await message.channel.send({ embeds: [embed] });
      }

      if (cmd === "ticketpanel") {
        const embed = new EmbedBuilder()
          .setTitle("Tickets")
          .setDescription(
            "🆘 | Help & Support Ticket\nIf you need help with anything, create a support ticket.\n\n" +
              "💰 | Claim Order\nIf you have placed an order and are waiting to receive it please open this ticket.\n\n" +
              "💸| Sell To us\nWant to make some real cash of the donutsmp? Open a ticket and sell to us here.\n\n" +
              "🎁 | Claim Rewards Ticket\nLooking to claim rewards, make this ticket."
          )
          .setColor(0x2b2d31);

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("ticket_support").setLabel("Help & Support").setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId("ticket_claim").setLabel("Claim Order").setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId("ticket_sell").setLabel("Sell To Us").setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId("ticket_rewards").setLabel("Rewards").setStyle(ButtonStyle.Danger)
        );

        await message.channel.send({ embeds: [embed], components: [row] });
      }

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

        const toDelete = Math.min(100, amount + 1); // amount + the command itself
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
