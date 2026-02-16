require("dotenv").config();
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

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

const PREFIX = "!";

// EXACT category names you asked for
const CATEGORIES = {
  SELL: "Sell to Us",
  SUPPORT: "Help & Support",
  CLAIM: "Claim Order",
  REWARDS: "Rewards",
};

// Buttons -> ticket type config (each points to a different category)
const ticketMap = {
  ticket_open_sell: { key: "sell-to-us", label: "Sell to Us", category: CATEGORIES.SELL },
  ticket_open_claim: { key: "claim-order", label: "Claim Order", category: CATEGORIES.CLAIM },
  ticket_open_rewards: { key: "rewards", label: "Rewards", category: CATEGORIES.REWARDS },
  ticket_open_support: { key: "help-support", label: "Help & Support", category: CATEGORIES.SUPPORT },
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
    category = await guild.channels.create({
      name: categoryName,
      type: ChannelType.GuildCategory,
    });
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

async function registerSlashCommands() {
  const token = process.env.TOKEN;
  const guildId = process.env.GUILD_ID;

  if (!token) throw new Error("Missing TOKEN env var.");
  if (!guildId) throw new Error("Missing GUILD_ID env var (needed to register /close).");

  const commands = [
    new SlashCommandBuilder()
      .setName("close")
      .setDescription("Close this ticket and DM the opener the reason.")
      .addStringOption((opt) =>
        opt
          .setName("reason")
          .setDescription("Reason for closing (will be DM'd to the ticket opener)")
          .setRequired(true)
      )
      .toJSON(),
  ];

  const rest = new REST({ version: "10" }).setToken(token);
  await rest.put(Routes.applicationGuildCommands(client.user.id, guildId), { body: commands });
  console.log("✅ Registered slash commands (/close) for this server.");
}

client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  try {
    await registerSlashCommands();
  } catch (e) {
    console.error("❌ Slash command registration failed:", e.message);
  }
});

client.on("messageCreate", async (message) => {
  if (message.author.bot || !message.guild) return;
  if (!message.content.startsWith(PREFIX)) return;

  // Preserve formatting/newlines for !embed
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

    const embed = new EmbedBuilder()
      .setTitle("Tickets")
      .setDescription("Choose what you need below:")
      .setColor(0x2b2d31);

    const row1 = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("ticket_open_sell").setLabel("Sell to Us").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("ticket_open_claim").setLabel("Claim Order").setStyle(ButtonStyle.Success)
    );

    const row2 = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("ticket_open_rewards").setLabel("Rewards").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("ticket_open_support").setLabel("Help & Support").setStyle(ButtonStyle.Danger)
    );

    return message.channel.send({ embeds: [embed], components: [row1, row2] });
  }
});

client.on("interactionCreate", async (interaction) => {
  // ✅ Button ticket creation
  if (interaction.isButton() && interaction.guild) {
    if (!(interaction.customId in ticketMap)) return;

    await interaction.deferReply({ ephemeral: true });

    const guild = interaction.guild;
    const member = interaction.member;
    const info = ticketMap[interaction.customId];

    // Use your exact category names (auto-create if missing)
    const category = await getOrCreateCategory(guild, info.category);

    const usernameSlug = cleanName(member.user.username) || member.user.id;
    const channelName = `${info.key}-${usernameSlug}`.slice(0, 90);

    // Prevent duplicate of same ticket type per user in that category
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

    const intro = new EmbedBuilder()
      .setTitle(`${info.label} (${member.user.username})`)
      .setDescription(`Explain what you need.\nClose with: **/close reason:<your reason>**`)
      .setColor(0x2b2d31);

    await channel.send({ content: `${member}`, embeds: [intro] });
    return interaction.editReply({ content: `✅ Ticket created: ${channel}` });
  }

  // ✅ Slash command: /close reason:<text>
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

    // DM the opener the reason
    try {
      const openerUser = await client.users.fetch(openerId);
      await openerUser.send(
        `Your ticket **${channel.name}** was closed by **${interaction.user.tag}**.\nReason: ${reason}`
      );
    } catch {
      // If DMs are closed, ignore
    }

    await interaction.reply({ content: "Closing ticket in 3 seconds...", ephemeral: true });
    setTimeout(() => channel.delete().catch(() => {}), 3000);
  }
});

client.login(process.env.TOKEN);
