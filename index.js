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
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");

/* -------------------- CONFIG -------------------- */

const PREFIX = "!";
const VOUCHES_CHANNEL_ID = "1455198053546983454";
const JOIN_LOG_CHANNEL_ID = "1461947323541225704";

const STAFF_ROLE_IDS = [
  "1465888170531881123",
  "1457184344538874029",
  "1456504229148758229",
  "1464012365472337990",
];

const AUTOMOD_ROLE_NAME = "automod";

/* Sticky storage (in-memory per channel)
   channelId -> { content: string, messageId: string|null }
*/
const stickyByChannel = new Map();

/* Invite cache: guildId -> Map(inviteCode -> uses) */
const invitesCache = new Map();
/* Per-inviter invite totals (inviterId -> total uses across their invites) */
const inviterUses = new Map();

/* -------------------- CLIENT -------------------- */

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildInvites,
  ],
  partials: [Partials.Channel],
});

/* -------------------- UTILS -------------------- */

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
  const discordInviteRegex = /(discord\.gg\/\S+)|(discord\.com\/invite\/\S+)/i;
  return urlRegex.test(content) || discordInviteRegex.test(content);
}

async function ensureAutoModRole(guild) {
  let role = guild.roles.cache.find((r) => r.name.toLowerCase() === AUTOMOD_ROLE_NAME);

  if (!role) {
    const me = await guild.members.fetchMe();
    if (!me.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
      console.log(`❌ Missing Manage Roles in ${guild.name}. Can't create automod role.`);
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
  }

  return role;
}

async function refreshGuildInvites(guild) {
  const invites = await guild.invites.fetch();

  const map = new Map();
  invites.forEach((inv) => map.set(inv.code, inv.uses ?? 0));
  invitesCache.set(guild.id, map);

  const totals = new Map();
  invites.forEach((inv) => {
    if (!inv.inviter) return;
    totals.set(inv.inviter.id, (totals.get(inv.inviter.id) || 0) + (inv.uses ?? 0));
  });
  totals.forEach((v, k) => inviterUses.set(k, v));
}

function getInviterTotalInvites(inviterId) {
  return inviterUses.get(inviterId) || 0;
}

// Parse a user from mention or raw ID
function parseUserId(arg) {
  if (!arg) return null;
  const mentionMatch = arg.match(/^<@!?(\d{10,25})>$/);
  if (mentionMatch) return mentionMatch[1];
  const idMatch = arg.match(/^(\d{10,25})$/);
  if (idMatch) return idMatch[1];
  return null;
}

/* -------------------- READY -------------------- */

client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  for (const guild of client.guilds.cache.values()) {
    try {
      await ensureAutoModRole(guild);
    } catch (e) {
      console.log(`❌ Failed to ensure automod role in ${guild.name}: ${e.message}`);
    }

    try {
      await refreshGuildInvites(guild);
      console.log(`✅ Loaded invites for ${guild.name}`);
    } catch (e) {
      console.log(
        `⚠️ Couldn't load invites for ${guild.name}. Give bot "Manage Server" to track inviters. (${e.message})`
      );
    }
  }
});

/* -------------------- INVITE TRACKING EVENTS -------------------- */

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
    const before = invitesCache.get(guild.id);

    const logChannel = await guild.channels.fetch(JOIN_LOG_CHANNEL_ID).catch(() => null);
    if (!logChannel || logChannel.type !== ChannelType.GuildText) return;

    // If we can't read invites, log join without inviter
    if (!before) {
      logChannel.send(`${member} joined. (Couldn't detect inviter — missing invite permissions)`).catch(() => {});
      return;
    }

    const invites = await guild.invites.fetch();

    let used = null;
    invites.forEach((inv) => {
      const prev = before.get(inv.code) ?? 0;
      const now = inv.uses ?? 0;
      if (now > prev && !used) used = inv;
    });

    // Refresh cache + totals
    const after = new Map();
    invites.forEach((inv) => after.set(inv.code, inv.uses ?? 0));
    invitesCache.set(guild.id, after);

    const totals = new Map();
    invites.forEach((inv) => {
      if (!inv.inviter) return;
      totals.set(inv.inviter.id, (totals.get(inv.inviter.id) || 0) + (inv.uses ?? 0));
    });
    totals.forEach((v, k) => inviterUses.set(k, v));

    if (!used || !used.inviter) {
      logChannel.send(`${member} has been invited by **Unknown** and now has **0** invites.`).catch(() => {});
      return;
    }

    const inviter = used.inviter;
    const totalInvites = getInviterTotalInvites(inviter.id);

    logChannel
      .send(`${member} has been invited by ${inviter} and now has **${totalInvites}** invites.`)
      .catch(() => {});
  } catch (e) {
    console.log("Invite join logging error:", e.message);
  }
});

/* -------------------- MESSAGE HANDLER (LINK BLOCK + COMMANDS + STICKY) -------------------- */

client.on("messageCreate", async (message) => {
  try {
    if (!message.guild || message.author.bot) return;

    // ---- LINK BLOCKER ----
    if (containsLink(message.content)) {
      const member = message.member;

      if (member) {
        const isAdmin = member.permissions.has(PermissionsBitField.Flags.Administrator);

        const automodRole = message.guild.roles.cache.find(
          (r) => r.name.toLowerCase() === AUTOMOD_ROLE_NAME
        );
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

    // ---- COMMANDS (ADMIN ONLY) ----
    if (message.content.startsWith(PREFIX)) {
      if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        return; // only admins can run any ! command
      }

      const parts = message.content.slice(PREFIX.length).trim().split(/\s+/);
      const cmd = (parts.shift() || "").toLowerCase();
      const text = message.content.slice(PREFIX.length + cmd.length + 1);
      const arg1 = parts[0];

      // !embed <text>
      if (cmd === "embed") {
        if (!text || !text.trim()) return message.reply("Usage: `!embed <text>`");
        const embed = new EmbedBuilder().setDescription(text).setColor(0x2b2d31);
        await message.channel.send({ embeds: [embed] });
      }

      // !vouches
      if (cmd === "vouches") {
        const channel = await message.guild.channels.fetch(VOUCHES_CHANNEL_ID).catch(() => null);
        if (!channel || channel.type !== ChannelType.GuildText) {
          await message.reply("Couldn't find the vouches channel.");
        } else {
          let total = 0;
          let lastId;

          while (true) {
            const messages = await channel.messages.fetch({ limit: 100, before: lastId });
            total += messages.size;
            if (messages.size < 100) break;
            lastId = messages.last().id;
          }

          await message.channel.send(`This server has **${total}** vouches.`);
        }
      }

      // !ticketpanel
      if (cmd === "ticketpanel") {
        const embed = new EmbedBuilder()
          .setTitle("Tickets")
          .setDescription(
            "🆘 | Help & Support Ticket\n" +
              "If you need help with anything, create a support ticket.\n\n" +
              "💰 | Claim Order\n" +
              "If you have placed an order and are waiting to receive it please open this ticket.\n\n" +
              "💸| Sell To us\n" +
              "Want to make some real cash of the donutsmp? Open a ticket and sell to us here.\n\n" +
              "🎁 | Claim Rewards Ticket\n" +
              "Looking to claim rewards, make this ticket."
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

      // !stick <message>
      if (cmd === "stick") {
        if (!text || !text.trim()) return message.reply("Usage: `!stick <message>`");

        const existing = stickyByChannel.get(message.channel.id);
        if (existing?.messageId) {
          await message.channel.messages.delete(existing.messageId).catch(() => {});
        }

        const sent = await message.channel.send(text);
        stickyByChannel.set(message.channel.id, { content: text, messageId: sent.id });
        await message.reply("✅ Sticky set for this channel.");
      }

      // !unstick
      if (cmd === "unstick") {
        const existing = stickyByChannel.get(message.channel.id);
        if (existing?.messageId) {
          await message.channel.messages.delete(existing.messageId).catch(() => {});
        }
        stickyByChannel.delete(message.channel.id);
        await message.reply("✅ Sticky removed for this channel.");
      }

      // !ban <user>
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

      // !kick <user>
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

      // !purge <amount> (deletes amount + command itself)
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

    // ---- STICKY BEHAVIOR (after every message) ----
    const sticky = stickyByChannel.get(message.channel.id);
    if (sticky) {
      if (sticky.messageId && message.id === sticky.messageId) return;

      if (sticky.messageId) {
        await message.channel.messages.delete(sticky.messageId).catch(() => {});
      }

      const sent = await message.channel.send(sticky.content);
      stickyByChannel.set(message.channel.id, { content: sticky.content, messageId: sent.id });
    }
  } catch (e) {
    console.error(e);
  }
});

/* -------------------- INTERACTIONS (TICKETS) -------------------- */

client.on("interactionCreate", async (interaction) => {
  try {
    // Ticket button -> Modal
    if (interaction.isButton() && interaction.customId.startsWith("ticket_")) {
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

    // Ticket modal submit -> Create ticket
    if (interaction.isModalSubmit() && interaction.customId.startsWith("ticket_modal:")) {
      await interaction.deferReply({ ephemeral: true });

      const type = interaction.customId.split(":")[1];
      const mc = interaction.fields.getTextInputValue("mc")?.trim() || "N/A";
      const need = interaction.fields.getTextInputValue("need")?.trim() || "N/A";

      const categoryName =
        type === "ticket_support"
          ? "Help & Support"
          : type === "ticket_claim"
          ? "Claim Order"
          : type === "ticket_sell"
          ? "Sell to Us"
          : "Rewards";

      let category = interaction.guild.channels.cache.find(
        (c) => c.type === ChannelType.GuildCategory && c.name === categoryName
      );

      if (!category) {
        category = await interaction.guild.channels.create({
          name: categoryName,
          type: ChannelType.GuildCategory,
        });
      }

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
        ...STAFF_ROLE_IDS.map((roleId) => ({
          id: roleId,
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.ReadMessageHistory,
          ],
        })),
      ];

      const channel = await interaction.guild.channels.create({
        name: `${cleanName(type)}-${cleanName(interaction.user.username)}`,
        type: ChannelType.GuildText,
        parent: category.id,
        permissionOverwrites: overwrites,
        topic: `opener:${interaction.user.id}`,
      });

      const embed = new EmbedBuilder()
        .setTitle("Ticket Created")
        .addFields(
          { name: "Minecraft Username", value: mc.slice(0, 64), inline: true },
          { name: "User", value: interaction.user.tag, inline: true },
          { name: "What They Need", value: need.slice(0, 1024), inline: false }
        )
        .setColor(0x2b2d31);

      await channel.send({ content: `${interaction.user}`, embeds: [embed] });

      return interaction.editReply({ content: `✅ Ticket created: ${channel}` });
    }
  } catch (e) {
    console.error(e);
  }
});

client.login(process.env.TOKEN);
