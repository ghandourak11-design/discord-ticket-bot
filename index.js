// Merged Discord Bot — DonutDemand (discord-ticket-bot + DonutDemand1)
// Combines restock notifications, loyalty stats, order polling, transcripts
// with ticket panels, invite tracking, giveaways, SOS games, bid auctions, and more.

/* ===================== CRASH PROTECTION ===================== */
process.on("unhandledRejection", (reason) => console.error("unhandledRejection:", reason));
process.on("uncaughtException", (err) => console.error("uncaughtException:", err));

require('dotenv').config();

const {
    Client,
    GatewayIntentBits,
    Partials,
    ChannelType,
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    RoleSelectMenuBuilder,
    ChannelSelectMenuBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    PermissionFlagsBits,
    PermissionsBitField,
    AuditLogEvent,
    REST,
    Routes,
} = require('discord.js');
const https = require('https');
const fs = require('fs');
const path = require('path');

/* ===================== CONFIG HELPERS (for config.json) ===================== */
const CONFIG_PATH = path.join(__dirname, 'config.json');

function loadConfig() {
    if (!fs.existsSync(CONFIG_PATH)) return {};
    try {
        return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    } catch (err) {
        console.error('Failed to parse config.json:', err);
        return {};
    }
}

function saveConfig(data) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2), 'utf8');
}

/* ===================== CONSTANTS ===================== */
const BOT_OWNER_ID = process.env.BOT_OWNER_ID || process.env.OWNER_ID || '1456326972631154786';
const OWNER_ID = BOT_OWNER_ID; // compatibility alias
const PREFIX = '!';
const token = process.env.DISCORD_TOKEN || process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

// Restock / product button IDs
const SHOW_STOCK_BUTTON_ID = 'show_current_stock';
const ORDER_NOW_BUTTON_ID = 'order_now';
const UPDATESTOCK_SELECT_PREFIX = 'updatestock_select:';
const EDITPRODUCT_SELECT_PREFIX = 'editproduct_select:';
const VALUE_SEPARATOR = '::::';
const VERIFY_AUTH_BUTTON_ID = 'verify_auth_button';
const ORDER_POLL_INTERVAL_MS = 3 * 1000;

// Transcript system
const TRANSCRIPT_BUTTON_PREFIX = 'view_transcript:';
const TRANSCRIPT_EXPIRY_MS = 24 * 60 * 60 * 1000;
const AUDIT_LOG_MAX_AGE_MS = 10000;
const transcriptStore = new Map();

// Pending edits map
const pendingEdits = new Map();

/* ===================== BASE44 API CONSTANTS ===================== */
const BASE44_API_BASE_URL = process.env.BASE44_API_URL || 'https://app.base44.com';
const STATS_API_KEY = process.env.BASE44_API_KEY || '';
const BASE44_APP_ID = process.env.BASE44_APP_ID || '698bba4e9e06a075e7c32be6';

const PRODUCT_API_URL =
    `${BASE44_API_BASE_URL.replace(/\/$/, '')}/api/apps/${BASE44_APP_ID}/entities/Product`;
const CUSTOMER_API_URL =
    `${BASE44_API_BASE_URL.replace(/\/$/, '')}/api/apps/${BASE44_APP_ID}/entities/Customer`;
const ORDER_API_URL =
    `${BASE44_API_BASE_URL.replace(/\/$/, '')}/api/apps/${BASE44_APP_ID}/entities/Order`;

/* ===================== JSON FILE HELPERS ===================== */
const DATA_DIR = __dirname;

const SETTINGS_FILE = path.join(DATA_DIR, 'guild_settings.json');
const PANEL_FILE = path.join(DATA_DIR, 'panel_config.json');
const INVITES_FILE = path.join(DATA_DIR, 'invites_data.json');
const INVITES_BACKUP_FILE = path.join(DATA_DIR, 'invites_backup.json');
const GIVEAWAYS_FILE = path.join(DATA_DIR, 'giveaways_data.json');
const BOT_STATE_FILE = path.join(DATA_DIR, 'bot_state.json');
const INVITES_AUTO_BACKUP_FILE = path.join(DATA_DIR, 'invites_auto_backup.json');
const BID_FILE = path.join(DATA_DIR, 'bid_data.json');
const SOS_FILE = path.join(DATA_DIR, 'sos_data.json');

function loadJson(file, fallback) {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
        return fallback;
    }
}
function saveJson(file, data) {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

/* ===================== DATA STORES ===================== */
const settingsStore = loadJson(SETTINGS_FILE, { byGuild: {} });
settingsStore.byGuild = settingsStore.byGuild ?? {};
saveJson(SETTINGS_FILE, settingsStore);

const panelStore = loadJson(PANEL_FILE, { byGuild: {} });
panelStore.byGuild = panelStore.byGuild ?? {};
saveJson(PANEL_FILE, panelStore);

const invitesData = loadJson(INVITES_FILE, {
    inviterStats: {},
    memberInviter: {},
    inviteOwners: {},
    invitedMembers: {},
});
invitesData.inviterStats = invitesData.inviterStats ?? {};
invitesData.memberInviter = invitesData.memberInviter ?? {};
invitesData.inviteOwners = invitesData.inviteOwners ?? {};
invitesData.invitedMembers = invitesData.invitedMembers ?? {};
saveJson(INVITES_FILE, invitesData);

const giveawayData = loadJson(GIVEAWAYS_FILE, { giveaways: {} });
giveawayData.giveaways = giveawayData.giveaways ?? {};
saveJson(GIVEAWAYS_FILE, giveawayData);

const sosData = loadJson(SOS_FILE, { games: {} });
sosData.games = sosData.games ?? {};
saveJson(SOS_FILE, sosData);

const botState = loadJson(BOT_STATE_FILE, { stoppedGuilds: {} });
botState.stoppedGuilds = botState.stoppedGuilds ?? {};
saveJson(BOT_STATE_FILE, botState);

const bidData = loadJson(BID_FILE, { auctions: {} });
bidData.auctions = bidData.auctions ?? {};
saveJson(BID_FILE, bidData);

function saveSettings() { saveJson(SETTINGS_FILE, settingsStore); }
function savePanelStore() { saveJson(PANEL_FILE, panelStore); }
function saveInvites() { saveJson(INVITES_FILE, invitesData); }
function saveGiveaways() { saveJson(GIVEAWAYS_FILE, giveawayData); }
function saveSOS() { saveJson(SOS_FILE, sosData); }
function saveBids() { saveJson(BID_FILE, bidData); }
function saveBotState() { saveJson(BOT_STATE_FILE, botState); }

/* ===================== CLIENT (merged intents + partials) ===================== */
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildInvites,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
    ],
    partials: [Partials.Channel, Partials.Message],
});

/* ===================== GUILD SETTINGS DEFAULTS ===================== */
function defaultGuildSettings() {
    return {
        staffRoleIds: [],
        vouchesChannelId: null,
        joinLogChannelId: null,
        customerRoleId: null,
        invitesBlacklist: [],
        rewardsWebhookUrl: null,
        notificationChannelId: null,
        automod: { enabled: true, bypassRoleName: 'automod' },
        ticketRoleOverrides: {},
    };
}

function getGuildSettings(guildId) {
    if (!settingsStore.byGuild[guildId]) {
        settingsStore.byGuild[guildId] = defaultGuildSettings();
        saveSettings();
    }
    const s = settingsStore.byGuild[guildId];
    s.staffRoleIds = s.staffRoleIds ?? [];
    s.vouchesChannelId = s.vouchesChannelId ?? null;
    s.joinLogChannelId = s.joinLogChannelId ?? null;
    s.customerRoleId = s.customerRoleId ?? null;
    s.invitesBlacklist = s.invitesBlacklist ?? [];
    s.rewardsWebhookUrl = s.rewardsWebhookUrl ?? null;
    s.notificationChannelId = s.notificationChannelId ?? null;
    s.automod = s.automod ?? { enabled: true, bypassRoleName: 'automod' };
    s.automod.enabled = s.automod.enabled ?? true;
    s.automod.bypassRoleName = s.automod.bypassRoleName ?? 'automod';
    s.ticketRoleOverrides = s.ticketRoleOverrides ?? {};
    return s;
}

function isStopped(guildId) {
    return Boolean(botState.stoppedGuilds?.[guildId]);
}

/* ===================== PANEL CONFIG ===================== */
const DEFAULT_PANEL_CONFIG = {
    embed: {
        title: 'Tickets',
        description:
            '🆘| Help & Support Ticket\nIf you need help with anything, create a support ticket.\n\n' +
            '💰| Claim Order\nIf you have placed an order and are waiting to receive it please open this ticket.\n\n' +
            '💸| Sell To us\nWant to make some real cash off the donutsmp? Open a ticket and sell to us here.\n\n' +
            '🎁| Claim Rewards Ticket\nLooking to claim rewards, make this ticket.',
        color: '#FF0000',
    },
    modal: {
        title: 'Ticket Info',
        mcLabel: 'What is your Minecraft username?',
        needLabel: 'What do you need?',
    },
    tickets: [
        { id: 'ticket_support', label: 'Help & Support', category: 'Help & Support', key: 'help-support', button: { label: 'Help & Support', style: 'Primary', emoji: '🆘' } },
        { id: 'ticket_claim', label: 'Claim Order', category: 'Claim Order', key: 'claim-order', button: { label: 'Claim Order', style: 'Success', emoji: '💰' } },
        { id: 'ticket_sell', label: 'Sell To us', category: 'Sell To us', key: 'sell-to-us', button: { label: 'Sell To us', style: 'Secondary', emoji: '💸' } },
        { id: 'ticket_rewards', label: 'Rewards', category: 'Rewards', key: 'rewards', button: { label: 'Rewards', style: 'Danger', emoji: '🎁' } },
    ],
    rewardsPanel: { text: null },
};

function getPanelConfig(guildId) {
    const cfg = panelStore.byGuild[guildId] || DEFAULT_PANEL_CONFIG;
    cfg.rewardsPanel = cfg.rewardsPanel ?? { text: null };
    cfg.rewardsPanel.text = cfg.rewardsPanel.text ?? null;
    return cfg;
}

/* ===================== SMALL HELPERS ===================== */
function isOwner(userId) {
    return String(userId) === String(BOT_OWNER_ID);
}

function parseHexColor(input) {
    if (!input) return null;
    let s = String(input).trim();
    if (s.startsWith('#')) s = s.slice(1);
    if (s.startsWith('0x')) s = s.slice(2);
    if (!/^[0-9a-fA-F]{6}$/.test(s)) return null;
    return parseInt(s, 16);
}

function normalizeButtonStyle(style) {
    const s = String(style || '').toLowerCase();
    if (s === 'primary') return ButtonStyle.Primary;
    if (s === 'secondary') return ButtonStyle.Secondary;
    if (s === 'success') return ButtonStyle.Success;
    if (s === 'danger') return ButtonStyle.Danger;
    return ButtonStyle.Primary;
}

function cleanName(str) {
    return (str || '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
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
        .replace(/^https?:\/\/(www\.)?(discord\.gg|discord\.com\/invite)\//i, '')
        .replace(/[\s/]+/g, '')
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

function isValidWebhookUrl(url) {
    if (!url) return false;
    const s = String(url).trim();
    return /^https:\/\/(canary\.|ptb\.)?discord\.com\/api\/webhooks\/\d+\/[\w-]+/i.test(s);
}

async function sendWebhook(webhookUrl, payload) {
    const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Webhook failed (${res.status}) ${text?.slice(0, 200) || ''}`);
    }
}

/* ===================== STOP/RESUME GATE ===================== */
async function denyIfStopped(interactionOrMessage) {
    const guildId = interactionOrMessage.guild?.id;
    if (!guildId) return false;
    if (!isStopped(guildId)) return false;
    const content = 'Adam has restricted commands in your server.';
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
    try {
        await interactionOrMessage.channel?.send(content).catch(() => {});
    } catch {}
    return true;
}

/* ===================== INVITE BLACKLIST ===================== */
function isBlacklistedInviter(guildId, userId) {
    const s = getGuildSettings(guildId);
    return (s.invitesBlacklist || []).includes(String(userId));
}

/* ===================== INVITE STATS HELPERS ===================== */
function ensureInviterStats(inviterId) {
    if (!invitesData.inviterStats[inviterId]) {
        invitesData.inviterStats[inviterId] = { joins: 0, rejoins: 0, left: 0, manual: 0 };
    } else {
        const s = invitesData.inviterStats[inviterId];
        s.joins = s.joins ?? 0;
        s.rejoins = s.rejoins ?? 0;
        s.left = s.left ?? 0;
        s.manual = s.manual ?? 0;
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

const invitesCache = new Map();

async function refreshGuildInvites(guild) {
    const invites = await guild.invites.fetch().catch(() => null);
    if (!invites) return null;
    const map = new Map();
    invites.forEach((inv) => map.set(inv.code, inv.uses ?? 0));
    invitesCache.set(guild.id, map);
    return invites;
}

function resetInvitesForUser(userId) {
    invitesData.inviterStats[userId] = { joins: 0, rejoins: 0, left: 0, manual: 0 };
    delete invitesData.invitedMembers[userId];
    for (const [memberId, inviterId] of Object.entries(invitesData.memberInviter || {})) {
        if (String(inviterId) === String(userId)) {
            delete invitesData.memberInviter[memberId];
        }
    }
    saveInvites();
}

/* ===================== BACKUP / RESTORE (INVITES) ===================== */
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
    if (!restored) return { ok: false, msg: 'No invites backup found (invites_backup.json missing).' };
    const snap = sanitizeInvitesDataForSave(restored);
    invitesData.inviterStats = snap.inviterStats;
    invitesData.memberInviter = snap.memberInviter;
    invitesData.inviteOwners = snap.inviteOwners;
    invitesData.invitedMembers = snap.invitedMembers;
    saveInvites();
    return { ok: true, msg: 'Invites restored from invites_backup.json.' };
}

async function syncInvitesToBase44() {
    const base44Url = process.env.BASE44_API_URL;
    if (!base44Url) return;
    for (const guild of client.guilds.cache.values()) {
        try {
            const userIds = Object.keys(invitesData.inviterStats || {});
            const payload = [];
            for (const userId of userIds) {
                let member;
                try {
                    member = await guild.members.fetch(userId);
                } catch {
                    continue;
                }
                const count = invitesStillInServerForGuild(guild.id, userId);
                payload.push({
                    username: member.user.username,
                    displayName: member.displayName,
                    odiscordId: userId,
                    invites: count,
                    guildId: guild.id,
                    guildName: guild.name,
                });
            }
            if (!payload.length) continue;
            const res = await fetch(`${base44Url}/invite`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            if (!res.ok) {
                const text = await res.text().catch(() => '');
                console.error(`Base44 sync failed for guild ${guild.id} (${res.status}): ${text.slice(0, 200)}`);
            } else {
                console.log(`Base44 sync succeeded for guild ${guild.id} (${payload.length} users)`);
            }
        } catch (e) {
            console.error(`Base44 sync error for guild ${guild.id}:`, e?.message || e);
        }
    }
}

async function doAutoBackupInvites() {
    const snapshot = sanitizeInvitesDataForSave(invitesData);
    saveJson(INVITES_AUTO_BACKUP_FILE, snapshot);
    console.log('Auto-backed up invites');
    for (const [guildId, s] of Object.entries(settingsStore.byGuild || {})) {
        if (!s.notificationChannelId) continue;
        try {
            const ch = await client.channels.fetch(s.notificationChannelId).catch(() => null);
            if (ch && ch.type === ChannelType.GuildText) {
                await ch.send('Invites have been auto-backed up!').catch(() => {});
            }
        } catch {}
    }
}

/* ===================== TICKET HELPERS ===================== */
async function getOrCreateCategory(guild, name) {
    const safeName = String(name || 'Tickets').slice(0, 90);
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

function resolveTicketType(config, typeId) {
    return (config.tickets || []).find((t) => t.id === typeId) || null;
}

function buildTicketPanelMessage(config) {
    const c = parseHexColor(config.embed?.color) ?? 0xed4245;
    const embed = new EmbedBuilder()
        .setTitle(String(config.embed?.title || 'Tickets').slice(0, 256))
        .setDescription(String(config.embed?.description || 'Open a ticket below.').slice(0, 4000))
        .setColor(c)
        .setFooter({ text: 'DonutDemand Support' })
        .setTimestamp();
    const row = new ActionRowBuilder();
    for (const t of config.tickets) {
        const b = t.button || {};
        const btn = new ButtonBuilder()
            .setCustomId(`ticket:${t.id}`)
            .setLabel(String(b.label || t.label).slice(0, 80))
            .setStyle(normalizeButtonStyle(b.style || 'Primary'));
        if (b.emoji) btn.setEmoji(String(b.emoji).slice(0, 40));
        row.addComponents(btn);
    }
    return { embeds: [embed], components: [row] };
}

function validatePanelConfig(cfg) {
    if (!cfg || typeof cfg !== 'object') return { ok: false, msg: 'Config must be a JSON object.' };
    const embed = cfg.embed || {};
    const modal = cfg.modal || {};
    const tickets = Array.isArray(cfg.tickets) ? cfg.tickets : null;
    if (!tickets || tickets.length < 1) return { ok: false, msg: 'Config must include tickets: [...] with at least 1 type.' };
    if (tickets.length > 4) return { ok: false, msg: 'Max 4 ticket types (fits in one button row).' };
    const title = String(embed.title ?? '').trim();
    const desc = String(embed.description ?? '').trim();
    const color = String(embed.color ?? '').trim();
    if (!title || title.length > 256) return { ok: false, msg: 'embed.title is required and must be <= 256 chars.' };
    if (!desc || desc.length > 4000) return { ok: false, msg: 'embed.description is required and must be <= 4000 chars.' };
    if (color && !parseHexColor(color)) return { ok: false, msg: 'embed.color must be a hex like #FF0000.' };
    const mTitle = String(modal.title ?? 'Ticket Info');
    const mcLabel = String(modal.mcLabel ?? 'What is your Minecraft username?');
    const needLabel = String(modal.needLabel ?? 'What do you need?');
    if (mTitle.length < 1 || mTitle.length > 45) return { ok: false, msg: 'modal.title must be 1-45 chars.' };
    if (mcLabel.length < 1 || mcLabel.length > 45) return { ok: false, msg: 'modal.mcLabel must be 1-45 chars.' };
    if (needLabel.length < 1 || needLabel.length > 45) return { ok: false, msg: 'modal.needLabel must be 1-45 chars.' };
    const seenIds = new Set();
    for (const t of tickets) {
        const id = String(t.id || '').trim();
        const label = String(t.label || '').trim();
        const category = String(t.category || '').trim();
        const key = String(t.key || '').trim();
        if (!id || id.length > 100) return { ok: false, msg: 'Each ticket needs id (<= 100 chars).' };
        if (seenIds.has(id)) return { ok: false, msg: `Duplicate ticket id: ${id}` };
        seenIds.add(id);
        if (!label || label.length > 80) return { ok: false, msg: 'Each ticket needs label (<= 80 chars).' };
        if (!category || category.length > 100) return { ok: false, msg: 'Each ticket needs category (<= 100 chars).' };
        if (!key || key.length > 60) return { ok: false, msg: 'Each ticket needs key (<= 60 chars).' };
        const b = t.button || {};
        const bLabel = String(b.label || '').trim();
        if (!bLabel || bLabel.length > 80) return { ok: false, msg: 'Each ticket.button needs label (<= 80 chars).' };
        const emoji = b.emoji ? String(b.emoji).trim() : '';
        if (emoji && emoji.length > 40) return { ok: false, msg: 'ticket.button.emoji too long.' };
        const style = b.style ? String(b.style).trim() : 'Primary';
        if (!['Primary', 'Secondary', 'Success', 'Danger'].includes(style)) {
            return { ok: false, msg: 'ticket.button.style must be Primary/Secondary/Success/Danger.' };
        }
    }
    return { ok: true, msg: 'OK' };
}

function buildCloseDmEmbed({ guild, ticketChannelName, ticketTypeLabel, openedAtMs, closedByTag, reason, vouchesChannelId }) {
    const openedUnix = openedAtMs ? Math.floor(openedAtMs / 1000) : null;
    const closedUnix = Math.floor(Date.now() / 1000);
    const nextSteps = [
        '• If you still need help, open a new ticket from the ticket panel.',
        '• Keep your DMs open so you don\'t miss updates.',
    ];
    if (vouchesChannelId) nextSteps.splice(1, 0, `• Please consider leaving a vouch in <#${vouchesChannelId}>.`);
    return new EmbedBuilder()
        .setTitle('Ticket Closed')
        .setColor(0xed4245)
        .setDescription('Your ticket has been closed. Here are the details:')
        .addFields(
            { name: 'Server', value: `${guild.name}`, inline: true },
            { name: 'Ticket', value: `${ticketChannelName}`, inline: true },
            { name: 'Type', value: ticketTypeLabel || 'Unknown', inline: true },
            { name: 'Closed By', value: closedByTag || 'Unknown', inline: true },
            { name: 'Reason', value: String(reason || 'No reason provided').slice(0, 1024), inline: false },
            { name: 'Opened', value: openedUnix ? `<t:${openedUnix}:F> (<t:${openedUnix}:R>)` : 'Unknown', inline: true },
            { name: 'Closed', value: `<t:${closedUnix}:F> (<t:${closedUnix}:R>)`, inline: true },
            { name: 'Next Steps', value: nextSteps.join('\n'), inline: false }
        )
        .setFooter({ text: 'DonutDemand Support' })
        .setTimestamp();
}

function isRewardsTicket(ticketType) {
    if (!ticketType) return false;
    const id = String(ticketType.id || '').toLowerCase();
    const key = String(ticketType.key || '').toLowerCase();
    return id === 'ticket_rewards' || key.includes('rewards');
}

function canOpenRewardsTicket(member) {
    const inv = invitesStillInServerForGuild(member.guild.id, member.id);
    if (inv >= 5) return { ok: true, reason: 'has 5+ invites' };
    const joinedAt = member.joinedTimestamp || 0;
    const ageMs = Date.now() - joinedAt;
    const TWO_HOURS = 2 * 60 * 60 * 1000;
    if (joinedAt && ageMs <= TWO_HOURS) return { ok: true, reason: 'joined within 2 hours' };
    return { ok: false, invites: inv };
}

function canClaimRewardsNow(guildId, userId) {
    const invites = invitesStillInServerForGuild(guildId, userId);
    if (invites < 1) return { ok: false, code: 'NO_INVITES', invites };
    const invitedMap = invitesData.invitedMembers?.[userId] || {};
    const records = Object.values(invitedMap || {}).filter(Boolean);
    if (!records.length) return { ok: false, code: 'NO_HISTORY' };
    const mostRecentJoinedAt = Math.max(
        ...records.map((r) => Number(r.joinedAt || 0)).filter((n) => Number.isFinite(n) && n > 0)
    );
    if (!mostRecentJoinedAt || !Number.isFinite(mostRecentJoinedAt)) return { ok: false, code: 'NO_HISTORY' };
    const TWO_HOURS = 2 * 60 * 60 * 1000;
    const ageMs = Date.now() - mostRecentJoinedAt;
    if (ageMs < TWO_HOURS) {
        const remainingMs = TWO_HOURS - ageMs;
        const remainingHours = Math.max(1, Math.ceil(remainingMs / (60 * 60 * 1000)));
        return { ok: false, code: 'TOO_RECENT', remainingMs, remainingHours, mostRecentJoinedAt };
    }
    return { ok: true, invites, mostRecentJoinedAt };
}

function buildTicketInsideEmbed({ typeLabel, user, mc, need }) {
    return new EmbedBuilder()
        .setTitle(`${typeLabel} Ticket`)
        .setColor(0x2b2d31)
        .setDescription(`${user} — a staff member will be with you shortly.`)
        .addFields(
            { name: 'Minecraft', value: (mc || 'N/A').slice(0, 64), inline: true },
            { name: 'Request', value: (need || 'N/A').slice(0, 1024), inline: false }
        )
        .setTimestamp();
}

function buildTicketControlRow() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('ticket_close_btn').setStyle(ButtonStyle.Danger).setEmoji('🔒').setLabel('Close Ticket')
    );
}

const stickyByChannel = new Map();
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
    const ticketTypeLabel = t?.label || 'Unknown';
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
                    closedByTag: closerUser?.tag || 'Unknown',
                    reason,
                    vouchesChannelId: s.vouchesChannelId,
                })],
            });
        }
    } catch {}
    try {
        await channel.send('Ticket closing...').catch(() => {});
    } catch {}
    setTimeout(() => {
        channel.delete().catch(() => {});
    }, 2500);
}

/* ===================== GIVEAWAY HELPERS ===================== */
function parseDurationToMs(input) {
    if (!input) return null;
    const s = input.trim().toLowerCase().replace(/\s+/g, '');
    const re = /(\d+)(s|m|h|d)/g;
    let total = 0;
    let ok = false;
    let m;
    while ((m = re.exec(s))) {
        ok = true;
        const n = parseInt(m[1], 10);
        const u = m[2];
        if (u === 's') total += n * 1000;
        if (u === 'm') total += n * 60 * 1000;
        if (u === 'h') total += n * 60 * 60 * 1000;
        if (u === 'd') total += n * 24 * 60 * 60 * 1000;
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

async function getMissingRequiredRoleId(interaction, requiredRoleId) {
    if (!requiredRoleId) return null;
    const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    if (!member) return requiredRoleId;
    return member.roles.cache.has(requiredRoleId) ? null : requiredRoleId;
}

function makeGiveawayEmbed(gw) {
    const endUnix = Math.floor(gw.endsAt / 1000);
    const minInv = gw.minInvites > 0 ? `\nMin invites to join: **${gw.minInvites}**` : '';
    const reqRole = gw.requiredRoleId ? `\n🔒 Required Role: <@&${gw.requiredRoleId}>` : '';
    const status = gw.ended ? '\n**STATUS: ENDED**' : '';
    return new EmbedBuilder()
        .setTitle(`🎁 GIVEAWAY — ${gw.prize}`)
        .setColor(0xed4245)
        .setDescription(
            `Ends: <t:${endUnix}:R> (<t:${endUnix}:F>)\n` +
            `Hosted by: <@${gw.hostId}>\n` +
            `Entries: **${gw.entries.length}**\n` +
            `Winners: **${gw.winners}**` + minInv + reqRole + status
        )
        .setFooter({ text: `Giveaway Message ID: ${gw.messageId}` })
        .setTimestamp();
}

function giveawayRow(gw) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`gw_join:${gw.messageId}`)
            .setStyle(ButtonStyle.Success)
            .setEmoji('🎊')
            .setLabel(gw.ended ? 'Giveaway Ended' : 'Join / Leave')
            .setDisabled(Boolean(gw.ended))
    );
}

async function endGiveaway(messageId, endedByUserId = null) {
    const gw = giveawayData.giveaways[messageId];
    if (!gw || gw.ended) return { ok: false, msg: 'Giveaway not found or already ended.' };
    gw.ended = true;
    saveGiveaways();
    const channel = await client.channels.fetch(gw.channelId).catch(() => null);
    if (!channel) return { ok: false, msg: 'Channel not found.' };
    const msg = await channel.messages.fetch(gw.messageId).catch(() => null);
    if (msg) await msg.edit({ embeds: [makeGiveawayEmbed(gw)], components: [giveawayRow(gw)] }).catch(() => {});
    if (!gw.entries.length) {
        await channel.send(`No entries — giveaway for **${gw.prize}** ended with no winners.`).catch(() => {});
        return { ok: true, msg: 'Ended (no entries).' };
    }
    const winnerCount = Math.max(1, Math.min(gw.winners, gw.entries.length));
    const winners = pickRandomWinners(gw.entries, winnerCount);
    gw.lastWinners = winners;
    saveGiveaways();
    const endedBy = endedByUserId ? ` (ended by <@${endedByUserId}>)` : '';
    await channel.send(`🎉 Giveaway ended${endedBy}! Winners for **${gw.prize}**: ${winners.map((id) => `<@${id}>`).join(', ')}`).catch(() => {});
    return { ok: true, msg: 'Ended with winners.' };
}

async function rerollGiveaway(messageId, rerolledByUserId = null) {
    const gw = giveawayData.giveaways[messageId];
    if (!gw) return { ok: false, msg: 'Giveaway not found.' };
    if (!gw.entries.length) return { ok: false, msg: 'No entries to reroll.' };
    const channel = await client.channels.fetch(gw.channelId).catch(() => null);
    if (!channel) return { ok: false, msg: 'Channel not found.' };
    const winnerCount = Math.max(1, Math.min(gw.winners, gw.entries.length));
    const winners = pickRandomWinners(gw.entries, winnerCount);
    gw.lastWinners = winners;
    saveGiveaways();
    const by = rerolledByUserId ? ` by <@${rerolledByUserId}>` : '';
    await channel.send(`🔁 Reroll${by}! New winners for **${gw.prize}**: ${winners.map((id) => `<@${id}>`).join(', ')}`).catch(() => {});
    return { ok: true, msg: 'Rerolled.' };
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

/* ===================== SOS (SPLIT OR STEAL) ===================== */
const pendingSOSDMs = new Map();
const pendingSOSDMPrompts = new Map();

function makeSosEmbed(game) {
    const endUnix = Math.floor(game.endsAt / 1000);
    const minInv = game.minInvites > 0 ? `\nMin invites to join: **${game.minInvites}**` : '';
    const reqRole = game.requiredRoleId ? `\n🔒 Required Role: <@&${game.requiredRoleId}>` : '';
    const status = game.ended ? '\n**STATUS: ENDED**' : '';
    return new EmbedBuilder()
        .setTitle(`🎲 SPLIT OR STEAL — ${game.title}`)
        .setColor(0x9b59b6)
        .setDescription(
            `Prize: **${game.prize}**\n` +
            `Ends: <t:${endUnix}:R> (<t:${endUnix}:F>)\n` +
            `Hosted by: <@${game.hostId}>\n` +
            `Entries: **${game.entries.length}**` + minInv + reqRole + status
        )
        .setFooter({ text: `Split or Steal • Message ID: ${game.messageId}` })
        .setTimestamp();
}

function makeSosWaitingEmbed(game) {
    const [p1, p2] = game.players;
    return new EmbedBuilder()
        .setTitle(`🎲 SPLIT OR STEAL — ${game.title}`)
        .setColor(0xe67e22)
        .setDescription(
            `Prize: **${game.prize}**\n` +
            `Hosted by: <@${game.hostId}>\n\n` +
            `⏳ Waiting for <@${p1}> and <@${p2}> to decide...\n` +
            `Responses: **${game.responsesCount}/2**`
        )
        .setFooter({ text: `Split or Steal • Message ID: ${game.messageId}` })
        .setTimestamp();
}

function sosRow(game) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`sos_join:${game.messageId}`)
            .setStyle(ButtonStyle.Primary)
            .setEmoji('🎲')
            .setLabel(game.ended ? 'Game Ended' : 'Enter / Leave')
            .setDisabled(Boolean(game.ended))
    );
}

async function resolveSOSGame(messageId) {
    const game = sosData.games[messageId];
    if (!game || game.resolved) return;
    game.resolved = true;
    saveSOS();
    for (const userId of game.players || []) pendingSOSDMs.delete(userId);
    const channel = await client.channels.fetch(game.channelId).catch(() => null);
    if (game.discussionChannelId) {
        setTimeout(async () => {
            const dc = await client.channels.fetch(game.discussionChannelId).catch(() => null);
            if (dc) await dc.delete().catch(() => {});
        }, 3000);
    }
    if (!channel) return;
    const [p1, p2] = game.players;
    const c1 = game.responses[p1] || 'STEAL';
    const c2 = game.responses[p2] || 'STEAL';
    let outcome, color;
    if (c1 === 'SPLIT' && c2 === 'SPLIT') {
        outcome = `🤝 **Both Split!** Both players get half the prize.\n<@${p1}> and <@${p2}> each receive half of **${game.prize}**!`;
        color = 0x2ecc71;
    } else if (c1 === 'STEAL' && c2 === 'STEAL') {
        outcome = `💀 **Both Steal!** Nobody wins.\nBoth players chose to steal — nobody gets anything.`;
        color = 0x95a5a6;
    } else if (c1 === 'STEAL') {
        outcome = `😈 **<@${p1}> stole everything!** <@${p2}> gets nothing.\n<@${p1}> walks away with **${game.prize}**!`;
        color = 0xe74c3c;
    } else {
        outcome = `😈 **<@${p2}> stole everything!** <@${p1}> gets nothing.\n<@${p2}> walks away with **${game.prize}**!`;
        color = 0xe74c3c;
    }
    const resultsEmbed = new EmbedBuilder()
        .setTitle(`🎲 Split or Steal Results — ${game.title}`)
        .setColor(color)
        .setDescription(`**Prize:** ${game.prize}\n\n${outcome}`)
        .addFields(
            { name: 'Player 1', value: `<@${p1}>\n${c1 === 'SPLIT' ? '🤝 SPLIT' : '😈 STEAL'}`, inline: true },
            { name: 'Player 2', value: `<@${p2}>\n${c2 === 'SPLIT' ? '🤝 SPLIT' : '😈 STEAL'}`, inline: true }
        )
        .setFooter({ text: `Split or Steal • Hosted by: ${game.hostId}` })
        .setTimestamp();
    await channel.send({ embeds: [resultsEmbed] }).catch(() => {});
}

async function endSOS(messageId) {
    const game = sosData.games[messageId];
    if (!game || game.ended) return;
    game.ended = true;
    saveSOS();
    const channel = await client.channels.fetch(game.channelId).catch(() => null);
    if (!channel) return;
    const msg = await channel.messages.fetch(game.messageId).catch(() => null);
    if (msg) await msg.edit({ embeds: [makeSosEmbed(game)], components: [sosRow(game)] }).catch(() => {});
    if (game.entries.length < 2) {
        await channel.send(`🎲 Split or Steal ended — not enough entries (need at least 2). **${game.title}** cancelled.`).catch(() => {});
        return;
    }
    const players = pickRandomWinners(game.entries, 2);
    game.players = players;
    game.responses = {};
    game.responsesCount = 0;
    game.drawn = true;
    game.resolved = false;
    game.failedPlayers = [];
    saveSOS();
    await runSOSDraw(messageId);
}

async function redrawSOSPlayers(messageId) {
    const game = sosData.games[messageId];
    if (!game || game.resolved) return;
    const nonResponders = (game.players || []).filter((uid) => !game.responses[uid]);
    for (const uid of nonResponders) {
        pendingSOSDMs.delete(uid);
        pendingSOSDMPrompts.delete(uid);
        game.failedPlayers = game.failedPlayers || [];
        if (!game.failedPlayers.includes(uid)) game.failedPlayers.push(uid);
    }
    if (game.discussionChannelId) {
        const dc = await client.channels.fetch(game.discussionChannelId).catch(() => null);
        if (dc) await dc.delete().catch(() => {});
        game.discussionChannelId = null;
    }
    const excluded = new Set(game.failedPlayers || []);
    const pool = (game.entries || []).filter((uid) => !excluded.has(uid));
    const channel = await client.channels.fetch(game.channelId).catch(() => null);
    if (pool.length < 2) {
        game.resolved = true;
        saveSOS();
        if (channel) {
            await channel.send(`🎲 **Split or Steal — ${game.title}:** Not enough players responded. Game cancelled.`).catch(() => {});
            const msg2 = await channel.messages.fetch(game.messageId).catch(() => null);
            if (msg2) await msg2.edit({ embeds: [makeSosEmbed(game)], components: [sosRow(game)] }).catch(() => {});
        }
        return;
    }
    const newPlayers = pickRandomWinners(pool, 2);
    game.players = newPlayers;
    game.responses = {};
    game.responsesCount = 0;
    saveSOS();
    if (channel) await channel.send(`🔄 Previous players did not respond in time. Drawing 2 new players...`).catch(() => {});
    await runSOSDraw(messageId);
}

async function runSOSDraw(messageId) {
    const game = sosData.games[messageId];
    if (!game || game.resolved) return;
    const [p1, p2] = game.players;
    const channel = await client.channels.fetch(game.channelId).catch(() => null);
    const msg = channel ? await channel.messages.fetch(game.messageId).catch(() => null) : null;
    const s = getGuildSettings(game.guildId);
    const guild = client.guilds.cache.get(game.guildId) || (await client.guilds.fetch(game.guildId).catch(() => null));
    let discussionChannel = null;
    if (guild) {
        const sosOverrideRoles =
            s.ticketRoleOverrides?.['sos_discussion']?.length > 0
                ? s.ticketRoleOverrides['sos_discussion']
                : s.staffRoleIds || [];
        const overwrites = [
            { id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
            { id: p1, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
            { id: p2, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
            ...sosOverrideRoles.map((rid) => ({ id: rid, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] })),
        ];
        discussionChannel = await guild.channels.create({
            name: `sos-${messageId.slice(-6)}`,
            type: ChannelType.GuildText,
            topic: `Split or Steal discussion — game ${messageId}`,
            permissionOverwrites: overwrites,
        }).catch(() => null);
    }
    if (discussionChannel) {
        game.discussionChannelId = discussionChannel.id;
        saveSOS();
        await discussionChannel.send({
            embeds: [new EmbedBuilder()
                .setTitle(`🎲 Split or Steal — ${game.title}`)
                .setColor(0x9b59b6)
                .setDescription(
                    `<@${p1}> and <@${p2}> — you two have been selected!\n\n` +
                    `**Prize:** ${game.prize}\n\n` +
                    `Check your DMs! You have **2 hours** to reply with \`SPLIT\` or \`STEAL\`.\n\n` +
                    `Use this channel to discuss your strategy before deciding.`
                )],
        }).catch(() => {});
    }
    if (msg) await msg.edit({ embeds: [makeSosWaitingEmbed(game)], components: [sosRow(game)] }).catch(() => {});
    for (const userId of [p1, p2]) {
        try {
            const user = await client.users.fetch(userId);
            const promptMessage = await user.send(
                `🎲 **You've been selected for Split or Steal!**\n\n` +
                `**Game:** ${game.title}\n**Prize:** ${game.prize}\n\n` +
                `Do you want to **SPLIT** or **STEAL**?\n\n` +
                `⚠️ You MUST reply to THIS message — do NOT just type in the chat. ` +
                `Type \`SPLIT\` or \`STEAL\` as a reply to this message.\n\nYou have **2 hours** to respond.`
            );
            pendingSOSDMs.set(userId, messageId);
            pendingSOSDMPrompts.set(userId, promptMessage.id);
        } catch {
            game.failedPlayers = game.failedPlayers || [];
            if (!game.failedPlayers.includes(userId)) game.failedPlayers.push(userId);
        }
    }
    saveSOS();
    const playersWithoutPendingDMs = [p1, p2].filter((uid) => !pendingSOSDMs.has(uid));
    if (playersWithoutPendingDMs.length === 2) {
        await redrawSOSPlayers(messageId);
        return;
    }
    if (msg) await msg.edit({ embeds: [makeSosWaitingEmbed(game)], components: [sosRow(game)] }).catch(() => {});
    setTimeout(async () => {
        const g = sosData.games[messageId];
        if (!g || g.resolved) return;
        const stillPending = [p1, p2].filter((uid) => !g.responses[uid]);
        if (stillPending.length === 0) return;
        await redrawSOSPlayers(messageId);
    }, 2 * 60 * 60 * 1000);
}

function scheduleSOSEnd(messageId) {
    const game = sosData.games[messageId];
    if (!game || game.ended) return;
    const delay = game.endsAt - Date.now();
    if (delay <= 0) return void endSOS(messageId).catch(() => {});
    const MAX = 2_147_483_647;
    setTimeout(() => {
        const g = sosData.games[messageId];
        if (!g || g.ended) return;
        if (g.endsAt - Date.now() > MAX) return scheduleSOSEnd(messageId);
        endSOS(messageId).catch(() => {});
    }, Math.min(delay, MAX));
}

/* ===================== SAFE CALCULATOR ===================== */
function tokenizeCalc(input) {
    const s = String(input || '').trim().toLowerCase().replace(/\u00d7/g, 'x').replace(/\s+/g, '').replace(/x/g, '*');
    if (!s) return [];
    const tokens = [];
    let i = 0;
    const isDigit = (c) => c >= '0' && c <= '9';
    while (i < s.length) {
        const c = s[i];
        if (isDigit(c) || c === '.') {
            let j = i;
            let dot = 0;
            while (j < s.length && (isDigit(s[j]) || s[j] === '.')) {
                if (s[j] === '.') dot++;
                if (dot > 1) throw new Error('Invalid number');
                j++;
            }
            const val = Number(s.slice(i, j));
            if (!Number.isFinite(val)) throw new Error('Invalid number');
            tokens.push({ type: 'num', v: val });
            i = j;
            continue;
        }
        if ('+-*/^()'.includes(c)) { tokens.push({ type: 'op', v: c }); i++; continue; }
        throw new Error('Invalid character');
    }
    return tokens;
}

function toRpn(tokens) {
    const out = [], ops = [];
    const prec = (op) => { if (op === '^') return 4; if (op === '*' || op === '/') return 3; if (op === '+' || op === '-') return 2; return 0; };
    const rightAssoc = (op) => op === '^';
    for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];
        if (t.type === 'num') { out.push(t); continue; }
        const op = t.v;
        if (op === '(') { ops.push(op); continue; }
        if (op === ')') {
            while (ops.length && ops[ops.length - 1] !== '(') out.push({ type: 'op', v: ops.pop() });
            if (!ops.length || ops[ops.length - 1] !== '(') throw new Error('Mismatched parentheses');
            ops.pop(); continue;
        }
        if (op === '-') {
            const prev = i === 0 ? null : tokens[i - 1];
            const isUnary = !prev || (prev.type === 'op' && prev.v !== ')') || (prev.type === 'op' && prev.v === '(');
            if (isUnary) out.push({ type: 'num', v: 0 });
        }
        while (ops.length) {
            const top = ops[ops.length - 1];
            if (top === '(') break;
            if ((rightAssoc(op) && prec(op) < prec(top)) || (!rightAssoc(op) && prec(op) <= prec(top))) {
                out.push({ type: 'op', v: ops.pop() });
            } else break;
        }
        ops.push(op);
    }
    while (ops.length) {
        const op = ops.pop();
        if (op === '(' || op === ')') throw new Error('Mismatched parentheses');
        out.push({ type: 'op', v: op });
    }
    return out;
}

function evalRpn(rpn) {
    const stack = [];
    for (const t of rpn) {
        if (t.type === 'num') { stack.push(t.v); continue; }
        const b = stack.pop(), a = stack.pop();
        if (a === undefined || b === undefined) throw new Error('Invalid expression');
        let r;
        if (t.v === '+') r = a + b;
        else if (t.v === '-') r = a - b;
        else if (t.v === '*') r = a * b;
        else if (t.v === '/') r = a / b;
        else if (t.v === '^') r = Math.pow(a, b);
        else throw new Error('Bad operator');
        if (!Number.isFinite(r)) throw new Error('Invalid result');
        stack.push(r);
    }
    if (stack.length !== 1) throw new Error('Invalid expression');
    return stack[0];
}

function calcExpression(input) {
    const tokens = tokenizeCalc(input);
    if (!tokens.length) throw new Error('Empty');
    return evalRpn(toRpn(tokens));
}

function formatCalcResult(n) {
    if (!Number.isFinite(n)) return null;
    const abs = Math.abs(n);
    if (abs !== 0 && (abs >= 1e12 || abs < 1e-9)) return n.toExponential(6);
    const s = String(n);
    if (s.includes('.') && s.length > 18) return Number(n.toFixed(10)).toString();
    return s;
}

/* ===================== REWARDS PANEL ===================== */
function buildRewardsPanelMessage(guildId, text) {
    const t = String(text || 'Click the button below to claim rewards.').slice(0, 4000);
    const embed = new EmbedBuilder()
        .setTitle('🎁 Rewards Claim')
        .setColor(0xed4245)
        .setDescription(t)
        .setFooter({ text: 'DonutDemand Rewards' })
        .setTimestamp();
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('rewards_claim_btn').setStyle(ButtonStyle.Success).setLabel('Claim Rewards').setEmoji('🎁')
    );
    return { embeds: [embed], components: [row] };
}

/* ===================== BID AUCTION ===================== */
function makeBidEmbed(auction) {
    const bidderText = auction.currentBidderId ? `<@${auction.currentBidderId}>` : 'No bids yet';
    const bidText = auction.currentBidderId ? `**$${auction.currentBid}**` : `**$${auction.startingPrice}** (No bids yet)`;
    return new EmbedBuilder()
        .setTitle(`🔨 Auction — ${auction.item}`)
        .setColor(0xf1c40f)
        .addFields(
            { name: 'Item', value: String(auction.item).slice(0, 1024), inline: true },
            { name: 'Current Bid', value: bidText, inline: true },
            { name: 'Highest Bidder', value: bidderText, inline: true },
            { name: 'Max Bid', value: `**$${auction.maxBid}**`, inline: true },
            { name: 'Hosted by', value: `<@${auction.hostId}>`, inline: true }
        )
        .setFooter({ text: `Auction ID: ${auction.messageId}` })
        .setTimestamp();
}

function buildBidRow(messageId, ended) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`bid_plus1:${messageId}`).setStyle(ButtonStyle.Success).setLabel('+$1').setDisabled(Boolean(ended)),
        new ButtonBuilder().setCustomId(`bid_custom:${messageId}`).setStyle(ButtonStyle.Primary).setLabel('Custom Bid').setDisabled(Boolean(ended)),
        new ButtonBuilder().setCustomId(`bid_end:${messageId}`).setStyle(ButtonStyle.Danger).setLabel('End Auction').setDisabled(Boolean(ended))
    );
}

/* ===================== SETTINGS DASHBOARD ===================== */
function buildSettingsEmbed(guild, s) {
    const staffRoles = (s.staffRoleIds || []).length > 0
        ? s.staffRoleIds.map((id) => `<@&${id}>`).join(', ')
        : 'None set';
    return new EmbedBuilder()
        .setTitle(`⚙️ Settings — ${guild.name}`)
        .setColor(0x5865f2)
        .addFields(
            { name: '👥 Staff Roles', value: staffRoles, inline: false },
            { name: '📝 Vouches Channel', value: s.vouchesChannelId ? `<#${s.vouchesChannelId}>` : 'Not set', inline: true },
            { name: '📋 Join Log Channel', value: s.joinLogChannelId ? `<#${s.joinLogChannelId}>` : 'Not set', inline: true },
            { name: '🎫 Customer Role', value: s.customerRoleId ? `<@&${s.customerRoleId}>` : 'Not set', inline: true },
            { name: '🔔 Notification Channel', value: s.notificationChannelId ? `<#${s.notificationChannelId}>` : 'Not set', inline: true },
            { name: '🔗 Rewards Webhook', value: s.rewardsWebhookUrl ? '✅ Configured' : 'Not set', inline: true },
            { name: '🛡️ Automod', value: s.automod?.enabled ? `✅ Enabled (bypass: \`${s.automod?.bypassRoleName || 'automod'}\`)` : '❌ Disabled', inline: true }
        )
        .setFooter({ text: 'Use the menu below to change settings.' })
        .setTimestamp();
}

function buildSettingsComponents(guildId) {
    const config = getPanelConfig(guildId);
    const ticketTypes = (config.tickets || []).map((t) => ({
        label: String(t.label || t.id).slice(0, 25),
        value: String(t.id).slice(0, 100),
    }));

    const mainOptions = [
        { label: 'Set Staff Roles', value: 'set_staff_roles', emoji: '👥' },
        { label: 'Set Vouches Channel', value: 'set_vouches_channel', emoji: '📝' },
        { label: 'Set Join Log Channel', value: 'set_joinlog_channel', emoji: '📋' },
        { label: 'Set Customer Role', value: 'set_customer_role', emoji: '🎫' },
        { label: 'Set Notification Channel', value: 'set_notification_channel', emoji: '🔔' },
        { label: 'Set Rewards Webhook', value: 'set_rewards_webhook', emoji: '🔗' },
        { label: 'Toggle Automod', value: 'toggle_automod', emoji: '🛡️' },
        { label: 'Reset All Settings', value: 'reset_settings', emoji: '🔄' },
    ];

    const rows = [
        new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('settings_main_select')
                .setPlaceholder('Select a setting to change...')
                .addOptions(mainOptions)
        ),
    ];

    if (ticketTypes.length > 0) {
        rows.push(
            new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('settings_ticket_type_select')
                    .setPlaceholder('Set roles for ticket type...')
                    .addOptions(ticketTypes)
            )
        );
    }
    return rows;
}

/* ===================== BASE44 PRODUCT API (from discord-ticket-bot) ===================== */
function fetchCurrentStock() {
    return new Promise((resolve, reject) => {
        if (!BASE44_APP_ID) { reject(new Error('BASE44_APP_ID is not configured')); return; }
        if (!STATS_API_KEY) { reject(new Error('BASE44_API_KEY is not configured')); return; }
        let urlObj;
        try { urlObj = new URL(PRODUCT_API_URL); } catch { reject(new Error('Product API URL is not valid')); return; }
        const reqOptions = {
            hostname: urlObj.hostname,
            path: urlObj.pathname + urlObj.search,
            method: 'GET',
            headers: { 'api_key': STATS_API_KEY, 'Content-Type': 'application/json' },
        };
        https.get(reqOptions, res => {
            if (res.statusCode < 200 || res.statusCode >= 300) { res.resume(); reject(new Error(`Product API returned status ${res.statusCode}`)); return; }
            let raw = '';
            res.on('data', chunk => { raw += chunk; });
            res.on('end', () => {
                try {
                    const data = JSON.parse(raw);
                    const results = Array.isArray(data) ? data : (data.results ?? data.items ?? []);
                    resolve(results);
                } catch { reject(new Error('Failed to parse Product API response')); }
            });
        }).on('error', reject);
    });
}

function updateProductStock(productId, quantity) {
    return new Promise((resolve, reject) => {
        const apiUrl = new URL(`${PRODUCT_API_URL}/${encodeURIComponent(productId)}`);
        const body = JSON.stringify({ quantity });
        const options = {
            hostname: apiUrl.hostname,
            path: apiUrl.pathname,
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'api_key': STATS_API_KEY },
        };
        const req = https.request(options, res => {
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve({}); } });
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

function updateProduct(productId, fields) {
    return new Promise((resolve, reject) => {
        const apiUrl = new URL(`${PRODUCT_API_URL}/${encodeURIComponent(productId)}`);
        const body = JSON.stringify(fields);
        const options = {
            hostname: apiUrl.hostname,
            path: apiUrl.pathname,
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'api_key': STATS_API_KEY },
        };
        const req = https.request(options, res => {
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve({}); } });
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

function createProduct(productData) {
    return new Promise((resolve, reject) => {
        const apiUrl = new URL(PRODUCT_API_URL);
        const body = JSON.stringify(productData);
        const options = {
            hostname: apiUrl.hostname,
            path: apiUrl.pathname,
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'api_key': STATS_API_KEY },
        };
        const req = https.request(options, res => {
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve({}); } });
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

/* ===================== CUSTOMER & ORDER API ===================== */
function formatDate(dateStr) {
    if (!dateStr) return 'N/A';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return 'N/A';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function calcLoyaltyPoints(totalSpent) {
    return Math.min(100, Math.round(totalSpent * 0.1 * 10) / 10);
}

function buildLoyaltyBar(points) {
    const TOTAL_WIDTH = 20;
    const filled = Math.round((points / 100) * TOTAL_WIDTH);
    const empty = TOTAL_WIDTH - filled;
    return '\u2588'.repeat(filled) + '\u2591'.repeat(empty);
}

const TIERS = [
    { name: 'Diamond', color: 0xB9F2FF, emoji: '💎', minSpent: 500 },
    { name: 'Platinum', color: 0xE5E4E2, emoji: '🏆', minSpent: 200 },
    { name: 'Gold', color: 0xFFD700, emoji: '🥇', minSpent: 75 },
    { name: 'Silver', color: 0xC0C0C0, emoji: '🥈', minSpent: 25 },
    { name: 'Bronze', color: 0xCD7F32, emoji: '🥉', minSpent: 1 },
    { name: 'Unranked', color: 0x808080, emoji: '🔘', minSpent: 0 },
];

function getTier(totalSpent) {
    for (const tier of TIERS) {
        if (totalSpent >= tier.minSpent) return tier;
    }
    return TIERS[TIERS.length - 1];
}

const statsCache = new Map();
const STATS_CACHE_TTL_MS = 5 * 60 * 1000;

function fetchCustomerData(discordUsername) {
    return new Promise((resolve, reject) => {
        if (!BASE44_APP_ID) { reject(new Error('BASE44_APP_ID is not configured')); return; }
        if (!STATS_API_KEY) { reject(new Error('BASE44_API_KEY is not configured')); return; }
        let urlObj;
        try { urlObj = new URL(CUSTOMER_API_URL); } catch { reject(new Error('Customer API URL is not valid')); return; }
        urlObj.searchParams.set('discord_username', discordUsername);
        const reqOptions = {
            hostname: urlObj.hostname,
            path: urlObj.pathname + urlObj.search,
            method: 'GET',
            headers: { 'api_key': STATS_API_KEY, 'Content-Type': 'application/json' },
        };
        https.get(reqOptions, res => {
            if (res.statusCode < 200 || res.statusCode >= 300) { res.resume(); reject(new Error(`Customer API returned status ${res.statusCode}`)); return; }
            let raw = '';
            res.on('data', chunk => { raw += chunk; });
            res.on('end', () => {
                try {
                    const data = JSON.parse(raw);
                    const results = Array.isArray(data) ? data : (data.results ?? data.items ?? []);
                    resolve(results.length > 0 ? results[0] : null);
                } catch { reject(new Error('Failed to parse Customer API response')); }
            });
        }).on('error', reject);
    });
}

function fetchCustomerByMinecraft(mcUsername) {
    return new Promise((resolve, reject) => {
        if (!BASE44_APP_ID) { reject(new Error('BASE44_APP_ID is not configured')); return; }
        if (!STATS_API_KEY) { reject(new Error('BASE44_API_KEY is not configured')); return; }
        let urlObj;
        try { urlObj = new URL(CUSTOMER_API_URL); } catch { reject(new Error('Customer API URL is not valid')); return; }
        urlObj.searchParams.set('minecraft_username', mcUsername);
        const reqOptions = {
            hostname: urlObj.hostname,
            path: urlObj.pathname + urlObj.search,
            method: 'GET',
            headers: { 'api_key': STATS_API_KEY, 'Content-Type': 'application/json' },
        };
        https.get(reqOptions, res => {
            if (res.statusCode < 200 || res.statusCode >= 300) { res.resume(); reject(new Error(`Customer API returned status ${res.statusCode}`)); return; }
            let raw = '';
            res.on('data', chunk => { raw += chunk; });
            res.on('end', () => {
                try {
                    const data = JSON.parse(raw);
                    const results = Array.isArray(data) ? data : (data.results ?? data.items ?? []);
                    resolve(results.length > 0 ? results[0] : null);
                } catch { reject(new Error('Failed to parse Customer API response')); }
            });
        }).on('error', reject);
    });
}

function fetchAllCustomers() {
    return new Promise((resolve, reject) => {
        if (!BASE44_APP_ID) { reject(new Error('BASE44_APP_ID is not configured')); return; }
        if (!STATS_API_KEY) { reject(new Error('BASE44_API_KEY is not configured')); return; }
        let urlObj;
        try { urlObj = new URL(CUSTOMER_API_URL); } catch { reject(new Error('Customer API URL is not valid')); return; }
        const reqOptions = {
            hostname: urlObj.hostname,
            path: urlObj.pathname + urlObj.search,
            method: 'GET',
            headers: { 'api_key': STATS_API_KEY, 'Content-Type': 'application/json' },
        };
        https.get(reqOptions, res => {
            if (res.statusCode < 200 || res.statusCode >= 300) { res.resume(); reject(new Error(`Customer API returned status ${res.statusCode}`)); return; }
            let raw = '';
            res.on('data', chunk => { raw += chunk; });
            res.on('end', () => {
                try {
                    const data = JSON.parse(raw);
                    const results = Array.isArray(data) ? data : (data.results ?? data.items ?? []);
                    resolve(results);
                } catch { reject(new Error('Failed to parse Customer API response')); }
            });
        }).on('error', reject);
    });
}

function updateCustomerDiscordUsername(customerId, discordUsername) {
    return new Promise((resolve, reject) => {
        const apiUrl = new URL(`${CUSTOMER_API_URL}/${encodeURIComponent(customerId)}`);
        const body = JSON.stringify({ discord_username: discordUsername });
        const options = {
            hostname: apiUrl.hostname,
            path: apiUrl.pathname,
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'api_key': STATS_API_KEY },
        };
        const req = https.request(options, res => {
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve({}); } });
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

function getOrderDate(order) {
    const raw = order._created ?? order.created_date ?? order.order_date ?? order.created_at ?? null;
    if (!raw) return 0;
    const ts = new Date(raw).getTime();
    return isNaN(ts) ? 0 : ts;
}

function getOrderAmount(order) {
    const val = order.amount_total ?? order.total ?? order.amount ?? order.order_total ?? null;
    return typeof val === 'number' ? val : null;
}

function fetchOrdersByMinecraft(mcUsername) {
    return new Promise((resolve, reject) => {
        if (!BASE44_APP_ID) { reject(new Error('BASE44_APP_ID is not configured')); return; }
        if (!STATS_API_KEY) { reject(new Error('BASE44_API_KEY is not configured')); return; }
        let urlObj;
        try { urlObj = new URL(ORDER_API_URL); } catch { reject(new Error('Order API URL is not valid')); return; }
        urlObj.searchParams.set('minecraft_username', mcUsername);
        const reqOptions = {
            hostname: urlObj.hostname,
            path: urlObj.pathname + urlObj.search,
            method: 'GET',
            headers: { 'api_key': STATS_API_KEY, 'Content-Type': 'application/json' },
        };
        https.get(reqOptions, res => {
            if (res.statusCode < 200 || res.statusCode >= 300) { res.resume(); reject(new Error(`Order API returned status ${res.statusCode}`)); return; }
            let raw = '';
            res.on('data', chunk => { raw += chunk; });
            res.on('end', () => {
                try {
                    const data = JSON.parse(raw);
                    resolve(Array.isArray(data) ? data : (data.results ?? data.items ?? []));
                } catch { reject(new Error('Failed to parse Order API response')); }
            });
        }).on('error', reject);
    });
}

function fetchAllOrders() {
    return new Promise((resolve, reject) => {
        if (!BASE44_APP_ID) { reject(new Error('BASE44_APP_ID is not configured')); return; }
        if (!STATS_API_KEY) { reject(new Error('BASE44_API_KEY is not configured')); return; }
        let urlObj;
        try { urlObj = new URL(ORDER_API_URL); } catch { reject(new Error('Order API URL is not valid')); return; }
        const reqOptions = {
            hostname: urlObj.hostname,
            path: urlObj.pathname + urlObj.search,
            method: 'GET',
            headers: { 'api_key': STATS_API_KEY, 'Content-Type': 'application/json' },
        };
        https.get(reqOptions, res => {
            if (res.statusCode < 200 || res.statusCode >= 300) { res.resume(); reject(new Error(`Order API returned status ${res.statusCode}`)); return; }
            let raw = '';
            res.on('data', chunk => { raw += chunk; });
            res.on('end', () => {
                try {
                    const data = JSON.parse(raw);
                    resolve(Array.isArray(data) ? data : (data.results ?? data.items ?? []));
                } catch { reject(new Error('Failed to parse Order API response')); }
            });
        }).on('error', reject);
    });
}

function buildStatsEmbed(customer, discordMember) {
    const username = discordMember ? discordMember.user.username : (customer.discord_username || 'Unknown');
    const avatarUrl = discordMember ? discordMember.user.displayAvatarURL({ size: 128 }) : null;
    const orderCount = typeof customer.order_count === 'number' ? customer.order_count : 0;
    const totalSpent = typeof customer.total_spent === 'number' ? customer.total_spent : 0;
    const tier = getTier(totalSpent);
    const points = calcLoyaltyPoints(totalSpent);
    const bar = buildLoyaltyBar(points);
    const separator = '\u2500'.repeat(30);
    const embed = new EmbedBuilder()
        .setColor(tier.color)
        .setTitle(`${tier.emoji} Profile — ${username}`)
        .setDescription(`🟡 **Loyalty Points: ${points % 1 === 0 ? points : points.toFixed(1)}/100**\n\`${bar}\`\n${separator}`)
        .addFields(
            { name: '🏅 Standing', value: [`**Rank:** ${tier.emoji} ${tier.name}`, `**Total Spent:** $${totalSpent.toFixed(2)}`, `**Orders:** ${orderCount}`].join('\n'), inline: true },
            { name: '📈 Activity', value: [`**First Purchase:** ${formatDate(customer.first_purchase_date)}`, `**Last Purchase:** ${formatDate(customer.last_purchase_date)}`].join('\n'), inline: true }
        )
        .setFooter({ text: 'DonutDemand Bot' })
        .setTimestamp();
    if (avatarUrl) embed.setThumbnail(avatarUrl);
    return embed;
}

/* ===================== RESTOCK HELPERS ===================== */
function buildRestockEmbed(product, quantity) {
    const now = new Date();
    return new EmbedBuilder()
        .setColor(0x1E1F22)
        .setTitle('🔔 Product Restocked!')
        .setDescription(`**${product}** is back in stock and ready to purchase!`)
        .addFields(
            { name: '📦 Product', value: product, inline: true },
            { name: '✅ Status', value: '`Available Now` • `Restocked`', inline: true },
            { name: '🗃️ Stock', value: `**${quantity}** unit${quantity !== 1 ? 's' : ''} available`, inline: true }
        )
        .setFooter({ text: `Restocked at ${now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })}` })
        .setTimestamp(now);
}

function buildActionButtons() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(SHOW_STOCK_BUTTON_ID).setLabel('Show Current Stock').setStyle(ButtonStyle.Primary).setEmoji('📦'),
        new ButtonBuilder().setCustomId(ORDER_NOW_BUTTON_ID).setLabel('Order Now').setStyle(ButtonStyle.Success).setEmoji('🛒')
    );
}

/* ===================== ORDER NOTIFICATION HELPERS ===================== */
function buildOrderEmbed(order) {
    const productName = order.product_name ?? order.product ?? order.item_name ?? 'Unknown Product';
    const rawPrice = order.amount_total ?? order.total ?? order.amount ?? order.order_total ?? order.price_paid ?? null;
    const pricePaid = rawPrice !== null ? `$${rawPrice}` : 'Unknown';
    const minecraftUsername = order.minecraft_username ?? order.mc_username ?? order.player_name ?? order.ign ?? 'Unknown';
    const discordUsername = order.discord_username ?? order.discord_user ?? order.discord_name ?? 'Unknown';
    const quantity = order.quantity ?? order.product_quantity ?? 1;
    const discountCode = order.discount_code ?? order.coupon_code ?? order.coupon ?? order.discount ?? order.promo_code ?? null;
    const embed = new EmbedBuilder()
        .setColor(0xFFA500)
        .setTitle('🍩 New Order!')
        .addFields(
            { name: 'Order', value: `${quantity}x ${productName}`, inline: false },
            { name: 'Price Paid', value: pricePaid, inline: true },
            { name: 'Minecraft Username', value: `\`${minecraftUsername}\``, inline: true },
            { name: 'Discord Username', value: `\`${discordUsername}\``, inline: true }
        )
        .setTimestamp();
    if (discountCode) embed.addFields({ name: 'Discount Code', value: `\`${discountCode}\``, inline: true });
    return embed;
}

function buildOrderButtons(orderId) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`order_delivered:${orderId}`).setLabel('✅ Delivered').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`order_review:${orderId}`).setLabel('🔍 Needs Review').setStyle(ButtonStyle.Danger)
    );
}

/* ===================== ORDER POLLING ===================== */
let orderPollInterval = null;
const seenOrderIds = new Set();

async function seedSeenOrderIds() {
    let orders;
    try { orders = await fetchAllOrders(); } catch (err) { console.error('seedSeenOrderIds error:', err); return; }
    let dirty = false;
    for (const order of orders) {
        const orderId = String(order._id ?? order.id ?? '');
        if (!orderId) continue;
        if (!seenOrderIds.has(orderId)) { seenOrderIds.add(orderId); dirty = true; }
    }
    if (dirty) {
        const freshConfig = loadConfig();
        freshConfig.seenOrderIds = [...seenOrderIds];
        saveConfig(freshConfig);
    }
}

async function startOrderPolling() {
    const config = loadConfig();
    if (Array.isArray(config.seenOrderIds)) {
        for (const id of config.seenOrderIds) seenOrderIds.add(String(id));
    }
    await seedSeenOrderIds();
    if (orderPollInterval) clearInterval(orderPollInterval);
    orderPollInterval = setInterval(pollOrders, ORDER_POLL_INTERVAL_MS);
}

async function pollOrders() {
    const config = loadConfig();
    const channelId = config.orderChannelId;
    if (!channelId) return;
    let orders;
    try { orders = await fetchAllOrders(); } catch (err) { console.error('Order poll error:', err); return; }
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel) return;
    let dirty = false;
    for (const order of orders) {
        const orderId = String(order._id ?? order.id ?? '');
        if (!orderId) continue;
        if (seenOrderIds.has(orderId)) continue;
        const embed = buildOrderEmbed(order);
        const row = buildOrderButtons(orderId);
        try {
            await channel.send({ embeds: [embed], components: [row] });
            seenOrderIds.add(orderId);
            dirty = true;
        } catch (err) { console.error('Failed to post order notification:', err); }
    }
    if (dirty) {
        const freshConfig = loadConfig();
        freshConfig.seenOrderIds = [...seenOrderIds];
        saveConfig(freshConfig);
    }
}

/* ===================== LEADERBOARD (TOP SPENDERS) ===================== */
const leaderboardCache = new Map();
const LEADERBOARD_CACHE_TTL_MS = 5 * 60 * 1000;
const LEADERBOARD_UPDATE_INTERVAL_MS = 10 * 60 * 1000;
let leaderboardInterval = null;
const LEADERBOARD_MEDALS = ['🥇', '🥈', '🥉'];

function buildLeaderboardEmbed(customers) {
    const eligible = customers
        .filter(c => c.discord_username && c.discord_username.trim() !== '')
        .sort((a, b) => (b.total_spent || 0) - (a.total_spent || 0))
        .slice(0, 10);
    if (eligible.length === 0) return null;
    const leaderboardLines = eligible.map((c, i) => {
        const prefix = i < 3 ? LEADERBOARD_MEDALS[i] : `${i + 1}.`;
        const spent = (c.total_spent || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        return `${prefix} **${c.discord_username}** — $${spent}`;
    });
    const intervalMinutes = LEADERBOARD_UPDATE_INTERVAL_MS / 60000;
    return new EmbedBuilder()
        .setColor(0x1E1F22)
        .setTitle('🏆 Top 10 Spenders')
        .setDescription(leaderboardLines.join('\n'))
        .setFooter({ text: `Updated every ${intervalMinutes} minutes • DonutDemand Bot` })
        .setTimestamp();
}

async function updateLeaderboard() {
    const config = loadConfig();
    const channelId = config.leaderboardChannelId;
    if (!channelId) return;
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel) return;
    let customers;
    try { customers = await fetchAllCustomers(); } catch (err) { console.error('Leaderboard update failed:', err); return; }
    const embed = buildLeaderboardEmbed(customers);
    if (!embed) return;
    const messageId = config.leaderboardMessageId;
    if (messageId) {
        try {
            const msg = await channel.messages.fetch(messageId);
            await msg.edit({ embeds: [embed] });
            return;
        } catch {}
    }
    try {
        const msg = await channel.send({ embeds: [embed] });
        config.leaderboardMessageId = msg.id;
        saveConfig(config);
    } catch (err) { console.error('Failed to send leaderboard:', err); }
}

function startLeaderboardInterval() {
    if (leaderboardInterval) clearInterval(leaderboardInterval);
    leaderboardInterval = setInterval(updateLeaderboard, LEADERBOARD_UPDATE_INTERVAL_MS);
    updateLeaderboard();
}

/* ===================== TIMEZONE SYSTEM ===================== */
const TIMEZONE_UPDATE_INTERVAL_MS = 10 * 1000;
let timezoneInterval = null;

function parseTimeInput(timeStr) {
    const cleaned = timeStr.trim().toLowerCase().replace(/\s+/g, '');
    const match = cleaned.match(/^(\d{1,2}):(\d{2})(am|pm)?$/i);
    if (!match) return null;
    let hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    const period = match[3];
    if (period === 'pm' && hours !== 12) hours += 12;
    if (period === 'am' && hours === 12) hours = 0;
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
    return { hours, minutes };
}

function buildTimezoneEmbed(staffTimezones) {
    const now = new Date();
    const lines = Object.entries(staffTimezones).map(([userId, data]) => {
        const staffTime = new Date(now.getTime() + data.utcOffsetMinutes * 60000);
        const timeStr = staffTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'UTC' });
        return `<@${userId}> — **${timeStr}** (${data.timezone})`;
    });
    return new EmbedBuilder()
        .setColor(0xFFFDD0)
        .setTitle('🕐 Staff Times')
        .setDescription(lines.length > 0 ? lines.join('\n') : 'No staff members have set their timezone yet.')
        .setFooter({ text: 'Last updated' })
        .setTimestamp(now);
}

async function updateTimezoneDisplay() {
    const config = loadConfig();
    const channelId = config.timezoneChannelId;
    if (!channelId) return;
    const staffTimezones = config.staffTimezones || {};
    if (Object.keys(staffTimezones).length === 0) return;
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel) return;
    const embed = buildTimezoneEmbed(staffTimezones);
    const messageId = config.timezoneMessageId;
    if (messageId) {
        try {
            const msg = await channel.messages.fetch(messageId);
            await msg.edit({ embeds: [embed] });
            return;
        } catch {}
    }
    try {
        const msg = await channel.send({ embeds: [embed] });
        config.timezoneMessageId = msg.id;
        saveConfig(config);
    } catch (err) { console.error('Failed to send timezone display:', err); }
}

function startTimezoneInterval() {
    if (timezoneInterval) clearInterval(timezoneInterval);
    timezoneInterval = setInterval(updateTimezoneDisplay, TIMEZONE_UPDATE_INTERVAL_MS);
    updateTimezoneDisplay();
}

/* ===================== SLASH COMMANDS ===================== */
function buildCommandsJSON() {
    // /help
    const helpCmd = new SlashCommandBuilder()
        .setName('help')
        .setDescription('Show bot commands list.')
        .setDMPermission(false);

    // /settings (4 subcommands: channel, role, leader-channel, dashboard)
    const settingsCmd = new SlashCommandBuilder()
        .setName('settings')
        .setDescription('Configure bot settings.')
        .setDMPermission(false)
        .addSubcommand(sub => sub
            .setName('channel')
            .setDescription('Set the channel for restock notifications.')
            .addChannelOption(o => o.setName('channel').setDescription('Channel').addChannelTypes(ChannelType.GuildText).setRequired(true))
        )
        .addSubcommand(sub => sub
            .setName('role')
            .setDescription('Set the role to ping on restock notifications.')
            .addRoleOption(o => o.setName('role').setDescription('Role').setRequired(true))
        )
        .addSubcommand(sub => sub
            .setName('leader-channel')
            .setDescription('Set the channel for the auto-updating leaderboard.')
            .addChannelOption(o => o.setName('channel').setDescription('Channel').addChannelTypes(ChannelType.GuildText).setRequired(true))
        )
        .addSubcommand(sub => sub
            .setName('dashboard')
            .setDescription('Open the interactive settings dashboard.')
        );

    // /restock
    const restockCmd = new SlashCommandBuilder()
        .setName('restock')
        .setDescription('Send a restock notification embed.')
        .setDMPermission(false)
        .addStringOption(o => o.setName('product').setDescription('Product name').setRequired(true))
        .addIntegerOption(o => o.setName('quantity').setDescription('Quantity').setRequired(true).setMinValue(1));

    // /announce
    const announceCmd = new SlashCommandBuilder()
        .setName('announce')
        .setDescription('Send an announcement DM to all members.')
        .setDMPermission(false)
        .addStringOption(o => o.setName('message').setDescription('Message to send').setRequired(true))
        .addRoleOption(o => o.setName('role').setDescription('Only send to members with this role (optional)').setRequired(false));

    // /updatestock
    const updatestockCmd = new SlashCommandBuilder()
        .setName('updatestock')
        .setDescription('Select a product and update its stock quantity.')
        .setDMPermission(false)
        .addIntegerOption(o => o.setName('quantity').setDescription('New quantity').setRequired(true).setMinValue(0));

    // /addproduct
    const addproductCmd = new SlashCommandBuilder()
        .setName('addproduct')
        .setDescription('Add a new product to the store.')
        .setDMPermission(false)
        .addStringOption(o => o.setName('name').setDescription('Product name').setRequired(true))
        .addNumberOption(o => o.setName('price').setDescription('Price in USD').setRequired(true).setMinValue(0))
        .addIntegerOption(o => o.setName('quantity').setDescription('Initial quantity').setRequired(true).setMinValue(0))
        .addStringOption(o => o.setName('category').setDescription('Category (optional)').setRequired(false))
        .addStringOption(o => o.setName('description').setDescription('Description (optional)').setRequired(false))
        .addStringOption(o => o.setName('image_url').setDescription('Image URL (optional)').setRequired(false));

    // /editproduct
    const editproductCmd = new SlashCommandBuilder()
        .setName('editproduct')
        .setDescription('Select a product and edit one of its fields.')
        .setDMPermission(false)
        .addStringOption(o => o.setName('field').setDescription('Field to edit').setRequired(true)
            .addChoices(
                { name: 'Name', value: 'name' },
                { name: 'Price', value: 'price' },
                { name: 'Quantity', value: 'quantity' },
                { name: 'Category', value: 'category' },
                { name: 'Description', value: 'description' },
                { name: 'Image URL', value: 'image_url' }
            ))
        .addStringOption(o => o.setName('value').setDescription('New value').setRequired(true));

    // /claim
    const claimCmd = new SlashCommandBuilder()
        .setName('claim')
        .setDescription('Link your Discord account to your purchase history.')
        .setDMPermission(false)
        .addStringOption(o => o.setName('minecraft_username').setDescription('Your Minecraft username used at checkout').setRequired(true))
        .addNumberOption(o => o.setName('amount').setDescription('Your most recent order amount in USD').setRequired(true).setMinValue(0));

    // /stats
    const statsCmd = new SlashCommandBuilder()
        .setName('stats')
        .setDescription('View loyalty stats for a user.')
        .setDMPermission(false)
        .addSubcommand(sub => sub
            .setName('view')
            .setDescription('View loyalty stats for a user.')
            .addUserOption(o => o.setName('user').setDescription('User to view').setRequired(true))
        )
        .addSubcommand(sub => sub.setName('private').setDescription('Set your stats to private.'))
        .addSubcommand(sub => sub.setName('public').setDescription('Set your stats to public.'));

    // /leader (top spenders)
    const leaderCmd = new SlashCommandBuilder()
        .setName('leader')
        .setDescription('Display the top 10 spenders leaderboard.')
        .setDMPermission(false);

    // /timezone
    const timezoneCmd = new SlashCommandBuilder()
        .setName('timezone')
        .setDescription('Manage staff timezone display.')
        .setDMPermission(false)
        .addSubcommand(sub => sub
            .setName('set')
            .setDescription('Set your current local time and timezone.')
            .addStringOption(o => o.setName('current_time').setDescription('Your current local time (e.g. 10:32am)').setRequired(true))
            .addStringOption(o => o.setName('timezone').setDescription('Timezone name (e.g. EST, PST, GMT+5)').setRequired(true))
        )
        .addSubcommand(sub => sub
            .setName('channel')
            .setDescription('Set the channel for the live staff times display.')
            .addChannelOption(o => o.setName('channel').setDescription('Channel').addChannelTypes(ChannelType.GuildText).setRequired(true))
        );

    // /order
    const orderCmd = new SlashCommandBuilder()
        .setName('order')
        .setDescription('Manage order notifications.')
        .setDMPermission(false)
        .addSubcommand(sub => sub
            .setName('channel')
            .setDescription('Set the channel for new order notifications.')
            .addChannelOption(o => o.setName('channel').setDescription('Channel').addChannelTypes(ChannelType.GuildText).setRequired(true))
        );

    // /paid
    const paidCmd = new SlashCommandBuilder()
        .setName('paid')
        .setDescription('Manage delivered orders channel.')
        .setDMPermission(false)
        .addSubcommand(sub => sub
            .setName('channel')
            .setDescription('Set the channel for delivered orders.')
            .addChannelOption(o => o.setName('channel').setDescription('Channel').addChannelTypes(ChannelType.GuildText).setRequired(true))
        );

    // /review
    const reviewCmd = new SlashCommandBuilder()
        .setName('review')
        .setDescription('Manage review orders channel.')
        .setDMPermission(false)
        .addSubcommand(sub => sub
            .setName('channel')
            .setDescription('Set the channel for orders needing review.')
            .addChannelOption(o => o.setName('channel').setDescription('Channel').addChannelTypes(ChannelType.GuildText).setRequired(true))
        );

    // /setup-verify
    const setupVerifyCmd = new SlashCommandBuilder()
        .setName('setup-verify')
        .setDescription('Post a verification button for users to authorize with the bot. (Owner only)')
        .setDMPermission(false);

    // /sync (enhanced with mode option from DonutDemand1)
    const syncCmd = new SlashCommandBuilder()
        .setName('sync')
        .setDescription('OWNER: sync bot slash commands.')
        .setDMPermission(false)
        .addStringOption(o => o.setName('mode').setDescription('What to do').setRequired(false)
            .addChoices(
                { name: 'register_here', value: 'register_here' },
                { name: 'clear_here', value: 'clear_here' },
                { name: 'register_global', value: 'register_global' },
                { name: 'clear_global', value: 'clear_global' }
            ));

    // /stop & /resume
    const stopCmd = new SlashCommandBuilder()
        .setName('stop')
        .setDescription('OWNER: restrict bot commands in a server.')
        .setDMPermission(false)
        .addStringOption(o => o.setName('server_id').setDescription('Guild ID').setRequired(true));

    const resumeCmd = new SlashCommandBuilder()
        .setName('resume')
        .setDescription('OWNER: resume bot commands in a server.')
        .setDMPermission(false)
        .addStringOption(o => o.setName('server_id').setDescription('Guild ID').setRequired(true));

    // /backup & /restore
    const backupCmd = new SlashCommandBuilder()
        .setName('backup')
        .setDescription('OWNER/ADMIN: Backup invites data.')
        .setDMPermission(false);

    const restoreCmd = new SlashCommandBuilder()
        .setName('restore')
        .setDescription('OWNER/ADMIN: Restore invites data from backup.')
        .setDMPermission(false);

    // /panel
    const panelCmd = new SlashCommandBuilder()
        .setName('panel')
        .setDescription('Admin: configure and post ticket panels.')
        .setDMPermission(false)
        .addSubcommand(sub => sub.setName('set').setDescription('Save ticket panel config JSON.').addStringOption(o => o.setName('json').setDescription('Panel config JSON.').setRequired(true)))
        .addSubcommand(sub => sub.setName('post').setDescription('Post the ticket panel.').addChannelOption(o => o.setName('channel').setDescription('Channel (optional)').addChannelTypes(ChannelType.GuildText).setRequired(false)))
        .addSubcommand(sub => sub.setName('show').setDescription('Show current saved ticket panel config.'))
        .addSubcommand(sub => sub.setName('reset').setDescription('Reset ticket panel config to default.'))
        .addSubcommand(sub => sub.setName('rewards').setDescription('Post a Claim Rewards panel.'));

    // /embed
    const embedCmd = new SlashCommandBuilder()
        .setName('embed')
        .setDescription('Send a custom embed (admin only).')
        .setDMPermission(false)
        .addChannelOption(o => o.setName('channel').setDescription('Channel to send embed in (optional)').addChannelTypes(ChannelType.GuildText).setRequired(false))
        .addStringOption(o => o.setName('title').setDescription('Embed title').setRequired(false))
        .addStringOption(o => o.setName('description').setDescription('Embed description').setRequired(false))
        .addStringOption(o => o.setName('color').setDescription('Hex color like #ff0000').setRequired(false))
        .addStringOption(o => o.setName('url').setDescription('Clickable title URL').setRequired(false))
        .addStringOption(o => o.setName('thumbnail').setDescription('Thumbnail image URL').setRequired(false))
        .addStringOption(o => o.setName('image').setDescription('Main image URL').setRequired(false));

    // /calc
    const calcCmd = new SlashCommandBuilder()
        .setName('calc')
        .setDescription('Calculate an expression. Supports + - x / ^ and parentheses.')
        .setDMPermission(false)
        .addStringOption(o => o.setName('expression').setDescription('Example: (5x2)+3^2/3').setRequired(true));

    // /leaderboard (top inviters - DonutDemand1)
    const leaderboardCmd = new SlashCommandBuilder()
        .setName('leaderboard')
        .setDescription('Shows the top 10 inviters in this server.')
        .setDMPermission(false);

    // /blacklist
    const blacklistCmd = new SlashCommandBuilder()
        .setName('blacklist')
        .setDescription('Admin: blacklist users from earning invites.')
        .setDMPermission(false)
        .addSubcommand(s => s.setName('add').setDescription('Add a user to the invites blacklist.').addUserOption(o => o.setName('user').setDescription('User').setRequired(true)))
        .addSubcommand(s => s.setName('remove').setDescription('Remove a user from the invites blacklist.').addUserOption(o => o.setName('user').setDescription('User').setRequired(true)))
        .addSubcommand(s => s.setName('list').setDescription('Show blacklisted users for this server.'));

    // Invite commands
    const invitesCmds = [
        new SlashCommandBuilder().setName('vouches').setDescription('Shows how many messages are in the vouches channel.').setDMPermission(false),
        new SlashCommandBuilder().setName('invites').setDescription('Shows invites still in the server for a user.').setDMPermission(false).addUserOption(o => o.setName('user').setDescription('User').setRequired(true)),
        new SlashCommandBuilder().setName('generate').setDescription('Generate your personal invite link (credited to you).').setDMPermission(false),
        new SlashCommandBuilder().setName('linkinvite').setDescription('Link an existing invite code to yourself.').setDMPermission(false).addStringOption(o => o.setName('code').setDescription('Invite code or discord.gg link').setRequired(true)),
        new SlashCommandBuilder().setName('addinvites').setDescription('Add invites to a user (manual). Admin only.').setDMPermission(false).addUserOption(o => o.setName('user').setDescription('User').setRequired(true)).addIntegerOption(o => o.setName('amount').setDescription('Amount').setRequired(true)),
        new SlashCommandBuilder().setName('resetinvites').setDescription('Reset a user\'s invite stats. Staff role-locked.').setDMPermission(false).addUserOption(o => o.setName('user').setDescription('User').setRequired(true)),
        new SlashCommandBuilder().setName('resetall').setDescription('Reset invite stats for EVERYONE. Admin only.').setDMPermission(false),
        new SlashCommandBuilder().setName('link').setDescription('Staff/Admin: show who a user invited + invite links used.').setDMPermission(false).addUserOption(o => o.setName('user').setDescription('User to inspect').setRequired(true)),
    ];

    // Ticket commands
    const closeCmd = new SlashCommandBuilder()
        .setName('close')
        .setDescription('Close the current ticket.')
        .setDMPermission(false)
        .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(true));

    const opCmd = new SlashCommandBuilder()
        .setName('operation')
        .setDescription('Admin: give customer role + ping vouch, close ticket after timer.')
        .setDMPermission(false)
        .addSubcommand(sub => sub.setName('start').setDescription('Start operation timer in this ticket.').addStringOption(o => o.setName('duration').setDescription('e.g. 10m, 1h, 2d').setRequired(true)))
        .addSubcommand(sub => sub.setName('cancel').setDescription('Cancel operation timer in this ticket.'));

    const addTicketCmd = new SlashCommandBuilder()
        .setName('add')
        .setDescription('Add a user to the current ticket.')
        .setDMPermission(false)
        .addUserOption(o => o.setName('user').setDescription('User to add to this ticket').setRequired(true));

    // Giveaway commands
    const giveawayCmds = [
        new SlashCommandBuilder().setName('giveaway').setDescription('Start a giveaway with a join button.').setDMPermission(false)
            .addStringOption(o => o.setName('duration').setDescription('e.g. 30m 1h 2d').setRequired(true))
            .addIntegerOption(o => o.setName('winners').setDescription('How many winners').setRequired(true))
            .addStringOption(o => o.setName('prize').setDescription('Prize').setRequired(true))
            .addIntegerOption(o => o.setName('min_invites').setDescription('Minimum invites needed to join (optional)').setMinValue(0).setRequired(false))
            .addRoleOption(o => o.setName('required_role').setDescription('Role users must have to join (optional)').setRequired(false)),
        new SlashCommandBuilder().setName('end').setDescription('End a giveaway early (staff/admin).').setDMPermission(false).addStringOption(o => o.setName('message').setDescription('Giveaway message ID or link').setRequired(true)),
        new SlashCommandBuilder().setName('reroll').setDescription('Reroll winners for a giveaway (staff/admin).').setDMPermission(false).addStringOption(o => o.setName('message').setDescription('Giveaway message ID or link').setRequired(true)),
    ];

    // /sos
    const sosCmd = new SlashCommandBuilder()
        .setName('sos')
        .setDescription('Start a Split or Steal game.')
        .setDMPermission(false)
        .addStringOption(o => o.setName('title').setDescription('Title for the game').setRequired(true))
        .addStringOption(o => o.setName('prize').setDescription('What is being given away').setRequired(true))
        .addStringOption(o => o.setName('duration').setDescription('How long entries are open (e.g. 30m, 1h, 2d)').setRequired(true))
        .addIntegerOption(o => o.setName('min_invites').setDescription('Minimum invites needed to enter (optional)').setMinValue(0).setRequired(false))
        .addRoleOption(o => o.setName('required_role').setDescription('Role users must have to join (optional)').setRequired(false));

    // /redeem
    const redeemCmd = new SlashCommandBuilder()
        .setName('redeem')
        .setDescription('Restore your invites from the auto-backup after a bot reset.')
        .setDMPermission(false);

    // /bid
    const bidCmd = new SlashCommandBuilder()
        .setName('bid')
        .setDescription('Start an auction (staff only).')
        .setDMPermission(false)
        .addStringOption(o => o.setName('item').setDescription('What is being auctioned').setRequired(true))
        .addIntegerOption(o => o.setName('starting_price').setDescription('Starting bid amount').setMinValue(1).setRequired(true))
        .addIntegerOption(o => o.setName('max_bid').setDescription('Maximum allowed bid amount').setMinValue(1).setRequired(true));

    // /syncinvites
    const syncInvitesCmd = new SlashCommandBuilder()
        .setName('syncinvites')
        .setDescription('Admin: manually sync invite data to the website API.')
        .setDMPermission(false);

    return [
        helpCmd, settingsCmd, restockCmd, announceCmd, updatestockCmd,
        addproductCmd, editproductCmd, claimCmd, statsCmd, leaderCmd,
        timezoneCmd, orderCmd, paidCmd, reviewCmd, setupVerifyCmd,
        syncCmd, stopCmd, resumeCmd, backupCmd, restoreCmd,
        panelCmd, embedCmd, calcCmd, leaderboardCmd, blacklistCmd,
        ...invitesCmds, closeCmd, opCmd, addTicketCmd,
        ...giveawayCmds, sosCmd, redeemCmd, bidCmd, syncInvitesCmd,
    ].map(c => c.toJSON());
}

/* ===================== COMMAND REGISTRATION ===================== */
function getRest() {
    const t = process.env.DISCORD_TOKEN || process.env.TOKEN;
    if (!t) throw new Error('Missing DISCORD_TOKEN / TOKEN');
    return new REST({ version: '10' }).setToken(t);
}

function getAppId() {
    return client.application?.id || client.user?.id || CLIENT_ID || null;
}

async function registerGlobal() {
    const appId = getAppId();
    if (!appId) throw new Error('App ID not available yet (bot not ready).');
    const rest = getRest();
    await rest.put(Routes.applicationCommands(appId), { body: buildCommandsJSON() });
    console.log('Registered GLOBAL slash commands');
}

async function registerGuild(guildId) {
    const appId = getAppId();
    if (!appId) throw new Error('App ID not available yet (bot not ready).');
    const rest = getRest();
    await rest.put(Routes.applicationGuildCommands(appId, guildId), { body: buildCommandsJSON() });
    console.log(`Registered GUILD slash commands for guild ${guildId}`);
}

async function clearGlobal() {
    const appId = getAppId();
    if (!appId) throw new Error('App ID not available yet (bot not ready).');
    const rest = getRest();
    await rest.put(Routes.applicationCommands(appId), { body: [] });
    console.log('Cleared GLOBAL slash commands');
}

async function clearGuild(guildId) {
    const appId = getAppId();
    if (!appId) throw new Error('App ID not available yet (bot not ready).');
    const rest = getRest();
    await rest.put(Routes.applicationGuildCommands(appId, guildId), { body: [] });
    console.log(`Cleared GUILD slash commands for guild ${guildId}`);
}

async function autoRegisterOnStartup() {
    const scope = (process.env.REGISTER_SCOPE || 'global').toLowerCase().trim();
    const devGuild = (process.env.DEV_GUILD_ID || '').trim();
    if (scope === 'guild') {
        if (!/^\d{10,25}$/.test(devGuild)) throw new Error('REGISTER_SCOPE=guild requires DEV_GUILD_ID');
        await registerGuild(devGuild);
        return;
    }
    await registerGlobal();
}

// backward-compat wrapper
async function registerCommands() {
    await autoRegisterOnStartup();
}

/* ===================== READY EVENT ===================== */
client.once('ready', async () => {
    console.log(`Bot is ready! Logged in as ${client.user.tag}`);

    try { await client.application.fetch(); } catch {}

    try {
        await autoRegisterOnStartup();
    } catch (e) {
        console.log('Slash register failed:', e?.message || e);
    }

    // Load seen order IDs from config
    const config = loadConfig();
    if (config.leaderboardChannelId) startLeaderboardInterval();
    if (config.timezoneChannelId) startTimezoneInterval();
    if (config.orderChannelId) startOrderPolling();

    // Initialize guild invites cache and settings
    for (const guild of client.guilds.cache.values()) {
        await refreshGuildInvites(guild).catch(() => {});
        getGuildSettings(guild.id);
        getPanelConfig(guild.id);
    }

    // Reschedule active giveaways
    for (const messageId of Object.keys(giveawayData.giveaways || {})) {
        const gw = giveawayData.giveaways[messageId];
        if (gw && !gw.ended) scheduleGiveawayEnd(messageId);
    }

    // Reschedule active SOS games
    for (const messageId of Object.keys(sosData.games || {})) {
        const game = sosData.games[messageId];
        if (!game) continue;
        if (!game.ended) {
            scheduleSOSEnd(messageId);
        } else if (game.drawn && !game.resolved) {
            redrawSOSPlayers(messageId).catch(() => {});
        }
    }

    // Auto-backup invites every hour
    doAutoBackupInvites().catch(() => {});
    setInterval(() => doAutoBackupInvites().catch(() => {}), 60 * 60 * 1000);

    // Base44 invite sync every 60 seconds
    if (process.env.BASE44_API_URL) {
        syncInvitesToBase44().catch(() => {});
        setInterval(() => syncInvitesToBase44().catch(() => {}), 60 * 1000);
        console.log('Base44 invite sync started (every 60s)');
    }
});

client.on('guildCreate', async (guild) => {
    getGuildSettings(guild.id);
    getPanelConfig(guild.id);
    await refreshGuildInvites(guild).catch(() => {});
});

/* ===================== INVITE EVENTS ===================== */
client.on('inviteCreate', async (invite) => {
    await refreshGuildInvites(invite.guild).catch(() => {});
});
client.on('inviteDelete', async (invite) => {
    await refreshGuildInvites(invite.guild).catch(() => {});
});

client.on('guildMemberAdd', async (member) => {
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

        if (!creditedInviterId) {
            if (logChannel && logChannel.type === ChannelType.GuildText) {
                await logChannel.send(`${member} has been invited by **Unknown** and now has **0** invites.`).catch(() => {});
            }
            return;
        }

        const blacklisted = isBlacklistedInviter(guild.id, creditedInviterId);

        if (!blacklisted) {
            const stats = ensureInviterStats(creditedInviterId);
            if (invitesData.memberInviter[member.id]) stats.rejoins += 1;
            else stats.joins += 1;
            invitesData.memberInviter[member.id] = creditedInviterId;
            invitesData.invitedMembers[creditedInviterId] ??= {};
            invitesData.invitedMembers[creditedInviterId][member.id] = {
                inviteCode: used.code,
                joinedAt: Date.now(),
                active: true,
                leftAt: null,
            };
            saveInvites();
        }

        const still = invitesStillInServerForGuild(guild.id, creditedInviterId);

        if (logChannel && logChannel.type === ChannelType.GuildText) {
            if (blacklisted) {
                await logChannel.send(`${member} has been invited by **blacklisted user** (<@${creditedInviterId}>) and now has **0** invites.`).catch(() => {});
            } else {
                await logChannel.send(`${member} has been invited by <@${creditedInviterId}> and now has **${still}** invites.`).catch(() => {});
            }
        }

        syncInvitesToBase44().catch(() => {});
    } catch {}
});

client.on('guildMemberRemove', async (member) => {
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
        syncInvitesToBase44().catch(() => {});
    } catch {}
});

/* ===================== INTERACTION HANDLER ===================== */
client.on('interactionCreate', async interaction => {
    try {
        if (!interaction.guild) return;

        const isOwnerCmd = interaction.isChatInputCommand() &&
            ['stop', 'resume', 'sync', 'backup', 'restore'].includes(interaction.commandName);

        if (!isOwnerCmd) {
            const blocked = await denyIfStopped(interaction);
            if (blocked) return;
        }

        /* ── Button: View Transcript ──────────────────────────────────────── */
        if (interaction.isButton() && interaction.customId.startsWith(TRANSCRIPT_BUTTON_PREFIX)) {
            const transcriptId = interaction.customId.slice(TRANSCRIPT_BUTTON_PREFIX.length);
            const transcript = transcriptStore.get(transcriptId);
            if (!transcript) {
                await interaction.reply({ content: 'Transcript expired or not found.', ephemeral: true });
                return;
            }
            await interaction.reply({
                files: [{ attachment: Buffer.from(transcript.content, 'utf-8'), name: `transcript-${transcript.channelName}-${transcriptId}.txt` }],
                ephemeral: true,
            });
            return;
        }

        /* ── Button: Show Current Stock ───────────────────────────────────── */
        if (interaction.isButton() && interaction.customId === SHOW_STOCK_BUTTON_ID) {
            await interaction.deferReply({ ephemeral: true });
            let products;
            try { products = await fetchCurrentStock(); } catch (err) {
                await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0xED4245).setTitle('API Unreachable').setDescription('Could not fetch current stock data.')] });
                return;
            }
            if (!Array.isArray(products) || products.length === 0) {
                await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0xFEE75C).setTitle('📦 Current Stock').setDescription('No products found.')] });
                return;
            }
            const inStockProducts = products.filter(p => { const qty = p.quantity ?? p.stock ?? p.qty; return typeof qty === 'number' ? qty > 0 : true; });
            if (inStockProducts.length === 0) {
                await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0xFEE75C).setTitle('📦 Current Stock').setDescription('No items are currently in stock.')] });
                return;
            }
            const stockLines = inStockProducts.map(p => { const name = p.name || p.title || p.product_name || 'Unknown'; const qty = p.quantity ?? p.stock ?? p.qty ?? '—'; return `• **${name}** — ${qty} unit${qty === 1 ? '' : 's'}`; }).join('\n');
            const stockEmbed = new EmbedBuilder().setColor(0x5865F2).setTitle('📦 Current Stock Levels').setDescription(stockLines).setTimestamp();
            try {
                await interaction.user.send({ embeds: [stockEmbed] });
                await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0x57F287).setTitle('✅ Stock List Sent').setDescription('Check your DMs!')] });
            } catch {
                await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0xED4245).setTitle('❌ Could Not Send DM').setDescription('Please enable DMs from server members and try again.')] });
            }
            return;
        }

        /* ── Button: Order Now ────────────────────────────────────────────── */
        if (interaction.isButton() && interaction.customId === ORDER_NOW_BUTTON_ID) {
            await interaction.deferReply({ ephemeral: true });
            try {
                await interaction.user.send('Order at https://donutdemand.net');
                await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0x57F287).setTitle('✅ Order Link Sent').setDescription('Check your DMs!')] });
            } catch {
                await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0xED4245).setTitle('❌ Could Not Send DM').setDescription('Please enable DMs from server members and try again.')] });
            }
            return;
        }

        /* ── Button: Verify Auth ──────────────────────────────────────────── */
        if (interaction.isButton() && interaction.customId === VERIFY_AUTH_BUTTON_ID) {
            const userId = interaction.user.id;
            const config = loadConfig();
            if (!config.authorizedUsers) config.authorizedUsers = {};
            if (!config.authorizedUsers[userId]) {
                config.authorizedUsers[userId] = { authorizedAt: new Date().toISOString() };
                saveConfig(config);
            }
            await interaction.reply({ content: '✅ You have been verified! Your account is now linked to the bot.', ephemeral: true });
            return;
        }

        /* ── Select Menu: Update Stock ───────────────────────────────────── */
        if (interaction.isStringSelectMenu() && interaction.customId.startsWith(UPDATESTOCK_SELECT_PREFIX)) {
            await interaction.deferReply({ ephemeral: true });
            const quantityStr = interaction.customId.slice(UPDATESTOCK_SELECT_PREFIX.length);
            const quantity = parseInt(quantityStr, 10);
            const selectedValue = interaction.values[0];
            const separatorIdx = selectedValue.indexOf(VALUE_SEPARATOR);
            const productId = separatorIdx !== -1 ? selectedValue.slice(0, separatorIdx) : selectedValue;
            const productName = separatorIdx !== -1 ? selectedValue.slice(separatorIdx + VALUE_SEPARATOR.length) : selectedValue;
            try {
                await updateProductStock(productId, quantity);
            } catch (err) {
                await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0xED4245).setTitle('❌ Update Failed').setDescription('Could not update the stock.')] });
                return;
            }
            await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0x57F287).setTitle('✅ Stock Updated').setDescription(`**${productName}** stock set to **${quantity}** unit${quantity !== 1 ? 's' : ''}.`)] });
            return;
        }

        /* ── Select Menu: Edit Product ───────────────────────────────────── */
        if (interaction.isStringSelectMenu() && interaction.customId.startsWith(EDITPRODUCT_SELECT_PREFIX)) {
            await interaction.deferReply({ ephemeral: true });
            const editKey = interaction.customId.slice(EDITPRODUCT_SELECT_PREFIX.length);
            const editData = pendingEdits.get(editKey);
            if (!editData) {
                await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0xED4245).setTitle('❌ Edit Expired').setDescription('This edit session has expired. Please run `/editproduct` again.')] });
                return;
            }
            pendingEdits.delete(editKey);
            const { field, value: rawValue } = editData;
            const selectedValue = interaction.values[0];
            const separatorIdx = selectedValue.indexOf(VALUE_SEPARATOR);
            const productId = separatorIdx !== -1 ? selectedValue.slice(0, separatorIdx) : selectedValue;
            const productName = separatorIdx !== -1 ? selectedValue.slice(separatorIdx + VALUE_SEPARATOR.length) : selectedValue;
            let parsedValue = rawValue;
            if (field === 'price') {
                parsedValue = parseFloat(rawValue);
                if (isNaN(parsedValue) || parsedValue < 0) {
                    await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0xED4245).setTitle('❌ Invalid Price').setDescription('Price must be a valid positive number.')] });
                    return;
                }
            } else if (field === 'quantity') {
                parsedValue = parseInt(rawValue, 10);
                if (isNaN(parsedValue) || parsedValue < 0) {
                    await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0xED4245).setTitle('❌ Invalid Quantity').setDescription('Quantity must be a valid non-negative integer.')] });
                    return;
                }
            }
            const fieldLabels = { name: 'Name', price: 'Price', quantity: 'Quantity', category: 'Category', description: 'Description', image_url: 'Image URL' };
            try {
                await updateProduct(productId, { [field]: parsedValue });
            } catch (err) {
                await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0xED4245).setTitle('❌ Update Failed').setDescription('Could not update the product.')] });
                return;
            }
            const displayValue = field === 'price' ? `$${parsedValue}` : String(parsedValue);
            await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0x57F287).setTitle('✅ Product Updated').setDescription(`**${productName}** — **${fieldLabels[field] || field}** set to **${displayValue}**.`)] });
            return;
        }

        /* ── Button: Order Delivered ─────────────────────────────────────── */
        if (interaction.isButton() && interaction.customId.startsWith('order_delivered:')) {
            await interaction.deferUpdate();
            const config = loadConfig();
            const paidChannelId = config.paidChannelId;
            if (!paidChannelId) { await interaction.followUp({ embeds: [new EmbedBuilder().setColor(0xED4245).setTitle('❌ No Delivered Channel Set').setDescription('Please run `/paid channel` first.')], ephemeral: true }); return; }
            const paidChannel = await interaction.client.channels.fetch(paidChannelId).catch(() => null);
            if (!paidChannel) { await interaction.followUp({ embeds: [new EmbedBuilder().setColor(0xED4245).setTitle('❌ Channel Not Found')], ephemeral: true }); return; }
            const originalEmbed = interaction.message.embeds[0];
            const updatedEmbed = EmbedBuilder.from(originalEmbed).setColor(0x57F287).setTitle('✅ Order Delivered');
            try { await paidChannel.send({ embeds: [updatedEmbed] }); await interaction.message.delete().catch(() => {}); } catch (err) { console.error('Failed to move order to delivered channel:', err); }
            return;
        }

        /* ── Button: Order Needs Review ──────────────────────────────────── */
        if (interaction.isButton() && interaction.customId.startsWith('order_review:')) {
            await interaction.deferUpdate();
            const config = loadConfig();
            const reviewChannelId = config.reviewChannelId;
            if (!reviewChannelId) { await interaction.followUp({ embeds: [new EmbedBuilder().setColor(0xED4245).setTitle('❌ No Review Channel Set').setDescription('Please run `/review channel` first.')], ephemeral: true }); return; }
            const reviewChannel = await interaction.client.channels.fetch(reviewChannelId).catch(() => null);
            if (!reviewChannel) { await interaction.followUp({ embeds: [new EmbedBuilder().setColor(0xED4245).setTitle('❌ Channel Not Found')], ephemeral: true }); return; }
            const originalEmbed = interaction.message.embeds[0];
            const updatedEmbed = EmbedBuilder.from(originalEmbed).setColor(0xFEE75C).setTitle('🔍 Order Needs Review');
            try { await reviewChannel.send({ embeds: [updatedEmbed] }); await interaction.message.delete().catch(() => {}); } catch (err) { console.error('Failed to move order to review channel:', err); }
            return;
        }

        /* ── Giveaway join ───────────────────────────────────────────────── */
        if (interaction.isButton() && interaction.customId.startsWith('gw_join:')) {
            const messageId = interaction.customId.split('gw_join:')[1];
            const gw = giveawayData.giveaways[messageId];
            if (!gw) return interaction.reply({ content: 'This giveaway no longer exists.', ephemeral: true });
            if (gw.ended) return interaction.reply({ content: 'This giveaway already ended.', ephemeral: true });
            if ((gw.minInvites || 0) > 0) {
                const have = invitesStillInServerForGuild(interaction.guild.id, interaction.user.id);
                if (have < gw.minInvites) return interaction.reply({ content: `Need **${gw.minInvites}** invites. You have **${have}**.`, ephemeral: true });
            }
            if (gw.requiredRoleId) {
                const missingRoleId = await getMissingRequiredRoleId(interaction, gw.requiredRoleId);
                if (missingRoleId) return interaction.reply({ content: `You need the <@&${missingRoleId}> role to join this giveaway.`, ephemeral: true });
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
            return interaction.reply({ content: idx === -1 ? '✅ Entered the giveaway!' : '✅ Removed your entry.', ephemeral: true });
        }

        /* ── SOS join ────────────────────────────────────────────────────── */
        if (interaction.isButton() && interaction.customId.startsWith('sos_join:')) {
            const messageId = interaction.customId.split('sos_join:')[1];
            const game = sosData.games[messageId];
            if (!game) return interaction.reply({ content: 'This game no longer exists.', ephemeral: true });
            if (game.ended) return interaction.reply({ content: 'This game has already ended.', ephemeral: true });
            if ((game.minInvites || 0) > 0) {
                const have = invitesStillInServerForGuild(interaction.guild.id, interaction.user.id);
                if (have < game.minInvites) return interaction.reply({ content: `Need **${game.minInvites}** invites. You have **${have}**.`, ephemeral: true });
            }
            if (game.requiredRoleId) {
                const missingRoleId = await getMissingRequiredRoleId(interaction, game.requiredRoleId);
                if (missingRoleId) return interaction.reply({ content: `You need the <@&${missingRoleId}> role to join this game.`, ephemeral: true });
            }
            const userId = interaction.user.id;
            const idx = game.entries.indexOf(userId);
            if (idx === -1) game.entries.push(userId); else game.entries.splice(idx, 1);
            saveSOS();
            try {
                const channel = await client.channels.fetch(game.channelId);
                const msg = await channel.messages.fetch(game.messageId);
                await msg.edit({ embeds: [makeSosEmbed(game)], components: [sosRow(game)] });
            } catch {}
            return interaction.reply({ content: idx === -1 ? '✅ Entered the game!' : '✅ Removed your entry.', ephemeral: true });
        }

        /* ── Bid +$1 ─────────────────────────────────────────────────────── */
        if (interaction.isButton() && interaction.customId.startsWith('bid_plus1:')) {
            const messageId = interaction.customId.split('bid_plus1:')[1];
            const auction = bidData.auctions[messageId];
            if (!auction) return interaction.reply({ content: 'This auction no longer exists.', ephemeral: true });
            if (auction.ended) return interaction.reply({ content: 'This auction has already ended.', ephemeral: true });
            const newBid = auction.currentBid + 1;
            if (newBid > auction.maxBid) return interaction.reply({ content: `That would exceed the max bid of $${auction.maxBid}.`, ephemeral: true });
            if (auction.currentBidderId === interaction.user.id) return interaction.reply({ content: 'You are already the highest bidder!', ephemeral: true });
            auction.currentBid = newBid;
            auction.currentBidderId = interaction.user.id;
            saveBids();
            const ch = await client.channels.fetch(auction.channelId).catch(() => null);
            if (ch) { const msg = await ch.messages.fetch(auction.messageId).catch(() => null); if (msg) await msg.edit({ embeds: [makeBidEmbed(auction)], components: [buildBidRow(auction.messageId, false)] }).catch(() => {}); }
            return interaction.reply({ content: `✅ You bid $${newBid}!`, ephemeral: true });
        }

        /* ── Bid custom button -> modal ──────────────────────────────────── */
        if (interaction.isButton() && interaction.customId.startsWith('bid_custom:')) {
            const messageId = interaction.customId.split('bid_custom:')[1];
            const auction = bidData.auctions[messageId];
            if (!auction || auction.ended) return interaction.reply({ content: 'This auction has already ended.', ephemeral: true });
            const modal = new ModalBuilder().setCustomId(`bid_custom_modal:${messageId}`).setTitle('Custom Bid');
            modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('bid_amount').setLabel('Enter your bid amount (number)').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(10)));
            return interaction.showModal(modal);
        }

        /* ── Bid custom modal submit ─────────────────────────────────────── */
        if (interaction.isModalSubmit() && interaction.customId.startsWith('bid_custom_modal:')) {
            const messageId = interaction.customId.split('bid_custom_modal:')[1];
            const auction = bidData.auctions[messageId];
            if (!auction || auction.ended) return interaction.reply({ content: 'This auction has already ended.', ephemeral: true });
            const amount = parseInt((interaction.fields.getTextInputValue('bid_amount') || '').trim(), 10);
            if (isNaN(amount) || amount <= 0) return interaction.reply({ content: 'Invalid bid amount.', ephemeral: true });
            if (amount <= auction.currentBid) return interaction.reply({ content: `Your bid must be higher than the current bid of $${auction.currentBid}.`, ephemeral: true });
            if (amount > auction.maxBid) return interaction.reply({ content: `Your bid cannot exceed the max bid of $${auction.maxBid}.`, ephemeral: true });
            auction.currentBid = amount;
            auction.currentBidderId = interaction.user.id;
            saveBids();
            const ch = await client.channels.fetch(auction.channelId).catch(() => null);
            if (ch) { const msg = await ch.messages.fetch(auction.messageId).catch(() => null); if (msg) await msg.edit({ embeds: [makeBidEmbed(auction)], components: [buildBidRow(auction.messageId, false)] }).catch(() => {}); }
            return interaction.reply({ content: `✅ You bid $${amount}!`, ephemeral: true });
        }

        /* ── Bid end auction button ───────────────────────────────────────── */
        if (interaction.isButton() && interaction.customId.startsWith('bid_end:')) {
            const messageId = interaction.customId.split('bid_end:')[1];
            const auction = bidData.auctions[messageId];
            if (!auction) return interaction.reply({ content: 'This auction no longer exists.', ephemeral: true });
            if (auction.ended) return interaction.reply({ content: 'This auction has already ended.', ephemeral: true });
            const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
            if (!member || (!isOwner(interaction.user.id) && !isStaff(member))) return interaction.reply({ content: 'Only staff can end the auction.', ephemeral: true });
            auction.ended = true;
            saveBids();
            const ch = await client.channels.fetch(auction.channelId).catch(() => null);
            if (ch) { const msg = await ch.messages.fetch(auction.messageId).catch(() => null); if (msg) await msg.edit({ embeds: [makeBidEmbed(auction)], components: [buildBidRow(auction.messageId, true)] }).catch(() => {}); }
            await interaction.deferReply({ ephemeral: true });
            if (!auction.currentBidderId) {
                if (ch) await ch.send('No bids — auction ended with no winner.').catch(() => {});
                return interaction.editReply('✅ Auction ended with no winner.');
            }
            const guild = interaction.guild;
            const winnerMember = await guild.members.fetch(auction.currentBidderId).catch(() => null);
            const winnerName = winnerMember?.displayName || `<@${auction.currentBidderId}>`;
            if (ch) await ch.send(`🏆 Auction ended! **${winnerName}** won **${auction.item}** with a bid of **$${auction.currentBid}**!`).catch(() => {});
            const s = getGuildSettings(guild.id);
            const category = await getOrCreateCategory(guild, 'Auctions').catch(() => null);
            const winnerId = auction.currentBidderId;
            const channelName = `bid-${cleanName(winnerMember?.user.username || winnerId)}`;
            const createdAt = Date.now();
            const auctionOverrideRoles = s.ticketRoleOverrides?.['bid_winner']?.length > 0 ? s.ticketRoleOverrides['bid_winner'] : s.staffRoleIds || [];
            const overwrites = [
                { id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                { id: winnerId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
                ...auctionOverrideRoles.map(rid => ({ id: rid, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] })),
            ];
            const ticketChannel = await guild.channels.create({ name: channelName, type: ChannelType.GuildText, parent: category?.id, topic: `opener:${winnerId};created:${createdAt};type:bid_winner`, permissionOverwrites: overwrites }).catch(() => null);
            if (ticketChannel) await ticketChannel.send({ content: `<@${winnerId}> — You won the auction for **${auction.item}** at **$${auction.currentBid}**! A staff member will help you complete the trade.`, components: [buildTicketControlRow()] }).catch(() => {});
            return interaction.editReply('✅ Auction ended. Winner ticket created.');
        }

        /* ── Rewards claim button ────────────────────────────────────────── */
        if (interaction.isButton() && interaction.customId === 'rewards_claim_btn') {
            const s = getGuildSettings(interaction.guild.id);
            if (!s.rewardsWebhookUrl) return interaction.reply({ content: 'Rewards webhook is not configured. Ask an admin to set it via /settings → Set Rewards Webhook.', ephemeral: true });
            const gate = canClaimRewardsNow(interaction.guild.id, interaction.user.id);
            if (!gate.ok) {
                if (gate.code === 'NO_INVITES') return interaction.reply({ content: 'You need at least **1 invite** before you can claim rewards.', ephemeral: true });
                if (gate.code === 'TOO_RECENT') return interaction.reply({ content: `You can claim rewards in **${gate.remainingHours} hour(s)**.`, ephemeral: true });
                return interaction.reply({ content: 'Could not verify your invite history yet. Please try again later.', ephemeral: true });
            }
            const modal = new ModalBuilder().setCustomId('rewards_claim_modal').setTitle('Claim Rewards');
            modal.addComponents(
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('mc').setLabel('Minecraft username').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(32)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('discordname').setLabel('Discord username (for payout log)').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(64))
            );
            return interaction.showModal(modal);
        }

        /* ── Rewards claim modal submit ───────────────────────────────────── */
        if (interaction.isModalSubmit() && interaction.customId === 'rewards_claim_modal') {
            await interaction.deferReply({ ephemeral: true });
            const s = getGuildSettings(interaction.guild.id);
            const webhookUrl = s.rewardsWebhookUrl;
            if (!webhookUrl) return interaction.editReply('Rewards webhook is not configured. Ask an admin to set it via /settings → Set Rewards Webhook.');
            const gate = canClaimRewardsNow(interaction.guild.id, interaction.user.id);
            if (!gate.ok) {
                if (gate.code === 'NO_INVITES') return interaction.editReply('You need at least **1 invite** before you can claim rewards.');
                if (gate.code === 'TOO_RECENT') return interaction.editReply(`You can claim rewards in **${gate.remainingHours} hour(s)**.`);
                return interaction.editReply('Could not verify your invite history yet. Please try again later.');
            }
            const mc = (interaction.fields.getTextInputValue('mc') || '').trim();
            const discordName = (interaction.fields.getTextInputValue('discordname') || '').trim();
            if (!mc || !discordName) return interaction.editReply('Please fill out all fields.');
            const invitesBefore = invitesStillInServerForGuild(interaction.guild.id, interaction.user.id);
            const embed = new EmbedBuilder()
                .setTitle('🎁 Rewards Claim Submitted')
                .setColor(0xed4245)
                .addFields(
                    { name: 'Server', value: `${interaction.guild.name} (\`${interaction.guild.id}\`)`, inline: false },
                    { name: 'Discord User', value: `${interaction.user} — **${interaction.user.tag}** (\`${interaction.user.id}\`)`, inline: false },
                    { name: 'Minecraft Username', value: `\`${mc}\``, inline: true },
                    { name: 'Discord Username (provided)', value: `\`${discordName}\``, inline: true },
                    { name: 'Invites at Claim Time', value: `**${invitesBefore}**`, inline: true }
                )
                .setFooter({ text: 'DonutDemand Rewards • Claim log' })
                .setTimestamp();
            try { await sendWebhook(webhookUrl, { embeds: [embed.toJSON()] }); } catch (e) {
                return interaction.editReply(`Failed to submit claim to webhook: ${String(e?.message || e).slice(0, 180)}`);
            }
            resetInvitesForUser(interaction.user.id);
            syncInvitesToBase44().catch(() => {});
            return interaction.editReply(`✅ Your claim was submitted.\nYour invites have been reset and the rewards will be paid to **${mc}** after an admin reviews it.`);
        }

        /* ── Ticket close button -> modal ─────────────────────────────────── */
        if (interaction.isButton() && interaction.customId === 'ticket_close_btn') {
            if (!isTicketChannel(interaction.channel)) return interaction.reply({ content: 'This button only works inside tickets.', ephemeral: true });
            const meta = getTicketMetaFromTopic(interaction.channel.topic);
            const openerId = meta?.openerId;
            const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
            const canClose = isOwner(interaction.user.id) || interaction.user.id === openerId || isStaff(member);
            if (!canClose) return interaction.reply({ content: 'Only the opener or staff can close this ticket.', ephemeral: true });
            const modal = new ModalBuilder().setCustomId('ticket_close_modal').setTitle('Close Ticket');
            modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('reason').setLabel('Reason for closing').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(400)));
            return interaction.showModal(modal);
        }

        /* ── Close modal submit ───────────────────────────────────────────── */
        if (interaction.isModalSubmit() && interaction.customId === 'ticket_close_modal') {
            if (!isTicketChannel(interaction.channel)) return interaction.reply({ content: 'This only works inside tickets.', ephemeral: true });
            const meta = getTicketMetaFromTopic(interaction.channel.topic);
            const openerId = meta?.openerId;
            const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
            const canClose = isOwner(interaction.user.id) || interaction.user.id === openerId || isStaff(member);
            if (!canClose) return interaction.reply({ content: 'Only the opener or staff can close this ticket.', ephemeral: true });
            const reason = (interaction.fields.getTextInputValue('reason') || '').trim() || 'No reason provided';
            await interaction.reply({ content: '✅ Closing ticket...', ephemeral: true });
            await closeTicketFlow({ channel: interaction.channel, guild: interaction.guild, closerUser: interaction.user, reason });
            return;
        }

        /* ── Ticket panel buttons -> modal ────────────────────────────────── */
        if (interaction.isButton() && interaction.customId.startsWith('ticket:')) {
            const typeId = interaction.customId.split('ticket:')[1];
            const config = getPanelConfig(interaction.guild.id);
            const ticketType = resolveTicketType(config, typeId);
            if (!ticketType) return interaction.reply({ content: 'This ticket type no longer exists.', ephemeral: true });
            if (isRewardsTicket(ticketType)) {
                const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
                if (!member) return interaction.reply({ content: 'Couldn\'t verify your server join/invites.', ephemeral: true });
                const gate = canOpenRewardsTicket(member);
                if (!gate.ok) return interaction.reply({ content: `You can only open a Rewards ticket if you have **5+ invites** OR you joined **within the last 2 hours**.\nYou currently have **${gate.invites}** invites.`, ephemeral: true });
            }
            const existing = findOpenTicketChannel(interaction.guild, interaction.user.id);
            if (existing) return interaction.reply({ content: `You already have an open ticket: ${existing}`, ephemeral: true });
            const modal = new ModalBuilder().setCustomId(`ticket_modal:${ticketType.id}`).setTitle(String(config.modal?.title || 'Ticket Info').slice(0, 45));
            modal.addComponents(
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('mc').setLabel(String(config.modal?.mcLabel || 'What is your Minecraft username?').slice(0, 45)).setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(32)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('need').setLabel(String(config.modal?.needLabel || 'What do you need?').slice(0, 45)).setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1000))
            );
            return interaction.showModal(modal);
        }

        /* ── Rewards panel configure modal submit ─────────────────────────── */
        if (interaction.isModalSubmit() && interaction.customId === 'rewards_panel_modal') {
            const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
            if (!member || !isAdminOrOwner(member)) return interaction.reply({ content: 'Admins only.', ephemeral: true });
            const text = (interaction.fields.getTextInputValue('text') || '').trim();
            if (!text) return interaction.reply({ content: 'Panel text cannot be empty.', ephemeral: true });
            const cfg = getPanelConfig(interaction.guild.id);
            cfg.rewardsPanel = cfg.rewardsPanel ?? { text: null };
            cfg.rewardsPanel.text = text.slice(0, 4000);
            panelStore.byGuild[interaction.guild.id] = cfg;
            savePanelStore();
            const targetChannel = interaction.channel;
            if (!targetChannel || targetChannel.type !== ChannelType.GuildText) return interaction.reply({ content: 'Invalid channel to post in.', ephemeral: true });
            await targetChannel.send(buildRewardsPanelMessage(interaction.guild.id, cfg.rewardsPanel.text));
            return interaction.reply({ content: '✅ Posted Claim Rewards panel.', ephemeral: true });
        }

        /* ── Ticket modal submit ──────────────────────────────────────────── */
        if (interaction.isModalSubmit() && interaction.customId.startsWith('ticket_modal:')) {
            await interaction.deferReply({ ephemeral: true });
            const existing = findOpenTicketChannel(interaction.guild, interaction.user.id);
            if (existing) return interaction.editReply(`You already have an open ticket: ${existing}`);
            const typeId = interaction.customId.split('ticket_modal:')[1];
            const config = getPanelConfig(interaction.guild.id);
            const type = resolveTicketType(config, typeId);
            if (!type) return interaction.editReply('Invalid ticket type.');
            const mc = (interaction.fields.getTextInputValue('mc') || '').trim();
            const need = (interaction.fields.getTextInputValue('need') || '').trim();
            const category = await getOrCreateCategory(interaction.guild, type.category);
            const channelName = `${type.key}-${cleanName(interaction.user.username)}`.slice(0, 90);
            const s = getGuildSettings(interaction.guild.id);
            const overrideRoles = s.ticketRoleOverrides?.[typeId]?.length > 0 ? s.ticketRoleOverrides[typeId] : s.staffRoleIds || [];
            const overwrites = [
                { id: interaction.guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
                ...overrideRoles.map(rid => ({ id: rid, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] })),
            ];
            const createdAt = Date.now();
            const channel = await interaction.guild.channels.create({ name: channelName, type: ChannelType.GuildText, parent: category.id, topic: `opener:${interaction.user.id};created:${createdAt};type:${type.id}`, permissionOverwrites: overwrites });
            await channel.send({ content: `${interaction.user} — ticket created ✅`, embeds: [buildTicketInsideEmbed({ typeLabel: type.label, user: interaction.user, mc, need })], components: [buildTicketControlRow()] });
            return interaction.editReply(`✅ Ticket created: ${channel}`);
        }

        /* ── Settings select menu handlers ───────────────────────────────── */
        if (interaction.isStringSelectMenu() && interaction.customId === 'settings_main_select') {
            const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
            if (!member || !isAdminOrOwner(member)) return interaction.reply({ content: 'Admins only.', ephemeral: true });
            const value = interaction.values[0];
            const s = getGuildSettings(interaction.guild.id);
            if (value === 'set_staff_roles') {
                return interaction.reply({ content: '👥 Select the staff roles:', components: [new ActionRowBuilder().addComponents(new RoleSelectMenuBuilder().setCustomId('settings_staff_role_picker').setPlaceholder('Select staff roles (select none to clear)').setMinValues(0).setMaxValues(10))], ephemeral: true });
            }
            if (value === 'set_vouches_channel') {
                return interaction.reply({ content: '📝 Select the vouches channel:', components: [new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId('settings_vouches_ch_picker').setPlaceholder('Select vouches channel').addChannelTypes(ChannelType.GuildText))], ephemeral: true });
            }
            if (value === 'set_joinlog_channel') {
                return interaction.reply({ content: '📋 Select the join log channel:', components: [new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId('settings_joinlog_ch_picker').setPlaceholder('Select join log channel').addChannelTypes(ChannelType.GuildText))], ephemeral: true });
            }
            if (value === 'set_notification_channel') {
                return interaction.reply({ content: '🔔 Select the notification channel:', components: [new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId('settings_notification_ch_picker').setPlaceholder('Select notification channel').addChannelTypes(ChannelType.GuildText))], ephemeral: true });
            }
            if (value === 'set_customer_role') {
                return interaction.reply({ content: '🎫 Select the customer role:', components: [new ActionRowBuilder().addComponents(new RoleSelectMenuBuilder().setCustomId('settings_customer_role_picker').setPlaceholder('Select customer role').setMinValues(0).setMaxValues(1))], ephemeral: true });
            }
            if (value === 'set_rewards_webhook') {
                await interaction.reply({ content: '🔗 Please type the Discord webhook URL in this channel. You have 30 seconds.', ephemeral: true });
                const filter = (m) => m.author.id === interaction.user.id;
                const collector = interaction.channel.createMessageCollector({ filter, max: 1, time: 30000 });
                collector.on('collect', async (msg) => {
                    const url = msg.content.trim();
                    msg.delete().catch(() => {});
                    if (!isValidWebhookUrl(url)) return interaction.followUp({ content: 'Invalid webhook URL. Must start with `https://discord.com/api/webhooks/...`', ephemeral: true });
                    s.rewardsWebhookUrl = url;
                    saveSettings();
                    const updatedEmbed = buildSettingsEmbed(interaction.guild, getGuildSettings(interaction.guild.id));
                    const updatedComponents = buildSettingsComponents(interaction.guild.id);
                    await interaction.editReply({ content: null, embeds: [updatedEmbed], components: updatedComponents });
                    await interaction.followUp({ content: '✅ Rewards webhook saved.', ephemeral: true });
                });
                collector.on('end', (collected) => { if (collected.size === 0) interaction.followUp({ content: '⏱️ No URL received — timed out.', ephemeral: true }).catch(() => {}); });
                return;
            }
            if (value === 'toggle_automod') {
                s.automod = s.automod ?? { enabled: true, bypassRoleName: 'automod' };
                s.automod.enabled = !s.automod.enabled;
                saveSettings();
                const updatedEmbed = buildSettingsEmbed(interaction.guild, getGuildSettings(interaction.guild.id));
                const updatedComponents = buildSettingsComponents(interaction.guild.id);
                return interaction.update({ embeds: [updatedEmbed], components: updatedComponents });
            }
            if (value === 'reset_settings') {
                settingsStore.byGuild[interaction.guild.id] = defaultGuildSettings();
                saveSettings();
                const updatedEmbed = buildSettingsEmbed(interaction.guild, getGuildSettings(interaction.guild.id));
                const updatedComponents = buildSettingsComponents(interaction.guild.id);
                return interaction.update({ embeds: [updatedEmbed], components: updatedComponents });
            }
            return interaction.reply({ content: 'Unknown option.', ephemeral: true });
        }

        if (interaction.isRoleSelectMenu() && interaction.customId === 'settings_staff_role_picker') {
            const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
            if (!member || !isAdminOrOwner(member)) return interaction.reply({ content: 'Admins only.', ephemeral: true });
            const s = getGuildSettings(interaction.guild.id);
            s.staffRoleIds = interaction.values;
            saveSettings();
            return interaction.reply({ content: `✅ Staff roles updated: ${s.staffRoleIds.length > 0 ? s.staffRoleIds.map(id => `<@&${id}>`).join(', ') : 'none'}`, ephemeral: true });
        }

        if (interaction.isRoleSelectMenu() && interaction.customId === 'settings_customer_role_picker') {
            const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
            if (!member || !isAdminOrOwner(member)) return interaction.reply({ content: 'Admins only.', ephemeral: true });
            const s = getGuildSettings(interaction.guild.id);
            s.customerRoleId = interaction.values[0] || null;
            saveSettings();
            return interaction.reply({ content: `✅ Customer role set to ${s.customerRoleId ? `<@&${s.customerRoleId}>` : 'none'}.`, ephemeral: true });
        }

        if (interaction.isChannelSelectMenu() && interaction.customId === 'settings_vouches_ch_picker') {
            const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
            if (!member || !isAdminOrOwner(member)) return interaction.reply({ content: 'Admins only.', ephemeral: true });
            const s = getGuildSettings(interaction.guild.id);
            s.vouchesChannelId = interaction.values[0] || null;
            saveSettings();
            return interaction.reply({ content: `✅ Vouches channel set to <#${s.vouchesChannelId}>.`, ephemeral: true });
        }

        if (interaction.isChannelSelectMenu() && interaction.customId === 'settings_joinlog_ch_picker') {
            const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
            if (!member || !isAdminOrOwner(member)) return interaction.reply({ content: 'Admins only.', ephemeral: true });
            const s = getGuildSettings(interaction.guild.id);
            s.joinLogChannelId = interaction.values[0] || null;
            saveSettings();
            return interaction.reply({ content: `✅ Join log channel set to <#${s.joinLogChannelId}>.`, ephemeral: true });
        }

        if (interaction.isChannelSelectMenu() && interaction.customId === 'settings_notification_ch_picker') {
            const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
            if (!member || !isAdminOrOwner(member)) return interaction.reply({ content: 'Admins only.', ephemeral: true });
            const s = getGuildSettings(interaction.guild.id);
            s.notificationChannelId = interaction.values[0] || null;
            saveSettings();
            return interaction.reply({ content: `✅ Notification channel set to <#${s.notificationChannelId}>.`, ephemeral: true });
        }

        if (interaction.isStringSelectMenu() && interaction.customId === 'settings_ticket_type_select') {
            const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
            if (!member || !isAdminOrOwner(member)) return interaction.reply({ content: 'Admins only.', ephemeral: true });
            const typeId = interaction.values[0];
            const config = getPanelConfig(interaction.guild.id);
            const ticketType = (config.tickets || []).find(t => t.id === typeId);
            const typeName = ticketType ? ticketType.label : typeId;
            const picker = new RoleSelectMenuBuilder().setCustomId(`settings_ticket_roles_picker:${typeId}`).setPlaceholder(`Select roles that can view ${typeName} tickets (none = use staff roles)`).setMinValues(0).setMaxValues(10);
            return interaction.reply({ content: `🎫 Select which roles can view **${typeName}** tickets. Leave empty to fall back to staff roles.`, components: [new ActionRowBuilder().addComponents(picker)], ephemeral: true });
        }

        if (interaction.isRoleSelectMenu() && interaction.customId.startsWith('settings_ticket_roles_picker:')) {
            const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
            if (!member || !isAdminOrOwner(member)) return interaction.reply({ content: 'Admins only.', ephemeral: true });
            const typeId = interaction.customId.split('settings_ticket_roles_picker:')[1];
            const s = getGuildSettings(interaction.guild.id);
            s.ticketRoleOverrides = s.ticketRoleOverrides ?? {};
            if (interaction.values.length > 0) s.ticketRoleOverrides[typeId] = interaction.values;
            else delete s.ticketRoleOverrides[typeId];
            saveSettings();
            const config = getPanelConfig(interaction.guild.id);
            const ticketType = (config.tickets || []).find(t => t.id === typeId);
            const typeName = ticketType ? ticketType.label : typeId;
            const roleList = interaction.values.length > 0 ? interaction.values.map(id => `<@&${id}>`).join(', ') : 'none (falls back to staff roles)';
            return interaction.reply({ content: `✅ **${typeName}** ticket visibility roles set to: ${roleList}`, ephemeral: true });
        }

        if (!interaction.isChatInputCommand()) return;
        const name = interaction.commandName;

        /* ── /help ───────────────────────────────────────────────────────── */
        if (name === 'help') {
            const helpEmbed = new EmbedBuilder()
                .setColor(0x5865F2)
                .setTitle('📋 Bot Commands')
                .setDescription('Here is a list of all available commands.\nAll commands also work with the `!` prefix (e.g. `!help`, `!stats @user`).')
                .addFields(
                    { name: '`/settings channel|role|leader-channel|dashboard`', value: 'Configure restock notifications and bot settings.\n🔒 Requires **Manage Server** permission.', inline: false },
                    { name: '`/restock product:<name> quantity:<n>`', value: 'Send a restock notification.\n🔒 Requires **Manage Server** permission.', inline: false },
                    { name: '`/announce message:<text> [role:<@role>]`', value: 'Send an announcement DM to all members.\n🔒 Requires **Administrator** permission.', inline: false },
                    { name: '`/claim minecraft_username:<name> amount:<$>`', value: 'Link your Discord account to your purchase history.', inline: false },
                    { name: '`/stats view|private|public`', value: 'View loyalty stats or set your profile visibility.', inline: false },
                    { name: '`/leader`', value: 'Display the top 10 spenders leaderboard.', inline: false },
                    { name: '`/leaderboard`', value: 'Display the top 10 inviters leaderboard.', inline: false },
                    { name: '`/sync [mode]`', value: 'Sync bot slash commands.\n🔒 Owner only.', inline: false },
                    { name: '`/panel set|post|show|reset|rewards`', value: 'Configure and post ticket panels.\n🔒 Requires **Administrator** permission.', inline: false },
                    { name: '`/giveaway /end /reroll`', value: 'Start and manage giveaways.\n🔒 Staff only.', inline: false },
                    { name: '`/sos`', value: 'Start a Split or Steal game.\n🔒 Staff only.', inline: false },
                    { name: '`/bid`', value: 'Start an auction.\n🔒 Staff only.', inline: false },
                    { name: '`/calc expression`', value: 'Calculate a math expression.', inline: false },
                    { name: '`/invites /generate /linkinvite`', value: 'View and manage invite links.', inline: false },
                    { name: '`/addinvites /resetinvites /resetall`', value: 'Admin invite management.\n🔒 Admin only.', inline: false },
                    { name: '`/close /add /operation`', value: 'Ticket management commands.', inline: false },
                    { name: '`/order /paid /review`', value: 'Order channel configuration.\n🔒 Requires **Administrator** permission.', inline: false },
                    { name: '`/updatestock /addproduct /editproduct`', value: 'Product inventory management.\n🔒 Requires **Administrator** permission.', inline: false },
                    { name: '`?auth`', value: 'Show authorized/migratable user count.\n🔒 Owner only.', inline: false },
                    { name: '`?pull <server_id>`', value: 'Pull all authorized users to a server.\n🔒 Owner only.', inline: false }
                )
                .setFooter({ text: 'Use /settings channel first before running /restock.' })
                .setTimestamp();
            await interaction.reply({ embeds: [helpEmbed], ephemeral: true });
            return;
        }

        /* ── /settings channel ───────────────────────────────────────────── */
        if (name === 'settings' && interaction.options.getSubcommand() === 'channel') {
            const channel = interaction.options.getChannel('channel');
            const config = loadConfig();
            config.notificationChannelId = channel.id;
            saveConfig(config);
            await interaction.reply({ embeds: [new EmbedBuilder().setColor(0x57F287).setTitle('✅ Settings Updated').setDescription(`Restock notifications will now be sent to <#${channel.id}>.`)], ephemeral: true });
            return;
        }

        /* ── /settings role ──────────────────────────────────────────────── */
        if (name === 'settings' && interaction.options.getSubcommand() === 'role') {
            const role = interaction.options.getRole('role');
            const config = loadConfig();
            config.notificationRoleId = role.id;
            saveConfig(config);
            await interaction.reply({ embeds: [new EmbedBuilder().setColor(0x57F287).setTitle('✅ Settings Updated').setDescription(`<@&${role.id}> will now be pinged on restock notifications.`)], ephemeral: true });
            return;
        }

        /* ── /settings leader-channel ────────────────────────────────────── */
        if (name === 'settings' && interaction.options.getSubcommand() === 'leader-channel') {
            const channel = interaction.options.getChannel('channel');
            const config = loadConfig();
            config.leaderboardChannelId = channel.id;
            config.leaderboardMessageId = null;
            saveConfig(config);
            startLeaderboardInterval();
            await interaction.reply({ embeds: [new EmbedBuilder().setColor(0x57F287).setTitle('✅ Leaderboard Channel Set').setDescription(`The auto-updating leaderboard will be posted in <#${channel.id}> and refreshed every 10 minutes.`)], ephemeral: true });
            return;
        }

        /* ── /settings dashboard ─────────────────────────────────────────── */
        if (name === 'settings' && interaction.options.getSubcommand() === 'dashboard') {
            const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
            if (!member || !isAdminOrOwner(member)) return interaction.reply({ content: 'Admins only.', ephemeral: true });
            const s = getGuildSettings(interaction.guild.id);
            const embed = buildSettingsEmbed(interaction.guild, s);
            const components = buildSettingsComponents(interaction.guild.id);
            return interaction.reply({ embeds: [embed], components, ephemeral: true });
        }

        /* ── /restock ────────────────────────────────────────────────────── */
        if (name === 'restock') {
            const config = loadConfig();
            const channelId = config.notificationChannelId;
            if (!channelId) { await interaction.reply({ embeds: [new EmbedBuilder().setColor(0xED4245).setTitle('❌ No Notification Channel Set').setDescription('Please run `/settings channel` first.')], ephemeral: true }); return; }
            const product = interaction.options.getString('product');
            const quantity = interaction.options.getInteger('quantity');
            const notifChannel = await interaction.client.channels.fetch(channelId).catch(() => null);
            if (!notifChannel) { await interaction.reply({ embeds: [new EmbedBuilder().setColor(0xED4245).setTitle('❌ Channel Not Found')], ephemeral: true }); return; }
            const embed = buildRestockEmbed(product, quantity);
            const row = buildActionButtons();
            const roleId = config.notificationRoleId;
            const content = roleId ? `<@&${roleId}>` : undefined;
            await notifChannel.send({ content, embeds: [embed], components: [row] });
            await interaction.reply({ embeds: [new EmbedBuilder().setColor(0x57F287).setTitle('✅ Restock Notification Sent').setDescription(`Notification sent to <#${channelId}>.`)], ephemeral: true });
        }

        /* ── /announce ───────────────────────────────────────────────────── */
        if (name === 'announce') {
            const message = interaction.options.getString('message');
            const targetRole = interaction.options.getRole('role');
            await interaction.deferReply({ ephemeral: true });
            let members;
            try { members = await interaction.guild.members.fetch(); } catch (err) {
                await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0xED4245).setTitle('❌ Failed to Fetch Members')] });
                return;
            }
            let targets = [...members.values()].filter(m => !m.user.bot);
            if (targetRole) targets = targets.filter(m => m.roles.cache.has(targetRole.id));
            const total = targets.length;
            const scopeLabel = targetRole ? `members with role <@&${targetRole.id}>` : 'all members';
            const statusMessage = await interaction.channel.send(`📢 Announcement in progress... Sent to 0/${total} ${scopeLabel}`);
            const announceEmbed = new EmbedBuilder().setColor(0x5865F2).setTitle('📢 Server Announcement').setDescription(message).setFooter({ text: `From ${interaction.guild.name}` }).setTimestamp();
            let sent = 0, failed = 0;
            for (let i = 0; i < targets.length; i++) {
                const member = targets[i];
                let retries = 0, success = false;
                while (retries < 3 && !success) {
                    try { await member.user.send({ embeds: [announceEmbed] }); success = true; sent++; } catch (err) {
                        const retryAfter = err?.rawError?.retry_after ?? err?.retry_after;
                        if (retryAfter) { await new Promise(r => setTimeout(r, Math.ceil(retryAfter * 1000) + 500)); retries++; } else { failed++; break; }
                    }
                }
                if (!success && retries >= 3) failed++;
                await statusMessage.edit(`📢 Announcement in progress... Sent to ${sent}/${total} ${scopeLabel}`);
                if (i < targets.length - 1) await new Promise(r => setTimeout(r, 1000));
            }
            await statusMessage.edit(`✅ Announcement sent to ${sent}/${total} ${scopeLabel}${failed > 0 ? ` (${failed} could not be reached)` : ''}`);
            await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0x57F287).setTitle('✅ Announcement Sent').setDescription(`Announcement delivered to **${sent}** member${sent !== 1 ? 's' : ''}${failed > 0 ? ` (${failed} could not be reached)` : ''}.`)] });
        }

        /* ── /updatestock ────────────────────────────────────────────────── */
        if (name === 'updatestock') {
            const quantity = interaction.options.getInteger('quantity');
            await interaction.deferReply({ ephemeral: true });
            let products;
            try { products = await fetchCurrentStock(); } catch (err) {
                await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0xED4245).setTitle('❌ API Unreachable').setDescription('Could not fetch products from the inventory.')] });
                return;
            }
            if (!Array.isArray(products) || products.length === 0) {
                await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0xFEE75C).setTitle('📦 No Products Found').setDescription('No products were found in the inventory.')] });
                return;
            }
            const productSlice = products.slice(0, 25);
            const options = productSlice.map(p => {
                const name = p.name || p.title || p.product_name || 'Unknown Product';
                const id = String(p._id || p.id || name);
                const label = name.length > 100 ? name.slice(0, 100) : name;
                const maxNameLen = 100 - id.length - VALUE_SEPARATOR.length;
                const value = maxNameLen > 0 ? `${id}${VALUE_SEPARATOR}${name.slice(0, maxNameLen)}` : id.slice(0, 100);
                return new StringSelectMenuOptionBuilder().setLabel(label).setValue(value);
            });
            const selectMenu = new StringSelectMenuBuilder().setCustomId(`${UPDATESTOCK_SELECT_PREFIX}${quantity}`).setPlaceholder('Select a product to update…').addOptions(options);
            await interaction.editReply({
                embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('📦 Update Stock').setDescription(`Select a product below to set its stock to **${quantity}** unit${quantity !== 1 ? 's' : ''}.` + (products.length > 25 ? `\n\n⚠️ Only the first 25 of ${products.length} products are shown.` : ''))],
                components: [new ActionRowBuilder().addComponents(selectMenu)],
            });
        }

        /* ── /addproduct ─────────────────────────────────────────────────── */
        if (name === 'addproduct') {
            await interaction.deferReply({ ephemeral: true });
            const prodName = interaction.options.getString('name');
            const price = interaction.options.getNumber('price');
            const quantity = interaction.options.getInteger('quantity');
            const category = interaction.options.getString('category') || '';
            const description = interaction.options.getString('description') || '';
            const image_url = interaction.options.getString('image_url') || '';
            const productData = { name: prodName, price, quantity };
            if (category) productData.category = category;
            if (description) productData.description = description;
            if (image_url) productData.image_url = image_url;
            try {
                const created = await createProduct(productData);
                const productId = created._id || created.id || 'N/A';
                const embed = new EmbedBuilder().setColor(0x57F287).setTitle('✅ Product Created').setDescription(`**${prodName}** has been added to the store.`).addFields({ name: 'Price', value: `$${price.toFixed(2)}`, inline: true }, { name: 'Quantity', value: `${quantity}`, inline: true });
                if (category) embed.addFields({ name: 'Category', value: category, inline: true });
                if (description) embed.addFields({ name: 'Description', value: description, inline: false });
                if (image_url) embed.setThumbnail(image_url);
                embed.setFooter({ text: `Product ID: ${productId}` });
                await interaction.editReply({ embeds: [embed] });
            } catch (err) {
                await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0xED4245).setTitle('❌ Product Creation Failed').setDescription('Could not create the product.')] });
            }
        }

        /* ── /editproduct ────────────────────────────────────────────────── */
        if (name === 'editproduct') {
            const field = interaction.options.getString('field');
            const rawValue = interaction.options.getString('value');
            await interaction.deferReply({ ephemeral: true });
            let products;
            try { products = await fetchCurrentStock(); } catch (err) {
                await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0xED4245).setTitle('❌ API Unreachable').setDescription('Could not fetch products from the inventory.')] });
                return;
            }
            if (!Array.isArray(products) || products.length === 0) {
                await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0xFEE75C).setTitle('📦 No Products Found')] });
                return;
            }
            const productSlice = products.slice(0, 25);
            const options = productSlice.map(p => {
                const prodName = p.name || p.title || p.product_name || 'Unknown Product';
                const id = String(p._id || p.id || prodName);
                const label = prodName.length > 100 ? prodName.slice(0, 100) : prodName;
                const maxNameLen = 100 - id.length - VALUE_SEPARATOR.length;
                const value = maxNameLen > 0 ? `${id}${VALUE_SEPARATOR}${prodName.slice(0, maxNameLen)}` : id.slice(0, 100);
                return new StringSelectMenuOptionBuilder().setLabel(label).setValue(value);
            });
            const editKey = `${interaction.user.id}_${Date.now()}`;
            pendingEdits.set(editKey, { field, value: rawValue });
            setTimeout(() => pendingEdits.delete(editKey), 5 * 60 * 1000);
            const selectMenu = new StringSelectMenuBuilder().setCustomId(`${EDITPRODUCT_SELECT_PREFIX}${editKey}`).setPlaceholder('Select a product to edit…').addOptions(options);
            const fieldLabels = { name: 'Name', price: 'Price', quantity: 'Quantity', category: 'Category', description: 'Description', image_url: 'Image URL' };
            await interaction.editReply({
                embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('✏️ Edit Product').setDescription(`Select a product below to set its **${fieldLabels[field] || field}** to **${rawValue}**.` + (products.length > 25 ? `\n\n⚠️ Only the first 25 of ${products.length} products are shown.` : ''))],
                components: [new ActionRowBuilder().addComponents(selectMenu)],
            });
        }

        /* ── /claim ──────────────────────────────────────────────────────── */
        if (name === 'claim') {
            const mcUsername = interaction.options.getString('minecraft_username');
            const providedAmount = interaction.options.getNumber('amount');
            const discordUsername = interaction.user.username;
            await interaction.deferReply({ ephemeral: true });
            let customer;
            try { customer = await fetchCustomerByMinecraft(mcUsername); } catch (err) {
                await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0xED4245).setTitle('❌ API Unreachable').setDescription('Could not fetch customer data.')] });
                return;
            }
            if (!customer) { await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0xFEE75C).setTitle('❌ No Customer Found').setDescription('No customer found with that Minecraft username.')] }); return; }
            let orders;
            try { orders = await fetchOrdersByMinecraft(mcUsername); } catch (err) {
                await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0xED4245).setTitle('❌ API Unreachable').setDescription('Could not fetch order data.')] });
                return;
            }
            if (!orders || orders.length === 0) { await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0xFEE75C).setTitle('❌ No Orders Found').setDescription('No orders found for that Minecraft username.')] }); return; }
            const sortedOrders = [...orders].sort((a, b) => getOrderDate(b) - getOrderDate(a));
            const actualAmount = getOrderAmount(sortedOrders[0]);
            if (actualAmount === null) { await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0xED4245).setTitle('❌ Verification Failed').setDescription('Could not read the order amount.')] }); return; }
            if (Math.abs(providedAmount - actualAmount) > 0.10) {
                await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0xED4245).setTitle('❌ Verification Failed').setDescription('The order amount you provided doesn\'t match the most recent order.')] });
                return;
            }
            const config = loadConfig();
            if (!config.claimedAccounts) config.claimedAccounts = {};
            config.claimedAccounts[discordUsername] = mcUsername;
            saveConfig(config);
            statsCache.delete(discordUsername.toLowerCase());
            const totalSpent = typeof customer.total_spent === 'number' ? customer.total_spent : 0;
            const orderCount = typeof customer.order_count === 'number' ? customer.order_count : 0;
            const tier = getTier(totalSpent);
            const points = calcLoyaltyPoints(totalSpent);
            await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0x57F287).setTitle('✅ Account Linked!').setDescription(`Your Discord account has been linked to the Minecraft username **${mcUsername}**.`).addFields({ name: '🏅 Linked Stats', value: [`**Rank:** ${tier.emoji} ${tier.name}`, `**Total Spent:** $${totalSpent.toFixed(2)}`, `**Orders:** ${orderCount}`, `**Loyalty Points:** ${points % 1 === 0 ? points : points.toFixed(1)}/100`].join('\n'), inline: false }).setFooter({ text: 'DonutDemand Bot' }).setTimestamp()] });
            return;
        }

        /* ── /stats ──────────────────────────────────────────────────────── */
        if (name === 'stats') {
            const sub = interaction.options.getSubcommand();
            if (sub === 'private') {
                const config = loadConfig();
                if (!config.privateStats) config.privateStats = {};
                config.privateStats[interaction.user.id] = true;
                saveConfig(config);
                await interaction.reply({ content: '🔒 Your stats are now **private**. Only you and server admins can view them.', ephemeral: true });
                return;
            }
            if (sub === 'public') {
                const config = loadConfig();
                if (!config.privateStats) config.privateStats = {};
                delete config.privateStats[interaction.user.id];
                saveConfig(config);
                await interaction.reply({ content: '🔓 Your stats are now **public**. Anyone can view them.', ephemeral: true });
                return;
            }
            const mentionedUser = interaction.options.getUser('user');
            const username = mentionedUser.username;
            const config = loadConfig();
            const isPrivate = config.privateStats && config.privateStats[mentionedUser.id] === true;
            const isSelf = interaction.user.id === mentionedUser.id;
            const isAdmin = interaction.memberPermissions && interaction.memberPermissions.has(PermissionFlagsBits.Administrator);
            if (isPrivate && !isSelf && !isAdmin && !isOwner(interaction.user.id)) {
                await interaction.reply({ content: `🔒 **${username}** has set their stats to private.`, ephemeral: true });
                return;
            }
            await interaction.deferReply();
            const cached = statsCache.get(username.toLowerCase());
            if (cached && Date.now() - cached.ts < STATS_CACHE_TTL_MS) { await interaction.editReply({ embeds: [cached.embed] }); return; }
            let customer;
            try {
                const claimedMcUsername = config.claimedAccounts && config.claimedAccounts[username];
                customer = claimedMcUsername ? await fetchCustomerByMinecraft(claimedMcUsername) : await fetchCustomerData(username);
            } catch (err) {
                await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0xED4245).setTitle('❌ API Unreachable').setDescription('Could not fetch customer data.')] });
                return;
            }
            if (!customer) { await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0xFEE75C).setTitle('No Data Found').setDescription(`No customer data found for **${username}**.`)] }); return; }
            let discordMember = null;
            try { discordMember = await interaction.guild.members.fetch(mentionedUser.id); } catch {}
            const embed = buildStatsEmbed(customer, discordMember);
            statsCache.set(username.toLowerCase(), { embed, ts: Date.now() });
            await interaction.editReply({ embeds: [embed] });
            return;
        }

        /* ── /leader (top spenders) ──────────────────────────────────────── */
        if (name === 'leader') {
            await interaction.deferReply();
            const cachedLeaderboard = leaderboardCache.get('leaderboard');
            if (cachedLeaderboard && Date.now() - cachedLeaderboard.ts < LEADERBOARD_CACHE_TTL_MS) { await interaction.editReply({ embeds: [cachedLeaderboard.embed] }); return; }
            let customers;
            try { customers = await fetchAllCustomers(); } catch (err) {
                await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0xED4245).setTitle('❌ API Unreachable').setDescription('Could not fetch customer data.')] });
                return;
            }
            const embed = buildLeaderboardEmbed(customers);
            if (!embed) { await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0xFEE75C).setTitle('🏆 Top 10 Spenders').setDescription('No leaderboard data available yet.')] }); return; }
            leaderboardCache.set('leaderboard', { embed, ts: Date.now() });
            await interaction.editReply({ embeds: [embed] });
            return;
        }

        /* ── /timezone ───────────────────────────────────────────────────── */
        if (name === 'timezone' && interaction.options.getSubcommand() === 'set') {
            const timeInput = interaction.options.getString('current_time');
            const timezone = interaction.options.getString('timezone');
            const parsed = parseTimeInput(timeInput);
            if (!parsed) { await interaction.reply({ embeds: [new EmbedBuilder().setColor(0xED4245).setTitle('❌ Invalid Time Format').setDescription('Please use a format like `10:32am`, `2:15pm`, or `14:30`.')], ephemeral: true }); return; }
            const now = new Date();
            const currentUTCMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
            const providedMinutes = parsed.hours * 60 + parsed.minutes;
            let offsetMinutes = providedMinutes - currentUTCMinutes;
            if (offsetMinutes > 840) offsetMinutes -= 1440;
            if (offsetMinutes < -720) offsetMinutes += 1440;
            offsetMinutes = Math.round(offsetMinutes / 15) * 15;
            const config = loadConfig();
            if (!config.staffTimezones) config.staffTimezones = {};
            config.staffTimezones[interaction.user.id] = { username: interaction.user.username, timezone: timezone.toUpperCase(), utcOffsetMinutes: offsetMinutes };
            saveConfig(config);
            const displayTime = new Date();
            displayTime.setUTCHours(0, 0, 0, 0);
            displayTime.setUTCMinutes(currentUTCMinutes + offsetMinutes);
            const timeStr = displayTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'UTC' });
            await interaction.reply({ embeds: [new EmbedBuilder().setColor(0x57F287).setTitle('✅ Timezone Set').setDescription(`Your timezone has been set to **${timezone.toUpperCase()}** (current time: **${timeStr}**)`)], ephemeral: true });
            if (config.timezoneChannelId) updateTimezoneDisplay();
            return;
        }

        if (name === 'timezone' && interaction.options.getSubcommand() === 'channel') {
            const channel = interaction.options.getChannel('channel');
            const config = loadConfig();
            config.timezoneChannelId = channel.id;
            delete config.timezoneMessageId;
            saveConfig(config);
            startTimezoneInterval();
            await interaction.reply({ embeds: [new EmbedBuilder().setColor(0x57F287).setTitle('✅ Timezone Channel Set').setDescription(`Staff times will now be displayed in <#${channel.id}> and update every 10 seconds.`)], ephemeral: true });
            return;
        }

        /* ── /order /paid /review channel ───────────────────────────────── */
        if (name === 'order' && interaction.options.getSubcommand() === 'channel') {
            const channel = interaction.options.getChannel('channel');
            const config = loadConfig();
            config.orderChannelId = channel.id;
            saveConfig(config);
            await startOrderPolling();
            await interaction.reply({ embeds: [new EmbedBuilder().setColor(0x57F287).setTitle('✅ Order Channel Set').setDescription(`New order notifications will be posted in <#${channel.id}>.`)], ephemeral: true });
            return;
        }

        if (name === 'paid' && interaction.options.getSubcommand() === 'channel') {
            const channel = interaction.options.getChannel('channel');
            const config = loadConfig();
            config.paidChannelId = channel.id;
            saveConfig(config);
            await interaction.reply({ embeds: [new EmbedBuilder().setColor(0x57F287).setTitle('✅ Delivered Channel Set').setDescription(`Delivered orders will be sent to <#${channel.id}>.`)], ephemeral: true });
            return;
        }

        if (name === 'review' && interaction.options.getSubcommand() === 'channel') {
            const channel = interaction.options.getChannel('channel');
            const config = loadConfig();
            config.reviewChannelId = channel.id;
            saveConfig(config);
            await interaction.reply({ embeds: [new EmbedBuilder().setColor(0x57F287).setTitle('✅ Review Channel Set').setDescription(`Orders needing review will be sent to <#${channel.id}>.`)], ephemeral: true });
            return;
        }

        /* ── /setup-verify ───────────────────────────────────────────────── */
        if (name === 'setup-verify') {
            if (!isOwner(interaction.user.id)) { await interaction.reply({ content: '❌ Only the bot owner can use this command.', ephemeral: true }); return; }
            const verifyEmbed = new EmbedBuilder().setColor(0x5865F2).setTitle('🔐 Verify Your Account').setDescription('Click the button below to link your account with the bot.\n\nVerified users will be included when the server owner uses `?pull` to invite members to another server.');
            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(VERIFY_AUTH_BUTTON_ID).setLabel('✅ Verify').setStyle(ButtonStyle.Success));
            await interaction.reply({ embeds: [verifyEmbed], components: [row] });
            return;
        }

        /* ── /sync (Owner) ───────────────────────────────────────────────── */
        if (name === 'sync') {
            if (!isOwner(interaction.user.id)) return interaction.reply({ content: 'Only Adam can use this command.', ephemeral: true });
            const mode = interaction.options.getString('mode', false) || 'register_here';
            await interaction.deferReply({ ephemeral: true });
            try {
                if (mode === 'clear_here') { await clearGuild(interaction.guild.id); return interaction.editReply('🧹 Cleared THIS server commands. Now run /sync mode:register_here.'); }
                if (mode === 'register_here') { await registerGuild(interaction.guild.id); return interaction.editReply('✅ Re-registered commands for THIS server.'); }
                if (mode === 'clear_global') { await clearGlobal(); return interaction.editReply('🧹 Cleared GLOBAL commands.'); }
                if (mode === 'register_global') { await registerGlobal(); return interaction.editReply('✅ Re-registered GLOBAL commands. (May take time to update everywhere)'); }
            } catch (e) { return interaction.editReply(`❌ Sync failed: ${e?.message || e}`); }
        }

        /* ── /stop /resume ───────────────────────────────────────────────── */
        if (name === 'stop' || name === 'resume') {
            if (!isOwner(interaction.user.id)) return interaction.reply({ content: 'Only Adam can use this command.', ephemeral: true });
            const guildId = interaction.options.getString('server_id', true).trim();
            if (!/^\d{10,25}$/.test(guildId)) return interaction.reply({ content: 'Invalid server ID.', ephemeral: true });
            if (name === 'stop') { botState.stoppedGuilds[guildId] = true; saveBotState(); return interaction.reply({ content: `✅ Bot commands restricted in server: ${guildId}`, ephemeral: true }); }
            else { delete botState.stoppedGuilds[guildId]; saveBotState(); return interaction.reply({ content: `✅ Bot commands resumed in server: ${guildId}`, ephemeral: true }); }
        }

        /* ── /backup /restore ────────────────────────────────────────────── */
        if (name === 'backup') {
            const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
            if (!member || (!isOwner(interaction.user.id) && !member.permissions.has(PermissionsBitField.Flags.Administrator))) return interaction.reply({ content: 'Admins only.', ephemeral: true });
            doBackupInvites();
            return interaction.reply({ content: '✅ Backed up invites to **invites_backup.json** (saved on your host).' });
        }

        if (name === 'restore') {
            const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
            if (!member || (!isOwner(interaction.user.id) && !member.permissions.has(PermissionsBitField.Flags.Administrator))) return interaction.reply({ content: 'Admins only.', ephemeral: true });
            const res = doRestoreInvites();
            return interaction.reply({ content: res.ok ? `✅ ${res.msg}` : `❌ ${res.msg}` });
        }

        /* ── /calc ───────────────────────────────────────────────────────── */
        if (name === 'calc') {
            const expr = interaction.options.getString('expression', true);
            try {
                const result = calcExpression(expr);
                const out = formatCalcResult(result);
                if (out === null) return interaction.reply('Invalid calculation.');
                return interaction.reply(`🧮 Result: **${out}**`);
            } catch { return interaction.reply('Invalid calculation format.'); }
        }

        /* ── /leaderboard (top inviters) ─────────────────────────────────── */
        if (name === 'leaderboard') {
            await interaction.deferReply({ ephemeral: false });
            const ids = Object.keys(invitesData.inviterStats || {});
            if (!ids.length) return interaction.editReply('No invite data yet.');
            const scored = ids.map(id => ({ id, count: invitesStillInServerForGuild(interaction.guild.id, id) })).filter(x => x.count > 0).sort((a, b) => b.count - a.count).slice(0, 10);
            if (!scored.length) return interaction.editReply('No inviters with invites yet.');
            const lines = [];
            for (let i = 0; i < scored.length; i++) {
                const entry = scored[i];
                const m = await interaction.guild.members.fetch(entry.id).catch(() => null);
                const label = m ? `**${m.user.tag}**` : `<@${entry.id}>`;
                lines.push(`**${i + 1}.** ${label} — **${entry.count}** invite(s)`);
            }
            const embed = new EmbedBuilder().setTitle('🏆 Invite Leaderboard — Top 10').setColor(0xed4245).setDescription(lines.join('\n')).setFooter({ text: 'Invites still in the server' }).setTimestamp();
            return interaction.editReply({ embeds: [embed] });
        }

        /* ── /blacklist ──────────────────────────────────────────────────── */
        if (name === 'blacklist') {
            const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
            if (!member || (!isOwner(interaction.user.id) && !member.permissions.has(PermissionsBitField.Flags.Administrator))) return interaction.reply({ content: 'Admins only.', ephemeral: true });
            const sub = interaction.options.getSubcommand();
            const s = getGuildSettings(interaction.guild.id);
            if (sub === 'list') {
                const list = (s.invitesBlacklist || []).slice(0, 50);
                if (!list.length) return interaction.reply('Blacklist is empty.');
                return interaction.reply(`🚫 Blacklisted:\n${list.map(id => `• <@${id}> (\`${id}\`)`).join('\n')}`);
            }
            const user = interaction.options.getUser('user', true);
            if (sub === 'add') {
                if (!s.invitesBlacklist.includes(String(user.id))) s.invitesBlacklist.push(String(user.id));
                saveSettings();
                resetInvitesForUser(user.id);
                return interaction.reply(`✅ Blacklisted ${user} — their invites will always stay **0**.`);
            }
            if (sub === 'remove') {
                s.invitesBlacklist = (s.invitesBlacklist || []).filter(x => String(x) !== String(user.id));
                saveSettings();
                return interaction.reply(`✅ Removed ${user} from blacklist.`);
            }
        }

        /* ── /panel ──────────────────────────────────────────────────────── */
        if (name === 'panel') {
            const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
            if (!member || !isAdminOrOwner(member)) return interaction.reply({ content: 'Admins only.', ephemeral: true });
            const sub = interaction.options.getSubcommand();
            const cfg = getPanelConfig(interaction.guild.id);
            if (sub === 'show') {
                const showCfg = { embed: cfg.embed, modal: cfg.modal, tickets: cfg.tickets, rewardsPanel: cfg.rewardsPanel };
                const json = JSON.stringify(showCfg, null, 2);
                if (json.length > 1800) return interaction.reply({ content: 'Config too large to show here.', ephemeral: true });
                return interaction.reply({ content: '```json\n' + json + '\n```', ephemeral: true });
            }
            if (sub === 'reset') { delete panelStore.byGuild[interaction.guild.id]; savePanelStore(); return interaction.reply({ content: '✅ Panel config reset to default.', ephemeral: true }); }
            if (sub === 'set') {
                const raw = interaction.options.getString('json', true);
                if (raw.length > 6000) return interaction.reply({ content: '❌ JSON too long. Keep it under ~6000 chars.', ephemeral: true });
                let newCfg;
                try { newCfg = JSON.parse(raw); } catch { return interaction.reply({ content: '❌ Invalid JSON.', ephemeral: true }); }
                const v = validatePanelConfig(newCfg);
                if (!v.ok) return interaction.reply({ content: `❌ ${v.msg}`, ephemeral: true });
                newCfg.rewardsPanel = newCfg.rewardsPanel ?? cfg.rewardsPanel ?? { text: null };
                panelStore.byGuild[interaction.guild.id] = newCfg;
                savePanelStore();
                return interaction.reply({ content: '✅ Saved ticket panel config for this server.', ephemeral: true });
            }
            if (sub === 'post') {
                const targetChannel = interaction.options.getChannel('channel', false) || interaction.channel;
                if (!targetChannel || targetChannel.type !== ChannelType.GuildText) return interaction.reply({ content: 'Invalid channel.', ephemeral: true });
                const v = validatePanelConfig(cfg);
                if (!v.ok) return interaction.reply({ content: `❌ Saved config invalid: ${v.msg}`, ephemeral: true });
                await targetChannel.send(buildTicketPanelMessage(cfg));
                return interaction.reply({ content: '✅ Posted ticket panel.', ephemeral: true });
            }
            if (sub === 'rewards') {
                const modal = new ModalBuilder().setCustomId('rewards_panel_modal').setTitle('Rewards Panel');
                modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('text').setLabel('What should the rewards panel say?').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(4000)));
                return interaction.showModal(modal);
            }
        }

        /* ── /embed ──────────────────────────────────────────────────────── */
        if (name === 'embed') {
            const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
            if (!member || (!isOwner(interaction.user.id) && !member.permissions.has(PermissionsBitField.Flags.Administrator))) return interaction.reply({ content: 'Admins only.', ephemeral: true });
            const targetChannel = interaction.options.getChannel('channel', false) || interaction.channel;
            if (!targetChannel || targetChannel.type !== ChannelType.GuildText) return interaction.reply({ content: 'Invalid channel.', ephemeral: true });
            const title = interaction.options.getString('title', false);
            const description = interaction.options.getString('description', false);
            const colorInput = interaction.options.getString('color', false);
            const url = interaction.options.getString('url', false);
            const thumbnail = interaction.options.getString('thumbnail', false);
            const image = interaction.options.getString('image', false);
            if (!title && !description && !thumbnail && !image) return interaction.reply({ content: 'Provide at least title/description/image/thumbnail.', ephemeral: true });
            const e = new EmbedBuilder();
            if (title) e.setTitle(String(title).slice(0, 256));
            if (description) e.setDescription(String(description).slice(0, 4096));
            if (url) e.setURL(url);
            const c = parseHexColor(colorInput);
            e.setColor(c !== null ? c : 0x2b2d31);
            if (thumbnail) e.setThumbnail(thumbnail);
            if (image) e.setImage(image);
            await targetChannel.send({ embeds: [e] });
            return interaction.reply({ content: '✅ Sent embed.', ephemeral: true });
        }

        /* ── /vouches ────────────────────────────────────────────────────── */
        if (name === 'vouches') {
            const s = getGuildSettings(interaction.guild.id);
            if (!s.vouchesChannelId) return interaction.reply({ content: 'Set vouches channel first via /settings → Set Vouches Channel.', ephemeral: true });
            await interaction.deferReply({ ephemeral: false });
            const channel = await interaction.guild.channels.fetch(s.vouchesChannelId).catch(() => null);
            if (!channel || channel.type !== ChannelType.GuildText) return interaction.editReply('Couldn\'t find the vouches channel.');
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

        /* ── /invites ────────────────────────────────────────────────────── */
        if (name === 'invites') {
            const user = interaction.options.getUser('user', true);
            const blacklisted = isBlacklistedInviter(interaction.guild.id, user.id);
            const count = invitesStillInServerForGuild(interaction.guild.id, user.id);
            return interaction.reply({ content: blacklisted ? `📨 **${user.tag}** is **blacklisted** — invites will always stay **0**.` : `📨 **${user.tag}** has **${count}** invites still in the server.` });
        }

        /* ── /generate ───────────────────────────────────────────────────── */
        if (name === 'generate') {
            const me = await interaction.guild.members.fetchMe();
            const canCreate = interaction.channel.permissionsFor(me)?.has(PermissionsBitField.Flags.CreateInstantInvite);
            if (!canCreate) return interaction.reply({ content: '❌ I need **Create Invite** permission in this channel.', ephemeral: true });
            const invite = await interaction.channel.createInvite({ maxAge: 0, maxUses: 0, unique: true, reason: `Invite generated for ${interaction.user.tag}` });
            invitesData.inviteOwners[invite.code] = interaction.user.id;
            saveInvites();
            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Open Invite').setURL(invite.url));
            return interaction.reply({ content: `✅ Your personal invite link:\n${invite.url}`, components: [row], ephemeral: true });
        }

        /* ── /linkinvite ─────────────────────────────────────────────────── */
        if (name === 'linkinvite') {
            const input = interaction.options.getString('code', true);
            const code = extractInviteCode(input);
            if (!code) return interaction.reply({ content: '❌ Invalid invite code.', ephemeral: true });
            const invites = await interaction.guild.invites.fetch().catch(() => null);
            if (!invites) return interaction.reply({ content: '❌ I need invite permissions to verify invite codes.', ephemeral: true });
            const found = invites.find(inv => inv.code === code);
            if (!found) return interaction.reply({ content: '❌ That invite code wasn\'t found in this server.', ephemeral: true });
            invitesData.inviteOwners[code] = interaction.user.id;
            saveInvites();
            return interaction.reply({ content: `✅ Linked invite **${code}** to you.`, ephemeral: true });
        }

        /* ── /addinvites ─────────────────────────────────────────────────── */
        if (name === 'addinvites') {
            const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
            if (!member || (!isOwner(interaction.user.id) && !member.permissions.has(PermissionsBitField.Flags.Administrator))) return interaction.reply({ content: 'Admins only.', ephemeral: true });
            const user = interaction.options.getUser('user', true);
            const amount = interaction.options.getInteger('amount', true);
            if (isBlacklistedInviter(interaction.guild.id, user.id)) return interaction.reply(`❌ ${user} is blacklisted — their invites must stay at **0**.`);
            const st = ensureInviterStats(user.id);
            st.manual += amount;
            saveInvites();
            syncInvitesToBase44().catch(() => {});
            return interaction.reply({ content: `✅ Added **${amount}** invites to **${user.tag}**.` });
        }

        /* ── /resetinvites ───────────────────────────────────────────────── */
        if (name === 'resetinvites') {
            const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
            if (!member || (!isOwner(interaction.user.id) && !isStaff(member))) return interaction.reply({ content: 'Staff only (configure staff roles in /settings).', ephemeral: true });
            const user = interaction.options.getUser('user', true);
            resetInvitesForUser(user.id);
            syncInvitesToBase44().catch(() => {});
            return interaction.reply({ content: `✅ Reset invite stats for **${user.tag}**.` });
        }

        /* ── /resetall ───────────────────────────────────────────────────── */
        if (name === 'resetall') {
            const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
            if (!member || (!isOwner(interaction.user.id) && !member.permissions.has(PermissionsBitField.Flags.Administrator))) return interaction.reply({ content: 'Admins only.', ephemeral: true });
            invitesData.inviterStats = {};
            invitesData.memberInviter = {};
            invitesData.inviteOwners = {};
            invitesData.invitedMembers = {};
            saveInvites();
            syncInvitesToBase44().catch(() => {});
            return interaction.reply({ content: '✅ Reset invite stats for **everyone** in this server.', ephemeral: true });
        }

        /* ── /syncinvites ────────────────────────────────────────────────── */
        if (name === 'syncinvites') {
            const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
            if (!member || !isAdminOrOwner(member)) return interaction.reply({ content: 'Admins only.', ephemeral: true });
            await interaction.deferReply({ ephemeral: true });
            const base44Url = process.env.BASE44_API_URL;
            if (!base44Url) return interaction.editReply('❌ BASE44_API_URL is not configured in environment variables.');
            try { await syncInvitesToBase44(); return interaction.editReply('✅ Invite data synced to the website API.'); } catch (e) { return interaction.editReply(`❌ Sync failed: ${String(e?.message || e).slice(0, 1000)}`); }
        }

        /* ── /link ───────────────────────────────────────────────────────── */
        if (name === 'link') {
            const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
            if (!member || (!isOwner(interaction.user.id) && !isStaff(member))) return interaction.reply({ content: 'Staff only (configure staff roles in /settings).', ephemeral: true });
            const target = interaction.options.getUser('user', true);
            const invitedMap = invitesData.invitedMembers?.[target.id] || {};
            const invitedIds = Object.keys(invitedMap);
            const activeInvited = [];
            for (const invitedId of invitedIds) {
                const rec = invitedMap[invitedId];
                if (!rec?.active) continue;
                const m = await interaction.guild.members.fetch(invitedId).catch(() => null);
                if (!m) continue;
                activeInvited.push({ tag: m.user.tag, code: rec.inviteCode || 'unknown' });
            }
            const guildInvites = await interaction.guild.invites.fetch().catch(() => null);
            const codes = new Set();
            if (guildInvites) guildInvites.forEach(inv => { if (inv.inviter?.id === target.id) codes.add(inv.code); });
            for (const [code, ownerId] of Object.entries(invitesData.inviteOwners || {})) { if (ownerId === target.id) codes.add(code); }
            const codeList = [...codes].slice(0, 15);
            const inviteLinks = codeList.length ? codeList.map(c => `https://discord.gg/${c}`).join('\n') : 'None found.';
            const listText = activeInvited.length ? activeInvited.slice(0, 30).map((x, i) => `${i + 1}. ${x.tag} (code: ${x.code})`).join('\n') : 'No active invited members found.';
            return interaction.reply({ ephemeral: true, content: `**Invites for:** ${target.tag}\n\n• **Active invited members (still credited):**\n${listText}\n\n• **Invite link(s) they use:**\n${inviteLinks}` });
        }

        /* ── /close ──────────────────────────────────────────────────────── */
        if (name === 'close') {
            const channel = interaction.channel;
            if (!isTicketChannel(channel)) return interaction.reply({ content: 'Use **/close** inside a ticket channel.', ephemeral: true });
            const meta = getTicketMetaFromTopic(channel.topic);
            const openerId = meta?.openerId;
            const reason = interaction.options.getString('reason', true);
            const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
            const canClose = isOwner(interaction.user.id) || interaction.user.id === openerId || isStaff(member);
            if (!canClose) return interaction.reply({ content: 'Only the opener or staff can close this.', ephemeral: true });
            await interaction.reply({ content: '✅ Closing ticket...', ephemeral: true });
            await closeTicketFlow({ channel, guild: interaction.guild, closerUser: interaction.user, reason });
            return;
        }

        /* ── /operation ──────────────────────────────────────────────────── */
        if (name === 'operation') {
            const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
            if (!member || (!isOwner(interaction.user.id) && !member.permissions.has(PermissionsBitField.Flags.Administrator))) return interaction.reply({ content: 'Admins only.', ephemeral: true });
            if (!isTicketChannel(interaction.channel)) return interaction.reply({ content: 'Use /operation inside a ticket channel.', ephemeral: true });
            const sub = interaction.options.getSubcommand();
            if (sub === 'cancel') {
                if (!activeOperations.has(interaction.channel.id)) return interaction.reply({ content: 'No active operation timer in this ticket.', ephemeral: true });
                clearTimeout(activeOperations.get(interaction.channel.id));
                activeOperations.delete(interaction.channel.id);
                return interaction.reply({ content: '🛑 Operation cancelled.', ephemeral: true });
            }
            const durationStr = interaction.options.getString('duration', true);
            const ms = parseDurationToMs(durationStr);
            if (!ms) return interaction.reply({ content: 'Invalid duration. Use 10m, 1h, 2d.', ephemeral: true });
            const meta = getTicketMetaFromTopic(interaction.channel.topic);
            const openerId = meta?.openerId;
            if (!openerId) return interaction.reply({ content: 'Couldn\'t find ticket opener.', ephemeral: true });
            const s = getGuildSettings(interaction.guild.id);
            if (!s.customerRoleId) return interaction.reply({ content: 'Set customer role first via /settings → Set Customer Role.', ephemeral: true });
            const openerMember = await interaction.guild.members.fetch(openerId).catch(() => null);
            if (!openerMember) return interaction.reply({ content: 'Couldn\'t fetch ticket opener.', ephemeral: true });
            const botMe = await interaction.guild.members.fetchMe();
            if (!botMe.permissions.has(PermissionsBitField.Flags.ManageRoles)) return interaction.reply({ content: 'I need **Manage Roles** permission.', ephemeral: true });
            const role = await interaction.guild.roles.fetch(s.customerRoleId).catch(() => null);
            if (!role) return interaction.reply({ content: 'Customer role not found (check /settings).', ephemeral: true });
            if (role.position >= botMe.roles.highest.position) return interaction.reply({ content: 'Move the bot role above the customer role in Server Settings → Roles.', ephemeral: true });
            await openerMember.roles.add(role, `Customer role given by /operation from ${interaction.user.tag}`).catch(() => {});
            if (s.vouchesChannelId) await interaction.channel.send(`<@${openerId}> please go to <#${s.vouchesChannelId}> and drop a vouch for us. Thank you!`).catch(() => {});
            if (activeOperations.has(interaction.channel.id)) { clearTimeout(activeOperations.get(interaction.channel.id)); activeOperations.delete(interaction.channel.id); }
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

        /* ── /giveaway /end /reroll ───────────────────────────────────────── */
        if (name === 'giveaway') {
            const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
            if (!member || (!isOwner(interaction.user.id) && !isStaff(member))) return interaction.reply({ content: 'Staff only.', ephemeral: true });
            const durationStr = interaction.options.getString('duration', true);
            const winners = interaction.options.getInteger('winners', true);
            const prize = interaction.options.getString('prize', true).trim();
            const minInvites = interaction.options.getInteger('min_invites', false) ?? 0;
            const requiredRole = interaction.options.getRole('required_role', false);
            const ms = parseDurationToMs(durationStr);
            if (!ms) return interaction.reply({ content: 'Invalid duration. Use 30m, 1h, 2d, etc.', ephemeral: true });
            if (winners < 1) return interaction.reply({ content: 'Winners must be at least 1.', ephemeral: true });
            const gw = { guildId: interaction.guild.id, channelId: interaction.channel.id, messageId: null, prize, winners, hostId: interaction.user.id, endsAt: Date.now() + ms, entries: [], ended: false, minInvites, requiredRoleId: requiredRole?.id || null, lastWinners: [] };
            const sent = await interaction.reply({ embeds: [makeGiveawayEmbed({ ...gw, messageId: 'pending' })], components: [giveawayRow({ ...gw, messageId: 'pending' })], fetchReply: true });
            gw.messageId = sent.id;
            giveawayData.giveaways[gw.messageId] = gw;
            saveGiveaways();
            await sent.edit({ embeds: [makeGiveawayEmbed(gw)], components: [giveawayRow(gw)] }).catch(() => {});
            scheduleGiveawayEnd(gw.messageId);
            return;
        }

        if (name === 'end') {
            const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
            if (!member || (!isOwner(interaction.user.id) && !isStaff(member))) return interaction.reply({ content: 'Staff only.', ephemeral: true });
            const raw = interaction.options.getString('message', true);
            const messageId = extractMessageId(raw);
            if (!messageId) return interaction.reply({ content: 'Invalid message ID/link.', ephemeral: true });
            await interaction.deferReply({ ephemeral: true });
            const res = await endGiveaway(messageId, interaction.user.id);
            return interaction.editReply(res.ok ? '✅ Giveaway ended.' : `❌ ${res.msg}`);
        }

        if (name === 'reroll') {
            const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
            if (!member || (!isOwner(interaction.user.id) && !isStaff(member))) return interaction.reply({ content: 'Staff only.', ephemeral: true });
            const raw = interaction.options.getString('message', true);
            const messageId = extractMessageId(raw);
            if (!messageId) return interaction.reply({ content: 'Invalid message ID/link.', ephemeral: true });
            await interaction.deferReply({ ephemeral: true });
            const res = await rerollGiveaway(messageId, interaction.user.id);
            return interaction.editReply(res.ok ? '✅ Rerolled winners.' : `❌ ${res.msg}`);
        }

        /* ── /sos ────────────────────────────────────────────────────────── */
        if (name === 'sos') {
            const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
            if (!member || (!isOwner(interaction.user.id) && !isStaff(member))) return interaction.reply({ content: 'Staff only.', ephemeral: true });
            const title = interaction.options.getString('title', true).trim();
            const prize = interaction.options.getString('prize', true).trim();
            const durationStr = interaction.options.getString('duration', true);
            const minInvites = interaction.options.getInteger('min_invites', false) ?? 0;
            const requiredRole = interaction.options.getRole('required_role', false);
            const ms = parseDurationToMs(durationStr);
            if (!ms) return interaction.reply({ content: 'Invalid duration.', ephemeral: true });
            const game = { guildId: interaction.guild.id, channelId: interaction.channel.id, messageId: null, title, prize, hostId: interaction.user.id, endsAt: Date.now() + ms, entries: [], ended: false, minInvites, requiredRoleId: requiredRole?.id || null, players: null, responses: {}, responsesCount: 0, drawn: false, resolved: false, discussionChannelId: null };
            const sent = await interaction.reply({ embeds: [makeSosEmbed({ ...game, messageId: 'pending' })], components: [sosRow({ ...game, messageId: 'pending' })], fetchReply: true });
            game.messageId = sent.id;
            sosData.games[game.messageId] = game;
            saveSOS();
            await sent.edit({ embeds: [makeSosEmbed(game)], components: [sosRow(game)] }).catch(() => {});
            scheduleSOSEnd(game.messageId);
            return;
        }

        /* ── /redeem ─────────────────────────────────────────────────────── */
        if (name === 'redeem') {
            const userId = interaction.user.id;
            const backup = loadJson(INVITES_AUTO_BACKUP_FILE, null);
            if (!backup || !backup.inviterStats?.[userId]) return interaction.reply({ content: '❌ No backup data found for you.', ephemeral: true });
            const currentCount = invitesStillInServer(userId);
            if (currentCount > 0) return interaction.reply({ content: 'You already have invites. No restore needed.', ephemeral: true });
            invitesData.inviterStats[userId] = { ...backup.inviterStats[userId] };
            for (const [memberId, inviterId] of Object.entries(backup.memberInviter || {})) {
                if (String(inviterId) === String(userId)) invitesData.memberInviter[memberId] = inviterId;
            }
            if (backup.invitedMembers?.[userId]) invitesData.invitedMembers[userId] = { ...backup.invitedMembers[userId] };
            saveInvites();
            const newCount = invitesStillInServer(userId);
            return interaction.reply({ content: `✅ Your invites have been restored! You now have **${newCount}** invites.`, ephemeral: true });
        }

        /* ── /bid ────────────────────────────────────────────────────────── */
        if (name === 'bid') {
            const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
            if (!member || (!isOwner(interaction.user.id) && !isStaff(member))) return interaction.reply({ content: 'Staff only.', ephemeral: true });
            const item = interaction.options.getString('item', true).trim();
            const startingPrice = interaction.options.getInteger('starting_price', true);
            const maxBid = interaction.options.getInteger('max_bid', true);
            if (maxBid < startingPrice) return interaction.reply({ content: 'Max bid must be at least the starting price.', ephemeral: true });
            const auction = { guildId: interaction.guild.id, channelId: interaction.channel.id, messageId: null, item, startingPrice, maxBid, hostId: interaction.user.id, currentBid: startingPrice, currentBidderId: null, ended: false };
            const sent = await interaction.reply({ embeds: [makeBidEmbed({ ...auction, messageId: 'pending' })], components: [buildBidRow('pending', false)], fetchReply: true });
            auction.messageId = sent.id;
            bidData.auctions[auction.messageId] = auction;
            saveBids();
            await sent.edit({ embeds: [makeBidEmbed(auction)], components: [buildBidRow(auction.messageId, false)] }).catch(() => {});
            return;
        }

        /* ── /add ────────────────────────────────────────────────────────── */
        if (name === 'add') {
            if (!isTicketChannel(interaction.channel)) return interaction.reply({ content: 'Use **/add** inside a ticket channel.', ephemeral: true });
            const meta = getTicketMetaFromTopic(interaction.channel.topic);
            const openerId = meta?.openerId;
            const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
            const canAdd = isOwner(interaction.user.id) || interaction.user.id === openerId || isStaff(member);
            if (!canAdd) return interaction.reply({ content: 'Only the ticket opener or staff can add users.', ephemeral: true });
            const targetUser = interaction.options.getUser('user', true);
            await interaction.channel.permissionOverwrites.create(targetUser.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true });
            return interaction.reply({ content: `✅ Added ${targetUser} to this ticket.` });
        }

    } catch (e) {
        console.error('interaction error:', e);
        try {
            if (interaction?.isRepliable?.()) {
                const msg = { content: '❌ Something went wrong processing your request.', ephemeral: true };
                if (interaction.deferred || interaction.replied) await interaction.followUp(msg).catch(() => {});
                else await interaction.reply(msg).catch(() => {});
            }
        } catch {}
    }
});

/* ===================== CHANNEL DELETE: TRANSCRIPT ===================== */
client.on('channelDelete', async channel => {
    if (!channel.guild || !channel.isTextBased()) return;
    try {
        let closedBy = 'Unknown';
        try {
            const auditLogs = await channel.guild.fetchAuditLogs({ type: AuditLogEvent.ChannelDelete, limit: 5 });
            const entry = auditLogs.entries.find(e => e.target?.id === channel.id && Date.now() - e.createdTimestamp < AUDIT_LOG_MAX_AGE_MS);
            if (entry && entry.executor) closedBy = `${entry.executor.tag} (${entry.executor.id})`;
        } catch {}
        const messages = [...channel.messages.cache.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);
        let transcript = `Transcript for #${channel.name} (${channel.id})\n`;
        transcript += `Server: ${channel.guild.name}\n`;
        transcript += `Closed by: ${closedBy}\n`;
        transcript += `Deleted at: ${new Date().toUTCString()}\n`;
        transcript += `Messages: ${messages.length}\n`;
        transcript += '-'.repeat(50) + '\n\n';
        if (messages.length === 0) {
            transcript += '(No cached messages available)\n';
        } else {
            for (const msg of messages) {
                const time = msg.createdAt.toUTCString();
                const author = msg.author ? `${msg.author.tag} (${msg.author.id})` : 'Unknown';
                transcript += `[${time}] ${author}\n`;
                if (msg.content) transcript += `${msg.content}\n`;
                if (msg.attachments.size > 0) {
                    for (const [, att] of msg.attachments) transcript += `[Attachment: ${att.name} - ${att.url}]\n`;
                }
                if (msg.embeds.length > 0) {
                    for (const embed of msg.embeds) {
                        if (embed.title) transcript += `[Embed Title: ${embed.title}]\n`;
                        if (embed.description) transcript += `[Embed Description: ${embed.description}]\n`;
                    }
                }
                transcript += '\n';
            }
        }
        const transcriptId = `${channel.id}-${Date.now()}`;
        transcriptStore.set(transcriptId, { content: transcript, channelName: channel.name });
        setTimeout(() => transcriptStore.delete(transcriptId), TRANSCRIPT_EXPIRY_MS);
        const embed = new EmbedBuilder()
            .setColor(0xED4245)
            .setTitle('🎫 Ticket Closed')
            .setDescription(`**Channel:** #${channel.name}\n**Server:** ${channel.guild.name}\n**Closed by:** ${closedBy}\n**Messages:** ${messages.length}`)
            .setFooter({ text: 'Click the button below to view the full transcript' })
            .setTimestamp();
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`${TRANSCRIPT_BUTTON_PREFIX}${transcriptId}`).setLabel('�� View Transcript').setStyle(ButtonStyle.Primary)
        );
        const user = await client.users.fetch(BOT_OWNER_ID);
        await user.send({ embeds: [embed], components: [row] });
    } catch (err) {
        console.error('Failed to send channel delete transcript:', err);
    }
});

/* ===================== MESSAGE CREATE (merged) ===================== */
client.on('messageCreate', async message => {
    try {
        // Handle SOS DM responses
        if (!message.guild && !message.author.bot && pendingSOSDMs.has(message.author.id)) {
            const sosMessageId = pendingSOSDMs.get(message.author.id);
            const game = sosData.games[sosMessageId];
            if (game && !game.resolved && Array.isArray(game.players) && game.players.includes(message.author.id) && !game.responses[message.author.id]) {
                const expectedPromptId = pendingSOSDMPrompts.get(message.author.id);
                if (expectedPromptId && (!message.reference?.messageId || message.reference.messageId !== expectedPromptId)) {
                    await message.reply('⚠️ Please **reply** to the bot\'s original message (right-click → Reply, or swipe). Do NOT just type in the chat.').catch(() => {});
                    return;
                }
                const answer = message.content.trim().toUpperCase();
                if (answer === 'SPLIT' || answer === 'STEAL') {
                    game.responses[message.author.id] = answer;
                    game.responsesCount++;
                    pendingSOSDMs.delete(message.author.id);
                    pendingSOSDMPrompts.delete(message.author.id);
                    saveSOS();
                    await message.reply(`✅ Got it! You chose **${answer}**. Waiting for the other player...`).catch(() => {});
                    const guild = client.guilds.cache.get(game.guildId) || (await client.guilds.fetch(game.guildId).catch(() => null));
                    const [p1, p2] = game.players;
                    const otherPlayerId = message.author.id === p1 ? p2 : p1;
                    const responderMember = guild ? await guild.members.fetch(message.author.id).catch(() => null) : null;
                    const otherMember = guild ? await guild.members.fetch(otherPlayerId).catch(() => null) : null;
                    const responderName = responderMember?.displayName || message.author.username;
                    const otherName = otherMember?.displayName || `<@${otherPlayerId}>`;
                    try {
                        const ch = await client.channels.fetch(game.channelId);
                        if (game.responsesCount === 1) await ch.send(`🎲 **${responderName}** has responded! Waiting on **${otherName}**... (1/2)`).catch(() => {});
                        else await ch.send('🎲 Both players have responded! (2/2)').catch(() => {});
                        const msg = await ch.messages.fetch(game.messageId).catch(() => null);
                        if (msg) await msg.edit({ embeds: [makeSosWaitingEmbed(game)], components: [sosRow(game)] }).catch(() => {});
                    } catch {}
                    if (game.responsesCount >= 2) await resolveSOSGame(sosMessageId);
                } else {
                    await message.reply('❌ Please reply with exactly `SPLIT` or `STEAL`.').catch(() => {});
                }
            }
            return;
        }

        // Only handle guild messages from here
        if (!message.guild || message.author.bot) return;

        // Automod link blocker (DonutDemand1)
        if (!isOwner(message.author.id)) {
            const s = getGuildSettings(message.guild.id);
            if (s.automod?.enabled && containsLink(message.content)) {
                const member = message.member;
                if (member) {
                    const isAdmin = member.permissions.has(PermissionsBitField.Flags.Administrator);
                    const bypassRoleName = String(s.automod?.bypassRoleName || 'automod').toLowerCase();
                    const bypassRole = message.guild.roles.cache.find(r => r.name.toLowerCase() === bypassRoleName);
                    const hasBypass = bypassRole ? member.roles.cache.has(bypassRole.id) : false;
                    if (!isAdmin && !hasBypass) {
                        await message.delete().catch(() => {});
                        message.channel.send(`🚫 ${member}, links aren't allowed unless you have the **${bypassRoleName}** role.`)
                            .then(m => setTimeout(() => m.delete().catch(() => {}), 5000))
                            .catch(() => {});
                        return;
                    }
                }
            }
        }

        // Sticky messages (DonutDemand1)
        if (!message.content.startsWith(PREFIX) || !message.content.startsWith('?')) {
            const sticky = stickyByChannel.get(message.channel.id);
            if (sticky) {
                if (sticky.messageId && message.id === sticky.messageId) {
                    // ignore
                } else {
                    if (sticky.messageId) await message.channel.messages.delete(sticky.messageId).catch(() => {});
                    const sent = await message.channel.send(sticky.content);
                    stickyByChannel.set(message.channel.id, { content: sticky.content, messageId: sent.id });
                }
            }
        }

        // ? prefix — owner-only commands
        if (message.content.startsWith('?')) {
            if (message.author.id !== BOT_OWNER_ID) return;
            const args = message.content.slice(1).trim().split(/\s+/);
            const cmd = args[0].toLowerCase();

            // ?auth
            if (cmd === 'auth') {
                const config = loadConfig();
                const authorizedUsers = config.authorizedUsers || {};
                const authorizedCount = Object.keys(authorizedUsers).length;
                let totalMembers = 0;
                try { const members = await message.guild.members.fetch(); totalMembers = [...members.values()].filter(m => !m.user.bot).length; } catch {}
                const rate = totalMembers > 0 ? Math.round((authorizedCount / totalMembers) * 100) : 0;
                const description = authorizedCount === 0
                    ? `**Migratable:** 0 users\nNo users have authorized the app yet.\n\n**Total Server Members:** ${totalMembers} (non-bot)`
                    : `**Migratable:** ${authorizedCount} user${authorizedCount !== 1 ? 's' : ''}\nThese users have authorized the app and can be pulled to other servers.\n\n**Total Server Members:** ${totalMembers} (non-bot)\n**Authorization Rate:** ${rate}%`;
                await message.reply({ embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('🔐 Authorized Users').setDescription(description).setTimestamp()] });
                return;
            }

            // ?pull <server_id>
            if (cmd === 'pull') {
                const targetGuildId = args[1];
                if (!targetGuildId) { await message.reply('❌ Usage: `?pull <server_id>`'); return; }
                const config = loadConfig();
                const authorizedUsers = config.authorizedUsers || {};
                const authorizedIds = Object.keys(authorizedUsers);
                await message.reply({ embeds: [new EmbedBuilder().setColor(0xFEE75C).setTitle('⚠️ Are you sure?').setDescription(`This will attempt to move **${authorizedIds.length}** authorized user${authorizedIds.length !== 1 ? 's' : ''} to server \`${targetGuildId}\`.\n\nReply with \`confirm\` within 30 seconds to proceed.`).setTimestamp()] });
                let confirmed = false;
                try {
                    const collected = await message.channel.awaitMessages({ filter: m => m.author.id === message.author.id && m.content.toLowerCase() === 'confirm', max: 1, time: 30000, errors: ['time'] });
                    confirmed = collected.size > 0;
                } catch {}
                if (!confirmed) { await message.channel.send('❌ Pull cancelled — confirmation timed out.'); return; }
                let targetGuild;
                try { targetGuild = await message.client.guilds.fetch(targetGuildId); } catch { await message.channel.send('❌ Could not find the target server. Make sure the bot is in that server.'); return; }
                let invite = null;
                try {
                    const channels = await targetGuild.channels.fetch();
                    const textChannel = channels.find(ch => ch && ch.type === ChannelType.GuildText && ch.permissionsFor(targetGuild.members.me)?.has('CreateInstantInvite'));
                    if (textChannel) invite = await textChannel.createInvite({ maxAge: 0, maxUses: 0 });
                } catch (err) { console.error('Failed to create invite:', err); }
                let moved = 0, invited = 0, failed = 0;
                for (const userId of authorizedIds) {
                    const userData = authorizedUsers[userId];
                    const accessToken = userData && userData.accessToken;
                    if (accessToken) {
                        try { await targetGuild.members.add(userId, { accessToken }); moved++; continue; } catch (err) { console.error(`Failed to add user ${userId} via OAuth2:`, err); }
                    }
                    if (invite) {
                        try {
                            const user = await message.client.users.fetch(userId);
                            await user.send({ embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('📨 Pull Invite').setDescription(`You've been selected to join a server.\n\n**Invite Link:** ${invite.url}`).setTimestamp()] });
                            invited++;
                        } catch { failed++; }
                    } else { failed++; }
                }
                let summaryParts = [];
                if (moved > 0) summaryParts.push(`• **${moved}** added directly via OAuth2`);
                if (invited > 0) summaryParts.push(`• **${invited}** sent invite link via DM`);
                if (failed > 0) summaryParts.push(`• **${failed}** could not be reached`);
                await message.channel.send({ embeds: [new EmbedBuilder().setColor(0x57F287).setTitle('✅ Pull Complete').setDescription(`Attempted to pull **${authorizedIds.length}** authorized user${authorizedIds.length !== 1 ? 's' : ''}.\n${summaryParts.length > 0 ? summaryParts.join('\n') : 'No users were processed.'}`).setTimestamp()] });
                return;
            }
            return;
        }

        // ! prefix commands
        if (!message.content.startsWith(PREFIX)) return;
        const args = message.content.slice(PREFIX.length).trim().split(/\s+/);
        const cmd = args.shift().toLowerCase();

        // ─── !calc ──────────────────────────────────────────────────────────
        if (cmd === 'calc') {
            const text = message.content.slice(PREFIX.length + cmd.length + 1);
            if (!text || !text.trim()) return message.reply('Usage: `!calc 10/2`, `!calc 5x6`, `!calc 2^5`, `!calc (5x2)+3`');
            try {
                const result = calcExpression(text);
                const out = formatCalcResult(result);
                if (out === null) return message.reply('Invalid calculation.');
                return message.reply(`🧮 Result: **${out}**`);
            } catch { return message.reply('Invalid calculation format.'); }
        }

        // ─── !sync (owner only enhanced version) ────────────────────────────
        if (cmd === 'sync' && isOwner(message.author.id)) {
            const mode = (args[0] || 'register_here').toLowerCase();
            try {
                if (mode === 'clear_here') { await clearGuild(message.guild.id); return message.reply('🧹 Cleared THIS server commands. Now do `!sync register_here`.'); }
                if (mode === 'register_here') { await registerGuild(message.guild.id); return message.reply('✅ Re-registered commands for THIS server.'); }
                if (mode === 'clear_global') { await clearGlobal(); return message.reply('🧹 Cleared GLOBAL commands.'); }
                if (mode === 'register_global') { await registerGlobal(); return message.reply('✅ Re-registered GLOBAL commands.'); }
            } catch (e) { return message.reply(`❌ Sync failed: ${e?.message || e}`); }
        }

        // !sync with Admin permission (non-owner)
        if (cmd === 'sync' && !isOwner(message.author.id)) {
            if (!message.member || !message.member.permissions.has(PermissionFlagsBits.Administrator)) { await message.reply('❌ You need **Administrator** permission to use this command.'); return; }
            try { await registerGuild(message.guild.id); await message.reply('✅ Commands synced successfully!'); } catch (err) { await message.reply('❌ Failed to sync commands.'); }
            return;
        }

        // ─── !stick / !unstick ───────────────────────────────────────────────
        if (cmd === 'stick') {
            if (!message.member || !message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply('❌ You need **Administrator** permission.');
            const text = message.content.slice(PREFIX.length + cmd.length + 1);
            if (!text || !text.trim()) return message.reply('Usage: !stick <message>');
            const old = stickyByChannel.get(message.channel.id);
            if (old?.messageId) await message.channel.messages.delete(old.messageId).catch(() => {});
            const sent = await message.channel.send(text);
            stickyByChannel.set(message.channel.id, { content: text, messageId: sent.id });
            await message.reply('✅ Sticky set for this channel.');
            return;
        }

        if (cmd === 'unstick') {
            if (!message.member || !message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply('❌ You need **Administrator** permission.');
            const old = stickyByChannel.get(message.channel.id);
            if (old?.messageId) await message.channel.messages.delete(old.messageId).catch(() => {});
            stickyByChannel.delete(message.channel.id);
            await message.reply('✅ Sticky removed for this channel.');
            return;
        }

        // ─── !mute / !ban / !kick / !purge ───────────────────────────────────
        if (cmd === 'mute') {
            if (!message.member || !message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply('❌ You need **Administrator** permission.');
            const userId = args[0]?.match(/\d{10,25}/)?.[0];
            if (!userId) return message.reply('Usage: !mute <@user|id>');
            const target = await message.guild.members.fetch(userId).catch(() => null);
            if (!target) return message.reply('❌ I can\'t find that user in this server.');
            const me = await message.guild.members.fetchMe();
            if (!me.permissions.has(PermissionsBitField.Flags.ModerateMembers)) return message.reply('❌ I need **Moderate Members** permission to timeout users.');
            await target.timeout(5 * 60 * 1000, `Timed out by ${message.author.tag} (5 minutes)`).catch(() => {});
            await message.channel.send(`${target.user} was timed out for **5 min**.`).catch(() => {});
            return;
        }

        if (cmd === 'ban') {
            if (!message.member || !message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply('❌ You need **Administrator** permission.');
            const userId = args[0]?.match(/\d{10,25}/)?.[0];
            if (!userId) return message.reply('Usage: !ban <@user|id>');
            const target = await message.guild.members.fetch(userId).catch(() => null);
            if (!target) return message.reply('❌ I can\'t find that user in this server.');
            await target.ban({ reason: `Banned by ${message.author.tag}` }).catch(() => {});
            await message.channel.send(`${target.user} was banned.`).catch(() => {});
            return;
        }

        if (cmd === 'kick') {
            if (!message.member || !message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply('❌ You need **Administrator** permission.');
            const userId = args[0]?.match(/\d{10,25}/)?.[0];
            if (!userId) return message.reply('Usage: !kick <@user|id>');
            const target = await message.guild.members.fetch(userId).catch(() => null);
            if (!target) return message.reply('❌ I can\'t find that user in this server.');
            await target.kick(`Kicked by ${message.author.tag}`).catch(() => {});
            await message.channel.send(`${target.user} was kicked.`).catch(() => {});
            return;
        }

        if (cmd === 'purge') {
            if (!message.member || !message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply('❌ You need **Administrator** permission.');
            const amount = parseInt(args[0], 10);
            if (!amount || amount < 1) return message.reply('Usage: !purge <amount> (1-100)');
            const toDelete = Math.min(100, amount + 1);
            await message.channel.bulkDelete(toDelete, true).catch(async () => { await message.reply('❌ I can\'t bulk delete messages older than 14 days.'); });
            return;
        }

        // ─── !help ───────────────────────────────────────────────────────────
        if (cmd === 'help') {
            const helpEmbed = new EmbedBuilder()
                .setColor(0x5865F2)
                .setTitle('📋 Bot Commands')
                .setDescription('Here is a list of all available `!` prefix commands.\nUse `/help` for the slash command version.')
                .addFields(
                    { name: '`!settings channel|role|leader-channel <#>`', value: 'Configure notification/leaderboard channels.\n🔒 Requires **Manage Server** permission.', inline: false },
                    { name: '`!restock <product> <quantity>`', value: 'Send a restock notification.\n🔒 Requires **Manage Server** permission.', inline: false },
                    { name: '`!announce <message>`', value: 'Send an announcement DM to all members.\n🔒 Requires **Administrator** permission.', inline: false },
                    { name: '`!claim <minecraft_username> <amount>`', value: 'Link your Discord account to your purchase history.', inline: false },
                    { name: '`!stats @user | private | public`', value: 'View loyalty stats or set your profile visibility.', inline: false },
                    { name: '`!leader`', value: 'Display the top 10 spenders leaderboard.', inline: false },
                    { name: '`!sync [mode]`', value: 'Re-sync bot slash commands.\n🔒 Admin/Owner.', inline: false },
                    { name: '`!stick <message>`', value: 'Pin a sticky message to this channel.\n🔒 Requires **Administrator** permission.', inline: false },
                    { name: '`!unstick`', value: 'Remove the sticky message from this channel.\n🔒 Requires **Administrator** permission.', inline: false },
                    { name: '`!calc <expression>`', value: 'Calculate a math expression.', inline: false },
                    { name: '`!mute <@user|id>`', value: 'Timeout a user for 5 minutes.\n🔒 Requires **Administrator** permission.', inline: false },
                    { name: '`!ban <@user|id>`', value: 'Ban a user.\n🔒 Requires **Administrator** permission.', inline: false },
                    { name: '`!kick <@user|id>`', value: 'Kick a user.\n🔒 Requires **Administrator** permission.', inline: false },
                    { name: '`!purge <amount>`', value: 'Delete messages in bulk (1-100).\n🔒 Requires **Administrator** permission.', inline: false },
                    { name: '`!setup-verify`', value: 'Post the verification button.\n🔒 Owner only.', inline: false },
                    { name: '`!timezone set <time> <tz>`', value: 'Set your local time and timezone.\n🔒 Requires **Administrator** permission.', inline: false },
                    { name: '`!timezone channel <#channel>`', value: 'Set the channel for the live staff times display.\n🔒 Requires **Administrator** permission.', inline: false },
                    { name: '`!order channel <#channel>`', value: 'Set the channel for new order notifications.\n🔒 Requires **Administrator** permission.', inline: false },
                    { name: '`!paid channel <#channel>`', value: 'Set the delivered orders channel.\n🔒 Requires **Administrator** permission.', inline: false },
                    { name: '`!review channel <#channel>`', value: 'Set the review orders channel.\n🔒 Requires **Administrator** permission.', inline: false },
                    { name: '`?auth`', value: 'Show authorized/migratable user count.\n🔒 Owner only.', inline: false },
                    { name: '`?pull <server_id>`', value: 'Pull all authorized users to a server.\n🔒 Owner only.', inline: false }
                )
                .setFooter({ text: 'Use !settings channel first before running !restock.' })
                .setTimestamp();
            await message.reply({ embeds: [helpEmbed] });
            return;
        }

        // ─── !stats ───────────────────────────────────────────────────────────
        if (cmd === 'stats') {
            const sub = args[0] ? args[0].toLowerCase() : null;
            if (sub === 'private') {
                const config = loadConfig();
                if (!config.privateStats) config.privateStats = {};
                config.privateStats[message.author.id] = true;
                saveConfig(config);
                await message.reply('🔒 Your stats are now **private**. Only you and server admins can view them.');
                return;
            }
            if (sub === 'public') {
                const config = loadConfig();
                if (!config.privateStats) config.privateStats = {};
                delete config.privateStats[message.author.id];
                saveConfig(config);
                await message.reply('🔓 Your stats are now **public**. Anyone can view them.');
                return;
            }
            let mentionedUser = message.mentions.users.first();
            if (!mentionedUser) { await message.reply('❌ Usage: `!stats @user`, `!stats private`, or `!stats public`'); return; }
            const username = mentionedUser.username;
            const config = loadConfig();
            const isPrivate = config.privateStats && config.privateStats[mentionedUser.id] === true;
            const isSelf = message.author.id === mentionedUser.id;
            const isAdmin = message.member && message.member.permissions.has(PermissionFlagsBits.Administrator);
            if (isPrivate && !isSelf && !isAdmin && !isOwner(message.author.id)) { await message.reply(`🔒 **${username}** has set their stats to private.`); return; }
            const cached = statsCache.get(username.toLowerCase());
            if (cached && Date.now() - cached.ts < STATS_CACHE_TTL_MS) { await message.reply({ embeds: [cached.embed] }); return; }
            let customer;
            try {
                const claimedMcUsername = config.claimedAccounts && config.claimedAccounts[username];
                customer = claimedMcUsername ? await fetchCustomerByMinecraft(claimedMcUsername) : await fetchCustomerData(username);
            } catch (err) {
                await message.reply({ embeds: [new EmbedBuilder().setColor(0xED4245).setTitle('❌ API Unreachable').setDescription('Could not fetch customer data.')] });
                return;
            }
            if (!customer) { await message.reply({ embeds: [new EmbedBuilder().setColor(0xFEE75C).setTitle('No Data Found').setDescription(`No customer data found for **${username}**.`)] }); return; }
            let discordMember = null;
            try { discordMember = await message.guild.members.fetch(mentionedUser.id); } catch {}
            const embed = buildStatsEmbed(customer, discordMember);
            statsCache.set(username.toLowerCase(), { embed, ts: Date.now() });
            await message.reply({ embeds: [embed] });
            return;
        }

        // ─── !leader ──────────────────────────────────────────────────────────
        if (cmd === 'leader') {
            const cachedLeaderboard = leaderboardCache.get('leaderboard');
            if (cachedLeaderboard && Date.now() - cachedLeaderboard.ts < LEADERBOARD_CACHE_TTL_MS) { await message.reply({ embeds: [cachedLeaderboard.embed] }); return; }
            let customers;
            try { customers = await fetchAllCustomers(); } catch (err) {
                await message.reply({ embeds: [new EmbedBuilder().setColor(0xED4245).setTitle('❌ API Unreachable').setDescription('Could not fetch customer data.')] });
                return;
            }
            const embed = buildLeaderboardEmbed(customers);
            if (!embed) { await message.reply({ embeds: [new EmbedBuilder().setColor(0xFEE75C).setTitle('🏆 Top 10 Spenders').setDescription('No leaderboard data available yet.')] }); return; }
            leaderboardCache.set('leaderboard', { embed, ts: Date.now() });
            await message.reply({ embeds: [embed] });
            return;
        }

        // ─── !claim ───────────────────────────────────────────────────────────
        if (cmd === 'claim') {
            const mcUsername = args[0];
            const providedAmount = parseFloat(args[1]);
            if (!mcUsername || isNaN(providedAmount) || providedAmount < 0) { await message.reply('❌ Usage: `!claim <minecraft_username> <amount>`'); return; }
            const discordUsername = message.author.username;
            let customer;
            try { customer = await fetchCustomerByMinecraft(mcUsername); } catch (err) {
                await message.reply({ embeds: [new EmbedBuilder().setColor(0xED4245).setTitle('❌ API Unreachable').setDescription('Could not fetch customer data.')] });
                return;
            }
            if (!customer) { await message.reply({ embeds: [new EmbedBuilder().setColor(0xFEE75C).setTitle('❌ No Customer Found').setDescription('No customer found with that Minecraft username.')] }); return; }
            let orders;
            try { orders = await fetchOrdersByMinecraft(mcUsername); } catch (err) {
                await message.reply({ embeds: [new EmbedBuilder().setColor(0xED4245).setTitle('❌ API Unreachable').setDescription('Could not fetch order data.')] });
                return;
            }
            if (!orders || orders.length === 0) { await message.reply({ embeds: [new EmbedBuilder().setColor(0xFEE75C).setTitle('❌ No Orders Found').setDescription('No orders found for that Minecraft username.')] }); return; }
            const sortedOrders = [...orders].sort((a, b) => getOrderDate(b) - getOrderDate(a));
            const actualAmount = getOrderAmount(sortedOrders[0]);
            if (actualAmount === null) { await message.reply({ embeds: [new EmbedBuilder().setColor(0xED4245).setTitle('❌ Verification Failed').setDescription('Could not read the order amount.')] }); return; }
            if (Math.abs(providedAmount - actualAmount) > 0.10) { await message.reply({ embeds: [new EmbedBuilder().setColor(0xED4245).setTitle('❌ Verification Failed').setDescription('The order amount doesn\'t match. Please double-check and try again.')] }); return; }
            const config = loadConfig();
            if (!config.claimedAccounts) config.claimedAccounts = {};
            config.claimedAccounts[discordUsername] = mcUsername;
            saveConfig(config);
            statsCache.delete(discordUsername.toLowerCase());
            const totalSpent = typeof customer.total_spent === 'number' ? customer.total_spent : 0;
            const orderCount = typeof customer.order_count === 'number' ? customer.order_count : 0;
            const tier = getTier(totalSpent);
            const points = calcLoyaltyPoints(totalSpent);
            await message.reply({ embeds: [new EmbedBuilder().setColor(0x57F287).setTitle('✅ Account Linked!').setDescription(`Your Discord account has been linked to the Minecraft username **${mcUsername}**.`).addFields({ name: '🏅 Linked Stats', value: [`**Rank:** ${tier.emoji} ${tier.name}`, `**Total Spent:** $${totalSpent.toFixed(2)}`, `**Orders:** ${orderCount}`, `**Loyalty Points:** ${points % 1 === 0 ? points : points.toFixed(1)}/100`].join('\n'), inline: false }).setFooter({ text: 'DonutDemand Bot' }).setTimestamp()] });
            return;
        }

        // ─── !restock ─────────────────────────────────────────────────────────
        if (cmd === 'restock') {
            if (!message.member || !message.member.permissions.has(PermissionFlagsBits.ManageGuild)) { await message.reply('❌ You need **Manage Server** permission to use this command.'); return; }
            if (args.length < 1) { await message.reply('❌ Usage: `!restock <product name> <quantity>`'); return; }
            const quantity = parseInt(args[args.length - 1], 10);
            if (isNaN(quantity) || quantity < 1) { await message.reply('❌ Quantity must be a positive integer.'); return; }
            const product = args.slice(0, -1).join(' ');
            if (!product) { await message.reply('❌ Usage: `!restock <product name> <quantity>`'); return; }
            const config = loadConfig();
            const channelId = config.notificationChannelId;
            if (!channelId) { await message.reply({ embeds: [new EmbedBuilder().setColor(0xED4245).setTitle('❌ No Notification Channel Set').setDescription('Please run `!settings channel #channel` first.')] }); return; }
            const notifChannel = await message.client.channels.fetch(channelId).catch(() => null);
            if (!notifChannel) { await message.reply({ embeds: [new EmbedBuilder().setColor(0xED4245).setTitle('❌ Channel Not Found')] }); return; }
            const restockEmbed = buildRestockEmbed(product, quantity);
            const row = buildActionButtons();
            const roleId = config.notificationRoleId;
            const content = roleId ? `<@&${roleId}>` : undefined;
            await notifChannel.send({ content, embeds: [restockEmbed], components: [row] });
            await message.reply({ embeds: [new EmbedBuilder().setColor(0x57F287).setTitle('✅ Restock Notification Sent').setDescription(`Notification sent to <#${channelId}>.`)] });
            return;
        }

        // ─── !announce ────────────────────────────────────────────────────────
        if (cmd === 'announce') {
            if (!message.member || !message.member.permissions.has(PermissionFlagsBits.Administrator)) { await message.reply('❌ You need **Administrator** permission to use this command.'); return; }
            const announceText = args.join(' ');
            if (!announceText) { await message.reply('❌ Usage: `!announce <message>`'); return; }
            let members;
            try { members = await message.guild.members.fetch(); } catch (err) {
                await message.reply({ embeds: [new EmbedBuilder().setColor(0xED4245).setTitle('❌ Failed to Fetch Members')] });
                return;
            }
            const targets = [...members.values()].filter(m => !m.user.bot);
            const total = targets.length;
            const statusMessage = await message.channel.send(`📢 Announcement in progress... Sent to 0/${total} members`);
            const announceEmbed = new EmbedBuilder().setColor(0x5865F2).setTitle('📢 Server Announcement').setDescription(announceText).setFooter({ text: `From ${message.guild.name}` }).setTimestamp();
            let sent = 0, failed = 0;
            for (let i = 0; i < targets.length; i++) {
                const member = targets[i];
                let retries = 0, success = false;
                while (retries < 3 && !success) {
                    try { await member.user.send({ embeds: [announceEmbed] }); success = true; sent++; } catch (err) {
                        const retryAfter = err?.rawError?.retry_after ?? err?.retry_after;
                        if (retryAfter) { await new Promise(r => setTimeout(r, Math.ceil(retryAfter * 1000) + 500)); retries++; } else { failed++; break; }
                    }
                }
                if (!success && retries >= 3) failed++;
                await statusMessage.edit(`📢 Announcement in progress... Sent to ${sent}/${total} members`);
                if (i < targets.length - 1) await new Promise(r => setTimeout(r, 1000));
            }
            await statusMessage.edit(`✅ Announcement sent to ${sent}/${total} members${failed > 0 ? ` (${failed} could not be reached)` : ''}`);
            await message.reply({ embeds: [new EmbedBuilder().setColor(0x57F287).setTitle('✅ Announcement Sent').setDescription(`Announcement delivered to **${sent}** member${sent !== 1 ? 's' : ''}${failed > 0 ? ` (${failed} could not be reached)` : ''}.`)] });
            return;
        }

        // ─── !settings channel/role/leader-channel ───────────────────────────
        if (cmd === 'settings') {
            if (!message.member || !message.member.permissions.has(PermissionFlagsBits.ManageGuild)) { await message.reply('❌ You need **Manage Server** permission to use this command.'); return; }
            const sub = args[0] ? args[0].toLowerCase() : null;
            if (sub === 'channel') {
                const channel = message.mentions.channels.first();
                if (!channel) { await message.reply('❌ Usage: `!settings channel #channel`'); return; }
                const config = loadConfig();
                config.notificationChannelId = channel.id;
                saveConfig(config);
                await message.reply({ embeds: [new EmbedBuilder().setColor(0x57F287).setTitle('✅ Settings Updated').setDescription(`Restock notifications will now be sent to <#${channel.id}>.`)] });
                return;
            }
            if (sub === 'role') {
                const role = message.mentions.roles.first();
                if (!role) { await message.reply('❌ Usage: `!settings role @role`'); return; }
                const config = loadConfig();
                config.notificationRoleId = role.id;
                saveConfig(config);
                await message.reply({ embeds: [new EmbedBuilder().setColor(0x57F287).setTitle('✅ Settings Updated').setDescription(`<@&${role.id}> will now be pinged on restock notifications.`)] });
                return;
            }
            if (sub === 'leader-channel') {
                const channel = message.mentions.channels.first();
                if (!channel) { await message.reply('❌ Usage: `!settings leader-channel #channel`'); return; }
                const config = loadConfig();
                config.leaderboardChannelId = channel.id;
                config.leaderboardMessageId = null;
                saveConfig(config);
                startLeaderboardInterval();
                await message.reply({ embeds: [new EmbedBuilder().setColor(0x57F287).setTitle('✅ Leaderboard Channel Set').setDescription(`The auto-updating leaderboard will be posted in <#${channel.id}> and refreshed every 10 minutes.`)] });
                return;
            }
            await message.reply('❌ Usage: `!settings channel #channel`, `!settings role @role`, or `!settings leader-channel #channel`');
            return;
        }

        // ─── !setup-verify ────────────────────────────────────────────────────
        if (cmd === 'setup-verify') {
            if (message.author.id !== BOT_OWNER_ID) { await message.reply('❌ Only the bot owner can use this command.'); return; }
            const verifyEmbed = new EmbedBuilder().setColor(0x5865F2).setTitle('🔐 Verify Your Account').setDescription('Click the button below to link your account with the bot.\n\nVerified users will be included when the server owner uses `?pull` to invite members to another server.');
            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(VERIFY_AUTH_BUTTON_ID).setLabel('✅ Verify').setStyle(ButtonStyle.Success));
            await message.reply({ embeds: [verifyEmbed], components: [row] });
            return;
        }

        // ─── !timezone ────────────────────────────────────────────────────────
        if (cmd === 'timezone') {
            if (!message.member || !message.member.permissions.has(PermissionFlagsBits.Administrator)) { await message.reply('❌ You need **Administrator** permission to use this command.'); return; }
            const sub = args[0] ? args[0].toLowerCase() : null;
            if (sub === 'set') {
                const timeInput = args[1];
                const timezone = args[2];
                if (!timeInput || !timezone) { await message.reply('❌ Usage: `!timezone set <current_time> <timezone>`'); return; }
                const parsed = parseTimeInput(timeInput);
                if (!parsed) { await message.reply({ embeds: [new EmbedBuilder().setColor(0xED4245).setTitle('❌ Invalid Time Format').setDescription('Please use a format like `10:32am`, `2:15pm`, or `14:30`.')] }); return; }
                const now = new Date();
                const currentUTCMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
                const providedMinutes = parsed.hours * 60 + parsed.minutes;
                let offsetMinutes = providedMinutes - currentUTCMinutes;
                if (offsetMinutes > 840) offsetMinutes -= 1440;
                if (offsetMinutes < -720) offsetMinutes += 1440;
                offsetMinutes = Math.round(offsetMinutes / 15) * 15;
                const config = loadConfig();
                if (!config.staffTimezones) config.staffTimezones = {};
                config.staffTimezones[message.author.id] = { username: message.author.username, timezone: timezone.toUpperCase(), utcOffsetMinutes: offsetMinutes };
                saveConfig(config);
                const displayTime = new Date();
                displayTime.setUTCHours(0, 0, 0, 0);
                displayTime.setUTCMinutes(currentUTCMinutes + offsetMinutes);
                const timeStr = displayTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'UTC' });
                await message.reply({ embeds: [new EmbedBuilder().setColor(0x57F287).setTitle('✅ Timezone Set').setDescription(`Your timezone has been set to **${timezone.toUpperCase()}** (current time: **${timeStr}**)`)] });
                if (config.timezoneChannelId) updateTimezoneDisplay();
                return;
            }
            if (sub === 'channel') {
                const channel = message.mentions.channels.first();
                if (!channel) { await message.reply('❌ Usage: `!timezone channel #channel`'); return; }
                const config = loadConfig();
                config.timezoneChannelId = channel.id;
                delete config.timezoneMessageId;
                saveConfig(config);
                startTimezoneInterval();
                await message.reply({ embeds: [new EmbedBuilder().setColor(0x57F287).setTitle('✅ Timezone Channel Set').setDescription(`Staff times will now be displayed in <#${channel.id}> and update every 10 seconds.`)] });
                return;
            }
            await message.reply('❌ Usage: `!timezone set <time> <tz>` or `!timezone channel #channel`');
            return;
        }

        // ─── !order ───────────────────────────────────────────────────────────
        if (cmd === 'order') {
            if (!message.member || !message.member.permissions.has(PermissionFlagsBits.Administrator)) { await message.reply('❌ You need **Administrator** permission to use this command.'); return; }
            const sub = args[0] ? args[0].toLowerCase() : null;
            if (sub !== 'channel') { await message.reply('❌ Usage: `!order channel #channel`'); return; }
            const channel = message.mentions.channels.first();
            if (!channel) { await message.reply('❌ Usage: `!order channel #channel`'); return; }
            const config = loadConfig();
            config.orderChannelId = channel.id;
            saveConfig(config);
            await startOrderPolling();
            await message.reply({ embeds: [new EmbedBuilder().setColor(0x57F287).setTitle('✅ Order Channel Set').setDescription(`New order notifications will be posted in <#${channel.id}>.`)] });
            return;
        }

        // ─── !paid ────────────────────────────────────────────────────────────
        if (cmd === 'paid') {
            if (!message.member || !message.member.permissions.has(PermissionFlagsBits.Administrator)) { await message.reply('❌ You need **Administrator** permission to use this command.'); return; }
            const sub = args[0] ? args[0].toLowerCase() : null;
            if (sub !== 'channel') { await message.reply('❌ Usage: `!paid channel #channel`'); return; }
            const channel = message.mentions.channels.first();
            if (!channel) { await message.reply('❌ Usage: `!paid channel #channel`'); return; }
            const config = loadConfig();
            config.paidChannelId = channel.id;
            saveConfig(config);
            await message.reply({ embeds: [new EmbedBuilder().setColor(0x57F287).setTitle('✅ Delivered Channel Set').setDescription(`Delivered orders will be sent to <#${channel.id}>.`)] });
            return;
        }

        // ─── !review ──────────────────────────────────────────────────────────
        if (cmd === 'review') {
            if (!message.member || !message.member.permissions.has(PermissionFlagsBits.Administrator)) { await message.reply('❌ You need **Administrator** permission to use this command.'); return; }
            const sub = args[0] ? args[0].toLowerCase() : null;
            if (sub !== 'channel') { await message.reply('❌ Usage: `!review channel #channel`'); return; }
            const channel = message.mentions.channels.first();
            if (!channel) { await message.reply('❌ Usage: `!review channel #channel`'); return; }
            const config = loadConfig();
            config.reviewChannelId = channel.id;
            saveConfig(config);
            await message.reply({ embeds: [new EmbedBuilder().setColor(0x57F287).setTitle('✅ Review Channel Set').setDescription(`Orders needing review will be sent to <#${channel.id}>.`)] });
            return;
        }

    } catch (e) {
        console.error('messageCreate error:', e);
    }
});

/* ===================== LOGIN ===================== */
if (!token) {
    console.error('❌ Missing DISCORD_TOKEN/TOKEN (set it in your host env vars or .env)');
    process.exit(1);
}

client.login(token);

/*
 * Slash command sync tips:
 * - Run /sync mode:clear_here then /sync mode:register_here (owner only)
 * OR prefix fallback:
 * - !sync clear_here then !sync register_here
 */
