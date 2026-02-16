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
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

const PREFIX = "!";
const TICKET_CATEGORY_NAME = "Tickets";
const TICKET_PREFIX = "ticket-";

client.once("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

client.on("messageCreate", async (message) => {
  if (message.author.bot || !message.guild) return;
  if (!message.content.startsWith(PREFIX)) return;

const cmd = message.content.slice(PREFIX.length).split(" ")[0];
const text = message.content.slice(PREFIX.length + cmd.length + 1);

  if (cmd === "embed") {
    if (!text) return message.reply("Usage: `!embed <text>`");

    const embed = new EmbedBuilder()
      .setDescription(text)
      .setColor(0x2b2d31);

    return message.channel.send({ embeds: [embed] });
  }

  if (cmd === "ticketpanel") {
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return message.reply("You need **Administrator** to post the ticket panel.");
    }

    const embed = new EmbedBuilder()
      .setTitle("Support Tickets")
      .setDescription("Click the button below to open a ticket.")
      .setColor(0x2b2d31);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("ticket_open")
        .setLabel("Open Ticket")
        .setStyle(ButtonStyle.Primary)
    );

    return message.channel.send({ embeds: [embed], components: [row] });
  }
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isButton() || !interaction.guild) return;

  if (interaction.customId === "ticket_open") {
    await interaction.deferReply({ ephemeral: true });

    const guild = interaction.guild;
    const member = interaction.member;

    let category = guild.channels.cache.find(
      (c) => c.type === ChannelType.GuildCategory && c.name === TICKET_CATEGORY_NAME
    );

    if (!category) {
      category = await guild.channels.create({
        name: TICKET_CATEGORY_NAME,
        type: ChannelType.GuildCategory,
      });
    }

    const existing = guild.channels.cache.find(
      (c) => c.type === ChannelType.GuildText && c.name === `${TICKET_PREFIX}${member.user.id}`
    );
    if (existing) {
      return interaction.editReply({ content: `You already have a ticket: ${existing}` });
    }

    const channel = await guild.channels.create({
      name: `${TICKET_PREFIX}${member.user.id}`,
      type: ChannelType.GuildText,
      parent: category.id,
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
      new ButtonBuilder()
        .setCustomId("ticket_close")
        .setLabel("Close Ticket")
        .setStyle(ButtonStyle.Danger)
    );

    const intro = new EmbedBuilder()
      .setTitle("Ticket Opened")
      .setDescription(`Hey ${member}, describe your issue here.\nA staff member will reply soon.`)
      .setColor(0x2b2d31);

    await channel.send({ content: `${member}`, embeds: [intro], components: [closeRow] });
    return interaction.editReply({ content: `✅ Ticket created: ${channel}` });
  }

  if (interaction.customId === "ticket_close") {
    const channel = interaction.channel;

    if (!channel.name.startsWith(TICKET_PREFIX)) {
      return interaction.reply({ content: "This isn't a ticket channel.", ephemeral: true });
    }

    await interaction.reply({ content: "Closing ticket in 3 seconds...", ephemeral: true });
    setTimeout(() => channel.delete().catch(() => {}), 3000);
  }
});

client.login(process.env.TOKEN);

