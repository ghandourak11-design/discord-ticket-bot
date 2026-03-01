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

// ================= BASIC =================

if (!process.env.TOKEN) {
  console.error("Missing TOKEN");
  process.exit(1);
}

if (!process.env.BASE44_API_KEY) {
  console.error("Missing BASE44_API_KEY");
  process.exit(1);
}

const BASE44_APP_ID = "698bba4e9e06a075e7c32be6";
const BASE44_ENDPOINT =
  `https://app.base44.com/api/apps/${BASE44_APP_ID}/entities/Product`;

const PREFIX = "!";
const OWNER_ID = "1456326972631154786";

// ================= CLIENT =================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildInvites,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel]
});

// ================= FILE STORAGE =================

const DATA_DIR = __dirname;

function loadJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}
function saveJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// ---------- STOCK ----------
const STOCK_FILE = path.join(DATA_DIR, "stock.json");
const stockStore = loadJson(STOCK_FILE, { byGuild: {} });
stockStore.byGuild ??= {};
saveJson(STOCK_FILE, stockStore);

function getStock(guildId) {
  stockStore.byGuild[guildId] ??= {
    channelId: null,
    messageId: null
  };
  saveJson(STOCK_FILE, stockStore);
  return stockStore.byGuild[guildId];
}
function saveStock() {
  saveJson(STOCK_FILE, stockStore);
}

// ---------- INVITES ----------
const INVITES_FILE = path.join(DATA_DIR, "invites.json");
const invitesData = loadJson(INVITES_FILE, {
  inviterStats: {},
  memberInviter: {},
  inviteOwners: {},
  invitedMembers: {}
});
saveJson(INVITES_FILE, invitesData);

function saveInvites() {
  saveJson(INVITES_FILE, invitesData);
}

// ================= STOCK SYSTEM =================

async function fetchStock() {
  const res = await fetch(BASE44_ENDPOINT, {
    headers: {
      "api_key": process.env.BASE44_API_KEY,
      "Content-Type": "application/json"
    }
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Stock API error ${res.status}: ${t}`);
  }

  return await res.json();
}

function buildStockEmbed(products) {
  const embed = new EmbedBuilder()
    .setTitle("🍩 DonutDemand Live Stock")
    .setColor(0xed4245)
    .setTimestamp();

  if (!Array.isArray(products) || !products.length) {
    embed.setDescription("No products found.");
    return embed;
  }

  const lines = products.map(p => {
    const name = p.name || "Unnamed";
    const price = p.price ?? "N/A";
    const qty = Number(p.quantity ?? 0);

    if (qty <= 0)
      return `❌ **${name}** — $${price} — **OUT OF STOCK**`;

    return `✅ **${name}** — $${price} — **${qty} in stock**`;
  });

  embed.setDescription(lines.join("\n"));
  return embed;
}

async function updateStockMessage(guild) {
  const cfg = getStock(guild.id);
  if (!cfg.channelId) return;

  const channel = await guild.channels.fetch(cfg.channelId).catch(() => null);
  if (!channel || channel.type !== ChannelType.GuildText) return;

  const products = await fetchStock().catch(() => null);
  if (!products) return;

  const embed = buildStockEmbed(products);

  let msg;
  if (cfg.messageId)
    msg = await channel.messages.fetch(cfg.messageId).catch(() => null);

  if (!msg) {
    const sent = await channel.send({ embeds: [embed] });
    cfg.messageId = sent.id;
    saveStock();
  } else {
    await msg.edit({ embeds: [embed] }).catch(() => {});
  }
}
// ================= INVITE SYSTEM =================

function ensureInviter(inviterId) {
  invitesData.inviterStats[inviterId] ??= {
    joins: 0,
    rejoins: 0,
    left: 0,
    manual: 0
  };
  return invitesData.inviterStats[inviterId];
}

function invitesStill(inviterId) {
  const s = ensureInviter(inviterId);
  return Math.max(0, (s.joins + s.rejoins - s.left + s.manual));
}

// Blacklist per guild
const BLACKLIST_FILE = path.join(DATA_DIR, "blacklist.json");
const blacklistStore = loadJson(BLACKLIST_FILE, { byGuild: {} });
blacklistStore.byGuild ??= {};
saveJson(BLACKLIST_FILE, blacklistStore);

function saveBlacklist() {
  saveJson(BLACKLIST_FILE, blacklistStore);
}

function isBlacklisted(guildId, userId) {
  return (blacklistStore.byGuild[guildId] || []).includes(userId);
}

function addBlacklist(guildId, userId) {
  blacklistStore.byGuild[guildId] ??= [];
  if (!blacklistStore.byGuild[guildId].includes(userId))
    blacklistStore.byGuild[guildId].push(userId);
  saveBlacklist();
}

function removeBlacklist(guildId, userId) {
  blacklistStore.byGuild[guildId] =
    (blacklistStore.byGuild[guildId] || []).filter(x => x !== userId);
  saveBlacklist();
}

// ================= INVITE TRACKING =================

const inviteCache = new Map();

client.on("inviteCreate", async invite => {
  const invites = await invite.guild.invites.fetch().catch(() => null);
  if (!invites) return;

  const map = new Map();
  invites.forEach(i => map.set(i.code, i.uses ?? 0));
  inviteCache.set(invite.guild.id, map);
});

client.on("guildMemberAdd", async member => {
  const guild = member.guild;
  const before = inviteCache.get(guild.id);
  if (!before) return;

  const invites = await guild.invites.fetch().catch(() => null);
  if (!invites) return;

  let used;
  for (const inv of invites.values()) {
    const prev = before.get(inv.code) ?? 0;
    if ((inv.uses ?? 0) > prev) {
      used = inv;
      break;
    }
  }

  const newMap = new Map();
  invites.forEach(i => newMap.set(i.code, i.uses ?? 0));
  inviteCache.set(guild.id, newMap);

  if (!used?.inviter) return;

  const inviterId = used.inviter.id;
  if (isBlacklisted(guild.id, inviterId)) return;

  const stats = ensureInviter(inviterId);
  if (invitesData.memberInviter[member.id])
    stats.rejoins++;
  else
    stats.joins++;

  invitesData.memberInviter[member.id] = inviterId;
  saveInvites();
});

client.on("guildMemberRemove", member => {
  const inviterId = invitesData.memberInviter[member.id];
  if (!inviterId) return;

  const stats = ensureInviter(inviterId);
  stats.left++;
  saveInvites();
});

// ================= LEADERBOARD =================

async function sendLeaderboard(interaction) {
  const rows = [];

  for (const id of Object.keys(invitesData.inviterStats)) {
    if (isBlacklisted(interaction.guild.id, id)) continue;
    const count = invitesStill(id);
    if (count > 0)
      rows.push({ id, count });
  }

  rows.sort((a, b) => b.count - a.count);
  const top = rows.slice(0, 10);

  if (!top.length)
    return interaction.reply("No invite data yet.");

  const lines = top.map((r, i) =>
    `**${i + 1}.** <@${r.id}> — **${r.count} invites**`
  );

  const embed = new EmbedBuilder()
    .setTitle("📈 Invite Leaderboard")
    .setColor(0xed4245)
    .setDescription(lines.join("\n"))
    .setTimestamp();

  return interaction.reply({ embeds: [embed] });
}
// ================= TICKET SYSTEM =================

function buildTicketEmbed(user, mc, need) {
  return new EmbedBuilder()
    .setTitle("🎫 Support Ticket")
    .setColor(0x2b2d31)
    .addFields(
      { name: "User", value: `${user} (${user.tag})`, inline: true },
      { name: "Minecraft", value: mc, inline: true },
      { name: "Request", value: need }
    )
    .setTimestamp();
}

function ticketControls() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("ticket_close")
      .setLabel("Close Ticket")
      .setStyle(ButtonStyle.Danger)
  );
}

client.on("interactionCreate", async interaction => {

  // ========== TICKET BUTTON ==========
  if (interaction.isButton() && interaction.customId === "open_ticket") {

    const modal = new ModalBuilder()
      .setCustomId("ticket_modal")
      .setTitle("Open Ticket");

    const mcInput = new TextInputBuilder()
      .setCustomId("mc")
      .setLabel("Minecraft Username")
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    const needInput = new TextInputBuilder()
      .setCustomId("need")
      .setLabel("What do you need?")
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true);

    modal.addComponents(
      new ActionRowBuilder().addComponents(mcInput),
      new ActionRowBuilder().addComponents(needInput)
    );

    return interaction.showModal(modal);
  }

  // ========== TICKET MODAL ==========
  if (interaction.isModalSubmit() && interaction.customId === "ticket_modal") {

    const mc = interaction.fields.getTextInputValue("mc");
    const need = interaction.fields.getTextInputValue("need");

    const channel = await interaction.guild.channels.create({
      name: `ticket-${interaction.user.username}`,
      type: ChannelType.GuildText,
      permissionOverwrites: [
        {
          id: interaction.guild.roles.everyone,
          deny: [PermissionsBitField.Flags.ViewChannel]
        },
        {
          id: interaction.user.id,
          allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages]
        }
      ]
    });

    await channel.send({
      content: `${interaction.user}`,
      embeds: [buildTicketEmbed(interaction.user, mc, need)],
      components: [ticketControls()]
    });

    return interaction.reply({
      content: `✅ Ticket created: ${channel}`,
      ephemeral: true
    });
  }

  // ========== CLOSE BUTTON ==========
  if (interaction.isButton() && interaction.customId === "ticket_close") {

    if (!interaction.channel.name.startsWith("ticket-"))
      return interaction.reply({ content: "Not a ticket.", ephemeral: true });

    await interaction.reply("🔒 Closing ticket...");
    setTimeout(() => {
      interaction.channel.delete().catch(() => {});
    }, 2000);
  }

});

// ================= REWARDS SYSTEM =================

const REWARDS_FILE = path.join(DATA_DIR, "rewards.json");
const rewardsStore = loadJson(REWARDS_FILE, { webhook: null });
saveJson(REWARDS_FILE, rewardsStore);

function saveRewards() {
  saveJson(REWARDS_FILE, rewardsStore);
}

async function sendRewardWebhook(user, mc, invites) {

  const payAmount = invites * 3;

  const embed = new EmbedBuilder()
    .setTitle("🎁 Reward Claim")
    .setColor(0xed4245)
    .addFields(
      { name: "User", value: `${user.tag} (${user.id})` },
      { name: "Minecraft", value: mc },
      { name: "Invites", value: `${invites}` },
      { name: "Command", value: `**/pay ${mc} ${payAmount}**` }
    )
    .setTimestamp();

  const res = await fetch(rewardsStore.webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: "DonutDemand Rewards",
      embeds: [embed]
    })
  });

  if (!res.ok)
    throw new Error("Webhook failed");
}

// Rewards Claim Button
client.on("interactionCreate", async interaction => {

  if (interaction.isButton() && interaction.customId === "claim_rewards") {

    const invites = invitesStill(interaction.user.id);

    if (invites < 5)
      return interaction.reply({
        content: `❌ Need 5+ invites. You have ${invites}.`,
        ephemeral: true
      });

    const modal = new ModalBuilder()
      .setCustomId("rewards_modal")
      .setTitle("Claim Rewards");

    const mcInput = new TextInputBuilder()
      .setCustomId("mc")
      .setLabel("Minecraft Username")
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    modal.addComponents(
      new ActionRowBuilder().addComponents(mcInput)
    );

    return interaction.showModal(modal);
  }

  if (interaction.isModalSubmit() && interaction.customId === "rewards_modal") {

    await interaction.deferReply({ ephemeral: true });

    const mc = interaction.fields.getTextInputValue("mc");
    const invites = invitesStill(interaction.user.id);

    if (invites < 5)
      return interaction.editReply("❌ Not enough invites.");

    try {
      await sendRewardWebhook(interaction.user, mc, invites);

      // Reset invites after success
      invitesData.inviterStats[interaction.user.id] = {
        joins: 0,
        rejoins: 0,
        left: 0,
        manual: 0
      };
      saveInvites();

      return interaction.editReply("✅ Claim submitted & invites reset.");
    } catch {
      return interaction.editReply("❌ Webhook failed. Invites NOT reset.");
    }
  }

});
// ================= GIVEAWAYS =================

const GIVEAWAY_FILE = path.join(DATA_DIR, "giveaways.json");
const giveawayStore = loadJson(GIVEAWAY_FILE, { giveaways: {} });
saveJson(GIVEAWAY_FILE, giveawayStore);

function saveGiveaways() {
  saveJson(GIVEAWAY_FILE, giveawayStore);
}

function giveawayEmbed(gw) {
  return new EmbedBuilder()
    .setTitle(`🎁 GIVEAWAY — ${gw.prize}`)
    .setColor(0xed4245)
    .setDescription(
      `Ends: <t:${Math.floor(gw.endsAt / 1000)}:R>\n` +
      `Entries: **${gw.entries.length}**`
    )
    .setTimestamp();
}

client.on("interactionCreate", async interaction => {

  if (!interaction.isChatInputCommand()) return;

  // ================= STOCK COMMAND =================
  if (interaction.commandName === "stock") {

    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator))
      return interaction.reply({ content: "Admins only.", ephemeral: true });

    const sub = interaction.options.getSubcommand();

    if (sub === "set_channel") {
      const channel = interaction.options.getChannel("channel");
      const cfg = getStock(interaction.guild.id);
      cfg.channelId = channel.id;
      cfg.messageId = null;
      saveStock();
      return interaction.reply({ content: `✅ Stock channel set to ${channel}`, ephemeral: true });
    }

    if (sub === "post") {
      await updateStockMessage(interaction.guild);
      return interaction.reply({ content: "✅ Stock updated.", ephemeral: true });
    }
  }

  // ================= LEADERBOARD =================
  if (interaction.commandName === "leaderboard")
    return sendLeaderboard(interaction);

  // ================= BLACKLIST =================
  if (interaction.commandName === "blacklist") {

    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator))
      return interaction.reply({ content: "Admins only.", ephemeral: true });

    const sub = interaction.options.getSubcommand();
    const user = interaction.options.getUser("user");

    if (sub === "add") {
      addBlacklist(interaction.guild.id, user.id);
      return interaction.reply(`🚫 ${user.tag} blacklisted.`);
    }

    if (sub === "remove") {
      removeBlacklist(interaction.guild.id, user.id);
      return interaction.reply(`✅ ${user.tag} removed from blacklist.`);
    }
  }

  // ================= CALC =================
  if (interaction.commandName === "calc") {
    const expr = interaction.options.getString("expression");
    try {
      const result = Function(`"use strict"; return (${expr})`)();
      return interaction.reply(`🧮 Result: **${result}**`);
    } catch {
      return interaction.reply("Invalid expression.");
    }
  }

});

// ================= SLASH COMMAND REGISTRATION =================

async function registerCommands() {

  const commands = [

    new SlashCommandBuilder()
      .setName("stock")
      .setDescription("Stock system")
      .addSubcommand(s =>
        s.setName("set_channel")
          .setDescription("Set stock channel")
          .addChannelOption(o =>
            o.setName("channel")
              .setDescription("Text channel")
              .addChannelTypes(ChannelType.GuildText)
              .setRequired(true)
          )
      )
      .addSubcommand(s =>
        s.setName("post")
          .setDescription("Post stock immediately")
      ),

    new SlashCommandBuilder()
      .setName("leaderboard")
      .setDescription("Invite leaderboard"),

    new SlashCommandBuilder()
      .setName("blacklist")
      .setDescription("Invite blacklist")
      .addSubcommand(s =>
        s.setName("add")
          .setDescription("Blacklist user")
          .addUserOption(o => o.setName("user").setRequired(true))
      )
      .addSubcommand(s =>
        s.setName("remove")
          .setDescription("Remove blacklist")
          .addUserOption(o => o.setName("user").setRequired(true))
      ),

    new SlashCommandBuilder()
      .setName("calc")
      .setDescription("Calculator")
      .addStringOption(o =>
        o.setName("expression")
          .setDescription("Math expression")
          .setRequired(true)
      )

  ].map(c => c.toJSON());

  const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

  await rest.put(
    Routes.applicationCommands(client.user.id),
    { body: commands }
  );
}

// ================= READY =================

client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);

  await registerCommands();

  // Stock auto update every 1 minute
  setInterval(async () => {
    for (const guild of client.guilds.cache.values()) {
      await updateStockMessage(guild).catch(() => {});
    }
  }, 60 * 1000);
});

// ================= LOGIN =================

client.login(process.env.TOKEN);
