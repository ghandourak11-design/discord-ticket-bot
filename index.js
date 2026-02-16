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
} = require("discord.js");

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.Channel],
});

const PREFIX = "!";
const TICKET_CATEGORY_NAME = "Tickets";

// Maps button IDs -> ticket type config
const ticketMap = {
  ticket_open_sell: { key: "sell-to-us", label: "Sell to Us" },
  ticket_open_claim: { key: "claim-order", label: "Claim Order" },
  ticket_open_rewards: { key: "rewards", label: "Rewards" },
  ticket_open_support: { key: "help-support", label: "Help & Support" },
};

// Makes a safe channel-name piece from username
function cleanName(str) {
  return (str || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 24);
}

client.once("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

client.on("messageCreate", async (message) => {
  if (message.author.bot || !message.guild) return;
  if (!message.content.startsWith(PREFIX)) return;

  // Preserve formatting/newlines by NOT splitting on whitespace
  const cmd = message.content.slice(PREFIX.length).split(" ")[0].toLowerCase();
  const text = message.content.slice(PREFIX.length + cmd.length + 1); // everything after command, exactly

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

    const embed = new EmbedBuilder()
      .setTitle("Support Tickets")
      .setDescription("Choose what you need help with below:")
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
  if (!interaction.isButton() || !interaction.guild) return;

  // OPEN TICKET (4 types)
  if (interaction.customId in ticketMap) {
    await interaction.deferReply({ ephemeral: true });

    const guild = interaction.guild;
    const member = interaction.member;
    const info = ticketMap[interaction.customId];

    // Find/create category
    let category = guild.channels.cache.find(
      (c) => c.type === ChannelType.GuildCategory && c.name === TICKET_CATEGORY_NAME
    );

    if (!category) {
      category = await guild.channels.create({
        name: TICKET_CATEGORY_NAME,
        type: ChannelType.GuildCategory,
      });
    }

    // Ticket channel name: ticket-type-username (Discord channels can't have spaces/parentheses)
    const usernameSlug = cleanName(member.user.username) || member.user.id;
    const channelName = `${info.key}-${usernameSlug}`.slice(0, 90);

    // Prevent duplicates of same type per user
    const existing = guild.channels.cache.find(
      (c) => c.type === ChannelType.GuildText && c.name === channelName
    );
    if (existing) {
      return interaction.editReply({ content: `You already have this ticket open: ${existing}` });
    }

    const channel = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: category.id,
      topic: `${info.label} (${member.user.username})`,
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

    const closeRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("ticket_close").setLabel("Close Ticket").setStyle(ButtonStyle.Danger)
    );

    const intro = new EmbedBuilder()
      .setTitle(`${info.label} (${member.user.username})`)
      .setDescription(`Hey ${member}, explain what you need and we’ll help you ASAP.`)
      .setColor(0x2b2d31);

    await channel.send({ content: `${member}`, embeds: [intro], components: [closeRow] });
    return interaction.editReply({ content: `✅ Ticket created: ${channel}` });
  }

  // CLOSE TICKET
  if (interaction.customId === "ticket_close") {
    const channel = interaction.channel;

    // Basic safety: only close inside ticket channels
    if (!channel || channel.type !== ChannelType.GuildText) {
      return interaction.reply({ content: "This isn't a ticket channel.", ephemeral: true });
    }

    await interaction.reply({ content: "Closing ticket in 3 seconds...", ephemeral: true });
    setTimeout(() => channel.delete().catch(() => {}), 3000);
  }
});

client.login(process.env.TOKEN);
