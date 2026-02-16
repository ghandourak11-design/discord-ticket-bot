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
} = require("discord.js");

/* -------------------- INVITE DATA (simple JSON) -------------------- */
const DATA_FILE = path.join(__dirname, "invites_data.json");

function loadData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch {
    return {
      inviterStats: {}, // inviterId -> { joins, rejoins, left, manual }
      memberInviter: {}, // memberId -> inviterId
    };
  }
}
function saveData(d) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(d, null, 2));
  } catch (e) {
    console.error("Failed to save data:", e.message);
  }
}
const data = loadData();

/* -------------------- CLIENT -------------------- */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers, // invite tracking + join/leave
  ],
  partials: [Partials.Channel],
});

const PREFIX = "!";

/* -------------------- TICKET SETUP -------------------- */
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

/**
 * We’ll track which channels are waiting for "What do you need?" answers
 * so we don’t create multiple collectors.
 */
const pendingNeedAnswer = new Set();

/* -------------------- INVITE TRACKING -------------------- */
const invitesCache = new Map(); // guildId -> Map(inviteCode -> uses)

async function refreshInvitesForGuild(guild) {
  const invites = await guild.invites.fetch();
  const map = new Map();
  invites.forEach((inv) => map.set(inv.code, inv.uses ?? 0));
  invitesCache.set(guild.id, map);
  return invites;
}

function ensureInviter(inviterId) {
  if (!data.inviterStats[inviterId]) {
    data.inviterStats[inviterId] = { joins: 0, rejoins: 0, left: 0, manual: 0 };
  } else {
    data.inviterStats[inviterId].joins ??= 0;
    data.inviterStats[inviterId].rejoins ??= 0;
    data.inviterStats[inviterId].left ??= 0;
    data.inviterStats[inviterId].manual ??= 0;
  }
  return data.inviterStats[inviterId];
}

function stillInServerCount(userId) {
  const s = ensureInviter(userId);
  const base = (s.joins || 0) + (s.rejoins || 0) - (s.left || 0);
  return Math.max(0, base + (s.manual || 0));
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
  ].map((c) => c.toJSON());

  const rest = new REST({ version: "10" }).setToken(token);
  await rest.put(Routes.applicationGuildCommands(client.user.id, guildId), { body: commands });
  console.log("✅ Registered slash commands (/close, /invites, /addinvites, /resetinvites).");
}

client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  try {
    await registerSlashCommands();
  } catch (e) {
    console.error("❌ Slash command registration failed:", e.message);
  }

  // Prime invites cache
  try {
    const guild = client.guilds.cache.get(process.env.GUILD_ID);
    if (guild) await refreshInvitesForGuild(guild);
  } catch (e) {
    console.error("❌ Could not fetch invites (need Manage Server permission):", e.message);
  }
});

/* -------------------- TEXT COMMANDS -------------------- */
client.on("messageCreate", async (message) => {
  try {
    if (message.author.bot || !message.guild) return;
    if (!message.content.startsWith(PREFIX)) return;

    const cmd = message.content.slice(PREFIX.length).split(" ")[0].toLowerCase();
    const text = message.content.slice(PREFIX.length + cmd.length + 1); // preserve formatting

    // !embed <text>
    if (cmd === "embed") {
      if (!text || !text.trim()) return message.reply("Usage: `!embed <text>`");
      const embed = new EmbedBuilder().setDescription(text).setColor(0x2b2d31);
      return message.channel.send({ embeds: [embed] });
    }

    // !ticketpanel
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
    /* -------- Buttons -> Create Ticket + Ask "What do you need?" -------- */
    if (interaction.isButton() && interaction.guild) {
      if (!(interaction.customId in ticketMap)) return;

      await interaction.deferReply({ ephemeral: true });

      const guild = interaction.guild;
      const member = interaction.member;
      const info = ticketMap[interaction.customId];

      const category = await getOrCreateCategory(guild, info.category);

      const usernameSlug = cleanName(member.user.username) || member.user.id;
      const channelName = `${info.key}-${usernameSlug}`.slice(0, 90);

      // Prevent duplicates per type per user inside that category
      const existing = guild.channels.cache.find(
        (c) =>
          c.type === ChannelType.GuildText &&
          c.name === channelName &&
          c.parentId === category.id
      );
      if (existing) {
        return interaction.editReply({ content: `You already have this ticket open: ${existing}` });
      }

      const channel = await guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        parent: category.id,
        topic: `${info.label} (${member.user.username}) | opener:${member.user.id}`,
        permissionOverwrites: [
          { id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
          {
            id: member.user.id,
            allow: [
              PermissionsBitField.Flags.ViewChannel,
              PermissionsBitField.Flags.SendMessages,
              PermissionsBitField.Flags.ReadMessageHistory,
            ],
          },
        ],
      });

      // Ask question
      const askEmbed = new EmbedBuilder()
        .setTitle(`${info.label} (${member.user.username})`)
        .setDescription("**What do you need?**\nReply in this channel with your answer.")
        .setColor(0x2b2d31);

      await channel.send({ content: `${member}`, embeds: [askEmbed] });

      // Set up collector for ONE answer from opener
      pendingNeedAnswer.add(channel.id);

      const filter = (m) => m.author.id === member.user.id && m.channel.id === channel.id;
      const collector = channel.createMessageCollector({ filter, max: 1, time: 5 * 60 * 1000 });

      collector.on("collect", async (m) => {
        // Post their answer into an embed
        const answerEmbed = new EmbedBuilder()
          .setTitle("Ticket Details")
          .addFields(
            { name: "User", value: `${member.user.tag}`, inline: true },
            { name: "Type", value: info.label, inline: true },
            { name: "What they need", value: m.content.slice(0, 1024) || "(no text)", inline: false }
          )
          .setColor(0x2b2d31);

        await channel.send({ embeds: [answerEmbed] });
        pendingNeedAnswer.delete(channel.id);
      });

      collector.on("end", async (collected) => {
        if (collected.size === 0 && pendingNeedAnswer.has(channel.id)) {
          pendingNeedAnswer.delete(channel.id);
          await channel.send("⏰ No answer received. If you still need help, type your message here anyway.");
        }
      });

      return interaction.editReply({ content: `✅ Ticket created: ${channel}` });
    }

    /* -------- /close reason:<text> -------- */
    if (interaction.isChatInputCommand() && interaction.commandName === "close") {
      if (!interaction.guild) return;

      const channel = interaction.channel;
      if (!isTicketChannel(channel)) {
        return interaction.reply({ content: "Use **/close** inside a ticket channel.", ephemeral: true });
      }

      const openerId = getOpenerIdFromTopic(channel.topic);
      if (!openerId) {
        return interaction.reply({ content: "Can't find the ticket opener for this channel.", ephemeral: true });
      }

      const reason = interaction.options.getString("reason", true);

      const member = await interaction.guild.members.fetch(interaction.user.id);
      const isOpener = interaction.user.id === openerId;
      const isStaff =
        member.permissions.has(PermissionsBitField.Flags.Administrator) ||
        member.permissions.has(PermissionsBitField.Flags.ManageChannels);

      if (!isOpener && !isStaff) {
        return interaction.reply({ content: "Only the ticket opener or staff can close this ticket.", ephemeral: true });
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

    /* -------- /invites user:<user>  (regular message, only still-in-server count) -------- */
    if (interaction.isChatInputCommand() && interaction.commandName === "invites") {
      const user = interaction.options.getUser("user", true);
      const still = stillInServerCount(user.id);
      return interaction.reply({
        content: `📨 **${user.tag}** has **${still}** invites still in the server.`,
      });
    }

    /* -------- /addinvites user amount  (staff-only) -------- */
    if (interaction.isChatInputCommand() && interaction.commandName === "addinvites") {
      const member = await interaction.guild.members.fetch(interaction.user.id);
      const isStaff =
        member.permissions.has(PermissionsBitField.Flags.Administrator) ||
        member.permissions.has(PermissionsBitField.Flags.ManageGuild);

      if (!isStaff) return interaction.reply({ content: "No permission.", ephemeral: true });

      const user = interaction.options.getUser("user", true);
      const amount = interaction.options.getInteger("amount", true);

      const stats = ensureInviter(user.id);
      stats.manual += amount;
      saveData(data);

      const still = stillInServerCount(user.id);
      return interaction.reply({
        content: `✅ Added **${amount}** to **${user.tag}**. Now: **${still}** invites still in server.`,
      });
    }

    /* -------- /resetinvites user  (staff-only) -------- */
    if (interaction.isChatInputCommand() && interaction.commandName === "resetinvites") {
      const member = await interaction.guild.members.fetch(interaction.user.id);
      const isStaff =
        member.permissions.has(PermissionsBitField.Flags.Administrator) ||
        member.permissions.has(PermissionsBitField.Flags.ManageGuild);

      if (!isStaff) return interaction.reply({ content: "No permission.", ephemeral: true });

      const user = interaction.options.getUser("user", true);

      data.inviterStats[user.id] = { joins: 0, rejoins: 0, left: 0, manual: 0 };
      saveData(data);

      return interaction.reply({ content: `✅ Reset invite stats for **${user.tag}**.` });
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

    // Refresh cache
    const afterMap = new Map();
    invites.forEach((inv) => afterMap.set(inv.code, inv.uses ?? 0));
    invitesCache.set(guild.id, afterMap);

    if (!usedInvite || !usedInvite.inviter) return;

    const inviterId = usedInvite.inviter.id;
    const s = ensureInviter(inviterId);

    // Rejoin if we've ever seen this member before
    if (data.memberInviter[member.id]) s.rejoins += 1;
    else s.joins += 1;

    data.memberInviter[member.id] = inviterId;
    saveData(data);
  } catch (e) {
    console.error("Invite tracking (join) failed:", e.message);
  }
});

client.on("guildMemberRemove", async (member) => {
  try {
    const inviterId = data.memberInviter[member.id];
    if (!inviterId) return;

    const s = ensureInviter(inviterId);
    s.left += 1;

    // Keep mapping so re-joins count as rejoins
    saveData(data);
  } catch (e) {
    console.error("Invite tracking (leave) failed:", e.message);
  }
});

client.login(process.env.TOKEN);
