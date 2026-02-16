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
  REST,
  Routes,
  SlashCommandBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");

/* -------------------- STAFF ROLES THAT CAN SEE TICKETS -------------------- */
const STAFF_ROLE_IDS = [
  "1465888170531881123",
  "1457184344538874029",
  "1456504229148758229",
  "1464012365472337990",
];

/* -------------------- INVITE DATA (simple JSON) -------------------- */
const INVITES_FILE = path.join(__dirname, "invites_data.json");

function loadInvitesData() {
  try {
    return JSON.parse(fs.readFileSync(INVITES_FILE, "utf8"));
  } catch {
    return {
      inviterStats: {},
      memberInviter: {},
    };
  }
}
function saveInvitesData(d) {
  try {
    fs.writeFileSync(INVITES_FILE, JSON.stringify(d, null, 2));
  } catch (e) {
    console.error("Failed to save invites data:", e.message);
  }
}
const invitesData = loadInvitesData();

/* -------------------- GIVEAWAY DATA (simple JSON) -------------------- */
const GIVEAWAYS_FILE = path.join(__dirname, "giveaways_data.json");

function loadGiveaways() {
  try {
    return JSON.parse(fs.readFileSync(GIVEAWAYS_FILE, "utf8"));
  } catch {
    return { giveaways: {} };
  }
}
function saveGiveaways(d) {
  try {
    fs.writeFileSync(GIVEAWAYS_FILE, JSON.stringify(d, null, 2));
  } catch (e) {
    console.error("Failed to save giveaways data:", e.message);
  }
}
const giveawayStore = loadGiveaways();

/* -------------------- CLIENT -------------------- */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Channel],
});

const PREFIX = "!";

/* -------------------- TICKETS -------------------- */
const CATEGORIES = {
  SELL: "Sell to Us",
  SUPPORT: "Help & Support",
  CLAIM: "Claim Order",
  REWARDS: "Rewards",
};

const ticketMap = {
  ticket_open_support: { key: "help-support", label: "Help & Support", category: CATEGORIES.SUPPORT },
  ticket_open_claim: { key: "claim-order", label: "Claim Order", category: CATEGORIES.CLAIM },
  ticket_open_sell: { key: "sell-to-us", label: "Sell to Us", category: CATEGORIES.SELL },
  ticket_open_rewards: { key: "claim-rewards", label: "Claim Rewards Ticket", category: CATEGORIES.REWARDS },
};

function cleanName(str) {
  return (str || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 24);
}

async function getOrCreateCategory(guild, categoryName) {
  let category = guild.channels.cache.find(
    (c) => c.type === ChannelType.GuildCategory && c.name === categoryName
  );
  if (!category) {
    category = await guild.channels.create({ name: categoryName, type: ChannelType.GuildCategory });
  }
  return category;
}

function getOpenerIdFromTopic(topic) {
  if (!topic) return null;
  const m = topic.match(/opener:(\d{10,25})/i);
  return m ? m[1] : null;
}
function isTicketChannel(channel) {
  if (!channel || channel.type !== ChannelType.GuildText) return false;
  return Boolean(getOpenerIdFromTopic(channel.topic));
}

/* -------------------- INVITES TRACKING -------------------- */
const invitesCache = new Map();

async function refreshInvitesForGuild(guild) {
  const invites = await guild.invites.fetch();
  const map = new Map();
  invites.forEach((inv) => map.set(inv.code, inv.uses ?? 0));
  invitesCache.set(guild.id, map);
  return invites;
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

function stillInServerCount(userId) {
  const s = ensureInviter(userId);
  const base = (s.joins || 0) + (s.rejoins || 0) - (s.left || 0);
  return Math.max(0, base + (s.manual || 0));
}

/* -------------------- GIVEAWAY HELPERS -------------------- */
function parseDurationToMs(input) {
  if (!input || typeof input !== "string") return null;
  const s = input.trim().toLowerCase();

  const normalized = s
    .replace(/seconds?|secs?/g, "s")
    .replace(/minutes?|mins?/g, "m")
    .replace(/hours?|hrs?/g, "h")
    .replace(/days?/g, "d")
    .replace(/\s+/g, "");

  const re = /(\d+)(s|m|h|d)/g;
  let total = 0;
  let matched = false;

  let m;
  while ((m = re.exec(normalized))) {
    matched = true;
    const n = parseInt(m[1], 10);
    const unit = m[2];
    if (unit === "s") total += n * 1000;
    if (unit === "m") total += n * 60 * 1000;
    if (unit === "h") total += n * 60 * 60 * 1000;
    if (unit === "d") total += n * 24 * 60 * 60 * 1000;
  }

  if (!matched || total <= 0) return null;
  return total;
}

function makeGiveawayEmbed(gw) {
  const endUnix = Math.floor(gw.endsAt / 1000);
  const entries = gw.entries.length;

  return new EmbedBuilder()
    .setTitle(gw.prize)
    .setColor(0x5865f2)
    .setDescription(
      `Ends: <t:${endUnix}:R> (<t:${endUnix}:F>)\n` +
      `Hosted by: <@${gw.hostId}>\n` +
      `Entries: **${entries}**\n` +
      `Winners: **${gw.winners}**`
    );
}

function pickRandomWinners(arr, n) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}

async function endGiveaway(gwId) {
  const gw = giveawayStore.giveaways[gwId];
  if (!gw || gw.ended) return;

  gw.ended = true;
  saveGiveaways(giveawayStore);

  try {
    const channel = await client.channels.fetch(gw.channelId);
    if (!channel) return;

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

    const entries = gw.entries;
    if (entries.length === 0) {
      await channel.send(`No entries — giveaway for **${gw.prize}** ended with no winners.`);
      return;
    }

    const winnerCount = Math.max(1, Math.min(gw.winners, entries.length));
    const winners = pickRandomWinners(entries, winnerCount);

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
  const wait = Math.min(delay, MAX);

  setTimeout(() => {
    const g = giveawayStore.giveaways[gwId];
    if (!g || g.ended) return;
    const remaining = g.endsAt - Date.now();
    if (remaining > MAX) scheduleGiveawayEnd(gwId);
    else endGiveaway(gwId);
  }, wait);
}

/* -------------------- SLASH COMMANDS -------------------- */
async function registerSlashCommands() {
  const token = process.env.TOKEN;
  const guildId = process.env.GUILD_ID;

  if (!token) throw new Error("Missing TOKEN env var.");
  if (!guildId) throw new Error("Missing GUILD_ID env var.");

  const commands = [
    new SlashCommandBuilder()
      .setName("close")
      .setDescription("Close this ticket and DM the opener the reason.")
      .addStringOption((opt) =>
        opt.setName("reason").setDescription("Reason (DM'd to ticket opener)").setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName("invites")
      .setDescription("Show invites still in server for a user.")
      .addUserOption((opt) => opt.setName("user").setDescription("User to check").setRequired(true)),

    new SlashCommandBuilder()
      .setName("addinvites")
      .setDescription("Add invites to a user's still-in-server count.")
      .addUserOption((opt) => opt.setName("user").setDescription("User").setRequired(true))
      .addIntegerOption((opt) => opt.setName("amount").setDescription("How many to add").setRequired(true)),

    new SlashCommandBuilder()
      .setName("resetinvites")
      .setDescription("Reset a user's invite stats to 0.")
      .addUserOption((opt) => opt.setName("user").setDescription("User").setRequired(true)),

    new SlashCommandBuilder()
      .setName("giveaway")
      .setDescription("Start a giveaway with a join button.")
      .addStringOption((opt) =>
        opt.setName("duration").setDescription("e.g. 30m, 1h, 2d").setRequired(true)
      )
      .addIntegerOption((opt) =>
        opt.setName("winners").setDescription("Number of winners").setRequired(true)
      )
      .addStringOption((opt) =>
        opt.setName("prize").setDescription("Prize name").setRequired(true)
      ),
  ].map((c) => c.toJSON());

  const rest = new REST({ version: "10" }).setToken(token);
  await rest.put(Routes.applicationGuildCommands(client.user.id, guildId), { body: commands });
  console.log("✅ Registered slash commands.");
}

client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  try {
    await registerSlashCommands();
  } catch (e) {
    console.error("❌ Slash command registration failed:", e.message);
  }

  try {
    const guild = client.guilds.cache.get(process.env.GUILD_ID);
    if (guild) await refreshInvitesForGuild(guild);
  } catch (e) {
    console.error("❌ Could not fetch invites (need Manage Server permission):", e.message);
  }

  try {
    const all = giveawayStore.giveaways || {};
    for (const gwId of Object.keys(all)) {
      const gw = all[gwId];
      if (gw && !gw.ended) scheduleGiveawayEnd(gwId);
    }
  } catch (e) {
    console.error("Failed to reschedule giveaways:", e.message);
  }
});

/* -------------------- TEXT COMMANDS -------------------- */
client.on("messageCreate", async (message) => {
  try {
    if (message.author.bot || !message.guild) return;
    if (!message.content.startsWith(PREFIX)) return;

    const cmd = message.content.slice(PREFIX.length).split(" ")[0].toLowerCase();
    const text = message.content.slice(PREFIX.length + cmd.length + 1);

    if (cmd === "embed") {
      if (!text || !text.trim()) return message.reply("Usage: `!embed <text>`");
      const embed = new EmbedBuilder().setDescription(text).setColor(0x2b2d31);
      return message.channel.send({ embeds: [embed] });
    }

    if (cmd === "ticketpanel") {
      if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        return message.reply("You need **Administrator** to post the ticket panel.");
      }

      const panelText =
        "🆘 | Help & Support Ticket\n" +
        "If you need help with anything, create a support ticket.\n\n" +
        "💰 | Claim Order\n" +
        "If you have placed an order and are waiting to receive it please open this ticket.\n\n" +
        "💸| Sell To us\n" +
        "Want to make some real cash of the donutsmp? Open a ticket and sell to us here.\n\n" +
        "🎁 | Claim Rewards Ticket\n" +
        "Looking to claim rewards, make this ticket.";

      const embed = new EmbedBuilder()
        .setTitle("Tickets")
        .setDescription(panelText)
        .setColor(0x2b2d31);

      const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("ticket_open_support").setLabel("Help & Support").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("ticket_open_claim").setLabel("Claim Order").setStyle(ButtonStyle.Success)
      );

      const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("ticket_open_sell").setLabel("Sell to Us").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("ticket_open_rewards").setLabel("Rewards").setStyle(ButtonStyle.Danger)
      );

      return message.channel.send({ embeds: [embed], components: [row1, row2] });
    }
  } catch (e) {
    console.error(e);
  }
});

/* -------------------- INTERACTIONS -------------------- */
client.on("interactionCreate", async (interaction) => {
  try {
    // Giveaway join button
    if (interaction.isButton() && interaction.customId.startsWith("gw_join:")) {
      const gwId = interaction.customId.split("gw_join:")[1];
      const gw = giveawayStore.giveaways[gwId];

      if (!gw) return interaction.reply({ content: "This giveaway no longer exists.", ephemeral: true });
      if (gw.ended) return interaction.reply({ content: "This giveaway already ended.", ephemeral: true });

      const userId = interaction.user.id;
      const idx = gw.entries.indexOf(userId);

      if (idx === -1) gw.entries.push(userId);
      else gw.entries.splice(idx, 1);

      saveGiveaways(giveawayStore);

      try {
        const channel = await client.channels.fetch(gw.channelId);
        const msg = await channel.messages.fetch(gw.messageId);

        await msg.edit({
          embeds: [makeGiveawayEmbed(gw)],
          components: [
            new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId(`gw_join:${gwId}`)
                .setEmoji("🎉")
                .setStyle(ButtonStyle.Primary)
            ),
          ],
        });
      } catch {}

      return interaction.reply({
        content: idx === -1 ? "✅ Entered the giveaway!" : "✅ Removed your entry.",
        ephemeral: true,
      });
    }

    // Ticket button -> show modal
    if (interaction.isButton() && interaction.guild && interaction.customId in ticketMap) {
      const info = ticketMap[interaction.customId];

      const modal = new ModalBuilder()
        .setCustomId(`ticket_modal:${interaction.customId}`)
        .setTitle(info.label);

      // NEW: Minecraft username (on top)
      const mcUser = new TextInputBuilder()
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
        new ActionRowBuilder().addComponents(mcUser),
        new ActionRowBuilder().addComponents(needInput)
      );

      return interaction.showModal(modal);
    }

    // Ticket modal submit -> create ticket
    if (interaction.isModalSubmit() && interaction.guild && interaction.customId.startsWith("ticket_modal:")) {
      const buttonId = interaction.customId.split("ticket_modal:")[1];
      if (!(buttonId in ticketMap)) return interaction.reply({ content: "Invalid ticket type.", ephemeral: true });

      await interaction.deferReply({ ephemeral: true });

      const guild = interaction.guild;
      const member = interaction.member;
      const info = ticketMap[buttonId];

      const mcName = interaction.fields.getTextInputValue("mc")?.trim() || "N/A";
      const needText = interaction.fields.getTextInputValue("need")?.trim() || "No details provided.";

      const category = await getOrCreateCategory(guild, info.category);

      const usernameSlug = cleanName(member.user.username) || member.user.id;
      const channelName = `${info.key}-${usernameSlug}`.slice(0, 90);

      const existing = guild.channels.cache.find(
        (c) => c.type === ChannelType.GuildText && c.name === channelName && c.parentId === category.id
      );
      if (existing) return interaction.editReply({ content: `You already have this ticket open: ${existing}` });

      const overwrites = [
        { id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
        {
          id: member.user.id,
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.ReadMessageHistory,
          ],
        },
        ...STAFF_ROLE_IDS.map((roleId) => ({
          id: roleId,
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.ReadMessageHistory,
          ],
        })),
      ];

      const channel = await guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        parent: category.id,
        topic: `${info.label} (${member.user.username}) | opener:${member.user.id}`,
        permissionOverwrites: overwrites,
      });

      const detailsEmbed = new EmbedBuilder()
        .setTitle(`${info.label} (${member.user.username})`)
        .addFields(
          { name: "Minecraft Username", value: mcName.slice(0, 64), inline: true },
          { name: "Discord User", value: `${member.user.tag}`, inline: true },
          { name: "What they need", value: needText.slice(0, 1024) || "(no text)", inline: false }
        )
        .setColor(0x2b2d31);

      await channel.send({ content: `${member}`, embeds: [detailsEmbed] });
      return interaction.editReply({ content: `✅ Ticket created: ${channel}` });
    }

    // Slash commands
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === "giveaway") {
        const me = await interaction.guild.members.fetch(interaction.user.id);
        const isStaff =
          STAFF_ROLE_IDS.some((rid) => me.roles.cache.has(rid)) ||
          me.permissions.has(PermissionsBitField.Flags.Administrator) ||
          me.permissions.has(PermissionsBitField.Flags.ManageGuild);

        if (!isStaff) return interaction.reply({ content: "No permission.", ephemeral: true });

        const durationStr = interaction.options.getString("duration", true);
        const winners = interaction.options.getInteger("winners", true);
        const prize = interaction.options.getString("prize", true).trim();

        const ms = parseDurationToMs(durationStr);
        if (!ms) return interaction.reply({ content: "Invalid duration. Use 30m, 1h, 2d, etc.", ephemeral: true });
        if (winners < 1) return interaction.reply({ content: "Winners must be at least 1.", ephemeral: true });
        if (!prize) return interaction.reply({ content: "Prize cannot be empty.", ephemeral: true });

        const endsAt = Date.now() + ms;
        const gwId = `${Date.now()}_${Math.random().toString(16).slice(2)}`;

        const gw = {
          id: gwId,
          guildId: interaction.guild.id,
          channelId: interaction.channel.id,
          messageId: null,
          prize,
          winners,
          hostId: interaction.user.id,
          endsAt,
          entries: [],
          ended: false,
        };

        const embed = makeGiveawayEmbed(gw);
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`gw_join:${gwId}`).setEmoji("🎉").setStyle(ButtonStyle.Primary)
        );

        const msg = await interaction.reply({ embeds: [embed], components: [row], fetchReply: true });

        gw.messageId = msg.id;
        giveawayStore.giveaways[gwId] = gw;
        saveGiveaways(giveawayStore);

        scheduleGiveawayEnd(gwId);
        return;
      }

      if (interaction.commandName === "close") {
        const channel = interaction.channel;
        if (!isTicketChannel(channel)) {
          return interaction.reply({ content: "Use **/close** inside a ticket channel.", ephemeral: true });
        }

        const openerId = getOpenerIdFromTopic(channel.topic);
        if (!openerId) {
          return interaction.reply({ content: "Can't find the ticket opener.", ephemeral: true });
        }

        const reason = interaction.options.getString("reason", true);

        const member = await interaction.guild.members.fetch(interaction.user.id);
        const isOpener = interaction.user.id === openerId;
        const isStaff =
          STAFF_ROLE_IDS.some((rid) => member.roles.cache.has(rid)) ||
          member.permissions.has(PermissionsBitField.Flags.Administrator) ||
          member.permissions.has(PermissionsBitField.Flags.ManageChannels);

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

      if (interaction.commandName === "invites") {
        const user = interaction.options.getUser("user", true);
        const still = stillInServerCount(user.id);
        return interaction.reply({ content: `📨 **${user.tag}** has **${still}** invites still in the server.` });
      }

      if (interaction.commandName === "addinvites") {
        const me = await interaction.guild.members.fetch(interaction.user.id);
        const isStaff =
          STAFF_ROLE_IDS.some((rid) => me.roles.cache.has(rid)) ||
          me.permissions.has(PermissionsBitField.Flags.Administrator) ||
          me.permissions.has(PermissionsBitField.Flags.ManageGuild);

        if (!isStaff) return interaction.reply({ content: "No permission.", ephemeral: true });

        const user = interaction.options.getUser("user", true);
        const amount = interaction.options.getInteger("amount", true);

        const s = ensureInviter(user.id);
        s.manual += amount;
        saveInvitesData(invitesData);

        const still = stillInServerCount(user.id);
        return interaction.reply({ content: `✅ Added **${amount}** to **${user.tag}**. Now: **${still}** invites still in server.` });
      }

      if (interaction.commandName === "resetinvites") {
        const me = await interaction.guild.members.fetch(interaction.user.id);
        const isStaff =
          STAFF_ROLE_IDS.some((rid) => me.roles.cache.has(rid)) ||
          me.permissions.has(PermissionsBitField.Flags.Administrator) ||
          me.permissions.has(PermissionsBitField.Flags.ManageGuild);

        if (!isStaff) return interaction.reply({ content: "No permission.", ephemeral: true });

        const user = interaction.options.getUser("user", true);
        invitesData.inviterStats[user.id] = { joins: 0, rejoins: 0, left: 0, manual: 0 };
        saveInvitesData(invitesData);

        return interaction.reply({ content: `✅ Reset invite stats for **${user.tag}**.` });
      }
    }
  } catch (e) {
    console.error(e);
  }
});

/* -------------------- INVITE JOIN/LEAVE -------------------- */
client.on("guildMemberAdd", async (member) => {
  try {
    const guild = member.guild;
    const before = invitesCache.get(guild.id) || new Map();

    const invites = await guild.invites.fetch();
    let usedInvite = null;

    for (const inv of invites.values()) {
      const prevUses = before.get(inv.code) ?? 0;
      const nowUses = inv.uses ?? 0;
      if (nowUses > prevUses) {
        usedInvite = inv;
        break;
      }
    }

    const afterMap = new Map();
    invites.forEach((inv) => afterMap.set(inv.code, inv.uses ?? 0));
    invitesCache.set(guild.id, afterMap);

    if (!usedInvite || !usedInvite.inviter) return;

    const inviterId = usedInvite.inviter.id;
    const s = ensureInviter(inviterId);

    if (invitesData.memberInviter[member.id]) s.rejoins += 1;
    else s.joins += 1;

    invitesData.memberInviter[member.id] = inviterId;
    saveInvitesData(invitesData);
  } catch (e) {
    console.error("Invite tracking (join) failed:", e.message);
  }
});

client.on("guildMemberRemove", async (member) => {
  try {
    const inviterId = invitesData.memberInviter[member.id];
    if (!inviterId) return;

    const s = ensureInviter(inviterId);
    s.left += 1;

    saveInvitesData(invitesData);
  } catch (e) {
    console.error("Invite tracking (leave) failed:", e.message);
  }
});

client.login(process.env.TOKEN);
