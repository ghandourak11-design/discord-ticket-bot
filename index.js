try { require("dotenv").config({ quiet: true }); } catch {}

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

process.on("unhandledRejection", (r) => console.error("unhandledRejection:", r));
process.on("uncaughtException", (e) => console.error("uncaughtException:", e));

/* ====== CONFIG ====== */
const PREFIX = "!";
const OWNER_ID = "1456326972631154786"; // Adam

const DATA_DIR = __dirname;
const SETTINGS_FILE = path.join(DATA_DIR, "guild_settings.json");
const PANEL_FILE = path.join(DATA_DIR, "panel_config.json");
const INVITES_FILE = path.join(DATA_DIR, "invites_data.json");
const INVITES_BACKUP_FILE = path.join(DATA_DIR, "invites_backup.json");
const GIVEAWAYS_FILE = path.join(DATA_DIR, "giveaways_data.json");
const BOT_STATE_FILE = path.join(DATA_DIR, "bot_state.json");

/* ====== BASE44 STOCK ENV ====== */
const BASE44_APP_ID = (process.env.BASE44_APP_ID || "").trim(); // required
const BASE44_API_KEY = (process.env.BASE44_API_KEY || "").trim(); // required
const BASE44_API_URL = (process.env.BASE44_API_URL || "https://donutdemand.net").trim().replace(/\/+$/, "");
const STOCK_CHANNEL_ID = (process.env.STOCK_CHANNEL_ID || "").trim(); // required
const STOCK_INTERVAL_MS = Number(process.env.STOCK_INTERVAL_MS || "60000");

/* ====== HELPERS ====== */
function isOwner(userId) { return String(userId) === String(OWNER_ID); }
function loadJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}
function saveJson(file, data) { fs.writeFileSync(file, JSON.stringify(data, null, 2)); }
function parseHexColor(input) {
  if (!input) return null;
  let s = String(input).trim();
  if (s.startsWith("#")) s = s.slice(1);
  if (s.startsWith("0x")) s = s.slice(2);
  if (!/^[0-9a-fA-F]{6}$/.test(s)) return null;
  return parseInt(s, 16);
}
function normalizeButtonStyle(style) {
  const s = String(style || "").toLowerCase();
  if (s === "primary") return ButtonStyle.Primary;
  if (s === "secondary") return ButtonStyle.Secondary;
  if (s === "success") return ButtonStyle.Success;
  if (s === "danger") return ButtonStyle.Danger;
  return ButtonStyle.Primary;
}
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
function memberHasAnyRole(member, roleIds) {
  if (!member || !roleIds?.length) return false;
  return roleIds.some((rid) => member.roles.cache.has(rid));
}
function defaultGuildSettings() {
  return {
    staffRoleIds: [],
    vouchesChannelId: null,
    joinLogChannelId: null,
    customerRoleId: null,
    invitesBlacklist: [],
    rewardsWebhookUrl: null,
    automod: { enabled: true, bypassRoleName: "automod" },
  };
}

/* ====== STORES ====== */
const settingsStore = loadJson(SETTINGS_FILE, { byGuild: {} });
settingsStore.byGuild ??= {};
saveJson(SETTINGS_FILE, settingsStore);

const panelStore = loadJson(PANEL_FILE, { byGuild: {} });
panelStore.byGuild ??= {};
saveJson(PANEL_FILE, panelStore);

const invitesData = loadJson(INVITES_FILE, {
  inviterStats: {},
  memberInviter: {},
  inviteOwners: {},
  invitedMembers: {},
});
invitesData.inviterStats ??= {};
invitesData.memberInviter ??= {};
invitesData.inviteOwners ??= {};
invitesData.invitedMembers ??= {};
saveJson(INVITES_FILE, invitesData);

const giveawayData = loadJson(GIVEAWAYS_FILE, { giveaways: {} });
giveawayData.giveaways ??= {};
saveJson(GIVEAWAYS_FILE, giveawayData);

const botState = loadJson(BOT_STATE_FILE, { stoppedGuilds: {}, stock: {} });
botState.stoppedGuilds ??= {};
botState.stock ??= {};
saveJson(BOT_STATE_FILE, botState);

function saveSettings() { saveJson(SETTINGS_FILE, settingsStore); }
function savePanelStore() { saveJson(PANEL_FILE, panelStore); }
function saveInvites() { saveJson(INVITES_FILE, invitesData); }
function saveGiveaways() { saveJson(GIVEAWAYS_FILE, giveawayData); }
function saveBotState() { saveJson(BOT_STATE_FILE, botState); }

function getGuildSettings(guildId) {
  if (!settingsStore.byGuild[guildId]) {
    settingsStore.byGuild[guildId] = defaultGuildSettings();
    saveSettings();
  }
  const s = settingsStore.byGuild[guildId];
  s.staffRoleIds ??= [];
  s.vouchesChannelId ??= null;
  s.joinLogChannelId ??= null;
  s.customerRoleId ??= null;
  s.invitesBlacklist ??= [];
  s.rewardsWebhookUrl ??= null;
  s.automod ??= { enabled: true, bypassRoleName: "automod" };
  s.automod.enabled ??= true;
  s.automod.bypassRoleName ??= "automod";
  return s;
}
function isStopped(guildId) { return Boolean(botState.stoppedGuilds?.[guildId]); }

function isStaff(member) {
  if (!member) return false;
  if (isOwner(member.id)) return true;
  if (member.permissions.has(PermissionsBitField.Flags.Administrator)) return true;
  const s = getGuildSettings(member.guild.id);
  return memberHasAnyRole(member, s.staffRoleIds);
}
function isAdminOrOwner(member) {
  if (!member) return false;
  if (isOwner(member.id)) return true;
  return member.permissions.has(PermissionsBitField.Flags.Administrator);
}

async function denyIfStopped(interactionOrMessage) {
  const guildId = interactionOrMessage.guild?.id;
  if (!guildId) return false;
  if (!isStopped(guildId)) return false;
  const content = "Adam has restricted commands in your server.";
  if (
    interactionOrMessage.isChatInputCommand?.() ||
    interactionOrMessage.isButton?.() ||
    interactionOrMessage.isModalSubmit?.()
  ) {
    try {
      if (interactionOrMessage.deferred || interactionOrMessage.replied) {
        await interactionOrMessage.followUp({ content, ephemeral: true }).catch(() => {});
      } else {
        await interactionOrMessage.reply({ content, ephemeral: true }).catch(() => {});
      }
    } catch {}
    return true;
  }
  try { await interactionOrMessage.channel?.send(content).catch(() => {}); } catch {}
  return true;
}

/* ====== INVITES ====== */
function isBlacklistedInviter(guildId, userId) {
  const s = getGuildSettings(guildId);
  return (s.invitesBlacklist || []).includes(String(userId));
}
function ensureInviterStats(inviterId) {
  if (!invitesData.inviterStats[inviterId]) {
    invitesData.inviterStats[inviterId] = { joins: 0, rejoins: 0, left: 0, manual: 0 };
  } else {
    const s = invitesData.inviterStats[inviterId];
    s.joins ??= 0; s.rejoins ??= 0; s.left ??= 0; s.manual ??= 0;
  }
  return invitesData.inviterStats[inviterId];
}
function invitesStillInServer(inviterId) {
  const s = ensureInviterStats(inviterId);
  const base = (s.joins || 0) + (s.rejoins || 0) - (s.left || 0);
  return Math.max(0, base + (s.manual || 0));
}
function invitesStillInServerForGuild(guildId, inviterId) {
  if (isBlacklistedInviter(guildId, inviterId)) return 0;
  return invitesStillInServer(inviterId);
}
function resetInvitesForUser(inviterId) {
  invitesData.inviterStats[inviterId] = { joins: 0, rejoins: 0, left: 0, manual: 0 };
  delete invitesData.invitedMembers[inviterId];
  for (const [memberId, invId] of Object.entries(invitesData.memberInviter || {})) {
    if (String(invId) === String(inviterId)) delete invitesData.memberInviter[memberId];
  }
  for (const [code, ownerId] of Object.entries(invitesData.inviteOwners || {})) {
    if (String(ownerId) === String(inviterId)) delete invitesData.inviteOwners[code];
  }
  saveInvites();
}
const invitesCache = new Map();
async function refreshGuildInvites(guild) {
  const invites = await guild.invites.fetch().catch(() => null);
  if (!invites) return null;
  const map = new Map();
  invites.forEach((inv) => map.set(inv.code, inv.uses ?? 0));
  invitesCache.set(guild.id, map);
  return invites;
}

/* ====== BACKUP / RESTORE ====== */
function sanitizeInvitesDataForSave(obj) {
  return {
    inviterStats: obj?.inviterStats || {},
    memberInviter: obj?.memberInviter || {},
    inviteOwners: obj?.inviteOwners || {},
    invitedMembers: obj?.invitedMembers || {},
  };
}
function doBackupInvites() {
  const snapshot = sanitizeInvitesDataForSave(invitesData);
  saveJson(INVITES_BACKUP_FILE, snapshot);
  return snapshot;
}
function doRestoreInvites() {
  const restored = loadJson(INVITES_BACKUP_FILE, null);
  if (!restored) return { ok: false, msg: "No invites backup found (invites_backup.json missing)." };
  const snap = sanitizeInvitesDataForSave(restored);
  invitesData.inviterStats = snap.inviterStats;
  invitesData.memberInviter = snap.memberInviter;
  invitesData.inviteOwners = snap.inviteOwners;
  invitesData.invitedMembers = snap.invitedMembers;
  saveInvites();
  return { ok: true, msg: "Invites restored from invites_backup.json." };
}

/* ====== TICKETS ====== */
async function getOrCreateCategory(guild, name) {
  const safeName = String(name || "Tickets").slice(0, 90);
  let cat = guild.channels.cache.find((c) => c.type === ChannelType.GuildCategory && c.name === safeName);
  if (!cat) cat = await guild.channels.create({ name: safeName, type: ChannelType.GuildCategory });
  return cat;
}
function getTicketMetaFromTopic(topic) {
  if (!topic) return null;
  const opener = topic.match(/opener:(\d{10,25})/i)?.[1] || null;
  const created = topic.match(/created:(\d{10,20})/i)?.[1] || null;
  const typeId = topic.match(/type:([a-z0-9_\-]{1,100})/i)?.[1] || null;
  if (!opener) return null;
  return { openerId: opener, createdAt: created ? Number(created) : null, typeId };
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

/* ====== PANEL CONFIG ====== */
const DEFAULT_PANEL_CONFIG = {
  embed: {
    title: "Tickets",
    description:
      "🆘| Help & Support Ticket\nIf you need help with anything, create a support ticket.\n\n" +
      "💰| Claim Order\nIf you have placed an order and are waiting to receive it please open this ticket.\n\n" +
      "💸| Sell To us\nWant to make some real cash off the donutsmp? Open a ticket and sell to us here.\n\n" +
      "🎁| Claim Rewards Ticket\nLooking to claim rewards, make this ticket.",
    color: "#FF0000",
  },
  modal: { title: "Ticket Info", mcLabel: "What is your Minecraft username?", needLabel: "What do you need?" },
  tickets: [
    { id: "ticket_support", label: "Help & Support", category: "Help & Support", key: "help-support", button: { label: "Help & Support", style: "Primary", emoji: "🆘" } },
    { id: "ticket_claim", label: "Claim Order", category: "Claim Order", key: "claim-order", button: { label: "Claim Order", style: "Success", emoji: "💰" } },
    { id: "ticket_sell", label: "Sell To us", category: "Sell To us", key: "sell-to-us", button: { label: "Sell To us", style: "Secondary", emoji: "💸" } },
    { id: "ticket_rewards", label: "Rewards", category: "Rewards", key: "rewards", button: { label: "Rewards", style: "Danger", emoji: "🎁" } },
  ],
};
function getPanelConfig(guildId) {
  return panelStore.byGuild[guildId]?.ticketPanel || DEFAULT_PANEL_CONFIG;
}
function resolveTicketType(config, typeId) {
  return (config.tickets || []).find((t) => t.id === typeId) || null;
}
function buildTicketPanelMessage(config) {
  const c = parseHexColor(config.embed?.color) ?? 0xed4245;
  const embed = new EmbedBuilder()
    .setTitle(String(config.embed?.title || "Tickets").slice(0, 256))
    .setDescription(String(config.embed?.description || "Open a ticket below.").slice(0, 4000))
    .setColor(c)
    .setFooter({ text: "DonutDemand Support" })
    .setTimestamp();

  const row = new ActionRowBuilder();
  for (const t of config.tickets) {
    const b = t.button || {};
    const btn = new ButtonBuilder()
      .setCustomId(`ticket:${t.id}`)
      .setLabel(String(b.label || t.label || "Ticket").slice(0, 80))
      .setStyle(normalizeButtonStyle(b.style || "Primary"));
    if (b.emoji) btn.setEmoji(String(b.emoji).slice(0, 40));
    row.addComponents(btn);
  }
  return { embeds: [embed], components: [row] };
}
function validatePanelConfig(cfg) {
  if (!cfg || typeof cfg !== "object") return { ok: false, msg: "Config must be a JSON object." };
  const embed = cfg.embed || {};
  const modal = cfg.modal || {};
  const tickets = Array.isArray(cfg.tickets) ? cfg.tickets : null;
  if (!tickets || tickets.length < 1) return { ok: false, msg: "Config must include tickets: [...] with at least 1 type." };
  if (tickets.length > 4) return { ok: false, msg: "Max 4 ticket types." };

  const title = String(embed.title ?? "").trim();
  const desc = String(embed.description ?? "").trim();
  const color = String(embed.color ?? "").trim();
  if (!title || title.length > 256) return { ok: false, msg: "embed.title required (<=256)." };
  if (!desc || desc.length > 4000) return { ok: false, msg: "embed.description required (<=4000)." };
  if (color && !parseHexColor(color)) return { ok: false, msg: "embed.color must be hex like #FF0000." };

  const mTitle = String(modal.title ?? "Ticket Info");
  const mcLabel = String(modal.mcLabel ?? "Minecraft username?");
  const needLabel = String(modal.needLabel ?? "What do you need?");
  if (mTitle.length < 1 || mTitle.length > 45) return { ok: false, msg: "modal.title 1-45 chars." };
  if (mcLabel.length < 1 || mcLabel.length > 45) return { ok: false, msg: "modal.mcLabel 1-45 chars." };
  if (needLabel.length < 1 || needLabel.length > 45) return { ok: false, msg: "modal.needLabel 1-45 chars." };

  const seen = new Set();
  for (const t of tickets) {
    const id = String(t.id || "").trim();
    const label = String(t.label || "").trim();
    const category = String(t.category || "").trim();
    const key = String(t.key || "").trim();
    if (!id) return { ok: false, msg: "Ticket id required." };
    if (seen.has(id)) return { ok: false, msg: `Duplicate ticket id: ${id}` };
    seen.add(id);
    if (!label) return { ok: false, msg: "Ticket label required." };
    if (!category) return { ok: false, msg: "Ticket category required." };
    if (!key) return { ok: false, msg: "Ticket key required." };
    const b = t.button || {};
    const bLabel = String(b.label || "").trim();
    if (!bLabel) return { ok: false, msg: "ticket.button.label required." };
    const style = String(b.style || "Primary");
    if (!["Primary", "Secondary", "Success", "Danger"].includes(style)) return { ok: false, msg: "ticket.button.style invalid." };
  }
  return { ok: true, msg: "OK" };
}

/* ====== REWARDS ====== */
function isRewardsTicket(ticketType) {
  const id = String(ticketType?.id || "").toLowerCase();
  const key = String(ticketType?.key || "").toLowerCase();
  return id === "ticket_rewards" || key.includes("rewards");
}
function canOpenRewardsTicket(member) {
  const inv = invitesStillInServerForGuild(member.guild.id, member.id);
  if (inv >= 5) return { ok: true };
  return { ok: false, invites: inv };
}
async function sendWebhook(webhookUrl, payload) {
  if (!webhookUrl) throw new Error("Missing webhook url");
  let f = globalThis.fetch;
  if (!f) {
    const mod = await import("node-fetch");
    f = mod.default;
  }
  const res = await f(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Webhook failed (${res.status}): ${text.slice(0, 200)}`);
  }
}
function buildRewardsClaimModal() {
  const modal = new ModalBuilder().setCustomId("rewards_claim_modal").setTitle("Claim Rewards");
  const mcInput = new TextInputBuilder()
    .setCustomId("mc")
    .setLabel("Minecraft username (to pay)")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(32);
  const discordInput = new TextInputBuilder()
    .setCustomId("discordname")
    .setLabel("Your Discord username")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(64);
  modal.addComponents(new ActionRowBuilder().addComponents(mcInput), new ActionRowBuilder().addComponents(discordInput));
  return modal;
}
function makeRewardsWebhookEmbed({ guild, user, mc, discordName, invitesAtClaim }) {
  const payAmount = invitesAtClaim * 3;
  const cmd = `/pay ${mc} ${payAmount}`;
  return new EmbedBuilder()
    .setTitle("🎁 Reward Claim Submitted")
    .setColor(0xed4245)
    .setDescription("A new reward claim has been submitted.")
    .addFields(
      { name: "Discord User", value: `${user}\n${user.tag}\nID: \`${user.id}\``, inline: false },
      { name: "Minecraft Username", value: `\`${mc}\``, inline: true },
      { name: "Listed Discord Username", value: `\`${discordName}\``, inline: true },
      { name: "Invites At Claim", value: `**${invitesAtClaim}**`, inline: true },
      { name: "Server", value: `${guild.name}\nID: \`${guild.id}\``, inline: false },
      { name: "Payout Command (copy)", value: `**${cmd}**`, inline: false }
    )
    .setFooter({ text: "DonutDemand Rewards" })
    .setTimestamp();
}

/* ====== CALC ====== */
function tokenizeCalc(input) {
  const s = String(input || "").trim().toLowerCase().replace(/×/g, "x").replace(/\s+/g, "").replace(/x/g, "*");
  if (!s) return [];
  const tokens = [];
  let i = 0;
  const isDigit = (c) => c >= "0" && c <= "9";
  while (i < s.length) {
    const c = s[i];
    if (isDigit(c) || c === ".") {
      let j = i, dot = 0;
      while (j < s.length && (isDigit(s[j]) || s[j] === ".")) {
        if (s[j] === ".") dot++;
        if (dot > 1) throw new Error("Invalid number");
        j++;
      }
      const numStr = s.slice(i, j);
      const val = Number(numStr);
      if (!Number.isFinite(val)) throw new Error("Invalid number");
      tokens.push({ type: "num", v: val });
      i = j;
      continue;
    }
    if ("+-*/^()".includes(c)) { tokens.push({ type: "op", v: c }); i++; continue; }
    throw new Error("Invalid character");
  }
  return tokens;
}
function toRpn(tokens) {
  const out = [];
  const ops = [];
  const prec = (op) => (op === "^" ? 4 : op === "*" || op === "/" ? 3 : op === "+" || op === "-" ? 2 : 0);
  const rightAssoc = (op) => op === "^";
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === "num") { out.push(t); continue; }
    const op = t.v;
    if (op === "(") { ops.push(op); continue; }
    if (op === ")") {
      while (ops.length && ops[ops.length - 1] !== "(") out.push({ type: "op", v: ops.pop() });
      if (!ops.length || ops[ops.length - 1] !== "(") throw new Error("Mismatched parentheses");
      ops.pop();
      continue;
    }
    if (op === "-") {
      const prev = i === 0 ? null : tokens[i - 1];
      const isUnary = !prev || (prev.type === "op" && prev.v !== ")") || (prev.type === "op" && prev.v === "(");
      if (isUnary) out.push({ type: "num", v: 0 });
    }
    while (ops.length) {
      const top = ops[ops.length - 1];
      if (top === "(") break;
      const pTop = prec(top);
      const pCur = prec(op);
      if ((rightAssoc(op) && pCur < pTop) || (!rightAssoc(op) && pCur <= pTop)) out.push({ type: "op", v: ops.pop() });
      else break;
    }
    ops.push(op);
  }
  while (ops.length) {
    const op = ops.pop();
    if (op === "(" || op === ")") throw new Error("Mismatched parentheses");
    out.push({ type: "op", v: op });
  }
  return out;
}
function evalRpn(rpn) {
  const stack = [];
  for (const t of rpn) {
    if (t.type === "num") { stack.push(t.v); continue; }
    const op = t.v;
    const b = stack.pop();
    const a = stack.pop();
    if (a === undefined || b === undefined) throw new Error("Invalid expression");
    let r;
    if (op === "+") r = a + b;
    else if (op === "-") r = a - b;
    else if (op === "*") r = a * b;
    else if (op === "/") r = a / b;
    else if (op === "^") r = Math.pow(a, b);
    else throw new Error("Bad operator");
    if (!Number.isFinite(r)) throw new Error("Invalid result");
    stack.push(r);
  }
  if (stack.length !== 1) throw new Error("Invalid expression");
  return stack[0];
}
function calcExpression(input) {
  const tokens = tokenizeCalc(input);
  if (!tokens.length) throw new Error("Empty");
  return evalRpn(toRpn(tokens));
}
function formatCalcResult(n) {
  if (!Number.isFinite(n)) return null;
  const abs = Math.abs(n);
  if (abs !== 0 && (abs >= 1e12 || abs < 1e-9)) return n.toExponential(6);
  const s = String(n);
  if (s.includes(".") && s.length > 18) return Number(n.toFixed(10)).toString();
  return s;
}

/* ====== GIVEAWAYS ====== */
function parseDurationToMs(input) {
  if (!input) return null;
  const s = input.trim().toLowerCase().replace(/\s+/g, "");
  const re = /(\d+)(s|m|h|d)/g;
  let total = 0, ok = false, m;
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
  const minInv = gw.minInvites > 0 ? `\nMin invites: **${gw.minInvites}**` : "";
  const status = gw.ended ? "\n**STATUS: ENDED**" : "";
  return new EmbedBuilder()
    .setTitle(`🎁 GIVEAWAY — ${gw.prize}`)
    .setColor(0xed4245)
    .setDescription(
      `Ends: <t:${endUnix}:R> (<t:${endUnix}:F>)\nHosted by: <@${gw.hostId}>\nEntries: **${gw.entries.length}**\nWinners: **${gw.winners}**${minInv}${status}`
    )
    .setFooter({ text: `Giveaway Message ID: ${gw.messageId}` })
    .setTimestamp();
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
  if (msg) await msg.edit({ embeds: [makeGiveawayEmbed(gw)], components: [giveawayRow(gw)] }).catch(() => {});
  if (!gw.entries.length) {
    await channel.send(`No entries — giveaway for **${gw.prize}** ended with no winners.`).catch(() => {});
    return { ok: true, msg: "Ended (no entries)." };
  }
  const winnerCount = Math.max(1, Math.min(gw.winners, gw.entries.length));
  const winners = pickRandomWinners(gw.entries, winnerCount);
  gw.lastWinners = winners;
  saveGiveaways();
  const endedBy = endedByUserId ? ` (ended by <@${endedByUserId}>)` : "";
  await channel.send(`🎉 Giveaway ended${endedBy}! Winners: ${winners.map((id) => `<@${id}>`).join(", ")}`).catch(() => {});
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
  await channel.send(`🔁 Reroll${by}! New winners: ${winners.map((id) => `<@${id}>`).join(", ")}`).catch(() => {});
  return { ok: true, msg: "Rerolled." };
}
function scheduleGiveawayEnd(messageId) {
  const gw = giveawayData.giveaways[messageId];
  if (!gw || gw.ended) return;
  const delay = gw.endsAt - Date.now();
  if (delay <= 0) return void endGiveaway(messageId).catch(() => {});
  const MAX = 2_147_483_647;
  setTimeout(() => {
    const g = giveawayData.giveaways[messageId];
    if (!g || g.ended) return;
    if (g.endsAt - Date.now() > MAX) return scheduleGiveawayEnd(messageId);
    endGiveaway(messageId).catch(() => {});
  }, Math.min(delay, MAX));
}

/* ====== TICKET UI ====== */
function buildTicketInsideEmbed({ typeLabel, user, mc, need, createdAtMs }) {
  const openedUnix = Math.floor((createdAtMs || Date.now()) / 1000);
  return new EmbedBuilder()
    .setTitle(`🎫 ${String(typeLabel || "Support")} Ticket`)
    .setColor(0x2b2d31)
    .setDescription(`**Welcome, ${user}!**\n🕒 Opened: <t:${openedUnix}:F> (<t:${openedUnix}:R>)`)
    .addFields(
      { name: "User", value: `${user} (${user.tag})`, inline: true },
      { name: "Minecraft", value: (mc || "N/A").slice(0, 64), inline: true },
      { name: "Request", value: (need || "N/A").slice(0, 1024), inline: false }
    )
    .setFooter({ text: "DonutDemand Support" })
    .setTimestamp();
}
function buildTicketControlRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("ticket_close_btn").setStyle(ButtonStyle.Danger).setEmoji("🔒").setLabel("Close Ticket")
  );
}
function buildCloseDmEmbed({ guild, ticketChannelName, ticketTypeLabel, openedAtMs, closedByTag, reason, vouchesChannelId }) {
  const openedUnix = openedAtMs ? Math.floor(openedAtMs / 1000) : null;
  const closedUnix = Math.floor(Date.now() / 1000);
  const nextSteps = ["• If you still need help, open a new ticket.", "• Keep DMs open for updates."];
  if (vouchesChannelId) nextSteps.splice(1, 0, `• Leave a vouch in <#${vouchesChannelId}> if you can.`);
  return new EmbedBuilder()
    .setTitle("✅ Ticket Closed")
    .setColor(0xed4245)
    .setDescription("Your ticket has been closed.")
    .addFields(
      { name: "Server", value: `${guild.name}`, inline: true },
      { name: "Ticket", value: `${ticketChannelName}`, inline: true },
      { name: "Type", value: ticketTypeLabel || "Unknown", inline: true },
      { name: "Closed By", value: closedByTag || "Unknown", inline: true },
      { name: "Reason", value: String(reason || "No reason provided").slice(0, 1024), inline: false },
      { name: "Opened", value: openedUnix ? `<t:${openedUnix}:F> (<t:${openedUnix}:R>)` : "Unknown", inline: true },
      { name: "Closed", value: `<t:${closedUnix}:F> (<t:${closedUnix}:R>)`, inline: true },
      { name: "Next Steps", value: nextSteps.join("\n"), inline: false }
    )
    .setFooter({ text: "DonutDemand Support" })
    .setTimestamp();
}
const activeOperations = new Map();
async function closeTicketFlow({ channel, guild, closerUser, reason }) {
  if (!channel || !guild) return;
  if (activeOperations.has(channel.id)) {
    clearTimeout(activeOperations.get(channel.id));
    activeOperations.delete(channel.id);
  }
  const meta = getTicketMetaFromTopic(channel.topic);
  const openerId = meta?.openerId;
  const config = getPanelConfig(guild.id);
  const t = resolveTicketType(config, meta?.typeId);
  const ticketTypeLabel = t?.label || "Unknown";
  const s = getGuildSettings(guild.id);

  try {
    if (openerId) {
      const openerUser = await client.users.fetch(openerId);
      await openerUser.send({
        embeds: [buildCloseDmEmbed({
          guild,
          ticketChannelName: channel.name,
          ticketTypeLabel,
          openedAtMs: meta?.createdAt,
          closedByTag: closerUser?.tag || "Unknown",
          reason,
          vouchesChannelId: s.vouchesChannelId,
        })],
      });
    }
  } catch {}

  try { await channel.send("🔒 Ticket closing...").catch(() => {}); } catch {}
  setTimeout(() => { channel.delete().catch(() => {}); }, 2000);
}

/* ====== BASE44 STOCK ====== */
async function base44FetchProducts() {
  if (!BASE44_APP_ID || !BASE44_API_KEY) throw new Error("Missing BASE44_APP_ID or BASE44_API_KEY");
  let f = globalThis.fetch;
  if (!f) {
    const mod = await import("node-fetch");
    f = mod.default;
  }
  const url = `${BASE44_API_URL}/api/apps/${BASE44_APP_ID}/entities/Product`;
  const res = await f(url, {
    headers: { api_key: BASE44_API_KEY, "Content-Type": "application/json" },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Base44 API error ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error("Base44 returned non-array");
  return data;
}
function buildStockEmbeds(products) {
  const now = Math.floor(Date.now() / 1000);
  const cleaned = products.map((p) => ({
    name: String(p.name || "Unnamed"),
    qty: Number(p.quantity ?? 0),
    price: p.price == null ? null : Number(p.price),
    category: p.category ? String(p.category) : null,
  }));

  cleaned.sort((a, b) => a.name.localeCompare(b.name));

  const lines = cleaned.map((p) => {
    const qty = Number.isFinite(p.qty) ? p.qty : 0;
    const price = Number.isFinite(p.price) ? `$${p.price}` : "—";
    const cat = p.category ? ` • ${p.category}` : "";
    return `• **${p.name}** — **${qty}** in stock — ${price}${cat}`;
  });

  const chunkSize = 35;
  const chunks = [];
  for (let i = 0; i < lines.length; i += chunkSize) chunks.push(lines.slice(i, i + chunkSize));

  const embeds = chunks.slice(0, 3).map((chunk, idx) =>
    new EmbedBuilder()
      .setTitle(idx === 0 ? "📦 DonutDemand Stock" : "📦 DonutDemand Stock (cont.)")
      .setColor(0xed4245)
      .setDescription(chunk.join("\n").slice(0, 4000))
      .setFooter({ text: `Last update: <t:${now}:R>` })
      .setTimestamp()
  );

  if (!embeds.length) {
    embeds.push(
      new EmbedBuilder()
        .setTitle("📦 DonutDemand Stock")
        .setColor(0xed4245)
        .setDescription("No products found.")
        .setTimestamp()
    );
  }
  return embeds;
}
async function postOrEditStockMessage(guild) {
  if (!STOCK_CHANNEL_ID) return;
  const channel = await guild.channels.fetch(STOCK_CHANNEL_ID).catch(() => null);
  if (!channel || channel.type !== ChannelType.GuildText) return;

  const products = await base44FetchProducts();
  const embeds = buildStockEmbeds(products);

  botState.stock[guild.id] ??= {};
  const lastId = botState.stock[guild.id].messageId;

  if (lastId) {
    const msg = await channel.messages.fetch(lastId).catch(() => null);
    if (msg) {
      await msg.edit({ embeds }).catch(() => {});
      return;
    }
  }

  const sent = await channel.send({ embeds }).catch(() => null);
  if (sent) {
    botState.stock[guild.id].messageId = sent.id;
    saveBotState();
  }
}
function startStockLoop() {
  if (!BASE44_APP_ID || !BASE44_API_KEY || !STOCK_CHANNEL_ID) {
    console.log("ℹ️ Stock loop not started (missing BASE44_APP_ID / BASE44_API_KEY / STOCK_CHANNEL_ID).");
    return;
  }
  const interval = Number.isFinite(STOCK_INTERVAL_MS) && STOCK_INTERVAL_MS >= 15000 ? STOCK_INTERVAL_MS : 60000;
  setInterval(async () => {
    for (const guild of client.guilds.cache.values()) {
      postOrEditStockMessage(guild).catch(() => {});
    }
  }, interval);
  console.log(`✅ Stock loop started every ${interval}ms`);
}

/* ====== CLIENT ====== */
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

/* ====== COMMANDS ====== */
function buildCommandsJSON() {
  const settingsCmd = new SlashCommandBuilder()
    .setName("settings")
    .setDescription("Admin: configure this bot.")
    .setDMPermission(false)
    .addSubcommand((s) => s.setName("show").setDescription("Show current settings."))
    .addSubcommand((s) => s.setName("reset").setDescription("Reset settings to defaults."))
    .addSubcommand((s) =>
      s
        .setName("set_staff_role")
        .setDescription("Add/remove/clear staff roles.")
        .addStringOption((o) =>
          o
            .setName("action")
            .setDescription("Choose add/remove/clear")
            .setRequired(true)
            .addChoices({ name: "add", value: "add" }, { name: "remove", value: "remove" }, { name: "clear", value: "clear" })
        )
        .addRoleOption((o) => o.setName("role").setDescription("Role for add/remove").setRequired(false))
    )
    .addSubcommand((s) =>
      s
        .setName("set_channel")
        .setDescription("Set bot channels.")
        .addStringOption((o) =>
          o
            .setName("type")
            .setDescription("Which channel?")
            .setRequired(true)
            .addChoices({ name: "vouches", value: "vouches" }, { name: "join_log", value: "join_log" })
        )
        .addChannelOption((o) =>
          o.setName("channel").setDescription("Text channel").addChannelTypes(ChannelType.GuildText).setRequired(true)
        )
    )
    .addSubcommand((s) =>
      s
        .setName("set_customer_role")
        .setDescription("Set the customer role used by /operation.")
        .addRoleOption((o) => o.setName("role").setDescription("Customer role").setRequired(true))
    )
    .addSubcommand((s) =>
      s
        .setName("set_rewards_webhook")
        .setDescription("Set/clear rewards webhook URL.")
        .addStringOption((o) => o.setName("url").setDescription("Webhook URL or 'clear'").setRequired(true))
    )
    .addSubcommand((s) =>
      s
        .setName("automod")
        .setDescription("Configure link blocker.")
        .addStringOption((o) =>
          o
            .setName("enabled")
            .setDescription("Turn on/off")
            .setRequired(true)
            .addChoices({ name: "on", value: "on" }, { name: "off", value: "off" })
        )
        .addStringOption((o) => o.setName("bypass_role_name").setDescription("Bypass role NAME").setRequired(false))
    );

  const panelCmd = new SlashCommandBuilder()
    .setName("panel")
    .setDescription("Admin: ticket panel.")
    .setDMPermission(false)
    .addSubcommand((sub) =>
      sub.setName("set").setDescription("Save ticket panel JSON.").addStringOption((o) => o.setName("json").setDescription("Panel JSON").setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName("post")
        .setDescription("Post ticket panel.")
        .addChannelOption((o) => o.setName("channel").setDescription("Channel (optional)").addChannelTypes(ChannelType.GuildText).setRequired(false))
    )
    .addSubcommand((sub) => sub.setName("show").setDescription("Show saved panel JSON."))
    .addSubcommand((sub) => sub.setName("reset").setDescription("Reset panel to default."));

  const leaderboardCmd = new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("Top 10 inviters by invites still in server.")
    .setDMPermission(false);

  const stockCmd = new SlashCommandBuilder()
    .setName("stock")
    .setDescription("Stock tools (Base44).")
    .setDMPermission(false)
    .addSubcommand((s) => s.setName("now").setDescription("Fetch stock now (admin)."))
    .addSubcommand((s) => s.setName("status").setDescription("Show stock config status (admin)."));

  const stopCmd = new SlashCommandBuilder()
    .setName("stop")
    .setDescription("OWNER: restrict bot commands in a server.")
    .setDMPermission(false)
    .addStringOption((o) => o.setName("server_id").setDescription("Guild ID").setRequired(true));

  const resumeCmd = new SlashCommandBuilder()
    .setName("resume")
    .setDescription("OWNER: resume bot commands in a server.")
    .setDMPermission(false)
    .addStringOption((o) => o.setName("server_id").setDescription("Guild ID").setRequired(true));

  const syncCmd = new SlashCommandBuilder()
    .setName("sync")
    .setDescription("OWNER: register/clear commands.")
    .setDMPermission(false)
    .addStringOption((o) =>
      o
        .setName("mode")
        .setDescription("Action")
        .setRequired(false)
        .addChoices(
          { name: "register_here", value: "register_here" },
          { name: "clear_here", value: "clear_here" },
          { name: "register_global", value: "register_global" },
          { name: "clear_global", value: "clear_global" }
        )
    );

  const backupCmd = new SlashCommandBuilder().setName("backup").setDescription("OWNER/ADMIN: backup invites data.").setDMPermission(false);
  const restoreCmd = new SlashCommandBuilder().setName("restore").setDescription("OWNER/ADMIN: restore invites data.").setDMPermission(false);

  const embedCmd = new SlashCommandBuilder()
    .setName("embed")
    .setDescription("Admin: send a custom embed.")
    .setDMPermission(false)
    .addChannelOption((o) => o.setName("channel").setDescription("Target channel").addChannelTypes(ChannelType.GuildText).setRequired(false))
    .addStringOption((o) => o.setName("title").setDescription("Embed title").setRequired(false))
    .addStringOption((o) => o.setName("description").setDescription("Embed description").setRequired(false))
    .addStringOption((o) => o.setName("color").setDescription("Hex like #ff0000").setRequired(false))
    .addStringOption((o) => o.setName("url").setDescription("Title URL").setRequired(false))
    .addStringOption((o) => o.setName("thumbnail").setDescription("Thumbnail URL").setRequired(false))
    .addStringOption((o) => o.setName("image").setDescription("Image URL").setRequired(false));

  const calcCmd = new SlashCommandBuilder()
    .setName("calc")
    .setDescription("Calculate + - x / ^ with parentheses.")
    .setDMPermission(false)
    .addStringOption((o) => o.setName("expression").setDescription("Example: (5x2)+3^2/3").setRequired(true));

  const blacklistCmd = new SlashCommandBuilder()
    .setName("blacklist")
    .setDescription("Admin: blacklist users from earning invites.")
    .setDMPermission(false)
    .addSubcommand((s) => s.setName("list").setDescription("List blacklisted users."))
    .addSubcommand((s) =>
      s.setName("add").setDescription("Add a user.")
        .addUserOption((o) => o.setName("user").setDescription("User to blacklist").setRequired(true))
    )
    .addSubcommand((s) =>
      s.setName("remove").setDescription("Remove a user.")
        .addUserOption((o) => o.setName("user").setDescription("User to unblacklist").setRequired(true))
    );

  const vouchesCmd = new SlashCommandBuilder().setName("vouches").setDescription("Count messages in vouches channel.").setDMPermission(false);

  const invitesCmd = new SlashCommandBuilder()
    .setName("invites")
    .setDescription("Show invites still in server for a user.")
    .setDMPermission(false)
    .addUserOption((o) => o.setName("user").setDescription("User to check").setRequired(true));

  const generateCmd = new SlashCommandBuilder().setName("generate").setDescription("Generate your personal invite link.").setDMPermission(false);

  const linkinviteCmd = new SlashCommandBuilder()
    .setName("linkinvite")
    .setDescription("Link an invite code to yourself for credit.")
    .setDMPermission(false)
    .addStringOption((o) => o.setName("code").setDescription("Invite code or link").setRequired(true));

  const addinvitesCmd = new SlashCommandBuilder()
    .setName("addinvites")
    .setDescription("Admin: add invites manually.")
    .setDMPermission(false)
    .addUserOption((o) => o.setName("user").setDescription("User").setRequired(true))
    .addIntegerOption((o) => o.setName("amount").setDescription("Amount to add").setRequired(true));

  const resetinvitesCmd = new SlashCommandBuilder()
    .setName("resetinvites")
    .setDescription("Staff: reset a user's invite stats.")
    .setDMPermission(false)
    .addUserOption((o) => o.setName("user").setDescription("User").setRequired(true));

  const resetallCmd = new SlashCommandBuilder().setName("resetall").setDescription("Admin: reset ALL invite data.").setDMPermission(false);

  const linkCmd = new SlashCommandBuilder()
    .setName("link")
    .setDescription("Staff: show who a user invited + invite codes used.")
    .setDMPermission(false)
    .addUserOption((o) => o.setName("user").setDescription("User to inspect").setRequired(true));

  const closeCmd = new SlashCommandBuilder()
    .setName("close")
    .setDescription("Close this ticket (DMs opener).")
    .setDMPermission(false)
    .addStringOption((o) => o.setName("reason").setDescription("Reason").setRequired(true));

  const opCmd = new SlashCommandBuilder()
    .setName("operation")
    .setDescription("Admin: give customer role + close after timer.")
    .setDMPermission(false)
    .addSubcommand((sub) =>
      sub.setName("start").setDescription("Start operation timer.")
        .addStringOption((o) => o.setName("duration").setDescription("e.g. 10m, 1h, 2d").setRequired(true))
    )
    .addSubcommand((sub) => sub.setName("cancel").setDescription("Cancel operation timer."));

  const giveawayCmd = new SlashCommandBuilder()
    .setName("giveaway")
    .setDescription("Staff: start a giveaway.")
    .setDMPermission(false)
    .addStringOption((o) => o.setName("duration").setDescription("e.g. 30m, 1h").setRequired(true))
    .addIntegerOption((o) => o.setName("winners").setDescription("Number of winners").setRequired(true))
    .addStringOption((o) => o.setName("prize").setDescription("Prize").setRequired(true))
    .addIntegerOption((o) => o.setName("min_invites").setDescription("Min invites to join (optional)").setMinValue(0).setRequired(false));

  const endCmd = new SlashCommandBuilder()
    .setName("end")
    .setDescription("Staff: end a giveaway early.")
    .setDMPermission(false)
    .addStringOption((o) => o.setName("message").setDescription("Giveaway message ID or link").setRequired(true));

  const rerollCmd = new SlashCommandBuilder()
    .setName("reroll")
    .setDescription("Staff: reroll giveaway winners.")
    .setDMPermission(false)
    .addStringOption((o) => o.setName("message").setDescription("Giveaway message ID or link").setRequired(true));

  return [
    settingsCmd,
    panelCmd,
    leaderboardCmd,
    stockCmd,
    stopCmd,
    resumeCmd,
    syncCmd,
    backupCmd,
    restoreCmd,
    embedCmd,
    calcCmd,
    blacklistCmd,
    vouchesCmd,
    invitesCmd,
    generateCmd,
    linkinviteCmd,
    addinvitesCmd,
    resetinvitesCmd,
    resetallCmd,
    linkCmd,
    closeCmd,
    opCmd,
    giveawayCmd,
    endCmd,
    rerollCmd,
  ].map((c) => c.toJSON());
}

function getRest() {
  if (!process.env.TOKEN) throw new Error("Missing TOKEN");
  return new REST({ version: "10" }).setToken(process.env.TOKEN);
}
function getAppId() {
  return client.application?.id || client.user?.id || null;
}
async function registerGlobal() {
  const appId = getAppId();
  if (!appId) throw new Error("App ID not available yet.");
  await getRest().put(Routes.applicationCommands(appId), { body: buildCommandsJSON() });
  console.log("✅ Registered GLOBAL commands");
}
async function registerGuild(guildId) {
  const appId = getAppId();
  if (!appId) throw new Error("App ID not available yet.");
  await getRest().put(Routes.applicationGuildCommands(appId, guildId), { body: buildCommandsJSON() });
  console.log(`✅ Registered GUILD commands for ${guildId}`);
}
async function clearGlobal() {
  const appId = getAppId();
  if (!appId) throw new Error("App ID not available yet.");
  await getRest().put(Routes.applicationCommands(appId), { body: [] });
  console.log("🧹 Cleared GLOBAL commands");
}
async function clearGuild(guildId) {
  const appId = getAppId();
  if (!appId) throw new Error("App ID not available yet.");
  await getRest().put(Routes.applicationGuildCommands(appId, guildId), { body: [] });
  console.log(`🧹 Cleared GUILD commands for ${guildId}`);
}
async function autoRegisterOnStartup() {
  const scope = (process.env.REGISTER_SCOPE || "global").toLowerCase().trim();
  const devGuild = (process.env.DEV_GUILD_ID || "").trim();
  if (scope === "guild") {
    if (!/^\d{10,25}$/.test(devGuild)) throw new Error("REGISTER_SCOPE=guild requires DEV_GUILD_ID");
    await registerGuild(devGuild);
  } else {
    await registerGlobal();
  }
}

/* ====== READY ====== */
client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  try { await client.application.fetch(); } catch {}
  try { await autoRegisterOnStartup(); } catch (e) { console.log("❌ Slash register failed:", e?.message || e); }

  for (const guild of client.guilds.cache.values()) {
    await refreshGuildInvites(guild).catch(() => {});
    getGuildSettings(guild.id);
  }

  for (const messageId of Object.keys(giveawayData.giveaways || {})) {
    const gw = giveawayData.giveaways[messageId];
    if (gw && !gw.ended) scheduleGiveawayEnd(messageId);
  }

  startStockLoop();
  for (const guild of client.guilds.cache.values()) {
    postOrEditStockMessage(guild).catch(() => {});
  }
});

client.on("guildCreate", async (guild) => {
  getGuildSettings(guild.id);
  await refreshGuildInvites(guild).catch(() => {});
  postOrEditStockMessage(guild).catch(() => {});
});

/* ====== INVITE EVENTS ====== */
client.on("inviteCreate", async (invite) => { await refreshGuildInvites(invite.guild).catch(() => {}); });
client.on("inviteDelete", async (invite) => { await refreshGuildInvites(invite.guild).catch(() => {}); });

client.on("guildMemberAdd", async (member) => {
  try {
    const guild = member.guild;
    const s = getGuildSettings(guild.id);
    const logChannelId = s.joinLogChannelId;
    const logChannel = logChannelId ? await guild.channels.fetch(logChannelId).catch(() => null) : null;

    const before = invitesCache.get(guild.id);
    if (!before) {
      if (logChannel && logChannel.type === ChannelType.GuildText) {
        await logChannel.send(`${member} joined. (Couldn't detect inviter — missing invite permissions)`).catch(() => {});
      }
      await refreshGuildInvites(guild).catch(() => {});
      return;
    }

    const invites = await guild.invites.fetch().catch(() => null);
    if (!invites) return;

    let used = null;
    for (const inv of invites.values()) {
      const prev = before.get(inv.code) ?? 0;
      const now = inv.uses ?? 0;
      if (now > prev) { used = inv; break; }
    }

    const after = new Map();
    invites.forEach((inv) => after.set(inv.code, inv.uses ?? 0));
    invitesCache.set(guild.id, after);

    if (!used) {
      if (logChannel && logChannel.type === ChannelType.GuildText) {
        await logChannel.send(`${member} joined. (Couldn't detect invite used)`).catch(() => {});
      }
      return;
    }

    const linkedOwner = invitesData.inviteOwners?.[used.code];
    const creditedInviterId = linkedOwner || used.inviter?.id || null;
    if (!creditedInviterId) return;

    const blacklisted = isBlacklistedInviter(guild.id, creditedInviterId);
    if (!blacklisted) {
      const stats = ensureInviterStats(creditedInviterId);
      if (invitesData.memberInviter[member.id]) stats.rejoins += 1;
      else stats.joins += 1;

      invitesData.memberInviter[member.id] = creditedInviterId;

      invitesData.invitedMembers[creditedInviterId] ??= {};
      invitesData.invitedMembers[creditedInviterId][member.id] = { inviteCode: used.code, joinedAt: Date.now(), active: true, leftAt: null };
      saveInvites();
    }

    const still = invitesStillInServerForGuild(guild.id, creditedInviterId);
    if (logChannel && logChannel.type === ChannelType.GuildText) {
      if (blacklisted) await logChannel.send(`${member} invited by **blacklisted** <@${creditedInviterId}> (invites stay 0).`).catch(() => {});
      else await logChannel.send(`${member} invited by <@${creditedInviterId}> — now **${still}** invites.`).catch(() => {});
    }
  } catch {}
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

/* ====== INTERACTIONS ====== */
client.on("interactionCreate", async (interaction) => {
  try {
    if (!interaction.guild) return;

    const isOwnerCmd = interaction.isChatInputCommand() && ["stop", "resume", "sync", "backup", "restore"].includes(interaction.commandName);
    if (!isOwnerCmd) {
      const blocked = await denyIfStopped(interaction);
      if (blocked) return;
    }

    if (interaction.isButton() && interaction.customId === "rewards_claim_btn") {
      const inv = invitesStillInServerForGuild(interaction.guild.id, interaction.user.id);
      if (inv < 5) return interaction.reply({ content: `❌ Need **5+ invites**. You have **${inv}**.`, ephemeral: true });
      const s = getGuildSettings(interaction.guild.id);
      if (!s.rewardsWebhookUrl) return interaction.reply({ content: "❌ Rewards webhook not set. Admin: /settings set_rewards_webhook", ephemeral: true });
      return interaction.showModal(buildRewardsClaimModal());
    }

    if (interaction.isModalSubmit() && interaction.customId === "rewards_claim_modal") {
      await interaction.deferReply({ ephemeral: true });
      const guild = interaction.guild;
      const s = getGuildSettings(guild.id);
      if (!s.rewardsWebhookUrl) return interaction.editReply("❌ Rewards webhook not set.");

      const mc = (interaction.fields.getTextInputValue("mc") || "").trim();
      const discordName = (interaction.fields.getTextInputValue("discordname") || "").trim();
      if (!mc) return interaction.editReply("❌ Minecraft username required.");
      if (!discordName) return interaction.editReply("❌ Discord username required.");

      const invitesAtClaim = invitesStillInServerForGuild(guild.id, interaction.user.id);
      if (invitesAtClaim < 5) return interaction.editReply(`❌ Need **5+ invites**. You have **${invitesAtClaim}**.`);

      const embed = makeRewardsWebhookEmbed({ guild, user: interaction.user, mc, discordName, invitesAtClaim });
      try {
        await sendWebhook(s.rewardsWebhookUrl, { username: "DonutDemand Rewards", embeds: [embed.toJSON()] });
      } catch (e) {
        return interaction.editReply(`❌ Webhook failed (invites NOT reset): ${String(e?.message || e).slice(0, 180)}`);
      }
      resetInvitesForUser(interaction.user.id);
      return interaction.editReply(`✅ Claim submitted. Invites reset. Payout will be reviewed for **${mc}**.`);
    }

    if (interaction.isButton() && interaction.customId === "ticket_close_btn") {
      if (!isTicketChannel(interaction.channel)) return interaction.reply({ content: "Only works in tickets.", ephemeral: true });
      const meta = getTicketMetaFromTopic(interaction.channel.topic);
      const openerId = meta?.openerId;
      const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
      const canClose = isOwner(interaction.user.id) || interaction.user.id === openerId || isStaff(member);
      if (!canClose) return interaction.reply({ content: "Only opener or staff.", ephemeral: true });

      const modal = new ModalBuilder().setCustomId("ticket_close_modal").setTitle("Close Ticket");
      const reasonInput = new TextInputBuilder()
        .setCustomId("reason")
        .setLabel("Reason")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(400);
      modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
      return interaction.showModal(modal);
    }

    if (interaction.isModalSubmit() && interaction.customId === "ticket_close_modal") {
      if (!isTicketChannel(interaction.channel)) return interaction.reply({ content: "Only works in tickets.", ephemeral: true });
      const meta = getTicketMetaFromTopic(interaction.channel.topic);
      const openerId = meta?.openerId;
      const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
      const canClose = isOwner(interaction.user.id) || interaction.user.id === openerId || isStaff(member);
      if (!canClose) return interaction.reply({ content: "Only opener or staff.", ephemeral: true });

      const reason = (interaction.fields.getTextInputValue("reason") || "").trim() || "No reason provided";
      await interaction.reply({ content: "✅ Closing ticket...", ephemeral: true });
      await closeTicketFlow({ channel: interaction.channel, guild: interaction.guild, closerUser: interaction.user, reason });
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith("ticket:")) {
      const typeId = interaction.customId.split("ticket:")[1];
      const config = getPanelConfig(interaction.guild.id);
      const ticketType = resolveTicketType(config, typeId);
      if (!ticketType) return interaction.reply({ content: "Ticket type not found.", ephemeral: true });

      if (isRewardsTicket(ticketType)) {
        const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
        if (!member) return interaction.reply({ content: "Couldn't verify invites.", ephemeral: true });
        const gate = canOpenRewardsTicket(member);
        if (!gate.ok) return interaction.reply({ content: `❌ Rewards ticket needs **5+ invites**. You have **${gate.invites}**.`, ephemeral: true });
      }

      const existing = findOpenTicketChannel(interaction.guild, interaction.user.id);
      if (existing) return interaction.reply({ content: `❌ You already have an open ticket: ${existing}`, ephemeral: true });

      const modal = new ModalBuilder()
        .setCustomId(`ticket_modal:${ticketType.id}`)
        .setTitle(String(config.modal?.title || "Ticket Info").slice(0, 45));

      const mcInput = new TextInputBuilder()
        .setCustomId("mc")
        .setLabel(String(config.modal?.mcLabel || "Minecraft username?").slice(0, 45))
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

    if (interaction.isModalSubmit() && interaction.customId.startsWith("ticket_modal:")) {
      await interaction.deferReply({ ephemeral: true });

      const existing = findOpenTicketChannel(interaction.guild, interaction.user.id);
      if (existing) return interaction.editReply(`❌ You already have an open ticket: ${existing}`);

      const typeId = interaction.customId.split("ticket_modal:")[1];
      const config = getPanelConfig(interaction.guild.id);
      const type = resolveTicketType(config, typeId);
      if (!type) return interaction.editReply("Invalid ticket type.");

      const mc = (interaction.fields.getTextInputValue("mc") || "").trim();
      const need = (interaction.fields.getTextInputValue("need") || "").trim();

      const category = await getOrCreateCategory(interaction.guild, type.category);
      const channelName = `${type.key}-${cleanName(interaction.user.username)}`.slice(0, 90);

      const s = getGuildSettings(interaction.guild.id);
      const overwrites = [
        { id: interaction.guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
        { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
        ...(s.staffRoleIds || []).map((rid) => ({ id: rid, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] })),
      ];

      const createdAt = Date.now();
      const channel = await interaction.guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        parent: category.id,
        topic: `opener:${interaction.user.id};created:${createdAt};type:${type.id}`,
        permissionOverwrites: overwrites,
      });

      const insideEmbed = buildTicketInsideEmbed({ typeLabel: type.label, user: interaction.user, mc, need, createdAtMs: createdAt });
      await channel.send({ content: `${interaction.user} — ticket created ✅`, embeds: [insideEmbed], components: [buildTicketControlRow()] });
      return interaction.editReply(`✅ Ticket created: ${channel}`);
    }

    if (interaction.isButton() && interaction.customId.startsWith("gw_join:")) {
      const messageId = interaction.customId.split("gw_join:")[1];
      const gw = giveawayData.giveaways[messageId];
      if (!gw) return interaction.reply({ content: "Giveaway not found.", ephemeral: true });
      if (gw.ended) return interaction.reply({ content: "Giveaway ended.", ephemeral: true });
      const need = gw.minInvites || 0;
      if (need > 0) {
        const have = invitesStillInServerForGuild(interaction.guild.id, interaction.user.id);
        if (have < need) return interaction.reply({ content: `❌ Need **${need}** invites. You have **${have}**.`, ephemeral: true });
      }
      const userId = interaction.user.id;
      const idx = gw.entries.indexOf(userId);
      if (idx === -1) gw.entries.push(userId); else gw.entries.splice(idx, 1);
      saveGiveaways();
      try {
        const channel = await client.channels.fetch(gw.channelId);
        const msg = await channel.messages.fetch(gw.messageId);
        await msg.edit({ embeds: [makeGiveawayEmbed(gw)], components: [giveawayRow(gw)] });
      } catch {}
      return interaction.reply({ content: idx === -1 ? "✅ Entered!" : "✅ Removed entry.", ephemeral: true });
    }

    if (!interaction.isChatInputCommand()) return;

    const name = interaction.commandName;

    if (name === "sync") {
      if (!isOwner(interaction.user.id)) return interaction.reply({ content: "Only Adam can use this.", ephemeral: true });
      const mode = interaction.options.getString("mode", false) || "register_here";
      await interaction.deferReply({ ephemeral: true });
      try {
        if (mode === "clear_here") { await clearGuild(interaction.guild.id); return interaction.editReply("🧹 Cleared HERE. Now /sync register_here"); }
        if (mode === "register_here") { await registerGuild(interaction.guild.id); return interaction.editReply("✅ Registered HERE."); }
        if (mode === "clear_global") { await clearGlobal(); return interaction.editReply("🧹 Cleared GLOBAL."); }
        if (mode === "register_global") { await registerGlobal(); return interaction.editReply("✅ Registered GLOBAL."); }
        return interaction.editReply("Unknown mode.");
      } catch (e) {
        return interaction.editReply(`❌ Sync failed: ${e?.message || e}`);
      }
    }

    if (name === "stop" || name === "resume") {
      if (!isOwner(interaction.user.id)) return interaction.reply({ content: "Only Adam can use this.", ephemeral: true });
      const guildId = interaction.options.getString("server_id", true).trim();
      if (!/^\d{10,25}$/.test(guildId)) return interaction.reply({ content: "Invalid server ID.", ephemeral: true });
      if (name === "stop") {
        botState.stoppedGuilds[guildId] = true;
        saveBotState();
        return interaction.reply({ content: `✅ Restricted commands in server: ${guildId}`, ephemeral: true });
      } else {
        delete botState.stoppedGuilds[guildId];
        saveBotState();
        return interaction.reply({ content: `✅ Resumed commands in server: ${guildId}`, ephemeral: true });
      }
    }

    if (name === "backup") {
      const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
      if (!member || (!isOwner(interaction.user.id) && !member.permissions.has(PermissionsBitField.Flags.Administrator))) {
        return interaction.reply({ content: "Admins only.", ephemeral: true });
      }
      doBackupInvites();
      return interaction.reply({ content: "✅ Backed up invites to invites_backup.json" });
    }

    if (name === "restore") {
      const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
      if (!member || (!isOwner(interaction.user.id) && !member.permissions.has(PermissionsBitField.Flags.Administrator))) {
        return interaction.reply({ content: "Admins only.", ephemeral: true });
      }
      const res = doRestoreInvites();
      return interaction.reply({ content: res.ok ? `✅ ${res.msg}` : `❌ ${res.msg}` });
    }

    if (name === "stock") {
      const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
      if (!member || !isAdminOrOwner(member)) return interaction.reply({ content: "Admins only.", ephemeral: true });

      const sub = interaction.options.getSubcommand();
      if (sub === "status") {
        return interaction.reply({
          ephemeral: true,
          content:
            `BASE44_API_URL: ${BASE44_API_URL}\n` +
            `BASE44_APP_ID: ${BASE44_APP_ID ? "set" : "missing"}\n` +
            `BASE44_API_KEY: ${BASE44_API_KEY ? "set" : "missing"}\n` +
            `STOCK_CHANNEL_ID: ${STOCK_CHANNEL_ID || "missing"}\n` +
            `STOCK_INTERVAL_MS: ${Number.isFinite(STOCK_INTERVAL_MS) ? STOCK_INTERVAL_MS : "invalid"}\n`,
        });
      }
      await interaction.deferReply({ ephemeral: true });
      try {
        await postOrEditStockMessage(interaction.guild);
        return interaction.editReply("✅ Stock updated.");
      } catch (e) {
        return interaction.editReply(`❌ Stock update failed: ${String(e?.message || e).slice(0, 200)}`);
      }
    }

    if (name === "leaderboard") {
      await interaction.deferReply({ ephemeral: false });
      const rows = [];
      for (const inviterId of Object.keys(invitesData.inviterStats || {})) {
        if (isBlacklistedInviter(interaction.guild.id, inviterId)) continue;
        const count = invitesStillInServerForGuild(interaction.guild.id, inviterId);
        if (count <= 0) continue;
        rows.push({ inviterId, count });
      }
      rows.sort((a, b) => b.count - a.count);
      const top = rows.slice(0, 10);
      if (!top.length) return interaction.editReply("No invite data yet.");
      const lines = top.map((r, i) => `**${i + 1}.** <@${r.inviterId}> — **${r.count}** invites`);
      const embed = new EmbedBuilder()
        .setTitle("📈 Invite Leaderboard")
        .setColor(0xed4245)
        .setDescription(lines.join("\n"))
        .setTimestamp();
      return interaction.editReply({ embeds: [embed] });
    }

    if (name === "calc") {
      const expr = interaction.options.getString("expression", true);
      try {
        const result = calcExpression(expr);
        const out = formatCalcResult(result);
        if (out === null) return interaction.reply("Invalid calculation.");
        return interaction.reply(`🧮 Result: **${out}**`);
      } catch {
        return interaction.reply("Invalid calculation format.");
      }
    }

    if (name === "blacklist") {
      const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
      if (!member || (!isOwner(interaction.user.id) && !member.permissions.has(PermissionsBitField.Flags.Administrator))) {
        return interaction.reply({ content: "Admins only.", ephemeral: true });
      }
      const sub = interaction.options.getSubcommand();
      const s = getGuildSettings(interaction.guild.id);

      if (sub === "list") {
        const list = (s.invitesBlacklist || []).slice(0, 50);
        if (!list.length) return interaction.reply("Blacklist is empty.");
        return interaction.reply(`🚫 Blacklisted:\n${list.map((id) => `• <@${id}> (\`${id}\`)`).join("\n")}`);
      }

      const user = interaction.options.getUser("user", true);

      if (sub === "add") {
        if (!s.invitesBlacklist.includes(String(user.id))) s.invitesBlacklist.push(String(user.id));
        saveSettings();
        invitesData.inviterStats[user.id] = { joins: 0, rejoins: 0, left: 0, manual: 0 };
        delete invitesData.invitedMembers[user.id];
        saveInvites();
        return interaction.reply(`✅ Blacklisted ${user}. Invites stay 0.`);
      }

      if (sub === "remove") {
        s.invitesBlacklist = (s.invitesBlacklist || []).filter((x) => String(x) !== String(user.id));
        saveSettings();
        return interaction.reply(`✅ Removed ${user} from blacklist.`);
      }
    }

    if (name === "settings") {
      const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
      if (!member || !isAdminOrOwner(member)) return interaction.reply({ content: "Admins only.", ephemeral: true });

      const sub = interaction.options.getSubcommand();
      const s = getGuildSettings(interaction.guild.id);

      if (sub === "show") {
        const safe = {
          staffRoleIds: s.staffRoleIds,
          vouchesChannelId: s.vouchesChannelId,
          joinLogChannelId: s.joinLogChannelId,
          customerRoleId: s.customerRoleId,
          invitesBlacklist: s.invitesBlacklist,
          rewardsWebhookUrl: s.rewardsWebhookUrl ? "set" : null,
          automod: s.automod,
        };
        return interaction.reply({ content: "```json\n" + JSON.stringify(safe, null, 2).slice(0, 1800) + "\n```", ephemeral: true });
      }

      if (sub === "reset") {
        settingsStore.byGuild[interaction.guild.id] = defaultGuildSettings();
        saveSettings();
        return interaction.reply({ content: "✅ Settings reset.", ephemeral: true });
      }

      if (sub === "set_staff_role") {
        const action = interaction.options.getString("action", true);
        const role = interaction.options.getRole("role", false);

        if (action === "clear") {
          s.staffRoleIds = [];
          saveSettings();
          return interaction.reply({ content: "✅ Cleared staff roles.", ephemeral: true });
        }
        if (!role) return interaction.reply({ content: "Pick a role.", ephemeral: true });

        s.staffRoleIds ??= [];
        if (action === "add") {
          if (!s.staffRoleIds.includes(role.id)) s.staffRoleIds.push(role.id);
          saveSettings();
          return interaction.reply({ content: `✅ Added staff role: ${role}`, ephemeral: true });
        }
        if (action === "remove") {
          s.staffRoleIds = s.staffRoleIds.filter((x) => x !== role.id);
          saveSettings();
          return interaction.reply({ content: `✅ Removed staff role: ${role}`, ephemeral: true });
        }
      }

      if (sub === "set_channel") {
        const type = interaction.options.getString("type", true);
        const channel = interaction.options.getChannel("channel", true);
        if (type === "vouches") s.vouchesChannelId = channel.id;
        if (type === "join_log") s.joinLogChannelId = channel.id;
        saveSettings();
        return interaction.reply({ content: `✅ Set ${type} channel to ${channel}.`, ephemeral: true });
      }

      if (sub === "set_customer_role") {
        const role = interaction.options.getRole("role", true);
        s.customerRoleId = role.id;
        saveSettings();
        return interaction.reply({ content: `✅ Customer role set to ${role}.`, ephemeral: true });
      }

      if (sub === "set_rewards_webhook") {
        const url = (interaction.options.getString("url", true) || "").trim();
        if (url.toLowerCase() === "clear") {
          s.rewardsWebhookUrl = null;
          saveSettings();
          return interaction.reply({ content: "✅ Rewards webhook cleared.", ephemeral: true });
        }
        if (!/^https?:\/\/(.*)discord\.com\/api\/webhooks\/\d+\/[\w-]+/i.test(url)) {
          return interaction.reply({ content: "❌ That doesn’t look like a Discord webhook URL.", ephemeral: true });
        }
        s.rewardsWebhookUrl = url.slice(0, 500);
        saveSettings();
        return interaction.reply({ content: "✅ Rewards webhook set.", ephemeral: true });
      }

      if (sub === "automod") {
        const enabled = interaction.options.getString("enabled", true) === "on";
        const bypassName = interaction.options.getString("bypass_role_name", false);
        s.automod.enabled = enabled;
        if (bypassName && bypassName.trim()) s.automod.bypassRoleName = bypassName.trim().slice(0, 50);
        saveSettings();
        return interaction.reply({ content: `✅ Automod is **${enabled ? "ON" : "OFF"}**. Bypass role name: **${s.automod.bypassRoleName}**`, ephemeral: true });
      }
    }

    if (name === "panel") {
      const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
      if (!member || !isAdminOrOwner(member)) return interaction.reply({ content: "Admins only.", ephemeral: true });

      const sub = interaction.options.getSubcommand();

      if (sub === "show") {
        const cfg = getPanelConfig(interaction.guild.id);
        const json = JSON.stringify(cfg, null, 2);
        if (json.length > 1800) return interaction.reply({ content: "Config too large to show here.", ephemeral: true });
        return interaction.reply({ content: "```json\n" + json + "\n```", ephemeral: true });
      }

      if (sub === "reset") {
        delete panelStore.byGuild[interaction.guild.id];
        savePanelStore();
        return interaction.reply({ content: "✅ Panel reset to default.", ephemeral: true });
      }

      if (sub === "set") {
        const raw = interaction.options.getString("json", true);
        if (raw.length > 6000) return interaction.reply({ content: "❌ JSON too long.", ephemeral: true });
        let cfg;
        try { cfg = JSON.parse(raw); } catch { return interaction.reply({ content: "❌ Invalid JSON.", ephemeral: true }); }
        const v = validatePanelConfig(cfg);
        if (!v.ok) return interaction.reply({ content: `❌ ${v.msg}`, ephemeral: true });
        panelStore.byGuild[interaction.guild.id] ??= {};
        panelStore.byGuild[interaction.guild.id].ticketPanel = cfg;
        savePanelStore();
        return interaction.reply({ content: "✅ Saved panel config.", ephemeral: true });
      }

      if (sub === "post") {
        const cfg = getPanelConfig(interaction.guild.id);
        const targetChannel = interaction.options.getChannel("channel", false) || interaction.channel;
        if (!targetChannel || targetChannel.type !== ChannelType.GuildText) return interaction.reply({ content: "Invalid channel.", ephemeral: true });
        const v = validatePanelConfig(cfg);
        if (!v.ok) return interaction.reply({ content: `❌ Saved config invalid: ${v.msg}`, ephemeral: true });
        await targetChannel.send(buildTicketPanelMessage(cfg));
        return interaction.reply({ content: "✅ Posted ticket panel.", ephemeral: true });
      }
    }

    if (name === "embed") {
      const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
      if (!member || (!isOwner(interaction.user.id) && !member.permissions.has(PermissionsBitField.Flags.Administrator))) {
        return interaction.reply({ content: "Admins only.", ephemeral: true });
      }
      const targetChannel = interaction.options.getChannel("channel", false) || interaction.channel;
      if (!targetChannel || targetChannel.type !== ChannelType.GuildText) return interaction.reply({ content: "Invalid channel.", ephemeral: true });

      const title = interaction.options.getString("title", false);
      const description = interaction.options.getString("description", false);
      const colorInput = interaction.options.getString("color", false);
      const url = interaction.options.getString("url", false);
      const thumbnail = interaction.options.getString("thumbnail", false);
      const image = interaction.options.getString("image", false);

      if (!title && !description && !thumbnail && !image) return interaction.reply({ content: "Provide at least title/description/image/thumbnail.", ephemeral: true });

      const e = new EmbedBuilder();
      if (title) e.setTitle(String(title).slice(0, 256));
      if (description) e.setDescription(String(description).slice(0, 4096));
      if (url) e.setURL(url);
      const c = parseHexColor(colorInput);
      e.setColor(c !== null ? c : 0x2b2d31);
      if (thumbnail) e.setThumbnail(thumbnail);
      if (image) e.setImage(image);

      await targetChannel.send({ embeds: [e] });
      return interaction.reply({ content: "✅ Sent embed.", ephemeral: true });
    }

    if (name === "vouches") {
      const s = getGuildSettings(interaction.guild.id);
      if (!s.vouchesChannelId) return interaction.reply({ content: "Set vouches channel: /settings set_channel", ephemeral: true });
      await interaction.deferReply({ ephemeral: false });
      const channel = await interaction.guild.channels.fetch(s.vouchesChannelId).catch(() => null);
      if (!channel || channel.type !== ChannelType.GuildText) return interaction.editReply("Vouches channel not found.");
      let total = 0, lastId;
      while (true) {
        const msgs = await channel.messages.fetch({ limit: 100, before: lastId });
        total += msgs.size;
        if (msgs.size < 100) break;
        lastId = msgs.last()?.id;
        if (!lastId) break;
      }
      return interaction.editReply(`This server has **${total}** vouch message(s).`);
    }

    if (name === "invites") {
      const user = interaction.options.getUser("user", true);
      const blacklisted = isBlacklistedInviter(interaction.guild.id, user.id);
      const count = invitesStillInServerForGuild(interaction.guild.id, user.id);
      return interaction.reply({
        content: blacklisted
          ? `📨 **${user.tag}** is **blacklisted** — invites stay **0**.`
          : `📨 **${user.tag}** has **${count}** invites still in the server.`,
      });
    }

    if (name === "generate") {
      const me = await interaction.guild.members.fetchMe();
      const canCreate = interaction.channel.permissionsFor(me)?.has(PermissionsBitField.Flags.CreateInstantInvite);
      if (!canCreate) return interaction.reply({ content: "❌ I need Create Invite permission here.", ephemeral: true });

      const invite = await interaction.channel.createInvite({ maxAge: 0, maxUses: 0, unique: true, reason: `Invite generated for ${interaction.user.tag}` });
      invitesData.inviteOwners[invite.code] = interaction.user.id;
      saveInvites();

      const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel("Open Invite").setURL(invite.url));
      return interaction.reply({ content: `✅ Your invite (credited to you):\n${invite.url}`, components: [row], ephemeral: true });
    }

    if (name === "linkinvite") {
      const input = interaction.options.getString("code", true);
      const code = extractInviteCode(input);
      if (!code) return interaction.reply({ content: "❌ Invalid invite code.", ephemeral: true });

      const invites = await interaction.guild.invites.fetch().catch(() => null);
      if (!invites) return interaction.reply({ content: "❌ I need invite permissions to verify codes.", ephemeral: true });

      const found = invites.find((inv) => inv.code === code);
      if (!found) return interaction.reply({ content: "❌ Invite code not found in this server.", ephemeral: true });

      invitesData.inviteOwners[code] = interaction.user.id;
      saveInvites();
      return interaction.reply({ content: `✅ Linked invite **${code}** to you.`, ephemeral: true });
    }

    if (name === "addinvites") {
      const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
      if (!member || (!isOwner(interaction.user.id) && !member.permissions.has(PermissionsBitField.Flags.Administrator))) {
        return interaction.reply({ content: "Admins only.", ephemeral: true });
      }
      const user = interaction.options.getUser("user", true);
      const amount = interaction.options.getInteger("amount", true);
      if (isBlacklistedInviter(interaction.guild.id, user.id)) return interaction.reply(`❌ ${user} is blacklisted — invites must stay 0.`);
      const st = ensureInviterStats(user.id);
      st.manual += amount;
      saveInvites();
      return interaction.reply({ content: `✅ Added **${amount}** invites to **${user.tag}**.` });
    }

    if (name === "resetinvites") {
      const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
      if (!member || (!isOwner(interaction.user.id) && !isStaff(member))) {
        return interaction.reply({ content: "Staff only (set staff roles in /settings).", ephemeral: true });
      }
      const user = interaction.options.getUser("user", true);
      resetInvitesForUser(user.id);
      return interaction.reply({ content: `✅ Reset invites for **${user.tag}**.` });
    }

    if (name === "resetall") {
      const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
      if (!member || (!isOwner(interaction.user.id) && !member.permissions.has(PermissionsBitField.Flags.Administrator))) {
        return interaction.reply({ content: "Admins only.", ephemeral: true });
      }
      invitesData.inviterStats = {};
      invitesData.memberInviter = {};
      invitesData.inviteOwners = {};
      invitesData.invitedMembers = {};
      saveInvites();
      return interaction.reply({ content: "✅ Reset invite stats for everyone.", ephemeral: true });
    }

    if (name === "link") {
      const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
      if (!member || (!isOwner(interaction.user.id) && !isStaff(member))) {
        return interaction.reply({ content: "Staff only.", ephemeral: true });
      }
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
      if (guildInvites) guildInvites.forEach((inv) => { if (inv.inviter?.id === target.id) codes.add(inv.code); });
      for (const [code, ownerId] of Object.entries(invitesData.inviteOwners || {})) if (ownerId === target.id) codes.add(code);

      const codeList = [...codes].slice(0, 15);
      const inviteLinks = codeList.length ? codeList.map((c) => `https://discord.gg/${c}`).join("\n") : "None found.";
      const listText = activeInvited.length
        ? activeInvited.slice(0, 30).map((x, i) => `${i + 1}. ${x.tag} (code: ${x.code})`).join("\n")
        : "No active invited members found.";

      return interaction.reply({
        ephemeral: true,
        content: `**Invites for:** ${target.tag}\n\n**Active invited members:**\n${listText}\n\n**Invite link(s):**\n${inviteLinks}`,
      });
    }

    if (name === "close") {
      const channel = interaction.channel;
      if (!isTicketChannel(channel)) return interaction.reply({ content: "Use /close inside a ticket channel.", ephemeral: true });
      const meta = getTicketMetaFromTopic(channel.topic);
      const openerId = meta?.openerId;
      const reason = interaction.options.getString("reason", true);
      const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
      const canClose = isOwner(interaction.user.id) || interaction.user.id === openerId || isStaff(member);
      if (!canClose) return interaction.reply({ content: "Only opener or staff.", ephemeral: true });
      await interaction.reply({ content: "✅ Closing ticket...", ephemeral: true });
      await closeTicketFlow({ channel, guild: interaction.guild, closerUser: interaction.user, reason });
      return;
    }

    if (name === "operation") {
      const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
      if (!member || (!isOwner(interaction.user.id) && !member.permissions.has(PermissionsBitField.Flags.Administrator))) {
        return interaction.reply({ content: "Admins only.", ephemeral: true });
      }
      if (!isTicketChannel(interaction.channel)) return interaction.reply({ content: "Use /operation inside a ticket.", ephemeral: true });

      const sub = interaction.options.getSubcommand();
      if (sub === "cancel") {
        if (!activeOperations.has(interaction.channel.id)) return interaction.reply({ content: "No active timer.", ephemeral: true });
        clearTimeout(activeOperations.get(interaction.channel.id));
        activeOperations.delete(interaction.channel.id);
        return interaction.reply({ content: "🛑 Operation cancelled.", ephemeral: true });
      }

      const durationStr = interaction.options.getString("duration", true);
      const ms = parseDurationToMs(durationStr);
      if (!ms) return interaction.reply({ content: "Invalid duration (10m, 1h, 2d).", ephemeral: true });

      const meta = getTicketMetaFromTopic(interaction.channel.topic);
      const openerId = meta?.openerId;
      if (!openerId) return interaction.reply({ content: "Couldn't find opener.", ephemeral: true });

      const s = getGuildSettings(interaction.guild.id);
      if (!s.customerRoleId) return interaction.reply({ content: "Set customer role: /settings set_customer_role", ephemeral: true });

      const openerMember = await interaction.guild.members.fetch(openerId).catch(() => null);
      if (!openerMember) return interaction.reply({ content: "Couldn't fetch opener.", ephemeral: true });

      const botMe = await interaction.guild.members.fetchMe();
      if (!botMe.permissions.has(PermissionsBitField.Flags.ManageRoles)) return interaction.reply({ content: "I need Manage Roles.", ephemeral: true });

      const role = await interaction.guild.roles.fetch(s.customerRoleId).catch(() => null);
      if (!role) return interaction.reply({ content: "Customer role not found.", ephemeral: true });
      if (role.position >= botMe.roles.highest.position) return interaction.reply({ content: "Move bot role above customer role.", ephemeral: true });

      await openerMember.roles.add(role, `Customer role given by /operation from ${interaction.user.tag}`).catch(() => {});
      if (s.vouchesChannelId) await interaction.channel.send(`<@${openerId}> please vouch in <#${s.vouchesChannelId}>. Thank you!`).catch(() => {});

      if (activeOperations.has(interaction.channel.id)) {
        clearTimeout(activeOperations.get(interaction.channel.id));
        activeOperations.delete(interaction.channel.id);
      }

      const channelId = interaction.channel.id;
      const timeout = setTimeout(async () => {
        const ch = await client.channels.fetch(channelId).catch(() => null);
        if (!ch || ch.type !== ChannelType.GuildText) return;
        ch.delete().catch(() => {});
        activeOperations.delete(channelId);
      }, ms);

      activeOperations.set(channelId, timeout);
      return interaction.reply({ content: `✅ Operation started. Ticket closes in **${durationStr}**.`, ephemeral: true });
    }

    if (name === "giveaway") {
      const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
      if (!member || (!isOwner(interaction.user.id) && !isStaff(member))) return interaction.reply({ content: "Staff only.", ephemeral: true });

      const durationStr = interaction.options.getString("duration", true);
      const winners = interaction.options.getInteger("winners", true);
      const prize = interaction.options.getString("prize", true).trim();
      const minInvites = interaction.options.getInteger("min_invites", false) ?? 0;

      const ms = parseDurationToMs(durationStr);
      if (!ms) return interaction.reply({ content: "Invalid duration.", ephemeral: true });
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

    if (name === "end") {
      const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
      if (!member || (!isOwner(interaction.user.id) && !isStaff(member))) return interaction.reply({ content: "Staff only.", ephemeral: true });
      const raw = interaction.options.getString("message", true);
      const messageId = extractMessageId(raw);
      if (!messageId) return interaction.reply({ content: "Invalid message ID/link.", ephemeral: true });
      await interaction.deferReply({ ephemeral: true });
      const res = await endGiveaway(messageId, interaction.user.id);
      return interaction.editReply(res.ok ? "✅ Giveaway ended." : `❌ ${res.msg}`);
    }

    if (name === "reroll") {
      const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
      if (!member || (!isOwner(interaction.user.id) && !isStaff(member))) return interaction.reply({ content: "Staff only.", ephemeral: true });
      const raw = interaction.options.getString("message", true);
      const messageId = extractMessageId(raw);
      if (!messageId) return interaction.reply({ content: "Invalid message ID/link.", ephemeral: true });
      await interaction.deferReply({ ephemeral: true });
      const res = await rerollGiveaway(messageId, interaction.user.id);
      return interaction.editReply(res.ok ? "✅ Rerolled winners." : `❌ ${res.msg}`);
    }
  } catch (e) {
    console.error("interaction error:", e);
    try {
      if (interaction?.isRepliable?.() && !interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: "Error handling that interaction.", ephemeral: true });
      }
    } catch {}
  }
});

/* ====== MESSAGE HANDLER (AUTOMOD + !calc + !sync) ====== */
client.on("messageCreate", async (message) => {
  try {
    if (!message.guild || message.author.bot) return;

    if (!isOwner(message.author.id) && isStopped(message.guild.id)) {
      await message.channel.send("Adam has restricted commands in your server.").catch(() => {});
      return;
    }

    const s = getGuildSettings(message.guild.id);

    if (s.automod?.enabled && containsLink(message.content) && !isOwner(message.author.id)) {
      const member = message.member;
      if (member) {
        const isAdmin = member.permissions.has(PermissionsBitField.Flags.Administrator);
        const bypassRoleName = String(s.automod?.bypassRoleName || "automod").toLowerCase();
        const bypassRole = message.guild.roles.cache.find((r) => r.name.toLowerCase() === bypassRoleName);
        const hasBypass = bypassRole ? member.roles.cache.has(bypassRole.id) : false;
        if (!isAdmin && !hasBypass) {
          await message.delete().catch(() => {});
          message.channel.send(`🚫 ${member}, links aren’t allowed unless you have **${bypassRoleName}** role.`)
            .then((m) => setTimeout(() => m.delete().catch(() => {}), 5000))
            .catch(() => {});
          return;
        }
      }
    }

    const canUsePrefix = isOwner(message.author.id) || message.member?.permissions?.has(PermissionsBitField.Flags.Administrator);

    if (message.content.startsWith(PREFIX) && canUsePrefix) {
      const parts = message.content.slice(PREFIX.length).trim().split(/\s+/);
      const cmd = (parts.shift() || "").toLowerCase();
      const text = message.content.slice(PREFIX.length + cmd.length + 1);

      if (cmd === "calc") {
        if (!text || !text.trim()) return message.reply("Usage: `!calc (5x2)+3^2/3`");
        try {
          const result = calcExpression(text);
          const out = formatCalcResult(result);
          if (out === null) return message.reply("Invalid calculation.");
          return message.reply(`🧮 Result: **${out}**`);
        } catch {
          return message.reply("Invalid calculation format.");
        }
      }

      if (cmd === "sync" && isOwner(message.author.id)) {
        const mode = (parts[0] || "register_here").toLowerCase();
        try {
          if (mode === "clear_here") { await clearGuild(message.guild.id); return message.reply("🧹 Cleared HERE. Now `!sync register_here`."); }
          if (mode === "register_here") { await registerGuild(message.guild.id); return message.reply("✅ Registered HERE."); }
          if (mode === "clear_global") { await clearGlobal(); return message.reply("🧹 Cleared GLOBAL."); }
          if (mode === "register_global") { await registerGlobal(); return message.reply("✅ Registered GLOBAL."); }
        } catch (e) {
          return message.reply(`❌ Sync failed: ${e?.message || e}`);
        }
      }
    }
  } catch (e) {
    console.error("messageCreate error:", e);
  }
});

/* ====== LOGIN ====== */
if (!process.env.TOKEN) {
  console.error("❌ Missing TOKEN");
  process.exit(1);
}
client.login(process.env.TOKEN);
