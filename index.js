// Discord Ticket Bot — includes restock notification feature

require('dotenv').config();

const {
    Client,
    GatewayIntentBits,
    ChannelType,
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    ChannelSelectMenuBuilder,
    RoleSelectMenuBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    PermissionFlagsBits,
    AuditLogEvent,
    REST,
    Routes,
} = require('discord.js');
const https = require('https');
const fs = require('fs');
const path = require('path');

// ─── Configuration helpers ────────────────────────────────────────────────────

const CONFIG_PATH = path.join(__dirname, 'config.json');

function loadConfig() {
    if (!fs.existsSync(CONFIG_PATH)) {
        return {};
    }
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

// ─── Slash command definitions ────────────────────────────────────────────────

const commands = [
    new SlashCommandBuilder()
        .setName('help')
        .setDescription('Show all available bot commands'),

    new SlashCommandBuilder()
        .setName('settings')
        .setDescription('View and configure all bot settings in one dashboard')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    new SlashCommandBuilder()
        .setName('restock')
        .setDescription('Send a product restock notification')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addStringOption(opt =>
            opt
                .setName('product')
                .setDescription('Name of the restocked product (e.g. "1M DonutSMP Money")')
                .setRequired(true),
        )
        .addIntegerOption(opt =>
            opt
                .setName('quantity')
                .setDescription('Available stock quantity')
                .setRequired(true)
                .setMinValue(1),
        ),

    new SlashCommandBuilder()
        .setName('announce')
        .setDescription('Send an announcement DM to server members')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption(opt =>
            opt
                .setName('message')
                .setDescription('The announcement message to send')
                .setRequired(true),
        )
        .addRoleOption(opt =>
            opt
                .setName('role')
                .setDescription('Only DM members who have this role (omit to send to all members)')
                .setRequired(false),
        ),

    new SlashCommandBuilder()
        .setName('updatestock')
        .setDescription('Update the stock quantity for a product')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addIntegerOption(opt =>
            opt
                .setName('quantity')
                .setDescription('The new stock quantity to set')
                .setRequired(true)
                .setMinValue(0),
        ),

    new SlashCommandBuilder()
        .setName('addproduct')
        .setDescription('Add a new product to the store')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption(opt =>
            opt
                .setName('name')
                .setDescription('Product name (e.g. "1M DonutSMP Money")')
                .setRequired(true),
        )
        .addNumberOption(opt =>
            opt
                .setName('price')
                .setDescription('Product price in USD (e.g. 9.99)')
                .setRequired(true)
                .setMinValue(0),
        )
        .addIntegerOption(opt =>
            opt
                .setName('quantity')
                .setDescription('Initial stock quantity')
                .setRequired(true)
                .setMinValue(0),
        )
        .addStringOption(opt =>
            opt
                .setName('category')
                .setDescription('Product category (e.g. "Ranks", "Items", "Currency")')
                .setRequired(false),
        )
        .addStringOption(opt =>
            opt
                .setName('description')
                .setDescription('Product description')
                .setRequired(false),
        )
        .addStringOption(opt =>
            opt
                .setName('image_url')
                .setDescription('Product image URL')
                .setRequired(false),
        ),

    new SlashCommandBuilder()
        .setName('editproduct')
        .setDescription('Edit an existing product (select from dropdown, then update fields)')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption(opt =>
            opt
                .setName('field')
                .setDescription('The field to update')
                .setRequired(true)
                .addChoices(
                    { name: 'Name', value: 'name' },
                    { name: 'Price', value: 'price' },
                    { name: 'Quantity', value: 'quantity' },
                    { name: 'Category', value: 'category' },
                    { name: 'Description', value: 'description' },
                    { name: 'Image URL', value: 'image_url' },
                ),
        )
        .addStringOption(opt =>
            opt
                .setName('value')
                .setDescription('The new value to set')
                .setRequired(true),
        ),

    new SlashCommandBuilder()
        .setName('stats')
        .setDescription('Manage and view loyalty stats')
        .addSubcommand(sub =>
            sub
                .setName('view')
                .setDescription('View a user\'s loyalty stats')
                .addUserOption(opt =>
                    opt
                        .setName('user')
                        .setDescription('The user to look up')
                        .setRequired(true),
                ),
        )
        .addSubcommand(sub =>
            sub
                .setName('private')
                .setDescription('Set your stats to private'),
        )
        .addSubcommand(sub =>
            sub
                .setName('public')
                .setDescription('Set your stats to public'),
        ),

    new SlashCommandBuilder()
        .setName('claim')
        .setDescription('Link your Discord account to your purchase history using your Minecraft username')
        .addStringOption(opt =>
            opt
                .setName('minecraft_username')
                .setDescription('The Minecraft username you used at checkout')
                .setRequired(true),
        )
        .addNumberOption(opt =>
            opt
                .setName('amount')
                .setDescription('Your most recent order amount in USD (e.g. 17.64)')
                .setRequired(true)
                .setMinValue(0),
        ),

    new SlashCommandBuilder()
        .setName('sync')
        .setDescription('Re-sync all bot slash commands')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    new SlashCommandBuilder()
        .setName('leader')
        .setDescription('Display the top 10 spenders leaderboard'),

    new SlashCommandBuilder()
        .setName('setup-verify')
        .setDescription('Post a verification button for users to authorize with the bot')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    new SlashCommandBuilder()
        .setName('timezone')
        .setDescription('Manage staff timezone display')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(sub =>
            sub
                .setName('set')
                .setDescription('Set your current time and timezone')
                .addStringOption(opt =>
                    opt
                        .setName('current_time')
                        .setDescription('Your current time right now (e.g. 10:32am, 2:15pm, 14:30)')
                        .setRequired(true),
                )
                .addStringOption(opt =>
                    opt
                        .setName('timezone')
                        .setDescription('Your timezone abbreviation (e.g. EST, PST, GMT, CET)')
                        .setRequired(true),
                ),
        )
        .addSubcommand(sub =>
            sub
                .setName('channel')
                .setDescription('Set the channel for the live staff times display')
                .addChannelOption(opt =>
                    opt
                        .setName('channel')
                        .setDescription('The channel to display staff times in')
                        .setRequired(true),
                ),
        ),

    new SlashCommandBuilder()
        .setName('order')
        .setDescription('Configure the order notification channel')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(sub =>
            sub
                .setName('channel')
                .setDescription('Set the channel for new order notifications')
                .addChannelOption(opt =>
                    opt
                        .setName('channel')
                        .setDescription('The channel to post new order notifications in')
                        .setRequired(true),
                ),
        ),

    new SlashCommandBuilder()
        .setName('paid')
        .setDescription('Configure the delivered orders channel')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(sub =>
            sub
                .setName('channel')
                .setDescription('Set the channel for delivered orders')
                .addChannelOption(opt =>
                    opt
                        .setName('channel')
                        .setDescription('The channel to move orders to when marked as delivered')
                        .setRequired(true),
                ),
        ),

    new SlashCommandBuilder()
        .setName('review')
        .setDescription('Configure the orders-needing-review channel')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(sub =>
            sub
                .setName('channel')
                .setDescription('Set the channel for orders needing review')
                .addChannelOption(opt =>
                    opt
                        .setName('channel')
                        .setDescription('The channel to move orders to when they need review')
                        .setRequired(true),
                ),
        ),

    // ── Giveaway commands ──────────────────────────────────────────────────────
    new SlashCommandBuilder()
        .setName('giveaway')
        .setDescription('Manage giveaways')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand(sub =>
            sub
                .setName('start')
                .setDescription('Start a new giveaway')
                .addStringOption(opt =>
                    opt.setName('prize').setDescription('What is the giveaway for?').setRequired(true),
                )
                .addStringOption(opt =>
                    opt.setName('duration').setDescription('Duration (e.g. 1h, 30m, 1d)').setRequired(true),
                )
                .addIntegerOption(opt =>
                    opt.setName('winners').setDescription('Number of winners').setRequired(true).setMinValue(1),
                )
                .addChannelOption(opt =>
                    opt.setName('channel').setDescription('Channel to post the giveaway in').setRequired(false),
                )
                .addIntegerOption(opt =>
                    opt.setName('min_invites').setDescription('Minimum invite count to participate').setRequired(false).setMinValue(0),
                )
                .addRoleOption(opt =>
                    opt.setName('required_role').setDescription('Role required to participate').setRequired(false),
                ),
        )
        .addSubcommand(sub =>
            sub
                .setName('end')
                .setDescription('Manually end an active giveaway early')
                .addStringOption(opt =>
                    opt.setName('message_id').setDescription('The giveaway message ID to end').setRequired(false),
                ),
        )
        .addSubcommand(sub =>
            sub
                .setName('reroll')
                .setDescription('Re-pick winners for a completed giveaway')
                .addStringOption(opt =>
                    opt.setName('message_id').setDescription('The giveaway message ID to reroll').setRequired(false),
                ),
        ),

    // ── Ticket panel command ───────────────────────────────────────────────────
    new SlashCommandBuilder()
        .setName('ticket')
        .setDescription('Ticket system management')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand(sub =>
            sub.setName('panel').setDescription('Open the ticket system configuration panel'),
        ),

    new SlashCommandBuilder()
        .setName('close')
        .setDescription('Close the current ticket')
        .addStringOption(opt =>
            opt.setName('reason').setDescription('Reason for closing the ticket').setRequired(false),
        ),

    new SlashCommandBuilder()
        .setName('secretclose')
        .setDescription('Silently close the current ticket without notifying the user'),

    // ── Invite tracking commands ───────────────────────────────────────────────
    new SlashCommandBuilder()
        .setName('invites')
        .setDescription('Check invite count for a user')
        .addUserOption(opt =>
            opt.setName('user').setDescription('User to check (defaults to yourself)').setRequired(false),
        ),

    new SlashCommandBuilder()
        .setName('resetinvites')
        .setDescription('Reset a user\'s invite count')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addUserOption(opt =>
            opt.setName('user').setDescription('User to reset').setRequired(true),
        ),

    new SlashCommandBuilder()
        .setName('addinvites')
        .setDescription('Add bonus invites to a user\'s count')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addUserOption(opt =>
            opt.setName('user').setDescription('User to add invites to').setRequired(true),
        )
        .addIntegerOption(opt =>
            opt.setName('amount').setDescription('Amount of invites to add').setRequired(true),
        ),

    new SlashCommandBuilder()
        .setName('invitechannel')
        .setDescription('Set the channel for invite join messages')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addChannelOption(opt =>
            opt.setName('channel').setDescription('Channel for invite notifications').setRequired(true),
        ),

    new SlashCommandBuilder()
        .setName('leaderboard')
        .setDescription('Show the top 10 inviters in this server'),

    // ── Vouch commands ─────────────────────────────────────────────────────────
    new SlashCommandBuilder()
        .setName('vc')
        .setDescription('Send a vouch message to the ticket creator and assign the vc role (ticket channels only)')
        .addStringOption(opt =>
            opt.setName('timer').setDescription('Time before ticket auto-closes (e.g. 1m, 30m, 1h, 1hr, 1d)').setRequired(false),
        ),

    new SlashCommandBuilder()
        .setName('vouchchannel')
        .setDescription('Set the vouch channel')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addChannelOption(opt =>
            opt.setName('channel').setDescription('Channel for vouches').setRequired(true),
        ),

    new SlashCommandBuilder()
        .setName('vcrole')
        .setDescription('Set the role to give the ticket creator after the vouch flow')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addRoleOption(opt =>
            opt.setName('role').setDescription('Role to assign').setRequired(true),
        ),

    new SlashCommandBuilder()
        .setName('legit')
        .setDescription('Configure the legit react channel')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(sub =>
            sub.setName('channel')
                .setDescription('Set the channel where users react to confirm legitimacy')
                .addChannelOption(opt =>
                    opt.setName('channel').setDescription('The legit react channel').setRequired(true),
                ),
        ),

    new SlashCommandBuilder()
        .setName('reviewlink')
        .setDescription('Set the review link shown to users after vouching')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption(opt =>
            opt.setName('url').setDescription('The review URL (e.g. Trustpilot link)').setRequired(true),
        ),

    new SlashCommandBuilder()
        .setName('proof')
        .setDescription('Send a proof message showing vouch channel, legit channel, and review link'),

    // ── Automod commands ───────────────────────────────────────────────────────
    new SlashCommandBuilder()
        .setName('automod')
        .setDescription('Manage automod settings')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(sub =>
            sub.setName('setup')
                .setDescription('Create the Automod Bypass role and enable link/word filtering'),
        ),

    new SlashCommandBuilder()
        .setName('banword')
        .setDescription('Add a word to the banned words list')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption(opt =>
            opt.setName('word').setDescription('The word to ban').setRequired(true),
        ),

    new SlashCommandBuilder()
        .setName('unbanword')
        .setDescription('Remove a word from the banned words list')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption(opt =>
            opt.setName('word').setDescription('The word to unban').setRequired(true),
        ),

    // ── Sticky message commands ────────────────────────────────────────────────
    new SlashCommandBuilder()
        .setName('stick')
        .setDescription('Stick a message to the bottom of this channel')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
        .addStringOption(opt =>
            opt.setName('message').setDescription('Message to stick').setRequired(true),
        )
        .addBooleanOption(opt =>
            opt.setName('review').setDescription('Include a review button (requires /reviewlink to be set)').setRequired(false),
        ),

    new SlashCommandBuilder()
        .setName('unstick')
        .setDescription('Remove the sticky message from this channel')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

    new SlashCommandBuilder()
        .setName('vouches')
        .setDescription('Show the total number of vouches in the configured vouch channel')
        .addUserOption(opt =>
            opt.setName('user').setDescription('User to check vouches for (optional)').setRequired(false),
        ),

    // ── Embed builder command ──────────────────────────────────────────────────
    new SlashCommandBuilder()
        .setName('embed')
        .setDescription('Send a custom embed message to the current channel')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
        .addStringOption(opt =>
            opt.setName('title').setDescription('Embed title').setRequired(true),
        )
        .addStringOption(opt =>
            opt.setName('description').setDescription('Embed description').setRequired(false),
        )
        .addStringOption(opt =>
            opt.setName('color').setDescription('Hex color code (e.g. #FF0000) or name (red, green, blue, yellow)').setRequired(false),
        )
        .addStringOption(opt =>
            opt.setName('footer').setDescription('Footer text').setRequired(false),
        )
        .addStringOption(opt =>
            opt.setName('image').setDescription('Image URL').setRequired(false),
        )
        .addStringOption(opt =>
            opt.setName('thumbnail').setDescription('Thumbnail URL').setRequired(false),
        )
        .addStringOption(opt =>
            opt.setName('author').setDescription('Author name').setRequired(false),
        )
        .addStringOption(opt =>
            opt.setName('url').setDescription('Title URL').setRequired(false),
        ),

    new SlashCommandBuilder()
        .setName('maintenance')
        .setDescription('Toggle maintenance mode for stats/leader/claim commands')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
].map(cmd => cmd.toJSON());

// ─── Register commands with Discord ──────────────────────────────────────────

async function registerCommands() {
    const token = process.env.DISCORD_TOKEN;
    const clientId = process.env.CLIENT_ID;

    if (!token || !clientId) {
        console.warn(
            'DISCORD_TOKEN or CLIENT_ID is not set — skipping command registration.',
        );
        return;
    }

    const rest = new REST({ version: '10' }).setToken(token);
    try {
        console.log('Registering application (/) commands…');
        await rest.put(Routes.applicationCommands(clientId), { body: commands });
        console.log('Commands registered successfully.');
    } catch (err) {
        console.error('Failed to register commands:', err);
    }
}

// ─── Restock embed & button builder ──────────────────────────────────────────

const PRODUCT_API_URL =
    `${(process.env.BASE44_API_URL || 'https://app.base44.com').replace(/\/$/, '')}/api/apps/${process.env.BASE44_APP_ID || '698bba4e9e06a075e7c32be6'}/entities/Product`;

const SHOW_STOCK_BUTTON_ID = 'show_current_stock';
const ORDER_NOW_BUTTON_ID = 'order_now';
const UPDATESTOCK_SELECT_PREFIX = 'updatestock_select:';
const EDITPRODUCT_SELECT_PREFIX = 'editproduct_select:';
const VALUE_SEPARATOR = '::::';
const VERIFY_AUTH_BUTTON_ID = 'verify_auth_button';
const ORDER_POLL_INTERVAL_MS = 3 * 1000; // 3 seconds

function fetchCurrentStock() {
    return new Promise((resolve, reject) => {
        const apiUrl = new URL(PRODUCT_API_URL);
        const options = {
            hostname: apiUrl.hostname,
            path: apiUrl.pathname + apiUrl.search,
            method: 'GET',
            headers: {
                'api_key': STATS_API_KEY,
            },
        };

        const req = https.request(options, res => {
            if (res.statusCode < 200 || res.statusCode >= 300) {
                res.resume();
                reject(new Error(`Stock API returned status ${res.statusCode}`));
                return;
            }
            let data = '';
            res.on('data', chunk => {
                data += chunk;
            });
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (err) {
                    reject(new Error('Failed to parse stock API response'));
                }
            });
        });

        req.on('error', reject);
        req.end();
    });
}

function updateProductStock(productId, quantity) {
    return updateProduct(productId, { quantity });
}

/**
 * Updates one or more fields on a product record.
 *
 * @param {string} productId
 * @param {object} fields  – key/value pairs to update (e.g. { quantity: 5, price: 9.99 })
 * @returns {Promise<object>}
 */
function updateProduct(productId, fields) {
    return new Promise((resolve, reject) => {
        const apiUrl = new URL(`${PRODUCT_API_URL}/${encodeURIComponent(productId)}`);
        const body = JSON.stringify(fields);

        const options = {
            hostname: apiUrl.hostname,
            path: apiUrl.pathname,
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body),
                'api_key': STATS_API_KEY,
            },
        };

        const req = https.request(options, res => {
            if (res.statusCode < 200 || res.statusCode >= 300) {
                let errBody = '';
                res.on('data', chunk => { errBody += chunk; });
                res.on('end', () => {
                    reject(new Error(`Update API returned status ${res.statusCode}: ${errBody}`));
                });
                return;
            }
            let data = '';
            res.on('data', chunk => {
                data += chunk;
            });
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch {
                    resolve({});
                }
            });
        });

        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

/**
 * Creates a new product via the Base44 Product API.
 *
 * @param {object} fields  – product data (e.g. { name, category, description, price, quantity, image_url })
 * @returns {Promise<object>}
 */
function createProduct(fields) {
    return new Promise((resolve, reject) => {
        const apiUrl = new URL(PRODUCT_API_URL);
        const body = JSON.stringify(fields);

        const options = {
            hostname: apiUrl.hostname,
            path: apiUrl.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body),
                'api_key': STATS_API_KEY,
            },
        };

        const req = https.request(options, res => {
            if (res.statusCode < 200 || res.statusCode >= 300) {
                res.resume();
                reject(new Error(`Create Product API returned status ${res.statusCode}`));
                return;
            }
            let data = '';
            res.on('data', chunk => {
                data += chunk;
            });
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch {
                    resolve({});
                }
            });
        });

        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

// ─── Constants ────────────────────────────────────────────────────────────────

const BOT_OWNER_ID = process.env.BOT_OWNER_ID || '1456326972631154786';
const TRANSCRIPT_BUTTON_PREFIX = 'view_transcript:';
const TRANSCRIPT_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours
const AUDIT_LOG_MAX_AGE_MS = 10000; // 10 seconds — max age of audit log entry to match
const transcriptStore = new Map();

// Temporary store for /editproduct select-menu payloads (avoids Discord 100-char customId limit)
const pendingEdits = new Map();

// ─── Stats / Customer system ──────────────────────────────────────────────────

const BASE44_API_BASE_URL = process.env.BASE44_API_URL || 'https://app.base44.com';
const STATS_API_KEY = process.env.BASE44_API_KEY || '';
const BASE44_APP_ID = process.env.BASE44_APP_ID || '698bba4e9e06a075e7c32be6';

// Customer endpoint: /api/apps/{APP_ID}/entities/Customer
const CUSTOMER_API_URL = `${BASE44_API_BASE_URL.replace(/\/$/, '')}/api/apps/${BASE44_APP_ID}/entities/Customer`;

/**
 * Formats a date string into a readable format (e.g., "Mar 11, 2026").
 * Returns "N/A" if the value is null, undefined, or empty.
 *
 * @param {string|null|undefined} dateStr
 * @returns {string}
 */
function formatDate(dateStr) {
    if (!dateStr) return 'N/A';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return 'N/A';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * Calculates loyalty points from total amount spent.
 * Every $1 spent = 0.1 loyalty points, max 100.
 * (Requires $1,000 spent to reach the maximum of 100 points.)
 *
 * @param {number} totalSpent
 * @returns {number}
 */
function calcLoyaltyPoints(totalSpent) {
    return Math.min(100, Math.round(totalSpent * 0.1 * 10) / 10);
}

/**
 * Builds a visual progress bar using Unicode block characters (20 segments wide).
 * Renders as a clean single-line bar that works well on mobile.
 *
 * @param {number} points  0–100
 * @returns {string}
 */
function buildLoyaltyBar(points) {
    const TOTAL_WIDTH = 20;
    const filled = Math.round((points / 100) * TOTAL_WIDTH);
    const empty = TOTAL_WIDTH - filled;
    return '█'.repeat(filled) + '░'.repeat(empty);
}

const TIERS = [
    { name: 'Diamond',  color: 0xB9F2FF, emoji: '💎', minSpent: 500 },
    { name: 'Platinum', color: 0xE5E4E2, emoji: '🏆', minSpent: 200 },
    { name: 'Gold',     color: 0xFFD700, emoji: '🥇', minSpent: 75  },
    { name: 'Silver',   color: 0xC0C0C0, emoji: '🥈', minSpent: 25  },
    { name: 'Bronze',   color: 0xCD7F32, emoji: '🥉', minSpent: 1   },
    { name: 'Unranked', color: 0x808080, emoji: '🔘', minSpent: 0   },
];

function getTier(totalSpent) {
    for (const tier of TIERS) {
        if (totalSpent >= tier.minSpent) return tier;
    }
    return TIERS[TIERS.length - 1]; // Unranked
}

// Simple in-memory cache to avoid hammering the API
const statsCache = new Map();
const STATS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Fetches customer data for a given Discord username from the Base44 Customer API.
 *
 * @param {string} discordUsername
 * @returns {Promise<object|null>}  Customer record or null if not found
 */
function fetchCustomerData(discordUsername) {
    return new Promise((resolve, reject) => {
        if (!BASE44_APP_ID) {
            reject(new Error('BASE44_APP_ID is not configured'));
            return;
        }

        if (!STATS_API_KEY) {
            reject(new Error('BASE44_API_KEY is not configured'));
            return;
        }

        let urlObj;
        try {
            urlObj = new URL(CUSTOMER_API_URL);
        } catch {
            reject(new Error('Customer API URL is not valid'));
            return;
        }

        urlObj.searchParams.set('discord_username', discordUsername);

        const reqOptions = {
            hostname: urlObj.hostname,
            path: urlObj.pathname + urlObj.search,
            method: 'GET',
            headers: {
                'api_key': STATS_API_KEY,
                'Content-Type': 'application/json',
            },
        };

        https
            .get(reqOptions, res => {
                if (res.statusCode < 200 || res.statusCode >= 300) {
                    res.resume();
                    reject(new Error(`Customer API returned status ${res.statusCode}`));
                    return;
                }
                let raw = '';
                res.on('data', chunk => { raw += chunk; });
                res.on('end', () => {
                    try {
                        const data = JSON.parse(raw);
                        const results = Array.isArray(data) ? data : (data.results ?? data.items ?? []);
                        resolve(results.length > 0 ? results[0] : null);
                    } catch {
                        reject(new Error('Failed to parse Customer API response'));
                    }
                });
            })
            .on('error', reject);
    });
}

/**
 * Fetches customer data for a given Minecraft username from the Base44 Customer API.
 *
 * @param {string} mcUsername
 * @returns {Promise<object|null>}  Customer record or null if not found
 */
function fetchCustomerByMinecraft(mcUsername) {
    return new Promise((resolve, reject) => {
        if (!BASE44_APP_ID) {
            reject(new Error('BASE44_APP_ID is not configured'));
            return;
        }

        if (!STATS_API_KEY) {
            reject(new Error('BASE44_API_KEY is not configured'));
            return;
        }

        let urlObj;
        try {
            urlObj = new URL(CUSTOMER_API_URL);
        } catch {
            reject(new Error('Customer API URL is not valid'));
            return;
        }

        urlObj.searchParams.set('minecraft_username', mcUsername);

        const reqOptions = {
            hostname: urlObj.hostname,
            path: urlObj.pathname + urlObj.search,
            method: 'GET',
            headers: {
                'api_key': STATS_API_KEY,
                'Content-Type': 'application/json',
            },
        };

        https
            .get(reqOptions, res => {
                if (res.statusCode < 200 || res.statusCode >= 300) {
                    res.resume();
                    reject(new Error(`Customer API returned status ${res.statusCode}`));
                    return;
                }
                let raw = '';
                res.on('data', chunk => { raw += chunk; });
                res.on('end', () => {
                    try {
                        const data = JSON.parse(raw);
                        const results = Array.isArray(data) ? data : (data.results ?? data.items ?? []);
                        resolve(results.length > 0 ? results[0] : null);
                    } catch {
                        reject(new Error('Failed to parse Customer API response'));
                    }
                });
            })
            .on('error', reject);
    });
}

/**
 * Fetches all customer records from the Base44 Customer API (no filter).
 *
 * @returns {Promise<object[]>}  Array of all customer records
 */
function fetchAllCustomers() {
    return new Promise((resolve, reject) => {
        if (!BASE44_APP_ID) {
            reject(new Error('BASE44_APP_ID is not configured'));
            return;
        }

        if (!STATS_API_KEY) {
            reject(new Error('BASE44_API_KEY is not configured'));
            return;
        }

        let urlObj;
        try {
            urlObj = new URL(CUSTOMER_API_URL);
        } catch {
            reject(new Error('Customer API URL is not valid'));
            return;
        }

        const reqOptions = {
            hostname: urlObj.hostname,
            path: urlObj.pathname + urlObj.search,
            method: 'GET',
            headers: {
                'api_key': STATS_API_KEY,
                'Content-Type': 'application/json',
            },
        };

        https
            .get(reqOptions, res => {
                if (res.statusCode < 200 || res.statusCode >= 300) {
                    res.resume();
                    reject(new Error(`Customer API returned status ${res.statusCode}`));
                    return;
                }
                let raw = '';
                res.on('data', chunk => { raw += chunk; });
                res.on('end', () => {
                    try {
                        const data = JSON.parse(raw);
                        const results = Array.isArray(data) ? data : (data.results ?? data.items ?? []);
                        resolve(results);
                    } catch {
                        reject(new Error('Failed to parse Customer API response'));
                    }
                });
            })
            .on('error', reject);
    });
}

// Order endpoint: /api/apps/{APP_ID}/entities/Order
const ORDER_API_URL = `${BASE44_API_BASE_URL.replace(/\/$/, '')}/api/apps/${BASE44_APP_ID}/entities/Order`;

/**
 * Returns the date value from an order object, checking multiple known field names.
 *
 * @param {object} order
 * @returns {number}  Timestamp in ms (0 if no date found)
 */
function getOrderDate(order) {
    const raw = order._created ?? order.created_date ?? order.order_date ?? order.created_at ?? null;
    if (!raw) return 0;
    const ts = new Date(raw).getTime();
    return isNaN(ts) ? 0 : ts;
}

/**
 * Returns the monetary amount from an order object, checking multiple known field names.
 *
 * @param {object} order
 * @returns {number|null}
 */
function getOrderAmount(order) {
    const val = order.amount_total ?? order.total ?? order.amount ?? order.order_total ?? null;
    return typeof val === 'number' ? val : null;
}

/**
 * Fetches orders for a given Minecraft username from the Base44 Order API.
 *
 * @param {string} mcUsername
 * @returns {Promise<object[]>}  Array of order objects
 */
function fetchOrdersByMinecraft(mcUsername) {
    return new Promise((resolve, reject) => {
        if (!BASE44_APP_ID) {
            reject(new Error('BASE44_APP_ID is not configured'));
            return;
        }

        if (!STATS_API_KEY) {
            reject(new Error('BASE44_API_KEY is not configured'));
            return;
        }

        let urlObj;
        try {
            urlObj = new URL(ORDER_API_URL);
        } catch {
            reject(new Error('Order API URL is not valid'));
            return;
        }

        urlObj.searchParams.set('minecraft_username', mcUsername);

        const reqOptions = {
            hostname: urlObj.hostname,
            path: urlObj.pathname + urlObj.search,
            method: 'GET',
            headers: {
                'api_key': STATS_API_KEY,
                'Content-Type': 'application/json',
            },
        };

        https
            .get(reqOptions, res => {
                if (res.statusCode < 200 || res.statusCode >= 300) {
                    res.resume();
                    reject(new Error(`Order API returned status ${res.statusCode}`));
                    return;
                }
                let raw = '';
                res.on('data', chunk => { raw += chunk; });
                res.on('end', () => {
                    try {
                        const data = JSON.parse(raw);
                        const results = Array.isArray(data) ? data : (data.results ?? data.items ?? []);
                        resolve(results);
                    } catch {
                        reject(new Error('Failed to parse Order API response'));
                    }
                });
            })
            .on('error', reject);
    });
}

/**
 * Fetches orders for a given Discord username from the Base44 Order API.
 *
 * @param {string} discordUsername
 * @returns {Promise<object[]>}  Array of order objects
 */
function fetchOrdersByDiscordUsername(discordUsername) {
    return new Promise((resolve, reject) => {
        if (!BASE44_APP_ID) {
            reject(new Error('BASE44_APP_ID is not configured'));
            return;
        }

        if (!STATS_API_KEY) {
            reject(new Error('BASE44_API_KEY is not configured'));
            return;
        }

        let urlObj;
        try {
            urlObj = new URL(ORDER_API_URL);
        } catch {
            reject(new Error('Order API URL is not valid'));
            return;
        }

        urlObj.searchParams.set('discord_username', discordUsername);

        const reqOptions = {
            hostname: urlObj.hostname,
            path: urlObj.pathname + urlObj.search,
            method: 'GET',
            headers: {
                'api_key': STATS_API_KEY,
                'Content-Type': 'application/json',
            },
        };

        https
            .get(reqOptions, res => {
                if (res.statusCode < 200 || res.statusCode >= 300) {
                    res.resume();
                    reject(new Error(`Order API returned status ${res.statusCode}`));
                    return;
                }
                let raw = '';
                res.on('data', chunk => { raw += chunk; });
                res.on('end', () => {
                    try {
                        const data = JSON.parse(raw);
                        const results = Array.isArray(data) ? data : (data.results ?? data.items ?? []);
                        resolve(results);
                    } catch {
                        reject(new Error('Failed to parse Order API response'));
                    }
                });
            })
            .on('error', reject);
    });
}

/**
 * Computes aggregated stats from an array of order objects.
 *
 * @param {object[]} orders
 * @param {string} discordUsername
 * @returns {object}  Synthesized customer-like object with order_count, total_spent, first_purchase_date, last_purchase_date
 */
function computeStatsFromOrders(orders, discordUsername) {
    let totalSpent = 0;
    let orderCount = 0;
    let firstDate = Infinity;
    let lastDate = 0;

    for (const order of orders) {
        const amount = getOrderAmount(order);
        if (amount !== null) {
            totalSpent += amount;
        }
        orderCount++;
        const ts = getOrderDate(order);
        if (ts > 0) {
            if (ts < firstDate) firstDate = ts;
            if (ts > lastDate) lastDate = ts;
        }
    }

    return {
        discord_username: discordUsername,
        order_count: orderCount,
        total_spent: totalSpent,
        first_purchase_date: firstDate !== Infinity ? new Date(firstDate).toISOString() : null,
        last_purchase_date: lastDate > 0 ? new Date(lastDate).toISOString() : null,
    };
}

/**
 * Fetches all orders from the Base44 Order API (no filter).
 *
 * @returns {Promise<object[]>}  Array of all order records
 */
function fetchAllOrders() {
    return new Promise((resolve, reject) => {
        if (!BASE44_APP_ID) {
            reject(new Error('BASE44_APP_ID is not configured'));
            return;
        }

        if (!STATS_API_KEY) {
            reject(new Error('BASE44_API_KEY is not configured'));
            return;
        }

        let urlObj;
        try {
            urlObj = new URL(ORDER_API_URL);
        } catch {
            reject(new Error('Order API URL is not valid'));
            return;
        }

        const reqOptions = {
            hostname: urlObj.hostname,
            path: urlObj.pathname + urlObj.search,
            method: 'GET',
            headers: {
                'api_key': STATS_API_KEY,
                'Content-Type': 'application/json',
            },
        };

        https
            .get(reqOptions, res => {
                if (res.statusCode < 200 || res.statusCode >= 300) {
                    res.resume();
                    reject(new Error(`Order API returned status ${res.statusCode}`));
                    return;
                }
                let raw = '';
                res.on('data', chunk => { raw += chunk; });
                res.on('end', () => {
                    try {
                        const data = JSON.parse(raw);
                        const results = Array.isArray(data) ? data : (data.results ?? data.items ?? []);
                        resolve(results);
                    } catch {
                        reject(new Error('Failed to parse Order API response'));
                    }
                });
            })
            .on('error', reject);
    });
}

/**
 * Updates the discord_username field on a customer record.
 *
 * @param {string} customerId
 * @param {string} discordUsername
 * @returns {Promise<object>}
 */
function updateCustomerDiscordUsername(customerId, discordUsername) {
    return new Promise((resolve, reject) => {
        const apiUrl = new URL(`${CUSTOMER_API_URL}/${encodeURIComponent(customerId)}`);
        const body = JSON.stringify({ discord_username: discordUsername });

        const options = {
            hostname: apiUrl.hostname,
            path: apiUrl.pathname,
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body),
                'api_key': STATS_API_KEY,
            },
        };

        const req = https.request(options, res => {
            if (res.statusCode < 200 || res.statusCode >= 300) {
                let errBody = '';
                res.on('data', chunk => { errBody += chunk; });
                res.on('end', () => {
                    reject(new Error(`Customer API returned status ${res.statusCode}: ${errBody}`));
                });
                return;
            }
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch {
                    resolve({});
                }
            });
        });

        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

function buildStatsEmbed(customer, discordMember) {
    const username = discordMember ? discordMember.user.username : (customer.discord_username || 'Unknown');
    const avatarUrl = discordMember
        ? discordMember.user.displayAvatarURL({ size: 128 })
        : null;

    const orderCount = typeof customer.order_count === 'number' ? customer.order_count : 0;
    const totalSpent = typeof customer.total_spent === 'number' ? customer.total_spent : 0;

    const tier = getTier(totalSpent);
    const points = calcLoyaltyPoints(totalSpent);
    const bar = buildLoyaltyBar(points);
    const separator = '─'.repeat(30);

    const embed = new EmbedBuilder()
        .setColor(tier.color)
        .setTitle(`${tier.emoji} Profile — ${username}`)
        .setDescription(`🟡 **Loyalty Points: ${points % 1 === 0 ? points : points.toFixed(1)}/100**\n\`${bar}\`\n${separator}`)
        .addFields(
            {
                name: '🏅 Standing',
                value: [
                    `**Rank:** ${tier.emoji} ${tier.name}`,
                    `**Total Spent:** $${totalSpent.toFixed(2)}`,
                    `**Orders:** ${orderCount}`,
                ].join('\n'),
                inline: true,
            },
            {
                name: '📈 Activity',
                value: [
                    `**First Purchase:** ${formatDate(customer.first_purchase_date)}`,
                    `**Last Purchase:** ${formatDate(customer.last_purchase_date)}`,
                ].join('\n'),
                inline: true,
            },
        )
        .setFooter({ text: 'DonutDemand Bot' })
        .setTimestamp();

    if (avatarUrl) {
        embed.setThumbnail(avatarUrl);
    }

    return embed;
}

function buildRestockEmbed(product, quantity) {
    const now = new Date();

    return new EmbedBuilder()
        .setColor(0x1E1F22)
        .setTitle('🔔 Product Restocked!')
        .setDescription(
            `**${product}** is back in stock and ready to purchase!`,
        )
        .addFields(
            {
                name: '📦 Product',
                value: product,
                inline: true,
            },
            {
                name: '✅ Status',
                value: '`Available Now` • `Restocked`',
                inline: true,
            },
            {
                name: '🗃️ Stock',
                value: `**${quantity}** unit${quantity !== 1 ? 's' : ''} available`,
                inline: true,
            },
        )
        .setFooter({
            text: `Restocked at ${now.toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
                hour12: true,
            })}`,
        })
        .setTimestamp(now);
}

function buildActionButtons() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(SHOW_STOCK_BUTTON_ID)
            .setLabel('Show Current Stock')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('📦'),
        new ButtonBuilder()
            .setCustomId(ORDER_NOW_BUTTON_ID)
            .setLabel('Order Now')
            .setStyle(ButtonStyle.Success)
            .setEmoji('🛒'),
    );
}

// ─── Order notification helpers ───────────────────────────────────────────────

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
            {
                name: 'Order',
                value: `${quantity}x ${productName}`,
                inline: false,
            },
            {
                name: 'Price Paid',
                value: pricePaid,
                inline: true,
            },
            {
                name: 'Minecraft Username',
                value: `\`${minecraftUsername}\``,
                inline: true,
            },
            {
                name: 'Discord Username',
                value: `\`${discordUsername}\``,
                inline: true,
            },
        )
        .setTimestamp();

    if (discountCode) {
        embed.addFields({
            name: 'Discount Code',
            value: `\`${discountCode}\``,
            inline: true,
        });
    }

    return embed;
}

function buildOrderButtons(orderId) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`order_delivered:${orderId}`)
            .setLabel('✅ Delivered')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId(`order_review:${orderId}`)
            .setLabel('🔍 Needs Review')
            .setStyle(ButtonStyle.Danger),
    );
}

// ─── Order polling system ─────────────────────────────────────────────────────

let orderPollInterval = null;
const seenOrderIds = new Set();

async function seedSeenOrderIds() {
    let orders;
    try {
        orders = await fetchAllOrders();
    } catch (err) {
        console.error('seedSeenOrderIds error:', err);
        return;
    }

    let dirty = false;
    for (const order of orders) {
        const orderId = String(order._id ?? order.id ?? '');
        if (!orderId) continue;
        if (!seenOrderIds.has(orderId)) {
            seenOrderIds.add(orderId);
            dirty = true;
        }
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
        for (const id of config.seenOrderIds) {
            seenOrderIds.add(String(id));
        }
    }

    // Seed all existing orders as "seen" before starting to poll
    await seedSeenOrderIds();

    if (orderPollInterval) clearInterval(orderPollInterval);
    orderPollInterval = setInterval(pollOrders, ORDER_POLL_INTERVAL_MS);
}

async function pollOrders() {
    const config = loadConfig();
    const channelId = config.orderChannelId;
    if (!channelId) return;

    let orders;
    try {
        orders = await fetchAllOrders();
    } catch (err) {
        console.error('Order poll error:', err);
        return;
    }

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

            // Invalidate stats cache for this user so /stats reflects the new order
            const orderDiscordUser = order.discord_username ?? order.discord_user ?? order.discord_name ?? null;
            if (orderDiscordUser) {
                statsCache.delete(orderDiscordUser.toLowerCase());
            }
        } catch (err) {
            console.error('Failed to post order notification:', err);
        }
    }

    if (dirty) {
        const freshConfig = loadConfig();
        freshConfig.seenOrderIds = [...seenOrderIds];
        saveConfig(freshConfig);
    }
}



const leaderboardCache = new Map();
const LEADERBOARD_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const LEADERBOARD_UPDATE_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
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
        const spent = (c.total_spent || 0).toLocaleString('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        });
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
    try {
        customers = await fetchAllCustomers();
    } catch (err) {
        console.error('Leaderboard update failed:', err);
        return;
    }

    const embed = buildLeaderboardEmbed(customers);
    if (!embed) return;

    const messageId = config.leaderboardMessageId;
    if (messageId) {
        try {
            const msg = await channel.messages.fetch(messageId);
            await msg.edit({ embeds: [embed] });
            return;
        } catch {
            // Message not found — send a new one below
        }
    }

    try {
        const msg = await channel.send({ embeds: [embed] });
        config.leaderboardMessageId = msg.id;
        saveConfig(config);
    } catch (err) {
        console.error('Failed to send leaderboard:', err);
    }
}

function startLeaderboardInterval() {
    if (leaderboardInterval) clearInterval(leaderboardInterval);
    leaderboardInterval = setInterval(updateLeaderboard, LEADERBOARD_UPDATE_INTERVAL_MS);
    updateLeaderboard();
}

// ─── Timezone system ──────────────────────────────────────────────────────────

const TIMEZONE_UPDATE_INTERVAL_MS = 10 * 1000; // 10 seconds
let timezoneInterval = null;

/**
 * Parses a time string into { hours, minutes } in 24-hour format.
 * Supports formats like "10:32am", "2:15pm", "14:30", "2:15 PM".
 *
 * @param {string} timeStr
 * @returns {{ hours: number, minutes: number }|null}
 */
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
        const timeStr = staffTime.toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
            timeZone: 'UTC',
        });
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
        } catch {
            // Message not found — send new one
        }
    }

    try {
        const msg = await channel.send({ embeds: [embed] });
        config.timezoneMessageId = msg.id;
        saveConfig(config);
    } catch (err) {
        console.error('Failed to send timezone display:', err);
    }
}

function startTimezoneInterval() {
    if (timezoneInterval) clearInterval(timezoneInterval);
    timezoneInterval = setInterval(updateTimezoneDisplay, TIMEZONE_UPDATE_INTERVAL_MS);
    updateTimezoneDisplay();
}

// ─── Giveaway System ─────────────────────────────────────────────────────────

const GIVEAWAYS_PATH = path.join(__dirname, 'giveaways.json');

function loadGiveaways() {
    if (!fs.existsSync(GIVEAWAYS_PATH)) return {};
    try {
        return JSON.parse(fs.readFileSync(GIVEAWAYS_PATH, 'utf8'));
    } catch {
        return {};
    }
}

function saveGiveaways(data) {
    fs.writeFileSync(GIVEAWAYS_PATH, JSON.stringify(data, null, 2), 'utf8');
}

const activeGiveawayTimers = new Map(); // giveawayId → setTimeout handle

function parseDuration(str) {
    const match = str.trim().match(/^(\d+)(s|m|h|d)$/i);
    if (!match) return null;
    const n = parseInt(match[1], 10);
    const unit = match[2].toLowerCase();
    const multipliers = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
    return n * multipliers[unit];
}

function buildGiveawayEmbed(giveaway) {
    const endTimeSec = Math.floor(giveaway.endTime / 1000);
    const requirements = [];
    if (giveaway.minInvites > 0) requirements.push(`📨 Minimum **${giveaway.minInvites}** invites`);
    if (giveaway.requiredRoleId) requirements.push(`🏷️ Must have <@&${giveaway.requiredRoleId}> role`);

    return new EmbedBuilder()
        .setColor(0xFEE75C)
        .setTitle('🎉 GIVEAWAY 🎉')
        .setDescription(
            `**Prize:** ${giveaway.prize}\n\n` +
            `Click the 🎉 button below to enter!\n\n` +
            `**Ends:** <t:${endTimeSec}:R> (<t:${endTimeSec}:f>)\n` +
            (requirements.length > 0 ? `\n**Requirements:**\n${requirements.join('\n')}\n` : '') +
            `\n**Hosted by:** <@${giveaway.hostId}>`,
        )
        .addFields(
            { name: '🏆 Winners', value: `${giveaway.winners}`, inline: true },
            { name: '👥 Entries', value: `${giveaway.participants.length}`, inline: true },
        )
        .setFooter({ text: `Giveaway ID: ${giveaway.id}` })
        .setTimestamp(giveaway.endTime);
}

function buildGiveawayEndedEmbed(giveaway, winnerIds) {
    return new EmbedBuilder()
        .setColor(winnerIds.length > 0 ? 0x57F287 : 0xED4245)
        .setTitle('🎉 GIVEAWAY ENDED 🎉')
        .setDescription(
            `**Prize:** ${giveaway.prize}\n\n` +
            (winnerIds.length > 0
                ? `🏆 **Winner${winnerIds.length > 1 ? 's' : ''}:** ${winnerIds.map(w => `<@${w}>`).join(', ')}`
                : '😔 No eligible participants entered.'),
        )
        .addFields(
            { name: '🏆 Winners', value: `${giveaway.winners}`, inline: true },
            { name: '👥 Total Entries', value: `${giveaway.participants.length}`, inline: true },
        )
        .setFooter({ text: `Hosted by: ${giveaway.hostId}` })
        .setTimestamp();
}

async function pickGiveawayWinners(giveaway, guild) {
    if (giveaway.participants.length === 0) return [];
    const eligible = [];
    for (const userId of giveaway.participants) {
        let pass = true;
        if (giveaway.requiredRoleId) {
            try {
                const member = await guild.members.fetch(userId);
                if (!member.roles.cache.has(giveaway.requiredRoleId)) pass = false;
            } catch {
                pass = false;
            }
        }
        if (pass && giveaway.minInvites > 0) {
            const invData = loadInvites();
            const guildData = invData[guild.id] || {};
            const userInv = (guildData.users || {})[userId] || {};
            const total = (userInv.real || 0) + (userInv.bonus || 0) - (userInv.left || 0);
            if (total < giveaway.minInvites) pass = false;
        }
        if (pass) eligible.push(userId);
    }
    const pool = [...eligible];
    const winners = [];
    const count = Math.min(giveaway.winners, pool.length);
    for (let i = 0; i < count; i++) {
        const idx = Math.floor(Math.random() * pool.length);
        winners.push(pool[idx]);
        pool[idx] = pool[pool.length - 1];
        pool.pop();
    }
    return winners;
}

async function endGiveaway(giveawayId) {
    const giveaways = loadGiveaways();
    const giveaway = giveaways[giveawayId];
    if (!giveaway || giveaway.ended) return;

    giveaway.ended = true;

    if (activeGiveawayTimers.has(giveawayId)) {
        clearTimeout(activeGiveawayTimers.get(giveawayId));
        activeGiveawayTimers.delete(giveawayId);
    }

    try {
        const guild = await client.guilds.fetch(giveaway.guildId);
        const channel = await client.channels.fetch(giveaway.channelId);
        const message = await channel.messages.fetch(giveaway.messageId);
        const winnerIds = await pickGiveawayWinners(giveaway, guild);
        giveaway.winnerIds = winnerIds;

        const endEmbed = buildGiveawayEndedEmbed(giveaway, winnerIds);
        await message.edit({ embeds: [endEmbed], components: [] });

        if (winnerIds.length > 0) {
            await channel.send({
                content: `🎉 Congratulations ${winnerIds.map(w => `<@${w}>`).join(', ')}! You won **${giveaway.prize}**!`,
            });
        } else {
            await channel.send({ content: `😔 No eligible winners for **${giveaway.prize}**.` });
        }
    } catch (err) {
        console.error(`Failed to end giveaway ${giveawayId}:`, err);
    }

    saveGiveaways(giveaways);
}

function scheduleGiveaway(giveawayId) {
    const giveaways = loadGiveaways();
    const giveaway = giveaways[giveawayId];
    if (!giveaway || giveaway.ended) return;
    const delay = Math.max(0, giveaway.endTime - Date.now());
    const timer = setTimeout(() => endGiveaway(giveawayId), delay);
    activeGiveawayTimers.set(giveawayId, timer);
}

function reloadGiveawayTimers() {
    const giveaways = loadGiveaways();
    for (const [id, giveaway] of Object.entries(giveaways)) {
        if (!giveaway.ended) scheduleGiveaway(id);
    }
}

// ─── Invite Tracking System ───────────────────────────────────────────────────

const INVITES_PATH = path.join(__dirname, 'invites.json');

function loadInvites() {
    if (!fs.existsSync(INVITES_PATH)) return {};
    try {
        return JSON.parse(fs.readFileSync(INVITES_PATH, 'utf8'));
    } catch {
        return {};
    }
}

function saveInvites(data) {
    fs.writeFileSync(INVITES_PATH, JSON.stringify(data, null, 2), 'utf8');
}

// Cache of invite uses per guild: guildId → Map(inviteCode → uses)
const guildInviteCache = new Map();

async function cacheGuildInvites(guild) {
    try {
        const invites = await guild.invites.fetch();
        const cache = new Map();
        invites.forEach(inv => cache.set(inv.code, inv.uses || 0));
        guildInviteCache.set(guild.id, cache);
    } catch (err) {
        console.error(`Failed to cache invites for ${guild.id}:`, err);
    }
}

// Helper: HTTP request for invite API calls
function inviteApiRequest(method, url, body) {
    return new Promise((resolve, reject) => {
        const parsedUrl = new URL(url);
        const options = {
            hostname: parsedUrl.hostname,
            port: parsedUrl.port || 443,
            path: parsedUrl.pathname + parsedUrl.search,
            method,
            headers: {
                'Content-Type': 'application/json',
                'api_key': STATS_API_KEY,
            },
        };
        if (body) options.headers['Content-Length'] = Buffer.byteLength(body);
        const req = https.request(options, res => {
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => resolve({ status: res.statusCode, body: data }));
        });
        req.on('error', reject);
        if (body) req.write(body);
        req.end();
    });
}

// ─── Ticket Panel System ──────────────────────────────────────────────────────

// Generate a short unique ID for ticket types
function genId() {
    return Math.random().toString(36).slice(2, 8);
}

const BUTTON_STYLE_MAP = {
    'Primary': ButtonStyle.Primary,
    'Secondary': ButtonStyle.Secondary,
    'Success': ButtonStyle.Success,
    'Danger': ButtonStyle.Danger,
};

const BUTTON_STYLE_LABELS = {
    'Primary': '🔵 Blurple',
    'Secondary': '⚪ Grey',
    'Success': '🟢 Green',
    'Danger': '🔴 Red',
};

function getTicketConfig(guildId) {
    const config = loadConfig();
    if (!config.ticketConfig) config.ticketConfig = {};
    if (!config.ticketConfig[guildId]) config.ticketConfig[guildId] = { types: [] };
    return config.ticketConfig[guildId];
}

function saveTicketConfig(guildId, tConf) {
    const config = loadConfig();
    if (!config.ticketConfig) config.ticketConfig = {};
    config.ticketConfig[guildId] = tConf;
    saveConfig(config);
}

function getOpenTickets(guildId) {
    const config = loadConfig();
    if (!config.openTickets) config.openTickets = {};
    if (!config.openTickets[guildId]) config.openTickets[guildId] = {};
    return config.openTickets[guildId];
}

function saveOpenTickets(guildId, tickets) {
    const config = loadConfig();
    if (!config.openTickets) config.openTickets = {};
    config.openTickets[guildId] = tickets;
    saveConfig(config);
}

function countUserOpenTickets(guildId, userId) {
    const tickets = getOpenTickets(guildId);
    return Object.values(tickets).filter(t => t.userId === userId).length;
}

function buildTicketPanelSettingsEmbed(guildId) {
    const tConf = getTicketConfig(guildId);
    const types = tConf.types || [];
    const lines = types.length > 0
        ? types.map((t, i) => `**${i + 1}.** ${t.name} — ${t.questions.length} question(s), ${t.viewableRoles.length} role(s), ${BUTTON_STYLE_LABELS[t.buttonStyle] || BUTTON_STYLE_LABELS['Primary']}`)
        : ['No ticket types configured yet. Add one below!'];
    const panelTitle = tConf.panelTitle || '🎫 Support Tickets';
    const panelDesc = tConf.panelDescription || 'Click a button below to open a ticket.';
    return new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('🎫 Ticket Panel Configuration')
        .setDescription('Manage your ticket types below. Configure each type\'s name, category, questions, and viewable roles.')
        .addFields(
            { name: 'Current Ticket Types', value: lines.join('\n') },
            { name: '📝 Panel Title', value: panelTitle, inline: true },
            { name: '📝 Panel Description', value: panelDesc, inline: true },
        )
        .setFooter({ text: 'Select a type to configure it, or add a new one.' });
}

function buildTypeConfigEmbed(type) {
    const roleStr = type.viewableRoles.length > 0
        ? type.viewableRoles.map(r => `<@&${r}>`).join(', ')
        : 'None';
    const qStr = type.questions.length > 0
        ? type.questions.map((q, i) => `${i + 1}. ${q}`).join('\n')
        : 'No questions set.';
    const colorLabel = BUTTON_STYLE_LABELS[type.buttonStyle] || BUTTON_STYLE_LABELS['Primary'];
    return new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle(`⚙️ Configuring: ${type.name}`)
        .addFields(
            { name: '🗂️ Category', value: type.categoryId ? `<#${type.categoryId}>` : 'Not set', inline: true },
            { name: '👁️ Viewable Roles', value: roleStr, inline: true },
            { name: '🎨 Button Color', value: colorLabel, inline: true },
            { name: '❓ Questions', value: qStr },
        )
        .setFooter({ text: `Type ID: ${type.id}` });
}

function buildTicketSettingsComponents(guildId) {
    const tConf = getTicketConfig(guildId);
    const types = tConf.types || [];

    const selectOptions = types.slice(0, 24).map(t =>
        new StringSelectMenuOptionBuilder()
            .setLabel(t.name.slice(0, 100))
            .setValue(t.id)
            .setDescription(`${t.questions.length} question(s)`),
    );
    selectOptions.unshift(
        new StringSelectMenuOptionBuilder()
            .setLabel('➕ Add New Ticket Type')
            .setValue('__add_new__')
            .setDescription('Create a new ticket type'),
    );

    const select = new StringSelectMenuBuilder()
        .setCustomId('tp_main_select')
        .setPlaceholder('Select a ticket type to configure...')
        .addOptions(selectOptions);

    const postBtn = new ButtonBuilder()
        .setCustomId('tp_post_panel')
        .setLabel('📋 Post Ticket Panel')
        .setStyle(ButtonStyle.Success);

    const editPanelBtn = new ButtonBuilder()
        .setCustomId('tp_edit_panel')
        .setLabel('✏️ Edit Panel Text')
        .setStyle(ButtonStyle.Primary);

    return [
        new ActionRowBuilder().addComponents(select),
        new ActionRowBuilder().addComponents(postBtn, editPanelBtn),
    ];
}

function buildTypeConfigComponents(typeId) {
    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`tp_cfg_name:${typeId}`).setLabel('✏️ Edit Name').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`tp_cfg_category:${typeId}`).setLabel('🗂️ Set Category').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`tp_cfg_questions:${typeId}`).setLabel('❓ Set Questions').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`tp_cfg_color:${typeId}`).setLabel('🎨 Button Color').setStyle(ButtonStyle.Primary),
    );
    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`tp_cfg_roles:${typeId}`).setLabel('👁️ Set Viewable Roles').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`tp_cfg_delete:${typeId}`).setLabel('🗑️ Delete Type').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('tp_cfg_back').setLabel('← Back').setStyle(ButtonStyle.Secondary),
    );
    return [row1, row2];
}

// ─── Settings dashboard helpers ───────────────────────────────────────────────

const SETTINGS_DEFS = [
    { key: 'notificationChannelId', label: '📣 Restock Channel', type: 'channel', description: 'Channel for restock notifications' },
    { key: 'notificationRoleId', label: '🔔 Restock Ping Role', type: 'role', description: 'Role to ping for restocks' },
    { key: 'leaderboardChannelId', label: '🏆 Leaderboard Channel', type: 'channel', description: 'Auto-updating leaderboard channel' },
    { key: 'orderChannelId', label: '🛒 Order Channel', type: 'channel', description: 'New order notifications channel' },
    { key: 'paidChannelId', label: '✅ Delivered Orders Channel', type: 'channel', description: 'Delivered orders channel' },
    { key: 'reviewChannelId', label: '🔍 Review Queue Channel', type: 'channel', description: 'Orders needing review channel' },
    { key: 'timezoneChannelId', label: '🕐 Staff Timezone Channel', type: 'channel', description: 'Live staff times channel' },
    { key: 'vouchChannel', label: '📋 Vouch Channel', type: 'channel', description: 'Vouch requests channel' },
    { key: 'vcRole', label: '🏅 VC Role', type: 'role', description: 'Role assigned after vouch flow' },
    { key: 'legitChannel', label: '✔️ Legit React Channel', type: 'channel', description: 'Legit confirmation reacts channel' },
    { key: 'reviewLink', label: '⭐ Review Link', type: 'url', description: 'External review link (e.g. Trustpilot)' },
    { key: '__inviteChannel', label: '📨 Invite Notification Channel', type: 'channel', description: 'Invite join messages channel' },
];

function buildSettingsDashboardEmbed(guildId) {
    const config = loadConfig();
    const invData = loadInvites();
    const fields = SETTINGS_DEFS.map(def => {
        let val;
        if (def.key === '__inviteChannel') {
            const gd = invData[guildId] || {};
            val = gd.inviteChannel ? `<#${gd.inviteChannel}>` : '*Not set*';
        } else if (def.type === 'channel') {
            val = config[def.key] ? `<#${config[def.key]}>` : '*Not set*';
        } else if (def.type === 'role') {
            val = config[def.key] ? `<@&${config[def.key]}>` : '*Not set*';
        } else {
            val = config[def.key] ? config[def.key] : '*Not set*';
        }
        return { name: def.label, value: val, inline: true };
    });
    return new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('⚙️ Bot Settings Dashboard')
        .setDescription('Select a setting from the dropdown below to edit it. Changes take effect immediately.')
        .addFields(fields)
        .setFooter({ text: 'Tip: Use /ticket panel to configure the ticket system.' });
}

function buildSettingsDashboardComponents() {
    const options = SETTINGS_DEFS.map(def =>
        new StringSelectMenuOptionBuilder()
            .setLabel(def.label)
            .setValue(def.key)
            .setDescription(def.description),
    );
    const select = new StringSelectMenuBuilder()
        .setCustomId('settings_main_select')
        .setPlaceholder('Choose a setting to edit…')
        .addOptions(options);
    return [new ActionRowBuilder().addComponents(select)];
}

// In-memory map for pending vc timers: ticketChannelId -> { creatorId, guildId, timer }
const vcTimers = new Map();

// ─── Duration parser for /vc timer option ─────────────────────────────────────
function parseVcDuration(str) {
    if (!str) return null;
    const match = str.trim().toLowerCase().match(/^(\d+)\s*(m|min|mins|h|hr|hrs|hour|hours|d|day|days)$/);
    if (!match) return null;
    const num = parseInt(match[1], 10);
    const unit = match[2];
    if (unit.startsWith('d')) return num * 24 * 60 * 60 * 1000;
    if (unit.startsWith('h')) return num * 60 * 60 * 1000;
    return num * 60 * 1000;
}

// ─── Vouch channel name auto-update interval ──────────────────────────────────
let vouchNameInterval = null;

async function updateVouchChannelName() {
    try {
        const config = loadConfig();
        const vouchChannelId = config.vouchChannel;
        if (!vouchChannelId) return;

        for (const guild of client.guilds.cache.values()) {
            const channel = await guild.channels.fetch(vouchChannelId).catch(() => null);
            if (!channel) continue;
            const count = await countChannelMessages(channel);
            const newName = `vouches│${count}`;
            if (channel.name !== newName) {
                await channel.setName(newName).catch(err => console.error('Failed to update vouch channel name:', err));
            }
            break;
        }
    } catch (err) {
        console.error('Error updating vouch channel name:', err);
    }
}

function startVouchChannelNameInterval() {
    if (vouchNameInterval) clearInterval(vouchNameInterval);
    updateVouchChannelName();
    vouchNameInterval = setInterval(updateVouchChannelName, 5 * 60 * 1000);
}

// ─── Discord client ───────────────────────────────────────────────────────────

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildInvites,
    ],
});

client.once('ready', async () => {
    console.log(`Bot is ready! Logged in as ${client.user.tag}`);
    const config = loadConfig();
    if (config.leaderboardChannelId) {
        startLeaderboardInterval();
    }
    if (config.timezoneChannelId) {
        startTimezoneInterval();
    }
    if (config.orderChannelId) {
        startOrderPolling();
    }
    // Start vouch channel name auto-update interval
    startVouchChannelNameInterval();
    // Reload active giveaway timers
    reloadGiveawayTimers();
    // Cache guild invites for invite tracking
    await Promise.all([...client.guilds.cache.values()].map(guild => cacheGuildInvites(guild)));

    // Live invite count sync to Base44 every 60 seconds
    setInterval(async () => {
        if (!BASE44_APP_ID || !STATS_API_KEY) return;
        const INVITE_API_URL = `${BASE44_API_BASE_URL.replace(/\/$/, '')}/api/apps/${BASE44_APP_ID}/entities/Invite`;
        const invData = loadInvites();

        // Collect all user entries to sync
        const syncEntries = [];
        for (const [guildId, guildData] of Object.entries(invData)) {
            if (!guildData.users) continue;
            const guild = client.guilds.cache.get(guildId);
            for (const [userId, counts] of Object.entries(guildData.users)) {
                syncEntries.push({ guildId, guild, userId, counts });
            }
        }

        // Process entries sequentially to avoid hammering the API
        for (const { guildId, guild, userId, counts } of syncEntries) {
            const total = (counts.real || 0) + (counts.bonus || 0) - (counts.left || 0);
            let username = userId;
            try {
                const member = guild ? await guild.members.fetch(userId).catch(() => null) : null;
                if (member) username = member.user.username;
                else {
                    const user = await client.users.fetch(userId).catch(() => null);
                    if (user) username = user.username;
                }
            } catch { /* ignore */ }

            const payload = JSON.stringify({
                discord_user_id: userId,
                discord_username: username,
                invite_count: total,
                guild_id: guildId,
            });

            const getUrl = new URL(INVITE_API_URL);
            getUrl.searchParams.set('discord_user_id', userId);
            getUrl.searchParams.set('guild_id', guildId);

            try {
                const getRes = await inviteApiRequest('GET', getUrl.toString(), null);
                if (getRes.status === 200) {
                    let records = [];
                    try { records = JSON.parse(getRes.body); } catch { records = []; }
                    if (Array.isArray(records) && records.length > 0) {
                        const recordId = records[0]._id || records[0].id;
                        if (recordId) {
                            await inviteApiRequest('PUT', `${INVITE_API_URL}/${recordId}`, payload);
                        } else {
                            await inviteApiRequest('POST', INVITE_API_URL, payload);
                        }
                    } else {
                        await inviteApiRequest('POST', INVITE_API_URL, payload);
                    }
                }
            } catch (err) {
                console.error(`Invite sync error for user ${userId}:`, err.message);
            }
        }
    }, 60_000);
});

client.on('interactionCreate', async interaction => {
    // ── Button: View Transcript ──────────────────────────────────────────────
    if (interaction.isButton() && interaction.customId.startsWith(TRANSCRIPT_BUTTON_PREFIX)) {
        const transcriptId = interaction.customId.slice(TRANSCRIPT_BUTTON_PREFIX.length);
        const transcript = transcriptStore.get(transcriptId);

        if (!transcript) {
            await interaction.reply({ content: '❌ Transcript expired or not found.', ephemeral: true });
            return;
        }

        await interaction.reply({
            files: [{
                attachment: Buffer.from(transcript.content, 'utf-8'),
                name: `transcript-${transcript.channelName}-${transcriptId}.txt`,
            }],
            ephemeral: true,
        });
        return;
    }

    // ── Button: Show Current Stock ───────────────────────────────────────────
    if (interaction.isButton() && interaction.customId === SHOW_STOCK_BUTTON_ID) {
        await interaction.deferReply({ ephemeral: true });

        let products;
        try {
            products = await fetchCurrentStock();
        } catch (err) {
            console.error('Stock API error:', err);
            await interaction.editReply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0xED4245)
                        .setTitle('❌ API Unreachable')
                        .setDescription(
                            'Could not fetch current stock data. Please try again later.',
                        ),
                ],
            });
            return;
        }

        if (!Array.isArray(products) || products.length === 0) {
            await interaction.editReply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0xFEE75C)
                        .setTitle('📦 Current Stock')
                        .setDescription('No products found in the inventory.'),
                ],
            });
            return;
        }

        const inStockProducts = products.filter(p => {
            const qty = p.quantity ?? p.stock ?? p.qty;
            return typeof qty === 'number' ? qty > 0 : true;
        });

        if (inStockProducts.length === 0) {
            await interaction.editReply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0xFEE75C)
                        .setTitle('📦 Current Stock')
                        .setDescription('No items are currently in stock.'),
                ],
            });
            return;
        }

        const stockLines = inStockProducts
            .map(p => {
                const name = p.name || p.title || p.product_name || 'Unknown Product';
                const qty = p.quantity ?? p.stock ?? p.qty ?? '—';
                return `• **${name}** — ${qty} unit${qty === 1 ? '' : 's'}`;
            })
            .join('\n');

        const stockEmbed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle('📦 Current Stock Levels')
            .setDescription(stockLines)
            .setTimestamp();

        try {
            await interaction.user.send({ embeds: [stockEmbed] });
            await interaction.editReply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0x57F287)
                        .setTitle('✅ Stock List Sent')
                        .setDescription('Check your DMs for the current stock list!'),
                ],
            });
        } catch {
            await interaction.editReply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0xED4245)
                        .setTitle('❌ Could Not Send DM')
                        .setDescription(
                            'I was unable to DM you. Please enable DMs from server members and try again.',
                        ),
                ],
            });
        }
        return;
    }

    // ── Button: Order Now ────────────────────────────────────────────────────
    if (interaction.isButton() && interaction.customId === ORDER_NOW_BUTTON_ID) {
        await interaction.deferReply({ ephemeral: true });

        try {
            await interaction.user.send('Order at https://donutdemand.net');
            await interaction.editReply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0x57F287)
                        .setTitle('✅ Order Link Sent')
                        .setDescription('Check your DMs for the order link!'),
                ],
            });
        } catch {
            await interaction.editReply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0xED4245)
                        .setTitle('❌ Could Not Send DM')
                        .setDescription(
                            'I was unable to DM you. Please enable DMs from server members and try again.',
                        ),
                ],
            });
        }
        return;
    }

    // ── Button: Verify Auth ──────────────────────────────────────────────────
    if (interaction.isButton() && interaction.customId === VERIFY_AUTH_BUTTON_ID) {
        const userId = interaction.user.id;
        const config = loadConfig();
        if (!config.authorizedUsers) config.authorizedUsers = {};
        if (!config.authorizedUsers[userId]) {
            config.authorizedUsers[userId] = { authorizedAt: new Date().toISOString() };
            saveConfig(config);
        }
        await interaction.reply({
            content: '✅ You have been verified! Your account is now linked to the bot.',
            ephemeral: true,
        });
        return;
    }

    // ── Select Menu: Update Stock ────────────────────────────────────────────
    if (
        interaction.isStringSelectMenu() &&
        interaction.customId.startsWith(UPDATESTOCK_SELECT_PREFIX)
    ) {
        await interaction.deferReply({ ephemeral: true });

        const quantityStr = interaction.customId.slice(UPDATESTOCK_SELECT_PREFIX.length);
        const quantity = parseInt(quantityStr, 10);
        const selectedValue = interaction.values[0];

        // Value is encoded as "<productId><VALUE_SEPARATOR><productName>" – split on first occurrence
        const separatorIdx = selectedValue.indexOf(VALUE_SEPARATOR);
        const productId = separatorIdx !== -1
            ? selectedValue.slice(0, separatorIdx)
            : selectedValue;
        const productName = separatorIdx !== -1
            ? selectedValue.slice(separatorIdx + VALUE_SEPARATOR.length)
            : selectedValue;

        try {
            await updateProductStock(productId, quantity);
        } catch (err) {
            console.error('Update stock API error:', err);
            await interaction.editReply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0xED4245)
                        .setTitle('❌ Update Failed')
                        .setDescription(
                            'Could not update the stock. Please try again later.',
                        ),
                ],
            });
            return;
        }

        await interaction.editReply({
            embeds: [
                new EmbedBuilder()
                    .setColor(0x57F287)
                    .setTitle('✅ Stock Updated')
                    .setDescription(
                        `**${productName}** stock has been set to **${quantity}** unit${quantity !== 1 ? 's' : ''}.`,
                    ),
            ],
        });
        return;
    }

    // ── Select Menu: Edit Product ────────────────────────────────────────────
    if (
        interaction.isStringSelectMenu() &&
        interaction.customId.startsWith(EDITPRODUCT_SELECT_PREFIX)
    ) {
        await interaction.deferReply({ ephemeral: true });

        // customId = "editproduct_select:<editKey>"
        const editKey = interaction.customId.slice(EDITPRODUCT_SELECT_PREFIX.length);
        const editData = pendingEdits.get(editKey);

        if (!editData) {
            await interaction.editReply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0xED4245)
                        .setTitle('❌ Edit Expired')
                        .setDescription('This edit session has expired. Please run `/editproduct` again.'),
                ],
            });
            return;
        }

        pendingEdits.delete(editKey);
        const { field, value: rawValue } = editData;

        const selectedValue = interaction.values[0];
        const separatorIdx = selectedValue.indexOf(VALUE_SEPARATOR);
        const productId = separatorIdx !== -1
            ? selectedValue.slice(0, separatorIdx)
            : selectedValue;
        const productName = separatorIdx !== -1
            ? selectedValue.slice(separatorIdx + VALUE_SEPARATOR.length)
            : selectedValue;

        // Convert value to proper type for numeric fields
        let parsedValue = rawValue;
        if (field === 'price') {
            parsedValue = parseFloat(rawValue);
            if (isNaN(parsedValue) || parsedValue < 0) {
                await interaction.editReply({
                    embeds: [
                        new EmbedBuilder()
                            .setColor(0xED4245)
                            .setTitle('❌ Invalid Price')
                            .setDescription('Price must be a valid positive number.'),
                    ],
                });
                return;
            }
        } else if (field === 'quantity') {
            parsedValue = parseInt(rawValue, 10);
            if (isNaN(parsedValue) || parsedValue < 0) {
                await interaction.editReply({
                    embeds: [
                        new EmbedBuilder()
                            .setColor(0xED4245)
                            .setTitle('❌ Invalid Quantity')
                            .setDescription('Quantity must be a valid non-negative integer.'),
                    ],
                });
                return;
            }
        }

        const fieldLabels = {
            name: 'Name',
            price: 'Price',
            quantity: 'Quantity',
            category: 'Category',
            description: 'Description',
            image_url: 'Image URL',
        };

        try {
            await updateProduct(productId, { [field]: parsedValue });
        } catch (err) {
            console.error('Edit product API error:', err);
            await interaction.editReply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0xED4245)
                        .setTitle('❌ Update Failed')
                        .setDescription(
                            'Could not update the product. Please try again later.',
                        ),
                ],
            });
            return;
        }

        const displayValue = field === 'price' ? `$${parsedValue}` : String(parsedValue);

        await interaction.editReply({
            embeds: [
                new EmbedBuilder()
                    .setColor(0x57F287)
                    .setTitle('✅ Product Updated')
                    .setDescription(
                        `**${productName}** — **${fieldLabels[field] || field}** has been set to **${displayValue}**.`,
                    ),
            ],
        });
        return;
    }

    // ── Button: Order Delivered ──────────────────────────────────────────────
    if (interaction.isButton() && interaction.customId.startsWith('order_delivered:')) {
        await interaction.deferUpdate();

        const config = loadConfig();
        const paidChannelId = config.paidChannelId;

        if (!paidChannelId) {
            await interaction.followUp({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0xED4245)
                        .setTitle('❌ No Delivered Channel Set')
                        .setDescription('Please run `/paid channel` first to configure the delivered orders channel.'),
                ],
                ephemeral: true,
            });
            return;
        }

        const paidChannel = await interaction.client.channels.fetch(paidChannelId).catch(() => null);
        if (!paidChannel) {
            await interaction.followUp({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0xED4245)
                        .setTitle('❌ Channel Not Found')
                        .setDescription('The configured delivered orders channel could not be found.'),
                ],
                ephemeral: true,
            });
            return;
        }

        const originalEmbed = interaction.message.embeds[0];
        const updatedEmbed = EmbedBuilder.from(originalEmbed)
            .setColor(0x57F287)
            .setTitle('✅ Order Delivered');

        try {
            await paidChannel.send({ embeds: [updatedEmbed] });
            await interaction.message.delete().catch(() => {}); // message may already be deleted
        } catch (err) {
            console.error('Failed to move order to delivered channel:', err);
        }
        return;
    }

    // ── Button: Order Needs Review ───────────────────────────────────────────
    if (interaction.isButton() && interaction.customId.startsWith('order_review:')) {
        await interaction.deferUpdate();

        const config = loadConfig();
        const reviewChannelId = config.reviewChannelId;

        if (!reviewChannelId) {
            await interaction.followUp({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0xED4245)
                        .setTitle('❌ No Review Channel Set')
                        .setDescription('Please run `/review channel` first to configure the review orders channel.'),
                ],
                ephemeral: true,
            });
            return;
        }

        const reviewChannel = await interaction.client.channels.fetch(reviewChannelId).catch(() => null);
        if (!reviewChannel) {
            await interaction.followUp({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0xED4245)
                        .setTitle('❌ Channel Not Found')
                        .setDescription('The configured review channel could not be found.'),
                ],
                ephemeral: true,
            });
            return;
        }

        const originalEmbed = interaction.message.embeds[0];
        const updatedEmbed = EmbedBuilder.from(originalEmbed)
            .setColor(0xFEE75C)
            .setTitle('🔍 Order Needs Review');

        try {
            await reviewChannel.send({ embeds: [updatedEmbed] });
            await interaction.message.delete().catch(() => {}); // message may already be deleted
        } catch (err) {
            console.error('Failed to move order to review channel:', err);
        }
        return;
    }

    if (!(interaction.isChatInputCommand() || interaction.isButton() || interaction.isStringSelectMenu() || interaction.isModalSubmit() || interaction.isChannelSelectMenu() || interaction.isRoleSelectMenu())) return;

    // /help
    if (interaction.commandName === 'help') {
        const helpEmbed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle('📋 Bot Commands')
            .setDescription('Here is a list of all available commands. Slash commands use `/`, prefix commands use `!`.')
            .addFields(
                {
                    name: '🎫 Ticket System',
                    value: '`/ticket panel` — Configure ticket types, categories, questions, and role visibility\n`/close [reason]` — Close the current ticket\n`/secretclose` — Silently close the current ticket\n`/add` — Add a user to the current ticket\n`/operation start` / `/operation cancel` — Manage ticket operations',
                    inline: false,
                },
                {
                    name: '🎉 Giveaway System',
                    value: '`/giveaway start prize:<p> duration:<d> winners:<n> [channel] [min_invites] [required_role]` — Start a giveaway\n`/giveaway end [message_id]` — End a giveaway early\n`/giveaway reroll [message_id]` — Reroll a giveaway winner',
                    inline: false,
                },
                {
                    name: '📨 Invite System',
                    value: '`/invites [user]` — Check invite count\n`/addinvites user:<@> amount:<n>` — Add bonus invites\n`/resetinvites user:<@>` — Reset invite count\n`/invitechannel channel:<#>` — Set invite join message channel\n`/leaderboard` — Show top 10 inviters',
                    inline: false,
                },
                {
                    name: '✅ Vouches',
                    value: '`/vouches` / `!vouches` — Show total vouch count\n`/vc [timer]` — Send vouch message (timer: `1m`, `1h`, `1d`)\n`/vouchchannel channel:<#>` — Set the vouch channel\n`/vcrole role:<@>` — Set the vc role\n`/legit channel:<#>` — Set the legit react channel\n`/reviewlink url:<url>` — Set the review link\n`/proof` — Show proof of legitimacy (vouches, legit, review)',
                    inline: false,
                },
                {
                    name: '📌 Sticky Messages',
                    value: '`/stick message:<text>` — Stick a message to the bottom of this channel\n`/unstick` — Remove the sticky message from this channel',
                    inline: false,
                },
                {
                    name: '📊 Stats & Loyalty',
                    value: '`/stats view user:<@>` — View loyalty profile & order history\n`/stats private` — Make your stats private\n`/stats public` — Make your stats public\n`/claim minecraft_username:<name> amount:<$>` — Link Discord to purchase history\n`/leader` — Top 10 spenders leaderboard',
                    inline: false,
                },
                {
                    name: '🛒 Store Management',
                    value: '`/restock product:<name> quantity:<n>` — Send restock notification\n`/addproduct name price quantity [category] [description] [image_url]` — Add a product\n`/editproduct field:<f> value:<v>` — Edit a product field\n`/updatestock quantity:<n>` — Update product stock',
                    inline: false,
                },
                {
                    name: '⚙️ Settings',
                    value: '`/settings` — Open the unified settings dashboard (channels, roles, links, and more)\n`/ticket panel` — Configure the ticket panel (types, categories, questions, roles)',
                    inline: false,
                },
                {
                    name: '🕐 Timezone',
                    value: '`/timezone set current_time:<time> timezone:<tz>` — Set your timezone for the staff clock\n`/timezone channel channel:<#>` — Set the live staff times channel',
                    inline: false,
                },
                {
                    name: '📢 Announcements',
                    value: '`/announce message:<text> [role:<@>]` — DM all members (or role members) an announcement',
                    inline: false,
                },
                {
                    name: '🛡️ Moderation',
                    value: '`!ban @user [reason]` — Ban a user\n`!kick @user [reason]` — Kick a user\n`!mute @user <duration> [reason]` — Timeout a user (e.g. `10m`, `1h`, `1d`)\n`!purge <1-100>` — Bulk delete messages',
                    inline: false,
                },
                {
                    name: '🤖 Automod',
                    value: '`/automod setup` — Create the Automod Bypass role and enable filtering\n`/banword word` — Add a banned word\n`/unbanword word` — Remove a banned word',
                    inline: false,
                },
                {
                    name: '📨 Embed Builder',
                    value: '`/embed title [description] [color] [footer] [image] [thumbnail] [author] [url]` — Send a custom embed',
                    inline: false,
                },
                {
                    name: '🤖 Bot Control',
                    value: '`/sync` — Re-sync slash commands\n`/setup-verify` — Post verification button\n`/help` / `!help` — Show this command list',
                    inline: false,
                },
                {
                    name: '🧮 Calculator',
                    value: '`!calc <expression>` — Calculate math (supports `+`, `-`, `x`, `/`, `^`, parentheses)',
                    inline: false,
                },
                {
                    name: '🔒 Owner Only',
                    value: '`?auth` — Show authorized user count\n`?pull <server_id>` — Pull authorized users to a server',
                    inline: false,
                },
            )
            .setFooter({ text: 'Use /settings to configure channels before running /restock.' })
            .setTimestamp();

        await interaction.reply({ embeds: [helpEmbed], ephemeral: true });
        return;
    }

    // /settings — main dashboard
    if (interaction.commandName === 'settings') {
        const embed = buildSettingsDashboardEmbed(interaction.guild.id);
        const components = buildSettingsDashboardComponents();
        await interaction.reply({ embeds: [embed], components, ephemeral: true });
        return;
    }

    // ── Select: Settings main select ──────────────────────────────────────────
    if (interaction.isStringSelectMenu() && interaction.customId === 'settings_main_select') {
        const key = interaction.values[0];
        const def = SETTINGS_DEFS.find(d => d.key === key);
        if (!def) { await interaction.reply({ content: '❌ Unknown setting.', ephemeral: true }); return; }

        if (def.type === 'channel') {
            const chSelect = new ChannelSelectMenuBuilder()
                .setCustomId(`settings_ch_select:${key}`)
                .setPlaceholder(`Select a channel for ${def.label}…`);
            const backBtn = new ButtonBuilder()
                .setCustomId('settings_back')
                .setLabel('← Back to Settings')
                .setStyle(ButtonStyle.Secondary);
            await interaction.update({
                content: `**Editing: ${def.label}**\n${def.description}`,
                embeds: [],
                components: [
                    new ActionRowBuilder().addComponents(chSelect),
                    new ActionRowBuilder().addComponents(backBtn),
                ],
            });
        } else if (def.type === 'role') {
            const roleSelect = new RoleSelectMenuBuilder()
                .setCustomId(`settings_role_select:${key}`)
                .setPlaceholder(`Select a role for ${def.label}…`);
            const backBtn = new ButtonBuilder()
                .setCustomId('settings_back')
                .setLabel('← Back to Settings')
                .setStyle(ButtonStyle.Secondary);
            await interaction.update({
                content: `**Editing: ${def.label}**\n${def.description}`,
                embeds: [],
                components: [
                    new ActionRowBuilder().addComponents(roleSelect),
                    new ActionRowBuilder().addComponents(backBtn),
                ],
            });
        } else {
            // URL type — show modal
            const config = loadConfig();
            const currentVal = config[key] || '';
            const modal = new ModalBuilder()
                .setCustomId(`settings_modal:${key}`)
                .setTitle(`Edit: ${def.label}`);
            const input = new TextInputBuilder()
                .setCustomId('value')
                .setLabel(def.description)
                .setStyle(TextInputStyle.Short)
                .setRequired(false)
                .setPlaceholder('Enter a URL (leave blank to clear)')
                .setValue(currentVal);
            modal.addComponents(new ActionRowBuilder().addComponents(input));
            await interaction.showModal(modal);
        }
        return;
    }

    // ── Channel select: Settings ───────────────────────────────────────────────
    if (interaction.isChannelSelectMenu() && interaction.customId.startsWith('settings_ch_select:')) {
        const key = interaction.customId.slice('settings_ch_select:'.length);
        const def = SETTINGS_DEFS.find(d => d.key === key);
        const channelId = interaction.values[0];

        if (key === '__inviteChannel') {
            const invData = loadInvites();
            if (!invData[interaction.guild.id]) invData[interaction.guild.id] = { users: {} };
            invData[interaction.guild.id].inviteChannel = channelId;
            saveInvites(invData);
        } else {
            const config = loadConfig();
            config[key] = channelId;
            if (key === 'leaderboardChannelId') config.leaderboardMessageId = null;
            if (key === 'timezoneChannelId') delete config.timezoneMessageId;
            saveConfig(config);
            if (key === 'leaderboardChannelId') startLeaderboardInterval();
            if (key === 'timezoneChannelId') startTimezoneInterval();
            if (key === 'orderChannelId') await startOrderPolling();
        }

        const embed = buildSettingsDashboardEmbed(interaction.guild.id);
        const components = buildSettingsDashboardComponents();
        await interaction.update({
            content: `✅ **${def ? def.label : key}** updated to <#${channelId}>.`,
            embeds: [embed],
            components,
        });
        return;
    }

    // ── Role select: Settings ──────────────────────────────────────────────────
    if (interaction.isRoleSelectMenu() && interaction.customId.startsWith('settings_role_select:')) {
        const key = interaction.customId.slice('settings_role_select:'.length);
        const def = SETTINGS_DEFS.find(d => d.key === key);
        const roleId = interaction.values[0];
        const config = loadConfig();
        config[key] = roleId;
        saveConfig(config);
        const embed = buildSettingsDashboardEmbed(interaction.guild.id);
        const components = buildSettingsDashboardComponents();
        await interaction.update({
            content: `✅ **${def ? def.label : key}** updated to <@&${roleId}>.`,
            embeds: [embed],
            components,
        });
        return;
    }

    // ── Modal: Settings URL value ──────────────────────────────────────────────
    if (interaction.isModalSubmit() && interaction.customId.startsWith('settings_modal:')) {
        const key = interaction.customId.slice('settings_modal:'.length);
        const def = SETTINGS_DEFS.find(d => d.key === key);
        const value = interaction.fields.getTextInputValue('value').trim();
        const config = loadConfig();
        if (value) {
            config[key] = value;
        } else {
            delete config[key];
        }
        saveConfig(config);
        const embed = buildSettingsDashboardEmbed(interaction.guild.id);
        const components = buildSettingsDashboardComponents();
        await interaction.reply({
            content: value
                ? `✅ **${def ? def.label : key}** updated.`
                : `🗑️ **${def ? def.label : key}** cleared.`,
            embeds: [embed],
            components,
            ephemeral: true,
        });
        return;
    }

    // ── Button: Settings back ──────────────────────────────────────────────────
    if (interaction.isButton() && interaction.customId === 'settings_back') {
        const embed = buildSettingsDashboardEmbed(interaction.guild.id);
        const components = buildSettingsDashboardComponents();
        await interaction.update({ content: null, embeds: [embed], components });
        return;
    }

    // /restock
    if (interaction.commandName === 'restock') {
        const config = loadConfig();
        const channelId = config.notificationChannelId;

        if (!channelId) {
            await interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0xED4245)
                        .setTitle('❌ No Notification Channel Set')
                        .setDescription(
                            'Please run `/settings` first to configure the notification channel.',
                        ),
                ],
                ephemeral: true,
            });
            return;
        }

        const product = interaction.options.getString('product');
        const quantity = interaction.options.getInteger('quantity');

        const notifChannel = await interaction.client.channels.fetch(channelId).catch(() => null);
        if (!notifChannel) {
            await interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0xED4245)
                        .setTitle('❌ Channel Not Found')
                        .setDescription(
                            'The configured notification channel could not be found. Please run `/settings` again.',
                        ),
                ],
                ephemeral: true,
            });
            return;
        }

        const embed = buildRestockEmbed(product, quantity);
        const row = buildActionButtons();

        const roleId = config.notificationRoleId;
        const content = roleId ? `<@&${roleId}>` : undefined;

        await notifChannel.send({ content, embeds: [embed], components: [row] });

        await interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setColor(0x57F287)
                    .setTitle('✅ Restock Notification Sent')
                    .setDescription(`Notification sent to <#${channelId}>.`),
            ],
            ephemeral: true,
        });
    }

    // /announce
    if (interaction.commandName === 'announce') {
        const message = interaction.options.getString('message');
        const targetRole = interaction.options.getRole('role');

        await interaction.deferReply({ ephemeral: true });

        let members;
        try {
            members = await interaction.guild.members.fetch();
        } catch (err) {
            console.error('Failed to fetch guild members:', err);
            await interaction.editReply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0xED4245)
                        .setTitle('❌ Failed to Fetch Members')
                        .setDescription('Could not retrieve server members. Please try again later.'),
                ],
            });
            return;
        }

        let targets = [...members.values()].filter(m => !m.user.bot);
        if (targetRole) {
            targets = targets.filter(m => m.roles.cache.has(targetRole.id));
        }
        const total = targets.length;

        const scopeLabel = targetRole
            ? `members with role <@&${targetRole.id}>`
            : 'all members';

        const statusMessage = await interaction.channel.send(
            `📢 Announcement in progress... Sent to 0/${total} ${scopeLabel}`,
        );

        const announceEmbed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle('📢 Server Announcement')
            .setDescription(message)
            .setFooter({ text: `From ${interaction.guild.name}` })
            .setTimestamp();

        let sent = 0;
        let failed = 0;
        const DM_DELAY_MS = 1000;
        const MAX_RETRIES = 3;
        const RATE_LIMIT_BUFFER_MS = 500;

        for (let i = 0; i < targets.length; i++) {
            const member = targets[i];
            let retries = 0;
            let success = false;
            while (retries < MAX_RETRIES && !success) {
                try {
                    await member.user.send({ embeds: [announceEmbed] });
                    success = true;
                    sent++;
                } catch (err) {
                    // Handle Discord rate-limit responses (HTTP 429)
                    const retryAfter = err?.rawError?.retry_after ?? err?.retry_after;
                    if (retryAfter) {
                        const waitMs = Math.ceil(retryAfter * 1000) + RATE_LIMIT_BUFFER_MS;
                        console.warn(`Rate limited — waiting ${waitMs}ms before retrying…`);
                        await new Promise(resolve => setTimeout(resolve, waitMs));
                        retries++;
                    } else {
                        // DMs disabled or other non-recoverable error
                        failed++;
                        break;
                    }
                }
            }
            if (!success && retries >= MAX_RETRIES) {
                failed++;
            }

            await statusMessage.edit(
                `📢 Announcement in progress... Sent to ${sent}/${total} ${scopeLabel}`,
            );

            // Respectful delay between DMs to avoid triggering spam detection
            // Skip delay after the last member
            if (i < targets.length - 1) {
                await new Promise(resolve => setTimeout(resolve, DM_DELAY_MS));
            }
        }

        await statusMessage.edit(
            `✅ Announcement sent to ${sent}/${total} ${scopeLabel}${failed > 0 ? ` (${failed} could not be reached)` : ''}`,
        );

        await interaction.editReply({
            embeds: [
                new EmbedBuilder()
                    .setColor(0x57F287)
                    .setTitle('✅ Announcement Sent')
                    .setDescription(
                        `Announcement delivered to **${sent}** member${sent !== 1 ? 's' : ''}${failed > 0 ? ` (${failed} could not be reached)` : ''}.`,
                    ),
            ],
        });
    }

    // /updatestock
    if (interaction.commandName === 'updatestock') {
        const quantity = interaction.options.getInteger('quantity');

        await interaction.deferReply({ ephemeral: true });

        let products;
        try {
            products = await fetchCurrentStock();
        } catch (err) {
            console.error('Stock API error:', err);
            await interaction.editReply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0xED4245)
                        .setTitle('❌ API Unreachable')
                        .setDescription(
                            'Could not fetch products from the inventory. Please try again later.',
                        ),
                ],
            });
            return;
        }

        if (!Array.isArray(products) || products.length === 0) {
            await interaction.editReply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0xFEE75C)
                        .setTitle('📦 No Products Found')
                        .setDescription('No products were found in the inventory.'),
                ],
            });
            return;
        }

        // Discord select menus support at most 25 options
        const productSlice = products.slice(0, 25);

        const options = productSlice.map(p => {
            const name = p.name || p.title || p.product_name || 'Unknown Product';
            const id = String(p._id || p.id || name);
            const label = name.length > 100 ? name.slice(0, 100) : name;
            // Encode as "<id><VALUE_SEPARATOR><name>". Ensure the ID and separator are
            // never truncated by trimming only the name portion to stay within 100 chars.
            const maxNameLen = 100 - id.length - VALUE_SEPARATOR.length;
            const value = maxNameLen > 0
                ? `${id}${VALUE_SEPARATOR}${name.slice(0, maxNameLen)}`
                : id.slice(0, 100);
            return new StringSelectMenuOptionBuilder()
                .setLabel(label)
                .setValue(value);
        });

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId(`${UPDATESTOCK_SELECT_PREFIX}${quantity}`)
            .setPlaceholder('Select a product to update…')
            .addOptions(options);

        const row = new ActionRowBuilder().addComponents(selectMenu);

        await interaction.editReply({
            embeds: [
                new EmbedBuilder()
                    .setColor(0x5865F2)
                    .setTitle('📦 Update Stock')
                    .setDescription(
                        `Select a product below to set its stock to **${quantity}** unit${quantity !== 1 ? 's' : ''}.` +
                        (products.length > 25 ? `\n\n⚠️ Only the first 25 of ${products.length} products are shown.` : ''),
                    ),
            ],
            components: [row],
        });
    }

    // /addproduct
    if (interaction.commandName === 'addproduct') {
        await interaction.deferReply({ ephemeral: true });

        const name = interaction.options.getString('name');
        const price = interaction.options.getNumber('price');
        const quantity = interaction.options.getInteger('quantity');
        const category = interaction.options.getString('category') || '';
        const description = interaction.options.getString('description') || '';
        const image_url = interaction.options.getString('image_url') || '';

        const productData = { name, price, quantity };
        if (category) productData.category = category;
        if (description) productData.description = description;
        if (image_url) productData.image_url = image_url;

        try {
            const created = await createProduct(productData);
            const productId = created._id || created.id || 'N/A';

            const embed = new EmbedBuilder()
                .setColor(0x57F287)
                .setTitle('✅ Product Created')
                .setDescription(`**${name}** has been added to the store.`)
                .addFields(
                    { name: 'Price', value: `$${price.toFixed(2)}`, inline: true },
                    { name: 'Quantity', value: `${quantity}`, inline: true },
                );
            if (category) embed.addFields({ name: 'Category', value: category, inline: true });
            if (description) embed.addFields({ name: 'Description', value: description, inline: false });
            if (image_url) embed.setThumbnail(image_url);
            embed.setFooter({ text: `Product ID: ${productId}` });

            await interaction.editReply({ embeds: [embed] });
        } catch (err) {
            console.error('Create product API error:', err);
            await interaction.editReply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0xED4245)
                        .setTitle('❌ Product Creation Failed')
                        .setDescription(
                            'Could not create the product. Please try again later.',
                        ),
                ],
            });
        }
    }

    // /editproduct
    if (interaction.commandName === 'editproduct') {
        const field = interaction.options.getString('field');
        const rawValue = interaction.options.getString('value');

        await interaction.deferReply({ ephemeral: true });

        let products;
        try {
            products = await fetchCurrentStock();
        } catch (err) {
            console.error('Stock API error:', err);
            await interaction.editReply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0xED4245)
                        .setTitle('❌ API Unreachable')
                        .setDescription(
                            'Could not fetch products from the inventory. Please try again later.',
                        ),
                ],
            });
            return;
        }

        if (!Array.isArray(products) || products.length === 0) {
            await interaction.editReply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0xFEE75C)
                        .setTitle('📦 No Products Found')
                        .setDescription('No products were found in the inventory.'),
                ],
            });
            return;
        }

        // Discord select menus support at most 25 options
        const productSlice = products.slice(0, 25);

        const options = productSlice.map(p => {
            const name = p.name || p.title || p.product_name || 'Unknown Product';
            const id = String(p._id || p.id || name);
            const label = name.length > 100 ? name.slice(0, 100) : name;
            const maxNameLen = 100 - id.length - VALUE_SEPARATOR.length;
            const value = maxNameLen > 0
                ? `${id}${VALUE_SEPARATOR}${name.slice(0, maxNameLen)}`
                : id.slice(0, 100);
            return new StringSelectMenuOptionBuilder()
                .setLabel(label)
                .setValue(value);
        });

        // Encode field and value using a short unique key to avoid Discord 100-char customId limit
        const editKey = `${interaction.user.id}_${Date.now()}`;
        pendingEdits.set(editKey, { field, value: rawValue });
        // Auto-expire after 5 minutes
        setTimeout(() => pendingEdits.delete(editKey), 5 * 60 * 1000);

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId(`${EDITPRODUCT_SELECT_PREFIX}${editKey}`)
            .setPlaceholder('Select a product to edit…')
            .addOptions(options);

        const row = new ActionRowBuilder().addComponents(selectMenu);

        const fieldLabels = {
            name: 'Name',
            price: 'Price',
            quantity: 'Quantity',
            category: 'Category',
            description: 'Description',
            image_url: 'Image URL',
        };

        await interaction.editReply({
            embeds: [
                new EmbedBuilder()
                    .setColor(0x5865F2)
                    .setTitle('✏️ Edit Product')
                    .setDescription(
                        `Select a product below to set its **${fieldLabels[field] || field}** to **${rawValue}**.` +
                        (products.length > 25 ? `\n\n⚠️ Only the first 25 of ${products.length} products are shown.` : ''),
                    ),
            ],
            components: [row],
        });
    }

    // /claim
    if (interaction.commandName === 'claim') {
        await interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setColor(0xFFA500)
                    .setTitle('🔧 Under Maintenance')
                    .setDescription('This feature is currently under maintenance. Please try again later.'),
            ],
        });
        return;

        const mcUsername = interaction.options.getString('minecraft_username');
        const providedAmount = interaction.options.getNumber('amount');
        const discordUsername = interaction.user.username;

        await interaction.deferReply({ ephemeral: true });

        // Step 1: Verify customer exists for the given Minecraft username
        let customer;
        try {
            customer = await fetchCustomerByMinecraft(mcUsername);
        } catch (err) {
            console.error('Claim API error:', err);
            await interaction.editReply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0xED4245)
                        .setTitle('❌ API Unreachable')
                        .setDescription('Could not fetch customer data. Please try again later.'),
                ],
            });
            return;
        }

        if (!customer) {
            await interaction.editReply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0xFEE75C)
                        .setTitle('❌ No Customer Found')
                        .setDescription(`No customer found with that Minecraft username.`),
                ],
            });
            return;
        }

        // Step 2: Fetch orders and verify amount
        let orders;
        try {
            orders = await fetchOrdersByMinecraft(mcUsername);
        } catch (err) {
            console.error('Claim orders API error:', err);
            await interaction.editReply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0xED4245)
                        .setTitle('❌ API Unreachable')
                        .setDescription('Could not fetch order data. Please try again later.'),
                ],
            });
            return;
        }

        if (!orders || orders.length === 0) {
            await interaction.editReply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0xFEE75C)
                        .setTitle('❌ No Orders Found')
                        .setDescription('❌ No orders found for that Minecraft username.'),
                ],
            });
            return;
        }

        // Find most recent order by sorting on known date fields
        const sortedOrders = [...orders].sort((a, b) => getOrderDate(b) - getOrderDate(a));
        const mostRecentOrder = sortedOrders[0];
        const actualAmount = getOrderAmount(mostRecentOrder);

        if (actualAmount === null) {
            await interaction.editReply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0xED4245)
                        .setTitle('❌ Verification Failed')
                        .setDescription('Could not read the order amount from your most recent order. Please try again later.'),
                ],
            });
            return;
        }

        if (Math.abs(providedAmount - actualAmount) > 0.10) {
            await interaction.editReply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0xED4245)
                        .setTitle('❌ Verification Failed')
                        .setDescription('❌ Verification failed. The order amount you provided doesn\'t match the most recent order for that Minecraft username. Please double-check and try again.'),
                ],
            });
            return;
        }

        // Step 3: Save local mapping discord_username → minecraft_username
        const config = loadConfig();
        if (!config.claimedAccounts) config.claimedAccounts = {};
        config.claimedAccounts[discordUsername] = mcUsername;
        saveConfig(config);

        // Clear cached stats so /stats shows fresh data
        statsCache.delete(discordUsername.toLowerCase());

        const totalSpent = typeof customer.total_spent === 'number' ? customer.total_spent : 0;
        const orderCount = typeof customer.order_count === 'number' ? customer.order_count : 0;
        const tier = getTier(totalSpent);
        const points = calcLoyaltyPoints(totalSpent);

        await interaction.editReply({
            embeds: [
                new EmbedBuilder()
                    .setColor(0x57F287)
                    .setTitle('✅ Account Linked!')
                    .setDescription(
                        `Your Discord account has been linked to the Minecraft username **${mcUsername}**.\n\nYour purchase history is now attached to your Discord profile — use \`/stats view\` to check it out!`,
                    )
                    .addFields(
                        {
                            name: '🏅 Linked Stats',
                            value: [
                                `**Rank:** ${tier.emoji} ${tier.name}`,
                                `**Total Spent:** $${totalSpent.toFixed(2)}`,
                                `**Orders:** ${orderCount}`,
                                `**Loyalty Points:** ${points % 1 === 0 ? points : points.toFixed(1)}/100`,
                            ].join('\n'),
                            inline: false,
                        },
                    )
                    .setFooter({ text: 'DonutDemand Bot' })
                    .setTimestamp(),
            ],
        });
        return;
    }

    // /stats
    if (interaction.commandName === 'stats') {
        await interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setColor(0xFFA500)
                    .setTitle('🔧 Under Maintenance')
                    .setDescription('This feature is currently under maintenance. Please try again later.'),
            ],
        });
        return;

        const sub = interaction.options.getSubcommand();

        // /stats private
        if (sub === 'private') {
            const config = loadConfig();
            if (!config.privateStats) config.privateStats = {};
            config.privateStats[interaction.user.id] = true;
            saveConfig(config);
            await interaction.reply({
                content: '🔒 Your stats are now **private**. Only you and server admins can view them.',
                ephemeral: true,
            });
            return;
        }

        // /stats public
        if (sub === 'public') {
            const config = loadConfig();
            if (!config.privateStats) config.privateStats = {};
            delete config.privateStats[interaction.user.id];
            saveConfig(config);
            await interaction.reply({
                content: '🔓 Your stats are now **public**. Anyone can view them.',
                ephemeral: true,
            });
            return;
        }

        // /stats view
        const mentionedUser = interaction.options.getUser('user');
        const username = mentionedUser.username;

        // Privacy check
        const config = loadConfig();
        const isPrivate = config.privateStats && config.privateStats[mentionedUser.id] === true;
        const isOwner = interaction.user.id === BOT_OWNER_ID;
        const isSelf = interaction.user.id === mentionedUser.id;
        const isAdmin = interaction.memberPermissions && interaction.memberPermissions.has(PermissionFlagsBits.Administrator);

        if (isPrivate && !isSelf && !isAdmin && !isOwner) {
            await interaction.reply({
                content: `🔒 **${username}** has set their stats to private.`,
                ephemeral: true,
            });
            return;
        }

        await interaction.deferReply();

        // Return cached result if still fresh
        const cached = statsCache.get(username.toLowerCase());
        if (cached && Date.now() - cached.ts < STATS_CACHE_TTL_MS) {
            await interaction.editReply({ embeds: [cached.embed] });
            return;
        }

        let customer;
        try {
            // Fetch orders from the Order API and compute stats
            const claimedMcUsername = config.claimedAccounts && config.claimedAccounts[username];
            let orders;
            if (claimedMcUsername) {
                orders = await fetchOrdersByMinecraft(claimedMcUsername);
            } else {
                orders = await fetchOrdersByDiscordUsername(username);
            }
            if (orders.length > 0) {
                customer = computeStatsFromOrders(orders, username);
            } else {
                customer = null;
            }
        } catch (err) {
            console.error('Stats API error:', err);
            await interaction.editReply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0xED4245)
                        .setTitle('❌ API Unreachable')
                        .setDescription('Could not fetch order data. Please try again later.'),
                ],
            });
            return;
        }

        if (!customer) {
            await interaction.editReply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0xFEE75C)
                        .setTitle('No Data Found')
                        .setDescription(`No customer data found for **${username}**.`),
                ],
            });
            return;
        }

        // Resolve the guild member from the mentioned user to get their avatar
        let discordMember = null;
        try {
            discordMember = await interaction.guild.members.fetch(mentionedUser.id);
        } catch {
            // Non-critical — avatar just won't appear
        }

        const embed = buildStatsEmbed(customer, discordMember);

        statsCache.set(username.toLowerCase(), { embed, ts: Date.now() });

        await interaction.editReply({ embeds: [embed] });
        return;
    }

    // /sync
    if (interaction.commandName === 'sync') {
        await interaction.deferReply({ ephemeral: true });
        try {
            await registerCommands();
            await interaction.editReply({ content: '✅ Commands synced successfully!' });
        } catch (err) {
            console.error('Sync failed:', err);
            await interaction.editReply({ content: '❌ Failed to sync commands.' });
        }
        return;
    }

    // /maintenance
    if (interaction.commandName === 'maintenance') {
        const config = loadConfig();
        config.statsMaintenance = !config.statsMaintenance;
        saveConfig(config);
        if (config.statsMaintenance) {
            await interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0xFFA500)
                        .setTitle('🔧 Maintenance Mode Enabled')
                        .setDescription('Stats, leader, and claim commands are now under maintenance. Users will see a maintenance message.'),
                ],
                ephemeral: true,
            });
        } else {
            await interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0x57F287)
                        .setTitle('✅ Maintenance Mode Disabled')
                        .setDescription('Stats, leader, and claim commands are now back online and will resume pulling data from the API.'),
                ],
                ephemeral: true,
            });
        }
        return;
    }

    // /leader
    if (interaction.commandName === 'leader') {
        await interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setColor(0xFFA500)
                    .setTitle('🔧 Under Maintenance')
                    .setDescription('This feature is currently under maintenance. Please try again later.'),
            ],
        });
        return;

        await interaction.deferReply();

        // Serve from cache if still fresh
        const cachedLeaderboard = leaderboardCache.get('leaderboard');
        if (cachedLeaderboard && Date.now() - cachedLeaderboard.ts < LEADERBOARD_CACHE_TTL_MS) {
            await interaction.editReply({ embeds: [cachedLeaderboard.embed] });
            return;
        }

        let customers;
        try {
            customers = await fetchAllCustomers();
        } catch (err) {
            console.error('Leader API error:', err);
            await interaction.editReply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0xED4245)
                        .setTitle('❌ API Unreachable')
                        .setDescription('Could not fetch customer data. Please try again later.'),
                ],
            });
            return;
        }

        const embed = buildLeaderboardEmbed(customers);

        if (!embed) {
            await interaction.editReply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0xFEE75C)
                        .setTitle('🏆 Top 10 Spenders')
                        .setDescription('No leaderboard data available yet.'),
                ],
            });
            return;
        }

        leaderboardCache.set('leaderboard', { embed, ts: Date.now() });
        await interaction.editReply({ embeds: [embed] });
        return;
    }

    // /timezone set
    if (interaction.commandName === 'timezone' && interaction.options.getSubcommand() === 'set') {
        const timeInput = interaction.options.getString('current_time');
        const timezone = interaction.options.getString('timezone');

        const parsed = parseTimeInput(timeInput);
        if (!parsed) {
            await interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0xED4245)
                        .setTitle('❌ Invalid Time Format')
                        .setDescription('Please use a format like `10:32am`, `2:15pm`, or `14:30`.'),
                ],
                ephemeral: true,
            });
            return;
        }

        const now = new Date();
        const currentUTCMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
        const providedMinutes = parsed.hours * 60 + parsed.minutes;
        let offsetMinutes = providedMinutes - currentUTCMinutes;

        // Normalize to the valid timezone range: UTC-12 (-720 min) to UTC+14 (+840 min)
        if (offsetMinutes > 840) offsetMinutes -= 1440;
        if (offsetMinutes < -720) offsetMinutes += 1440;

        // Round to nearest 15 minutes to account for the few seconds it takes to run the command
        offsetMinutes = Math.round(offsetMinutes / 15) * 15;

        const config = loadConfig();
        if (!config.staffTimezones) config.staffTimezones = {};
        config.staffTimezones[interaction.user.id] = {
            username: interaction.user.username,
            timezone: timezone.toUpperCase(),
            utcOffsetMinutes: offsetMinutes,
        };
        saveConfig(config);

        // Format the time for display
        const displayTime = new Date();
        displayTime.setUTCHours(0, 0, 0, 0);
        displayTime.setUTCMinutes(currentUTCMinutes + offsetMinutes);
        const timeStr = displayTime.toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
            timeZone: 'UTC',
        });

        await interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setColor(0x57F287)
                    .setTitle('✅ Timezone Set')
                    .setDescription(`Your timezone has been set to **${timezone.toUpperCase()}** (current time: **${timeStr}**)`),
            ],
            ephemeral: true,
        });

        if (config.timezoneChannelId) {
            updateTimezoneDisplay();
        }
        return;
    }

    // /timezone channel
    if (interaction.commandName === 'timezone' && interaction.options.getSubcommand() === 'channel') {
        const channel = interaction.options.getChannel('channel');
        const config = loadConfig();
        config.timezoneChannelId = channel.id;
        delete config.timezoneMessageId;
        saveConfig(config);

        startTimezoneInterval();

        await interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setColor(0x57F287)
                    .setTitle('✅ Timezone Channel Set')
                    .setDescription(`Staff times will now be displayed in <#${channel.id}> and update every 10 seconds.`),
            ],
            ephemeral: true,
        });
        return;
    }

    // /order channel
    if (interaction.commandName === 'order' && interaction.options.getSubcommand() === 'channel') {
        const channel = interaction.options.getChannel('channel');
        const config = loadConfig();
        config.orderChannelId = channel.id;
        saveConfig(config);

        await startOrderPolling();

        await interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setColor(0x57F287)
                    .setTitle('✅ Order Channel Set')
                    .setDescription(`New order notifications will be posted in <#${channel.id}>.`),
            ],
            ephemeral: true,
        });
        return;
    }

    // /paid channel
    if (interaction.commandName === 'paid' && interaction.options.getSubcommand() === 'channel') {
        const channel = interaction.options.getChannel('channel');
        const config = loadConfig();
        config.paidChannelId = channel.id;
        saveConfig(config);

        await interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setColor(0x57F287)
                    .setTitle('✅ Delivered Channel Set')
                    .setDescription(`Delivered orders will be sent to <#${channel.id}>.`),
            ],
            ephemeral: true,
        });
        return;
    }

    // /review channel
    if (interaction.commandName === 'review' && interaction.options.getSubcommand() === 'channel') {
        const channel = interaction.options.getChannel('channel');
        const config = loadConfig();
        config.reviewChannelId = channel.id;
        saveConfig(config);

        await interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setColor(0x57F287)
                    .setTitle('✅ Review Channel Set')
                    .setDescription(`Orders needing review will be sent to <#${channel.id}>.`),
            ],
            ephemeral: true,
        });
        return;
    }

    // /setup-verify
    if (interaction.commandName === 'setup-verify') {
        if (interaction.user.id !== BOT_OWNER_ID) {
            await interaction.reply({ content: '❌ Only the bot owner can use this command.', ephemeral: true });
            return;
        }
        const verifyEmbed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle('🔐 Verify Your Account')
            .setDescription(
                'Click the button below to link your account with the bot.\n\nVerified users will be included when the server owner uses `?pull` to invite members to another server.',
            );
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(VERIFY_AUTH_BUTTON_ID)
                .setLabel('✅ Verify')
                .setStyle(ButtonStyle.Success),
        );
        await interaction.reply({ embeds: [verifyEmbed], components: [row] });
        return;
    }

    // ── /giveaway start ──────────────────────────────────────────────────────
    if (interaction.commandName === 'giveaway' && interaction.options.getSubcommand() === 'start') {
        const prize = interaction.options.getString('prize');
        const durationStr = interaction.options.getString('duration');
        const winnersCount = interaction.options.getInteger('winners');
        const channelOpt = interaction.options.getChannel('channel');
        const minInvites = interaction.options.getInteger('min_invites') || 0;
        const requiredRole = interaction.options.getRole('required_role');

        const durationMs = parseDuration(durationStr);
        if (!durationMs) {
            await interaction.reply({
                embeds: [new EmbedBuilder().setColor(0xED4245).setTitle('❌ Invalid Duration').setDescription('Use formats like `1h`, `30m`, or `1d`. Combined units like `2h30m` are not supported — pick a single unit.')],
                ephemeral: true,
            });
            return;
        }

        const targetChannel = channelOpt || interaction.channel;
        const endTime = Date.now() + durationMs;
        const giveawayId = genId();

        const giveaway = {
            id: giveawayId,
            guildId: interaction.guild.id,
            channelId: targetChannel.id,
            messageId: null,
            prize,
            winners: winnersCount,
            endTime,
            minInvites,
            requiredRoleId: requiredRole ? requiredRole.id : null,
            participants: [],
            ended: false,
            hostId: interaction.user.id,
            winnerIds: [],
        };

        const embed = buildGiveawayEmbed(giveaway);
        const enterBtn = new ButtonBuilder()
            .setCustomId(`giveaway_enter:${giveawayId}`)
            .setLabel('🎉 Enter Giveaway')
            .setStyle(ButtonStyle.Primary);
        const row = new ActionRowBuilder().addComponents(enterBtn);

        const msg = await targetChannel.send({ embeds: [embed], components: [row] });
        giveaway.messageId = msg.id;

        const giveaways = loadGiveaways();
        giveaways[giveawayId] = giveaway;
        saveGiveaways(giveaways);

        scheduleGiveaway(giveawayId);

        await interaction.reply({
            embeds: [new EmbedBuilder().setColor(0x57F287).setTitle('✅ Giveaway Started').setDescription(`Giveaway for **${prize}** started in <#${targetChannel.id}>!`)],
            ephemeral: true,
        });
        return;
    }

    // ── /giveaway end ────────────────────────────────────────────────────────
    if (interaction.commandName === 'giveaway' && interaction.options.getSubcommand() === 'end') {
        const messageId = interaction.options.getString('message_id');
        const giveaways = loadGiveaways();
        let found = null;

        if (messageId) {
            found = Object.values(giveaways).find(g => g.messageId === messageId && g.guildId === interaction.guild.id && !g.ended);
        } else {
            found = Object.values(giveaways).find(g => g.channelId === interaction.channel.id && g.guildId === interaction.guild.id && !g.ended);
        }

        if (!found) {
            await interaction.reply({ content: '❌ No active giveaway found.', ephemeral: true });
            return;
        }

        await interaction.deferReply({ ephemeral: true });
        await endGiveaway(found.id);
        await interaction.editReply({ content: `✅ Giveaway for **${found.prize}** has been ended.` });
        return;
    }

    // ── /giveaway reroll ─────────────────────────────────────────────────────
    if (interaction.commandName === 'giveaway' && interaction.options.getSubcommand() === 'reroll') {
        const messageId = interaction.options.getString('message_id');
        const giveaways = loadGiveaways();
        let found = null;

        if (messageId) {
            found = Object.values(giveaways).find(g => g.messageId === messageId && g.guildId === interaction.guild.id && g.ended);
        } else {
            found = Object.values(giveaways).find(g => g.channelId === interaction.channel.id && g.guildId === interaction.guild.id && g.ended);
        }

        if (!found) {
            await interaction.reply({ content: '❌ No ended giveaway found to reroll.', ephemeral: true });
            return;
        }

        await interaction.deferReply({ ephemeral: true });
        const guild = await client.guilds.fetch(found.guildId);
        const winnerIds = await pickGiveawayWinners(found, guild);
        found.winnerIds = winnerIds;
        giveaways[found.id] = found;
        saveGiveaways(giveaways);

        const channel = await client.channels.fetch(found.channelId).catch(() => null);
        if (channel) {
            const endEmbed = buildGiveawayEndedEmbed(found, winnerIds);
            try {
                const msg = await channel.messages.fetch(found.messageId);
                await msg.edit({ embeds: [endEmbed], components: [] });
            } catch { /* message deleted */ }
            if (winnerIds.length > 0) {
                await channel.send({ content: `🎉 Reroll! Congratulations ${winnerIds.map(w => `<@${w}>`).join(', ')}! You won **${found.prize}**!` });
            } else {
                await channel.send({ content: `😔 No eligible winners for the reroll of **${found.prize}**.` });
            }
        }
        await interaction.editReply({ content: `✅ Rerolled winners for **${found.prize}**.` });
        return;
    }

    // ── Button: Giveaway Enter ───────────────────────────────────────────────
    if (interaction.isButton() && interaction.customId.startsWith('giveaway_enter:')) {
        const giveawayId = interaction.customId.slice('giveaway_enter:'.length);
        const giveaways = loadGiveaways();
        const giveaway = giveaways[giveawayId];

        if (!giveaway || giveaway.ended) {
            await interaction.reply({ content: '❌ This giveaway has already ended.', ephemeral: true });
            return;
        }

        if (giveaway.participants.includes(interaction.user.id)) {
            // Toggle: allow leaving
            giveaway.participants = giveaway.participants.filter(p => p !== interaction.user.id);
            saveGiveaways(giveaways);
            // Update embed
            try {
                const embed = buildGiveawayEmbed(giveaway);
                await interaction.update({ embeds: [embed], components: interaction.message.components });
            } catch {
                await interaction.reply({ content: '↩️ You have left the giveaway.', ephemeral: true });
            }
            return;
        }

        giveaway.participants.push(interaction.user.id);
        saveGiveaways(giveaways);

        try {
            const embed = buildGiveawayEmbed(giveaway);
            await interaction.update({ embeds: [embed], components: interaction.message.components });
        } catch {
            await interaction.reply({ content: '🎉 You have entered the giveaway!', ephemeral: true });
        }
        return;
    }

    // ── /ticket panel ────────────────────────────────────────────────────────
    if (interaction.commandName === 'ticket' && interaction.options.getSubcommand() === 'panel') {
        const embed = buildTicketPanelSettingsEmbed(interaction.guild.id);
        const components = buildTicketSettingsComponents(interaction.guild.id);
        await interaction.reply({ embeds: [embed], components, ephemeral: true });
        return;
    }

    // ── Select: Ticket panel main select ────────────────────────────────────
    if (interaction.isStringSelectMenu() && interaction.customId === 'tp_main_select') {
        const selected = interaction.values[0];

        if (selected === '__add_new__') {
            const modal = new ModalBuilder()
                .setCustomId('tp_modal_new_type')
                .setTitle('Add New Ticket Type');
            const nameInput = new TextInputBuilder()
                .setCustomId('type_name')
                .setLabel('Ticket Type Name')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('e.g. General Support')
                .setRequired(true)
                .setMaxLength(50);
            modal.addComponents(new ActionRowBuilder().addComponents(nameInput));
            await interaction.showModal(modal);
            return;
        }

        // Show config for selected type
        const tConf = getTicketConfig(interaction.guild.id);
        const type = tConf.types.find(t => t.id === selected);
        if (!type) {
            await interaction.reply({ content: '❌ Ticket type not found.', ephemeral: true });
            return;
        }
        const embed = buildTypeConfigEmbed(type);
        const components = buildTypeConfigComponents(type.id);
        await interaction.update({ embeds: [embed], components });
        return;
    }

    // ── Button: Ticket config — back ─────────────────────────────────────────
    if (interaction.isButton() && interaction.customId === 'tp_cfg_back') {
        const embed = buildTicketPanelSettingsEmbed(interaction.guild.id);
        const components = buildTicketSettingsComponents(interaction.guild.id);
        await interaction.update({ embeds: [embed], components });
        return;
    }

    // ── Button: Ticket config — edit name ────────────────────────────────────
    if (interaction.isButton() && interaction.customId.startsWith('tp_cfg_name:')) {
        const typeId = interaction.customId.slice('tp_cfg_name:'.length);
        const modal = new ModalBuilder().setCustomId(`tp_modal_name:${typeId}`).setTitle('Edit Ticket Type Name');
        const input = new TextInputBuilder().setCustomId('type_name').setLabel('New Name').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(50);
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        await interaction.showModal(modal);
        return;
    }

    // ── Button: Ticket config — set category ─────────────────────────────────
    if (interaction.isButton() && interaction.customId.startsWith('tp_cfg_category:')) {
        const typeId = interaction.customId.slice('tp_cfg_category:'.length);
        const chSelect = new ChannelSelectMenuBuilder()
            .setCustomId(`tp_category_select:${typeId}`)
            .setPlaceholder('Select a category channel…')
            .addChannelTypes(ChannelType.GuildCategory);
        const backBtn = new ButtonBuilder()
            .setCustomId(`tp_cfg_back_to_type:${typeId}`)
            .setLabel('← Back')
            .setStyle(ButtonStyle.Secondary);
        await interaction.update({
            content: '🗂️ Select the category where tickets of this type will be created:',
            embeds: [],
            components: [
                new ActionRowBuilder().addComponents(chSelect),
                new ActionRowBuilder().addComponents(backBtn),
            ],
        });
        return;
    }

    // ── Button: Ticket config — set questions ────────────────────────────────
    if (interaction.isButton() && interaction.customId.startsWith('tp_cfg_questions:')) {
        const typeId = interaction.customId.slice('tp_cfg_questions:'.length);
        const tConf = getTicketConfig(interaction.guild.id);
        const type = tConf.types.find(t => t.id === typeId);
        const existing = type ? type.questions : [];
        const modal = new ModalBuilder().setCustomId(`tp_modal_questions:${typeId}`).setTitle('Set Questions (up to 5)');
        for (let i = 0; i < 5; i++) {
            const field = new TextInputBuilder()
                .setCustomId(`q${i}`)
                .setLabel(`Question ${i + 1}${i === 0 ? ' (required)' : ' (optional)'}`)
                .setStyle(TextInputStyle.Short)
                .setRequired(i === 0)
                .setMaxLength(100)
                .setValue(existing[i] || '');
            modal.addComponents(new ActionRowBuilder().addComponents(field));
        }
        await interaction.showModal(modal);
        return;
    }

    // ── Button: Ticket config — set viewable roles ───────────────────────────
    if (interaction.isButton() && interaction.customId.startsWith('tp_cfg_roles:')) {
        const typeId = interaction.customId.slice('tp_cfg_roles:'.length);
        const roleSelect = new RoleSelectMenuBuilder()
            .setCustomId(`tp_roles_select:${typeId}`)
            .setPlaceholder('Select roles that can view this ticket type…')
            .setMinValues(0)
            .setMaxValues(10);
        const backBtn = new ButtonBuilder()
            .setCustomId(`tp_cfg_back_to_type:${typeId}`)
            .setLabel('← Back')
            .setStyle(ButtonStyle.Secondary);
        await interaction.update({
            content: '👁️ Select the roles that can see tickets of this type (select up to 10):',
            embeds: [],
            components: [
                new ActionRowBuilder().addComponents(roleSelect),
                new ActionRowBuilder().addComponents(backBtn),
            ],
        });
        return;
    }

    // ── Button: Ticket config — button color ─────────────────────────────────
    if (interaction.isButton() && interaction.customId.startsWith('tp_cfg_color:')) {
        const typeId = interaction.customId.slice('tp_cfg_color:'.length);
        const colorSelect = new StringSelectMenuBuilder()
            .setCustomId(`tp_color_select:${typeId}`)
            .setPlaceholder('Choose a button color…')
            .addOptions(
                Object.entries(BUTTON_STYLE_LABELS).map(([key, label]) =>
                    new StringSelectMenuOptionBuilder().setLabel(label).setValue(key),
                ),
            );
        await interaction.reply({
            content: '🎨 Select a button color for this ticket type:',
            components: [new ActionRowBuilder().addComponents(colorSelect)],
            ephemeral: true,
        });
        return;
    }

    // ── Select: Ticket button color ──────────────────────────────────────────
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('tp_color_select:')) {
        const typeId = interaction.customId.slice('tp_color_select:'.length);
        const selected = interaction.values[0];
        if (!BUTTON_STYLE_MAP[selected]) {
            await interaction.reply({ content: '❌ Invalid color selection.', ephemeral: true });
            return;
        }
        const tConf = getTicketConfig(interaction.guild.id);
        const type = tConf.types.find(t => t.id === typeId);
        if (!type) { await interaction.reply({ content: '❌ Type not found.', ephemeral: true }); return; }
        type.buttonStyle = selected;
        saveTicketConfig(interaction.guild.id, tConf);
        const embed = buildTypeConfigEmbed(type);
        const components = buildTypeConfigComponents(typeId);
        await interaction.update({ content: null, embeds: [embed], components });
        return;
    }

    // ── Button: Edit panel text ──────────────────────────────────────────────
    if (interaction.isButton() && interaction.customId === 'tp_edit_panel') {
        const tConf = getTicketConfig(interaction.guild.id);
        const modal = new ModalBuilder().setCustomId('tp_modal_panel_text').setTitle('Edit Panel Text');
        const titleInput = new TextInputBuilder()
            .setCustomId('panel_title')
            .setLabel('Panel Title')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(256)
            .setValue(tConf.panelTitle || '🎫 Support Tickets');
        const descInput = new TextInputBuilder()
            .setCustomId('panel_description')
            .setLabel('Panel Description')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setMaxLength(4000)
            .setValue(tConf.panelDescription || 'Click a button below to open a ticket.');
        modal.addComponents(
            new ActionRowBuilder().addComponents(titleInput),
            new ActionRowBuilder().addComponents(descInput),
        );
        await interaction.showModal(modal);
        return;
    }

    // ── Button: Ticket config — delete type ──────────────────────────────────
    if (interaction.isButton() && interaction.customId.startsWith('tp_cfg_delete:')) {
        const typeId = interaction.customId.slice('tp_cfg_delete:'.length);
        const tConf = getTicketConfig(interaction.guild.id);
        tConf.types = tConf.types.filter(t => t.id !== typeId);
        saveTicketConfig(interaction.guild.id, tConf);
        const embed = buildTicketPanelSettingsEmbed(interaction.guild.id);
        const components = buildTicketSettingsComponents(interaction.guild.id);
        await interaction.update({ embeds: [embed], components });
        return;
    }

    // ── Button: Post ticket panel ────────────────────────────────────────────
    if (interaction.isButton() && interaction.customId === 'tp_post_panel') {
        const tConf = getTicketConfig(interaction.guild.id);
        const types = tConf.types || [];
        if (types.length === 0) {
            await interaction.reply({ content: '❌ No ticket types configured. Add at least one type first.', ephemeral: true });
            return;
        }
        const panelEmbed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle(tConf.panelTitle || '🎫 Support Tickets')
            .setDescription(tConf.panelDescription || 'Click a button below to open a ticket.');

        const rows = [];
        for (let i = 0; i < types.length; i += 5) {
            const slice = types.slice(i, i + 5);
            const row = new ActionRowBuilder().addComponents(
                slice.map(t =>
                    new ButtonBuilder()
                        .setCustomId(`ticket_open:${t.id}`)
                        .setLabel(t.name.slice(0, 80))
                        .setStyle(BUTTON_STYLE_MAP[t.buttonStyle] || ButtonStyle.Primary),
                ),
            );
            rows.push(row);
            if (rows.length >= 5) break;
        }

        await interaction.channel.send({ embeds: [panelEmbed], components: rows });
        await interaction.reply({ content: '✅ Ticket panel posted!', ephemeral: true });
        return;
    }

    // ── Modal: New ticket type ───────────────────────────────────────────────
    if (interaction.isModalSubmit() && interaction.customId === 'tp_modal_new_type') {
        const name = interaction.fields.getTextInputValue('type_name').trim();
        const tConf = getTicketConfig(interaction.guild.id);
        const newType = { id: genId(), name, categoryId: null, questions: [], viewableRoles: [], buttonStyle: 'Primary' };
        tConf.types.push(newType);
        saveTicketConfig(interaction.guild.id, tConf);

        const embed = buildTypeConfigEmbed(newType);
        const components = buildTypeConfigComponents(newType.id);
        await interaction.reply({ embeds: [embed], components, ephemeral: true });
        return;
    }

    // ── Modal: Edit ticket type name ─────────────────────────────────────────
    if (interaction.isModalSubmit() && interaction.customId.startsWith('tp_modal_name:')) {
        const typeId = interaction.customId.slice('tp_modal_name:'.length);
        const newName = interaction.fields.getTextInputValue('type_name').trim();
        const tConf = getTicketConfig(interaction.guild.id);
        const type = tConf.types.find(t => t.id === typeId);
        if (!type) { await interaction.reply({ content: '❌ Type not found.', ephemeral: true }); return; }
        type.name = newName;
        saveTicketConfig(interaction.guild.id, tConf);
        const embed = buildTypeConfigEmbed(type);
        const components = buildTypeConfigComponents(typeId);
        await interaction.reply({ embeds: [embed], components, ephemeral: true });
        return;
    }

    // ── Modal: Set ticket category ───────────────────────────────────────────
    // (replaced by channel select — tp_category_select handler below)

    // ── Modal: Set ticket questions ──────────────────────────────────────────
    if (interaction.isModalSubmit() && interaction.customId.startsWith('tp_modal_questions:')) {
        const typeId = interaction.customId.slice('tp_modal_questions:'.length);
        const tConf = getTicketConfig(interaction.guild.id);
        const type = tConf.types.find(t => t.id === typeId);
        if (!type) { await interaction.reply({ content: '❌ Type not found.', ephemeral: true }); return; }
        const questions = [];
        for (let i = 0; i < 5; i++) {
            try {
                const val = interaction.fields.getTextInputValue(`q${i}`).trim();
                if (val) questions.push(val);
            } catch { /* field not present */ }
        }
        type.questions = questions;
        saveTicketConfig(interaction.guild.id, tConf);
        const embed = buildTypeConfigEmbed(type);
        const components = buildTypeConfigComponents(typeId);
        await interaction.reply({ embeds: [embed], components, ephemeral: true });
        return;
    }

    // ── Modal: Set ticket viewable roles ────────────────────────────────────
    // (replaced by role select — tp_roles_select handler below)

    // ── Modal: Edit panel text ───────────────────────────────────────────────
    if (interaction.isModalSubmit() && interaction.customId === 'tp_modal_panel_text') {
        const panelTitle = interaction.fields.getTextInputValue('panel_title').trim();
        const panelDescription = interaction.fields.getTextInputValue('panel_description').trim();
        const tConf = getTicketConfig(interaction.guild.id);
        tConf.panelTitle = panelTitle;
        tConf.panelDescription = panelDescription;
        saveTicketConfig(interaction.guild.id, tConf);
        const embed = buildTicketPanelSettingsEmbed(interaction.guild.id);
        const components = buildTicketSettingsComponents(interaction.guild.id);
        await interaction.reply({ embeds: [embed], components, ephemeral: true });
        return;
    }

    // ── Channel select: Ticket category ──────────────────────────────────────
    if (interaction.isChannelSelectMenu() && interaction.customId.startsWith('tp_category_select:')) {
        const typeId = interaction.customId.slice('tp_category_select:'.length);
        const channelId = interaction.values[0];
        const tConf = getTicketConfig(interaction.guild.id);
        const type = tConf.types.find(t => t.id === typeId);
        if (!type) { await interaction.reply({ content: '❌ Type not found.', ephemeral: true }); return; }
        type.categoryId = channelId;
        saveTicketConfig(interaction.guild.id, tConf);
        const embed = buildTypeConfigEmbed(type);
        const components = buildTypeConfigComponents(typeId);
        await interaction.update({ content: null, embeds: [embed], components });
        return;
    }

    // ── Role select: Ticket viewable roles ────────────────────────────────────
    if (interaction.isRoleSelectMenu() && interaction.customId.startsWith('tp_roles_select:')) {
        const typeId = interaction.customId.slice('tp_roles_select:'.length);
        const roleIds = interaction.values;
        const tConf = getTicketConfig(interaction.guild.id);
        const type = tConf.types.find(t => t.id === typeId);
        if (!type) { await interaction.reply({ content: '❌ Type not found.', ephemeral: true }); return; }
        type.viewableRoles = roleIds;
        saveTicketConfig(interaction.guild.id, tConf);
        const embed = buildTypeConfigEmbed(type);
        const components = buildTypeConfigComponents(typeId);
        await interaction.update({ content: null, embeds: [embed], components });
        return;
    }

    // ── Button: Ticket config — back to type view ─────────────────────────────
    if (interaction.isButton() && interaction.customId.startsWith('tp_cfg_back_to_type:')) {
        const typeId = interaction.customId.slice('tp_cfg_back_to_type:'.length);
        const tConf = getTicketConfig(interaction.guild.id);
        const type = tConf.types.find(t => t.id === typeId);
        if (!type) { await interaction.reply({ content: '❌ Type not found.', ephemeral: true }); return; }
        const embed = buildTypeConfigEmbed(type);
        const components = buildTypeConfigComponents(typeId);
        await interaction.update({ content: null, embeds: [embed], components });
        return;
    }

    // ── Button: Open ticket ──────────────────────────────────────────────────
    if (interaction.isButton() && interaction.customId.startsWith('ticket_open:')) {
        const typeId = interaction.customId.slice('ticket_open:'.length);
        const tConf = getTicketConfig(interaction.guild.id);
        const type = tConf.types.find(t => t.id === typeId);
        if (!type) {
            await interaction.reply({ content: '❌ Ticket type not found.', ephemeral: true });
            return;
        }

        // Check 3 open ticket limit
        const openCount = countUserOpenTickets(interaction.guild.id, interaction.user.id);
        if (openCount >= 3) {
            await interaction.reply({ content: '❌ You can only have **3 tickets** open at once.', ephemeral: true });
            return;
        }

        // Show modal with questions
        if (type.questions.length > 0) {
            const modal = new ModalBuilder()
                .setCustomId(`ticket_modal_open:${typeId}`)
                .setTitle(`Open Ticket: ${type.name.slice(0, 40)}`);
            for (let i = 0; i < Math.min(type.questions.length, 5); i++) {
                const field = new TextInputBuilder()
                    .setCustomId(`q${i}`)
                    .setLabel(type.questions[i].slice(0, 45))
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(true)
                    .setMaxLength(1000);
                modal.addComponents(new ActionRowBuilder().addComponents(field));
            }
            await interaction.showModal(modal);
        } else {
            // No questions — create ticket directly
            await interaction.deferReply({ ephemeral: true });
            await createTicketChannel(interaction.guild, interaction.member, type, [], interaction.channel);
            await interaction.editReply({ content: '✅ Your ticket has been created!' });
        }
        return;
    }

    // ── Modal: Open ticket with questions ───────────────────────────────────
    if (interaction.isModalSubmit() && interaction.customId.startsWith('ticket_modal_open:')) {
        const typeId = interaction.customId.slice('ticket_modal_open:'.length);
        const tConf = getTicketConfig(interaction.guild.id);
        const type = tConf.types.find(t => t.id === typeId);
        if (!type) { await interaction.reply({ content: '❌ Ticket type not found.', ephemeral: true }); return; }

        const openCount = countUserOpenTickets(interaction.guild.id, interaction.user.id);
        if (openCount >= 3) {
            await interaction.reply({ content: '❌ You can only have **3 tickets** open at once.', ephemeral: true });
            return;
        }

        await interaction.deferReply({ ephemeral: true });
        const answers = [];
        for (let i = 0; i < Math.min(type.questions.length, 5); i++) {
            try {
                answers.push({ q: type.questions[i], a: interaction.fields.getTextInputValue(`q${i}`) });
            } catch { /* missing */ }
        }

        const channel = await createTicketChannel(interaction.guild, interaction.member, type, answers, null);
        await interaction.editReply({ content: channel ? `✅ Your ticket has been created: <#${channel.id}>` : '❌ Failed to create ticket.' });
        return;
    }

    // ── Button: Close ticket ─────────────────────────────────────────────────
    if (interaction.isButton() && interaction.customId === 'ticket_close') {
        const modal = new ModalBuilder()
            .setCustomId(`ticket_modal_close:${interaction.channel.id}`)
            .setTitle('Close Ticket');
        const reasonInput = new TextInputBuilder()
            .setCustomId('reason')
            .setLabel('Reason for closing')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false)
            .setMaxLength(500)
            .setPlaceholder('Optional reason...');
        modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
        await interaction.showModal(modal);
        return;
    }

    // ── Modal: Close ticket reason ───────────────────────────────────────────
    if (interaction.isModalSubmit() && interaction.customId.startsWith('ticket_modal_close:')) {
        const channelId = interaction.customId.slice('ticket_modal_close:'.length);
        const reason = interaction.fields.getTextInputValue('reason').trim() || 'No reason provided.';

        const openTickets = getOpenTickets(interaction.guild.id);
        const ticket = openTickets[channelId];

        if (ticket) {
            // DM the ticket creator
            try {
                const creator = await client.users.fetch(ticket.userId);
                const dmEmbed = new EmbedBuilder()
                    .setColor(0xED4245)
                    .setTitle('🎫 Your ticket has been closed')
                    .addFields(
                        { name: '🔒 Reason', value: reason },
                        { name: '📋 Channel', value: `#${interaction.channel.name}` },
                        { name: '👤 Closed by', value: interaction.user.tag },
                    )
                    .setTimestamp();
                await creator.send({ embeds: [dmEmbed] });
            } catch { /* DMs disabled */ }

            delete openTickets[channelId];
            saveOpenTickets(interaction.guild.id, openTickets);
        }

        await interaction.reply({ content: `🔒 Closing ticket...` });
        try {
            await interaction.channel.delete();
        } catch (err) {
            console.error('Failed to delete ticket channel:', err);
        }
        return;
    }

    // ── Button: Private ticket ───────────────────────────────────────────────
    if (interaction.isButton() && interaction.customId === 'ticket_private') {
        const openTickets = getOpenTickets(interaction.guild.id);
        const ticket = openTickets[interaction.channel.id];
        if (!ticket) {
            await interaction.reply({ content: '❌ Ticket data not found.', ephemeral: true });
            return;
        }

        if (ticket.isPrivate) {
            await interaction.reply({ content: '🔒 This ticket is already private.', ephemeral: true });
            return;
        }

        ticket.isPrivate = true;
        saveOpenTickets(interaction.guild.id, openTickets);

        // Remove viewable roles access
        const tConf = getTicketConfig(interaction.guild.id);
        const type = tConf.types.find(t => t.id === ticket.typeId);
        if (type) {
            for (const roleId of type.viewableRoles) {
                try {
                    await interaction.channel.permissionOverwrites.delete(roleId);
                } catch { /* role may not exist */ }
            }
        }

        await interaction.reply({
            embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('🔒 Ticket is now Private').setDescription('Only admins and the ticket creator can view this ticket.')],
        });
        return;
    }

    // ── /invites ─────────────────────────────────────────────────────────────
    if (interaction.commandName === 'invites') {
        const target = interaction.options.getUser('user') || interaction.user;
        const invData = loadInvites();
        const guildData = invData[interaction.guild.id] || {};
        const userInv = (guildData.users || {})[target.id] || { real: 0, left: 0, fake: 0, bonus: 0 };
        const total = (userInv.real || 0) + (userInv.bonus || 0) - (userInv.left || 0);
        await interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setColor(0x5865F2)
                    .setTitle(`📨 Invites — ${target.username}`)
                    .addFields(
                        { name: '✅ Total', value: `${total}`, inline: true },
                        { name: '📥 Real', value: `${userInv.real || 0}`, inline: true },
                        { name: '📤 Left', value: `${userInv.left || 0}`, inline: true },
                        { name: '🎁 Bonus', value: `${userInv.bonus || 0}`, inline: true },
                        { name: '🤖 Fake', value: `${userInv.fake || 0}`, inline: true },
                    )
                    .setThumbnail(target.displayAvatarURL({ size: 64 }))
                    .setTimestamp(),
            ],
            ephemeral: true,
        });
        return;
    }

    // ── /resetinvites ────────────────────────────────────────────────────────
    if (interaction.commandName === 'resetinvites') {
        const target = interaction.options.getUser('user');
        const invData = loadInvites();
        if (!invData[interaction.guild.id]) invData[interaction.guild.id] = { users: {} };
        if (!invData[interaction.guild.id].users) invData[interaction.guild.id].users = {};
        invData[interaction.guild.id].users[target.id] = { real: 0, left: 0, fake: 0, bonus: 0 };
        saveInvites(invData);
        await interaction.reply({
            embeds: [new EmbedBuilder().setColor(0x57F287).setTitle('✅ Invites Reset').setDescription(`Reset invite count for <@${target.id}>.`)],
            ephemeral: true,
        });
        return;
    }

    // ── /addinvites ──────────────────────────────────────────────────────────
    if (interaction.commandName === 'addinvites') {
        const target = interaction.options.getUser('user');
        const amount = interaction.options.getInteger('amount');
        const invData = loadInvites();
        if (!invData[interaction.guild.id]) invData[interaction.guild.id] = { users: {} };
        if (!invData[interaction.guild.id].users) invData[interaction.guild.id].users = {};
        if (!invData[interaction.guild.id].users[target.id]) invData[interaction.guild.id].users[target.id] = { real: 0, left: 0, fake: 0, bonus: 0 };
        invData[interaction.guild.id].users[target.id].bonus = (invData[interaction.guild.id].users[target.id].bonus || 0) + amount;
        saveInvites(invData);
        await interaction.reply({
            embeds: [new EmbedBuilder().setColor(0x57F287).setTitle('✅ Invites Added').setDescription(`Added **${amount}** bonus invite${amount !== 1 ? 's' : ''} to <@${target.id}>.`)],
            ephemeral: true,
        });
        return;
    }

    // ── /invitechannel ───────────────────────────────────────────────────────
    if (interaction.commandName === 'invitechannel') {
        const channel = interaction.options.getChannel('channel');
        const invData = loadInvites();
        if (!invData[interaction.guild.id]) invData[interaction.guild.id] = { users: {} };
        invData[interaction.guild.id].inviteChannel = channel.id;
        saveInvites(invData);
        await interaction.reply({
            embeds: [new EmbedBuilder().setColor(0x57F287).setTitle('✅ Invite Channel Set').setDescription(`Invite join messages will be posted in <#${channel.id}>.`)],
            ephemeral: true,
        });
        return;
    }

    // ── /close ────────────────────────────────────────────────────────────────
    if (interaction.commandName === 'close') {
        const openTickets = getOpenTickets(interaction.guild.id);
        const ticket = openTickets[interaction.channel.id];
        if (!ticket) {
            await interaction.reply({ content: '❌ This channel is not a ticket.', ephemeral: true });
            return;
        }
        const reason = interaction.options.getString('reason') || 'No reason provided.';

        // DM the ticket creator
        try {
            const creator = await client.users.fetch(ticket.userId);
            const dmEmbed = new EmbedBuilder()
                .setColor(0xED4245)
                .setTitle('🎫 Your ticket has been closed')
                .addFields(
                    { name: '🔒 Reason', value: reason },
                    { name: '📋 Channel', value: `#${interaction.channel.name}` },
                    { name: '👤 Closed by', value: interaction.user.tag },
                )
                .setTimestamp();
            await creator.send({ embeds: [dmEmbed] });
        } catch { /* DMs disabled */ }

        delete openTickets[interaction.channel.id];
        saveOpenTickets(interaction.guild.id, openTickets);

        await interaction.reply({ content: '🔒 Closing ticket...' });
        try {
            await interaction.channel.delete();
        } catch (err) {
            console.error('Failed to delete ticket channel:', err);
        }
        return;
    }

    // ── /secretclose ─────────────────────────────────────────────────────────
    if (interaction.commandName === 'secretclose') {
        const openTickets = getOpenTickets(interaction.guild.id);
        const ticket = openTickets[interaction.channel.id];
        if (!ticket) {
            await interaction.reply({ content: '❌ This channel is not a ticket.', ephemeral: true });
            return;
        }

        delete openTickets[interaction.channel.id];
        saveOpenTickets(interaction.guild.id, openTickets);

        await interaction.reply({ content: '🔒 Closing ticket...' });
        try {
            await interaction.channel.delete();
        } catch (err) {
            console.error('Failed to delete ticket channel:', err);
        }
        return;
    }

    // ── /leaderboard ─────────────────────────────────────────────────────────
    if (interaction.commandName === 'leaderboard') {
        const invData = loadInvites();
        const guildData = invData[interaction.guild.id] || {};
        const users = guildData.users || {};

        const sorted = Object.entries(users)
            .map(([id, inv]) => ({
                id,
                total: (inv.real || 0) + (inv.bonus || 0) - (inv.left || 0),
            }))
            .sort((a, b) => b.total - a.total)
            .slice(0, 10);

        if (sorted.length === 0) {
            await interaction.reply({ content: '❌ No invite data found for this server.', ephemeral: true });
            return;
        }

        const description = sorted
            .map((entry, i) => `**${i + 1}.** <@${entry.id}> — **${entry.total}** invite${entry.total !== 1 ? 's' : ''}`)
            .join('\n');

        const lbEmbed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle('📨 Top 10 Inviters')
            .setDescription(description)
            .setTimestamp();

        await interaction.reply({ embeds: [lbEmbed] });
        return;
    }

    // ── /vc ──────────────────────────────────────────────────────────────────
    if (interaction.commandName === 'vc') {
        const openTickets = getOpenTickets(interaction.guild.id);
        const ticket = openTickets[interaction.channel.id];
        if (!ticket) {
            await interaction.reply({ content: '❌ This command can only be used inside a ticket channel.' });
            return;
        }

        const config = loadConfig();
        const vouchChannelId = config.vouchChannel;
        if (!vouchChannelId) {
            await interaction.reply({ content: '❌ No vouch channel set. Use `/vouchchannel` first.' });
            return;
        }

        const creatorId = ticket.userId;
        const guildId = interaction.guild.id;
        const channelId = interaction.channel.id;

        // Validate timer string if provided
        const timerStr = interaction.options.getString('timer');
        let timerMs = null;
        if (timerStr) {
            timerMs = parseVcDuration(timerStr);
            if (timerMs === null) {
                await interaction.reply({ content: '❌ Invalid timer format. Use formats like `1m`, `30m`, `1h`, `1hr`, `1d`.' });
                return;
            }
        }

        // Immediately assign vc role to ticket creator
        const vcRoleId = config.vcRole;
        if (vcRoleId) {
            try {
                const member = await interaction.guild.members.fetch(creatorId);
                await member.roles.add(vcRoleId);
            } catch (err) {
                console.error('Failed to assign vc role:', err);
            }
        }

        // Send vouch message pinging the ticket creator
        await interaction.reply({
            content: `<@${creatorId}> please head on over to <#${vouchChannelId}> and vouch for us! 🎉`,
        });

        // Legit react follow-up message
        if (config.legitChannel) {
            await interaction.channel.send({
                content: `<@${creatorId}> please also react to the message in <#${config.legitChannel}> to confirm your legitimacy! ✅`,
            });
        }

        // Review link follow-up message with embed and button
        if (config.reviewLink) {
            const reviewEmbed = new EmbedBuilder()
                .setColor(0x5865F2)
                .setDescription("We'd love your feedback! Click the button below to leave us a review. ⭐");
            const reviewRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setLabel('📝 Leave a Review')
                    .setStyle(ButtonStyle.Link)
                    .setURL(config.reviewLink),
            );
            await interaction.channel.send({ embeds: [reviewEmbed], components: [reviewRow] });
        }

        // Optional timer to auto-close the ticket
        if (timerMs) {
            if (vcTimers.has(channelId)) {
                clearTimeout(vcTimers.get(channelId).timer);
            }

            const timer = setTimeout(async () => {
                vcTimers.delete(channelId);
                try {
                    const ch = await client.channels.fetch(channelId);
                    if (ch) {
                        const freshTickets = getOpenTickets(guildId);
                        delete freshTickets[channelId];
                        saveOpenTickets(guildId, freshTickets);
                        await ch.delete();
                    }
                } catch (err) {
                    console.error('vc timer error:', err);
                }
            }, timerMs);

            vcTimers.set(channelId, { creatorId, guildId, timer });
        }
        return;
    }

    // ── /vouchchannel ────────────────────────────────────────────────────────
    if (interaction.commandName === 'vouchchannel') {
        const channel = interaction.options.getChannel('channel');
        const config = loadConfig();
        config.vouchChannel = channel.id;
        saveConfig(config);
        await interaction.reply({
            embeds: [new EmbedBuilder().setColor(0x57F287).setTitle('✅ Vouch Channel Set').setDescription(`Vouch requests will reference <#${channel.id}>.`)],
            ephemeral: true,
        });
        return;
    }

    // ── /vcrole ──────────────────────────────────────────────────────────────
    if (interaction.commandName === 'vcrole') {
        const role = interaction.options.getRole('role');
        const config = loadConfig();
        config.vcRole = role.id;
        saveConfig(config);
        await interaction.reply({
            embeds: [new EmbedBuilder().setColor(0x57F287).setTitle('✅ VC Role Set').setDescription(`<@&${role.id}> will be assigned to the ticket creator after the vouch flow.`)],
            ephemeral: true,
        });
        return;
    }

    // ── /legit ───────────────────────────────────────────────────────────────
    if (interaction.commandName === 'legit' && interaction.options.getSubcommand() === 'channel') {
        const channel = interaction.options.getChannel('channel');
        const config = loadConfig();
        config.legitChannel = channel.id;
        saveConfig(config);
        await interaction.reply({
            embeds: [new EmbedBuilder().setColor(0x57F287).setTitle('✅ Legit React Channel Set').setDescription(`Users will be asked to react in <#${channel.id}> to confirm legitimacy.`)],
        });
        return;
    }

    // ── /reviewlink ──────────────────────────────────────────────────────────
    if (interaction.commandName === 'reviewlink') {
        let url = interaction.options.getString('url');
        if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
        const config = loadConfig();
        config.reviewLink = url;
        saveConfig(config);
        await interaction.reply({
            embeds: [new EmbedBuilder().setColor(0x57F287).setTitle('✅ Review Link Set').setDescription(`Users will be directed to leave a review at: ${url}`)],
        });
        return;
    }

    // ── /proof ───────────────────────────────────────────────────────────────
    if (interaction.commandName === 'proof') {
        const config = loadConfig();
        const fields = [];

        if (config.vouchChannel) {
            fields.push({ name: '📋 Vouches', value: `<#${config.vouchChannel}>`, inline: true });
        }
        if (config.legitChannel) {
            fields.push({ name: '✅ Legit Reacts', value: `<#${config.legitChannel}>`, inline: true });
        }
        if (config.reviewLink) {
            fields.push({ name: '⭐ Reviews', value: `[Leave a Review](${config.reviewLink})`, inline: true });
        }

        if (fields.length === 0) {
            await interaction.reply({ content: '❌ No proof channels or review link configured yet.' });
            return;
        }

        const proofEmbed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle('🔒 Proof & Legitimacy')
            .setDescription('Here is our proof of legitimacy. Check our vouches, legit reacts, and reviews!')
            .addFields(...fields)
            .setTimestamp();

        const components = [];
        if (config.reviewLink) {
            components.push(
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setLabel('📝 Leave a Review')
                        .setStyle(ButtonStyle.Link)
                        .setURL(config.reviewLink),
                ),
            );
        }

        await interaction.reply({ embeds: [proofEmbed], components });
        return;
    }

    // ── /automod setup ───────────────────────────────────────────────────────
    if (interaction.commandName === 'automod' && interaction.options.getSubcommand() === 'setup') {
        const config = loadConfig();

        // Check if role already exists and is still valid
        if (config.automodRoleId) {
            const existing = interaction.guild.roles.cache.get(config.automodRoleId)
                || await interaction.guild.roles.fetch(config.automodRoleId).catch(() => null);
            if (existing) {
                await interaction.reply({
                    embeds: [new EmbedBuilder().setColor(0xFEE75C).setTitle('⚠️ Automod Already Set Up').setDescription(`The Automod Bypass role already exists: <@&${existing.id}>\nMembers with this role can send links and any configured banned words.`)],
                });
                return;
            }
        }

        // Create the bypass role
        let bypassRole;
        try {
            bypassRole = await interaction.guild.roles.create({
                name: 'Automod Bypass',
                color: 0x99AAB5,
                reason: 'Created by bot automod setup',
            });
        } catch (err) {
            console.error('Failed to create automod role:', err);
            await interaction.reply({ content: '❌ Failed to create the Automod Bypass role. Make sure I have the **Manage Roles** permission.' });
            return;
        }

        config.automodRoleId = bypassRole.id;
        saveConfig(config);

        await interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setColor(0x57F287)
                    .setTitle('✅ Automod Set Up')
                    .setDescription(`Created the <@&${bypassRole.id}> role.\n\n**Link filtering** and **banned word filtering** are now active.\nMembers with the **Automod Bypass** role are exempt.\n\nUse \`/banword\` to add banned words.`),
            ],
        });
        return;
    }

    // ── /banword ─────────────────────────────────────────────────────────────
    if (interaction.commandName === 'banword') {
        const word = interaction.options.getString('word').toLowerCase().trim();
        const config = loadConfig();
        if (!config.bannedWords) config.bannedWords = [];
        if (config.bannedWords.includes(word)) {
            await interaction.reply({ content: `⚠️ \`${word}\` is already in the banned words list.` });
            return;
        }
        config.bannedWords.push(word);
        saveConfig(config);
        await interaction.reply({
            embeds: [new EmbedBuilder().setColor(0x57F287).setTitle('✅ Banned Word Added').setDescription(`\`${word}\` has been added to the banned words list.`)],
        });
        return;
    }

    // ── /unbanword ───────────────────────────────────────────────────────────
    if (interaction.commandName === 'unbanword') {
        const word = interaction.options.getString('word').toLowerCase().trim();
        const config = loadConfig();
        if (!config.bannedWords) config.bannedWords = [];
        const idx = config.bannedWords.indexOf(word);
        if (idx === -1) {
            await interaction.reply({ content: `⚠️ \`${word}\` is not in the banned words list.` });
            return;
        }
        config.bannedWords.splice(idx, 1);
        saveConfig(config);
        await interaction.reply({
            embeds: [new EmbedBuilder().setColor(0x57F287).setTitle('✅ Banned Word Removed').setDescription(`\`${word}\` has been removed from the banned words list.`)],
        });
        return;
    }

    // ── /stick ───────────────────────────────────────────────────────────────
    if (interaction.commandName === 'stick') {
        const message = interaction.options.getString('message');
        const showReview = interaction.options.getBoolean('review') ?? true;
        const config = loadConfig();
        if (!config.stickyMessages) config.stickyMessages = {};

        // Delete existing sticky if present
        const existing = config.stickyMessages[interaction.channel.id];
        if (existing && existing.messageId) {
            try {
                const oldMsg = await interaction.channel.messages.fetch(existing.messageId);
                await oldMsg.delete();
            } catch { /* already deleted */ }
        }

        const stickyEmbed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setDescription(showReview && config.reviewLink
                ? `📌 ${message}\n\nWe'd love your feedback! Click the button below to leave us a review. ⭐`
                : `📌 ${message}`);
        const stickyPayload = { embeds: [stickyEmbed] };
        if (showReview && config.reviewLink) {
            stickyPayload.components = [
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setLabel('📝 Leave a Review')
                        .setStyle(ButtonStyle.Link)
                        .setURL(config.reviewLink),
                ),
            ];
        }

        const sent = await interaction.channel.send(stickyPayload);
        config.stickyMessages[interaction.channel.id] = { content: message, messageId: sent.id, showReview };
        saveConfig(config);

        await interaction.reply({ content: '📌 Message stuck!', ephemeral: true });
        return;
    }

    // ── /unstick ─────────────────────────────────────────────────────────────
    if (interaction.commandName === 'unstick') {
        const config = loadConfig();
        if (!config.stickyMessages) config.stickyMessages = {};
        const existing = config.stickyMessages[interaction.channel.id];
        if (!existing) {
            await interaction.reply({ content: '❌ No sticky message in this channel.', ephemeral: true });
            return;
        }
        if (existing.messageId) {
            try {
                const msg = await interaction.channel.messages.fetch(existing.messageId);
                await msg.delete();
            } catch { /* already deleted */ }
        }
        delete config.stickyMessages[interaction.channel.id];
        saveConfig(config);
        await interaction.reply({ content: '✅ Sticky message removed.', ephemeral: true });
        return;
    }

    // ── /vouches ─────────────────────────────────────────────────────────────
    if (interaction.commandName === 'vouches') {
        const config = loadConfig();
        const vouchChannelId = config.vouchChannel;
        if (!vouchChannelId) {
            await interaction.reply({
                content: '❌ No vouches channel has been configured. Use `/vouchchannel` to set one.',
                ephemeral: true,
            });
            return;
        }
        const vouchChannel = await interaction.guild.channels.fetch(vouchChannelId).catch(() => null);
        if (!vouchChannel) {
            await interaction.reply({ content: '❌ Configured vouch channel not found.', ephemeral: true });
            return;
        }
        await interaction.deferReply({ ephemeral: true });
        const count = await countChannelMessages(vouchChannel);
        const vouchEmbed = new EmbedBuilder()
            .setColor(0x57F287)
            .setTitle('📋 Vouches')
            .setDescription(`Total vouches: **${count}**\nChannel: <#${vouchChannelId}>`)
            .setTimestamp();
        await interaction.editReply({ embeds: [vouchEmbed] });
        return;
    }

    // ── /embed ───────────────────────────────────────────────────────────────
    if (interaction.commandName === 'embed') {
        const title = interaction.options.getString('title');
        const description = interaction.options.getString('description');
        const colorInput = interaction.options.getString('color');
        const footer = interaction.options.getString('footer');
        const image = interaction.options.getString('image');
        const thumbnail = interaction.options.getString('thumbnail');
        const author = interaction.options.getString('author');
        const url = interaction.options.getString('url');

        const colorNames = {
            red: 0xED4245, green: 0x57F287, blue: 0x5865F2, yellow: 0xFEE75C,
            orange: 0xE67E22, purple: 0x9B59B6, pink: 0xEB459E, white: 0xFFFFFF,
            black: 0x23272A, grey: 0x95A5A6, gray: 0x95A5A6, blurple: 0x5865F2,
        };
        let embedColor = 0x5865F2;
        if (colorInput) {
            const hexMatch = colorInput.replace('#', '').match(/^([0-9A-Fa-f]{6})$/);
            if (hexMatch) {
                embedColor = parseInt(hexMatch[1], 16);
            } else if (colorNames[colorInput.toLowerCase()]) {
                embedColor = colorNames[colorInput.toLowerCase()];
            } else {
                await interaction.reply({ content: `❌ Invalid color \`${colorInput}\`. Use a hex code (e.g. \`#FF0000\`) or a name: ${Object.keys(colorNames).join(', ')}`, ephemeral: true });
                return;
            }
        }

        const embed = new EmbedBuilder().setColor(embedColor).setTitle(title);
        if (description) embed.setDescription(description);
        if (footer) embed.setFooter({ text: footer });
        if (image) embed.setImage(image);
        if (thumbnail) embed.setThumbnail(thumbnail);
        if (author) embed.setAuthor({ name: author });
        if (url) embed.setURL(url);

        await interaction.channel.send({ embeds: [embed] });
        await interaction.reply({ content: '✅ Embed sent!', ephemeral: true });
        return;
    }
});

// ─── Helper: Count messages in a channel (capped at MAX_VOUCH_COUNT) ──────────

const MAX_VOUCH_COUNT = 10_000;

async function countChannelMessages(channel) {
    let count = 0;
    let lastId = null;
    try {
        while (count < MAX_VOUCH_COUNT) {
            const fetchOptions = { limit: 100 };
            if (lastId) fetchOptions.before = lastId;
            const msgs = await channel.messages.fetch(fetchOptions);
            if (msgs.size === 0) break;
            count += msgs.size;
            lastId = msgs.last().id;
            if (msgs.size < 100) break;
        }
    } catch (err) {
        console.error('Failed to count messages in channel:', err);
    }
    return count;
}

// ─── Helper: Create ticket channel ───────────────────────────────────────────

async function createTicketChannel(guild, member, type, answers, fallbackChannel) {
    try {
        const channelName = `ticket-${member.user.username.slice(0, 20).replace(/[^a-z0-9]/gi, '').toLowerCase() || 'user'}-${Date.now().toString(36).slice(-4)}`;

        const permOverwrites = [
            { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
            { id: member.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
        ];

        // Add viewable roles
        for (const roleId of type.viewableRoles) {
            permOverwrites.push({
                id: roleId,
                allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
            });
        }

        // Add bot itself
        permOverwrites.push({
            id: guild.members.me.id,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels],
        });

        const channelOptions = {
            name: channelName,
            type: ChannelType.GuildText,
            permissionOverwrites: permOverwrites,
        };

        if (type.categoryId) {
            channelOptions.parent = type.categoryId;
        }

        const channel = await guild.channels.create(channelOptions);

        // Save to open tickets
        const openTickets = getOpenTickets(guild.id);
        openTickets[channel.id] = { userId: member.id, typeId: type.id, guildId: guild.id, isPrivate: false };
        saveOpenTickets(guild.id, openTickets);

        // Build ticket embed with answers
        const ticketEmbed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle(`🎫 ${type.name}`)
            .setDescription(`Ticket opened by <@${member.id}>`)
            .setTimestamp();

        if (answers.length > 0) {
            ticketEmbed.addFields(answers.map(a => ({ name: a.q.slice(0, 256), value: a.a.slice(0, 1024) })));
        }

        const closeBtn = new ButtonBuilder().setCustomId('ticket_close').setLabel('🔒 Close Ticket').setStyle(ButtonStyle.Danger);
        const privateBtn = new ButtonBuilder().setCustomId('ticket_private').setLabel('🔐 Private Ticket').setStyle(ButtonStyle.Secondary);
        const row = new ActionRowBuilder().addComponents(closeBtn, privateBtn);

        await channel.send({ content: `<@${member.id}>`, embeds: [ticketEmbed], components: [row] });
        return channel;
    } catch (err) {
        console.error('Failed to create ticket channel:', err);
        return null;
    }
}

// ─── Channel Delete: Transcript to owner ──────────────────────────────────────

client.on('channelDelete', async channel => {
    if (!channel.guild || !channel.isTextBased()) return;

    try {
        // Try to find who deleted the channel from the audit log
        let closedBy = 'Unknown';
        try {
            const auditLogs = await channel.guild.fetchAuditLogs({
                type: AuditLogEvent.ChannelDelete,
                limit: 5,
            });
            const entry = auditLogs.entries.find(
                e => e.target?.id === channel.id && Date.now() - e.createdTimestamp < AUDIT_LOG_MAX_AGE_MS,
            );
            if (entry && entry.executor) {
                closedBy = `${entry.executor.tag} (${entry.executor.id})`;
            }
        } catch {
            // Audit log not accessible — keep "Unknown"
        }

        // Only cached messages are available; the channel no longer exists on Discord's API
        const messages = [...channel.messages.cache.values()]
            .sort((a, b) => a.createdTimestamp - b.createdTimestamp);

        let transcript = `Transcript for #${channel.name} (${channel.id})\n`;
        transcript += `Server: ${channel.guild.name}\n`;
        transcript += `Closed by: ${closedBy}\n`;
        transcript += `Deleted at: ${new Date().toUTCString()}\n`;
        transcript += `Messages: ${messages.length}\n`;
        transcript += '─'.repeat(50) + '\n\n';

        if (messages.length === 0) {
            transcript += '(No cached messages available)\n';
        } else {
            for (const msg of messages) {
                const time = msg.createdAt.toUTCString();
                const author = msg.author ? `${msg.author.tag} (${msg.author.id})` : 'Unknown';
                transcript += `[${time}] ${author}\n`;
                if (msg.content) transcript += `${msg.content}\n`;
                if (msg.attachments.size > 0) {
                    for (const [, att] of msg.attachments) {
                        transcript += `[Attachment: ${att.name} - ${att.url}]\n`;
                    }
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
            .setDescription(
                `**Channel:** #${channel.name}\n` +
                `**Server:** ${channel.guild.name}\n` +
                `**Closed by:** ${closedBy}\n` +
                `**Messages:** ${messages.length}`,
            )
            .setFooter({ text: 'Click the button below to view the full transcript' })
            .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`${TRANSCRIPT_BUTTON_PREFIX}${transcriptId}`)
                .setLabel('📋 View Transcript')
                .setStyle(ButtonStyle.Primary),
        );

        const user = await client.users.fetch(BOT_OWNER_ID);
        await user.send({ embeds: [embed], components: [row] });
    } catch (err) {
        console.error('Failed to send channel delete transcript:', err);
    }
});

// ─── Sticky Messages ──────────────────────────────────────────────────────────

// Track channels currently being re-posted to avoid infinite loops
const stickyLock = new Set();

client.on('messageCreate', async message => {
    if (!message.guild) return;
    // Ignore the bot's own messages for sticky to avoid infinite loops
    if (message.author.id === client.user?.id) return;

    const config = loadConfig();
    if (!config.stickyMessages) return;
    const sticky = config.stickyMessages[message.channel.id];
    if (!sticky) return;
    if (stickyLock.has(message.channel.id)) return;

    stickyLock.add(message.channel.id);
    try {
        // Delete old sticky
        if (sticky.messageId) {
            try {
                const oldMsg = await message.channel.messages.fetch(sticky.messageId);
                await oldMsg.delete();
            } catch { /* already gone */ }
        }
        // Re-post at the bottom
        const hasReview = sticky.showReview !== false && config.reviewLink;
        const stickyEmbed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setDescription(hasReview
                ? `📌 ${sticky.content}\n\nWe'd love your feedback! Click the button below to leave us a review. ⭐`
                : `📌 ${sticky.content}`);
        const stickyPayload = { embeds: [stickyEmbed] };
        if (hasReview) {
            stickyPayload.components = [
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setLabel('📝 Leave a Review')
                        .setStyle(ButtonStyle.Link)
                        .setURL(config.reviewLink),
                ),
            ];
        }
        const sent = await message.channel.send(stickyPayload);
        const freshConfig = loadConfig();
        if (!freshConfig.stickyMessages) freshConfig.stickyMessages = {};
        if (freshConfig.stickyMessages[message.channel.id]) {
            freshConfig.stickyMessages[message.channel.id].messageId = sent.id;
            saveConfig(freshConfig);
        }
    } catch (err) {
        console.error('Sticky message error:', err);
    } finally {
        stickyLock.delete(message.channel.id);
    }
});

// ─── Invite Tracking — guildCreate ───────────────────────────────────────────

client.on('guildCreate', async guild => {
    await cacheGuildInvites(guild);
});

// ─── Invite Tracking — guildMemberAdd ────────────────────────────────────────

client.on('guildMemberAdd', async member => {
    const guild = member.guild;
    // Re-cache after join so we can detect which invite was used
    let newCache;
    try {
        const fetched = await guild.invites.fetch();
        newCache = new Map();
        fetched.forEach(inv => newCache.set(inv.code, inv.uses || 0));
    } catch {
        return;
    }

    const oldCache = guildInviteCache.get(guild.id) || new Map();

    // Find the invite whose use count increased
    let usedInvite = null;
    for (const [code, uses] of newCache) {
        const prev = oldCache.get(code) || 0;
        if (uses > prev) {
            usedInvite = { code, uses, inviterId: null };
            break;
        }
    }

    // Update cache
    guildInviteCache.set(guild.id, newCache);

    if (!usedInvite) return;

    // Look up inviter from Discord API
    let inviterId = null;
    try {
        const fetchedInvites = await guild.invites.fetch();
        const inv = fetchedInvites.get(usedInvite.code);
        if (inv && inv.inviter) inviterId = inv.inviter.id;
    } catch { /* fallback: skip */ }

    if (!inviterId) return;

    // Update invite tracking data
    const invData = loadInvites();
    if (!invData[guild.id]) invData[guild.id] = { users: {}, inviterMap: {} };
    if (!invData[guild.id].users) invData[guild.id].users = {};
    if (!invData[guild.id].inviterMap) invData[guild.id].inviterMap = {};

    if (!invData[guild.id].users[inviterId]) {
        invData[guild.id].users[inviterId] = { real: 0, left: 0, fake: 0, bonus: 0 };
    }
    invData[guild.id].users[inviterId].real = (invData[guild.id].users[inviterId].real || 0) + 1;
    invData[guild.id].inviterMap[member.id] = inviterId;
    saveInvites(invData);

    // Post to invite channel
    const channelId = invData[guild.id].inviteChannel;
    if (!channelId) return;

    const total =
        (invData[guild.id].users[inviterId].real || 0) +
        (invData[guild.id].users[inviterId].bonus || 0) -
        (invData[guild.id].users[inviterId].left || 0);

    const inviteChannel = await client.channels.fetch(channelId).catch(() => null);
    if (!inviteChannel) return;

    await inviteChannel.send({
        content: `<@${member.id}> has been invited by <@${inviterId}>, who now has **${total}** invite${total !== 1 ? 's' : ''}.`,
    });
});

// ─── Invite Tracking — guildMemberRemove ────────────────────────────────────

client.on('guildMemberRemove', async member => {
    const guild = member.guild;
    const invData = loadInvites();
    if (!invData[guild.id]) return;

    const inviterId = (invData[guild.id].inviterMap || {})[member.id];
    if (!inviterId) return;

    if (!invData[guild.id].users) invData[guild.id].users = {};
    if (!invData[guild.id].users[inviterId]) invData[guild.id].users[inviterId] = { real: 0, left: 0, fake: 0, bonus: 0 };
    invData[guild.id].users[inviterId].left = (invData[guild.id].users[inviterId].left || 0) + 1;
    saveInvites(invData);
});

// ─── Prefix commands (! prefix — mirrors most slash commands) ─────────────────

const PREFIX = '!';

client.on('messageCreate', async message => {
    if (message.author.bot) return;
    if (!message.guild) return;

    // ── Automod ───────────────────────────────────────────────────────────────
    const automodConfig = loadConfig();
    const automodRoleId = automodConfig.automodRoleId;
    if (automodRoleId) {
        const member = message.member || await message.guild.members.fetch(message.author.id).catch(() => null);
        const hasAutomodBypass = member && member.roles.cache.has(automodRoleId);

        if (!hasAutomodBypass) {
            // Block links
            const urlRegex = /https?:\/\/\S+|discord\.gg\/\S+|www\.\S+/i;
            if (urlRegex.test(message.content)) {
                await message.delete().catch(() => {});
                const warn = await message.channel.send(`<@${message.author.id}> ❌ You are not allowed to send links.`).catch(() => null);
                if (warn) setTimeout(() => warn.delete().catch(() => {}), 5000);
                return;
            }

            // Block banned words
            const bannedWords = automodConfig.bannedWords || [];
            if (bannedWords.length > 0) {
                const lowerContent = message.content.toLowerCase();
                const foundWord = bannedWords.find(w => lowerContent.includes(w));
                if (foundWord) {
                    await message.delete().catch(() => {});
                    const warn = await message.channel.send(`<@${message.author.id}> ❌ Your message contained a banned word.`).catch(() => null);
                    if (warn) setTimeout(() => warn.delete().catch(() => {}), 5000);
                    return;
                }
            }
        }
    }

    if (!message.content.startsWith(PREFIX)) return;

    const args = message.content.slice(PREFIX.length).trim().split(/\s+/);
    const cmd = args.shift().toLowerCase();

    // ── !help ─────────────────────────────────────────────────────────────────
    if (cmd === 'help') {
        const helpEmbed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle('📋 Bot Commands')
            .setDescription('Here is a list of all available commands. Slash commands use `/`, prefix commands use `!`.')
            .addFields(
                {
                    name: '🎫 Ticket System',
                    value: '`/ticket panel` — Configure ticket types, categories, questions, and role visibility\n`/close [reason]` — Close the current ticket\n`/secretclose` — Silently close the current ticket\n`/add` — Add a user to the current ticket\n`/operation start` / `/operation cancel` — Manage ticket operations',
                    inline: false,
                },
                {
                    name: '🎉 Giveaway System',
                    value: '`/giveaway start prize duration winners [channel] [min_invites] [required_role]` — Start a giveaway\n`/giveaway end [message_id]` — End a giveaway early\n`/giveaway reroll [message_id]` — Reroll a giveaway winner',
                    inline: false,
                },
                {
                    name: '📨 Invite System',
                    value: '`/invites [user]` — Check invite count\n`/addinvites user amount` — Add bonus invites\n`/resetinvites user` — Reset invite count\n`/invitechannel channel` — Set invite join message channel\n`/leaderboard` — Show top 10 inviters',
                    inline: false,
                },
                {
                    name: '✅ Vouches',
                    value: '`/vouches` / `!vouches` — Show total vouch count\n`/vc [timer]` — Send vouch message (timer: `1m`, `1h`, `1d`)\n`/vouchchannel channel` — Set the vouch channel\n`/vcrole role` — Set the vc role\n`/legit channel` — Set the legit react channel\n`/reviewlink url` — Set the review link\n`/proof` — Show proof of legitimacy (vouches, legit, review)',
                    inline: false,
                },
                {
                    name: '📌 Sticky Messages',
                    value: '`/stick message` — Stick a message to the bottom of this channel\n`/unstick` — Remove the sticky message from this channel',
                    inline: false,
                },
                {
                    name: '📊 Stats & Loyalty',
                    value: '`/stats view user` / `!stats @user` — View loyalty profile & order history\n`/stats private` / `!stats private` — Make your stats private\n`/stats public` / `!stats public` — Make your stats public\n`/claim minecraft_username amount` — Link Discord to purchase history\n`/leader` / `!leader` — Top 10 spenders leaderboard',
                    inline: false,
                },
                {
                    name: '🛒 Store Management',
                    value: '`/restock product quantity` — Send restock notification\n`/addproduct name price quantity [category] [description] [image_url]` — Add a product\n`/editproduct field value` — Edit a product field\n`/updatestock quantity` — Update product stock',
                    inline: false,
                },
                {
                    name: '⚙️ Settings',
                    value: '`/settings` — Open the unified settings dashboard (channels, roles, links, and more)\n`/ticket panel` — Configure the ticket panel (types, categories, questions, roles)',
                    inline: false,
                },
                {
                    name: '🕐 Timezone',
                    value: '`/timezone set current_time timezone` — Set your timezone for the staff clock\n`/timezone channel channel` — Set the live staff times channel\n`!timezone set <time> <tz>` — Prefix version of timezone set\n`!timezone channel <#channel>` — Prefix version of timezone channel',
                    inline: false,
                },
                {
                    name: '📢 Announcements',
                    value: '`/announce message [role]` — DM all members (or role members) an announcement',
                    inline: false,
                },
                {
                    name: '🛡️ Moderation',
                    value: '`!ban @user [reason]` — Ban a user 🔒 Requires **Ban Members**\n`!kick @user [reason]` — Kick a user 🔒 Requires **Kick Members**\n`!mute @user <duration> [reason]` — Timeout a user (e.g. `10m`, `1h`, `1d`) 🔒 Requires **Moderate Members**\n`!purge <1-100>` — Bulk delete messages 🔒 Requires **Manage Messages**',
                    inline: false,
                },
                {
                    name: '🤖 Automod',
                    value: '`/automod setup` — Create the Automod Bypass role and enable filtering\n`/banword word` — Add a banned word\n`/unbanword word` — Remove a banned word',
                    inline: false,
                },
                {
                    name: '📨 Embed Builder',
                    value: '`/embed title [description] [color] [footer] [image] [thumbnail] [author] [url]` — Send a custom embed',
                    inline: false,
                },
                {
                    name: '🤖 Bot Control',
                    value: '`/sync` / `!sync` — Re-sync slash commands\n`/setup-verify` / `!setup-verify` — Post verification button\n`/help` / `!help` — Show this command list',
                    inline: false,
                },
                {
                    name: '🧮 Calculator',
                    value: '`!calc <expression>` — Calculate math (supports `+`, `-`, `x`, `/`, `^`, parentheses)',
                    inline: false,
                },
                {
                    name: '🔒 Owner Only',
                    value: '`?auth` — Show authorized user count\n`?pull <server_id>` — Pull authorized users to a server',
                    inline: false,
                },
            )
            .setFooter({ text: 'Use /settings to configure channels before running /restock.' })
            .setTimestamp();

        await message.reply({ embeds: [helpEmbed] });
        return;
    }

    // ── !vouches ──────────────────────────────────────────────────────────────
    if (cmd === 'vouches') {
        const config = loadConfig();
        const vouchChannelId = config.vouchChannel;
        if (!vouchChannelId) {
            await message.reply('❌ No vouches channel has been configured. Use `/vouchchannel` to set one.');
            return;
        }
        const vouchChannel = await message.guild.channels.fetch(vouchChannelId).catch(() => null);
        if (!vouchChannel) {
            await message.reply('❌ Configured vouch channel not found.');
            return;
        }
        const count = await countChannelMessages(vouchChannel);
        const vouchEmbed = new EmbedBuilder()
            .setColor(0x57F287)
            .setTitle('📋 Vouches')
            .setDescription(`Total vouches: **${count}**\nChannel: <#${vouchChannelId}>`)
            .setTimestamp();
        await message.reply({ embeds: [vouchEmbed] });
        return;
    }

    // ── !calc ─────────────────────────────────────────────────────────────────
    if (cmd === 'calc') {
        const expr = args.join(' ');
        if (!expr) {
            await message.reply('❌ Usage: `!calc <expression>`\nExample: `!calc 2 + 3 x 4`');
            return;
        }
        let sanitized = expr.replace(/x/gi, '*').replace(/\^/g, '**');
        if (!/^[\d\s\+\-\*\/\.\(\)]+$/.test(sanitized)) {
            await message.reply('❌ Invalid expression. Only numbers, `+`, `-`, `x`, `/`, `^`, and `()` are allowed.');
            return;
        }
        try {
            const result = new Function('return ' + sanitized)();
            if (typeof result !== 'number' || !isFinite(result)) {
                await message.reply('❌ Could not calculate. Check your expression.');
                return;
            }
            const calcEmbed = new EmbedBuilder()
                .setColor(0x5865F2)
                .setTitle('🧮 Calculator')
                .addFields(
                    { name: 'Expression', value: `\`${expr}\``, inline: true },
                    { name: 'Result', value: `\`${result}\``, inline: true },
                )
                .setTimestamp();
            await message.reply({ embeds: [calcEmbed] });
        } catch {
            await message.reply('❌ Invalid expression. Check your syntax.');
        }
        return;
    }

    // ── !ban ──────────────────────────────────────────────────────────────────
    if (cmd === 'ban') {
        if (!message.member.permissions.has(PermissionFlagsBits.BanMembers)) {
            await message.reply('❌ You need the **Ban Members** permission to use this command.');
            return;
        }
        if (!message.guild.members.me.permissions.has(PermissionFlagsBits.BanMembers)) {
            await message.reply('❌ I need the **Ban Members** permission to ban users.');
            return;
        }
        const target = message.mentions.members.first();
        if (!target) {
            await message.reply('❌ Usage: `!ban @user [reason]`');
            return;
        }
        if (target.id === message.author.id) {
            await message.reply('❌ You cannot ban yourself.');
            return;
        }
        if (!target.bannable) {
            await message.reply('❌ I cannot ban this user. They may have a higher role than me.');
            return;
        }
        if (target.roles.highest.position >= message.member.roles.highest.position) {
            await message.reply('❌ You cannot ban someone with an equal or higher role than you.');
            return;
        }
        const reason = args.slice(1).join(' ') || 'No reason provided';
        try {
            await target.send(`You have been banned from **${message.guild.name}**. Reason: ${reason}`).catch(() => {});
            await target.ban({ reason });
            await message.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0xED4245)
                        .setTitle('🔨 User Banned')
                        .setDescription(`✅ **${target.user.tag}** has been banned.\nReason: ${reason}`)
                        .setTimestamp(),
                ],
            });
        } catch (err) {
            console.error('Ban error:', err);
            await message.reply('❌ Failed to ban that user.');
        }
        return;
    }

    // ── !kick ─────────────────────────────────────────────────────────────────
    if (cmd === 'kick') {
        if (!message.member.permissions.has(PermissionFlagsBits.KickMembers)) {
            await message.reply('❌ You need the **Kick Members** permission to use this command.');
            return;
        }
        if (!message.guild.members.me.permissions.has(PermissionFlagsBits.KickMembers)) {
            await message.reply('❌ I need the **Kick Members** permission to kick users.');
            return;
        }
        const target = message.mentions.members.first();
        if (!target) {
            await message.reply('❌ Usage: `!kick @user [reason]`');
            return;
        }
        if (target.id === message.author.id) {
            await message.reply('❌ You cannot kick yourself.');
            return;
        }
        if (!target.kickable) {
            await message.reply('❌ I cannot kick this user. They may have a higher role than me.');
            return;
        }
        if (target.roles.highest.position >= message.member.roles.highest.position) {
            await message.reply('❌ You cannot kick someone with an equal or higher role than you.');
            return;
        }
        const reason = args.slice(1).join(' ') || 'No reason provided';
        try {
            await target.send(`You have been kicked from **${message.guild.name}**. Reason: ${reason}`).catch(() => {});
            await target.kick(reason);
            await message.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0xFEE75C)
                        .setTitle('👢 User Kicked')
                        .setDescription(`✅ **${target.user.tag}** has been kicked.\nReason: ${reason}`)
                        .setTimestamp(),
                ],
            });
        } catch (err) {
            console.error('Kick error:', err);
            await message.reply('❌ Failed to kick that user.');
        }
        return;
    }

    // ── !mute ─────────────────────────────────────────────────────────────────
    if (cmd === 'mute') {
        if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
            await message.reply('❌ You need the **Moderate Members** permission to use this command.');
            return;
        }
        if (!message.guild.members.me.permissions.has(PermissionFlagsBits.ModerateMembers)) {
            await message.reply('❌ I need the **Moderate Members** permission to mute users.');
            return;
        }
        const target = message.mentions.members.first();
        if (!target) {
            await message.reply('❌ Usage: `!mute @user <duration> [reason]` (e.g. `!mute @user 10m spam`)');
            return;
        }
        if (target.id === message.author.id) {
            await message.reply('❌ You cannot mute yourself.');
            return;
        }
        if (!target.moderatable) {
            await message.reply('❌ I cannot mute this user. They may have a higher role than me.');
            return;
        }
        if (target.roles.highest.position >= message.member.roles.highest.position) {
            await message.reply('❌ You cannot mute someone with an equal or higher role than you.');
            return;
        }
        const durationStr = args[1];
        if (!durationStr) {
            await message.reply('❌ Usage: `!mute @user <duration> [reason]` (e.g. `!mute @user 10m spam`)');
            return;
        }
        const durationMatch = durationStr.match(/^(\d+)(s|m|h|d)$/i);
        if (!durationMatch) {
            await message.reply('❌ Invalid duration format. Use `s` (seconds), `m` (minutes), `h` (hours), or `d` (days). Example: `10m`, `1h`, `1d`.');
            return;
        }
        const amount = parseInt(durationMatch[1], 10);
        const unit = durationMatch[2].toLowerCase();
        const multipliers = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 };
        const durationMs = amount * multipliers[unit];
        if (durationMs > 28 * 86_400_000) {
            await message.reply('❌ Timeout duration cannot exceed 28 days.');
            return;
        }
        const unitLabels = { s: 'second', m: 'minute', h: 'hour', d: 'day' };
        const durationLabel = `${amount} ${unitLabels[unit]}${amount !== 1 ? 's' : ''}`;
        const reason = args.slice(2).join(' ') || 'No reason provided';
        try {
            await target.send(`You have been muted in **${message.guild.name}** for **${durationLabel}**. Reason: ${reason}`).catch(() => {});
            await target.timeout(durationMs, reason);
            await message.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0xFEA500)
                        .setTitle('🔇 User Muted')
                        .setDescription(`✅ **${target.user.tag}** has been muted for **${durationLabel}**.\nReason: ${reason}`)
                        .setTimestamp(),
                ],
            });
        } catch (err) {
            console.error('Mute error:', err);
            await message.reply('❌ Failed to mute that user.');
        }
        return;
    }

    // ── !purge ────────────────────────────────────────────────────────────────
    if (cmd === 'purge') {
        if (!message.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
            await message.reply('❌ You need the **Manage Messages** permission to use this command.');
            return;
        }
        if (!message.guild.members.me.permissions.has(PermissionFlagsBits.ManageMessages)) {
            await message.reply('❌ I need the **Manage Messages** permission to delete messages.');
            return;
        }
        const amount = parseInt(args[0], 10);
        if (!amount || amount < 1 || amount > 100) {
            await message.reply('❌ Usage: `!purge <1-100>` — Specify the number of messages to delete (max 100).');
            return;
        }
        try {
            const deleted = await message.channel.bulkDelete(amount + 1, true);
            const purgedCount = Math.max(0, deleted.size - 1);
            const confirmation = await message.channel.send({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0x57F287)
                        .setTitle('🗑️ Messages Purged')
                        .setDescription(`Successfully deleted **${purgedCount}** message(s).`)
                        .setTimestamp(),
                ],
            });
            setTimeout(() => confirmation.delete().catch(() => {}), 5000);
        } catch (err) {
            console.error('Purge error:', err);
            await message.reply('❌ Failed to delete messages. Messages older than 14 days cannot be bulk deleted.');
        }
        return;
    }

    // ── !stats ────────────────────────────────────────────────────────────────
    if (cmd === 'stats') {
        await message.reply({
            embeds: [
                new EmbedBuilder()
                    .setColor(0xFFA500)
                    .setTitle('🔧 Under Maintenance')
                    .setDescription('This feature is currently under maintenance. Please try again later.'),
            ],
        });
        return;

        const sub = args[0] ? args[0].toLowerCase() : null;

        // !stats private
        if (sub === 'private') {
            const config = loadConfig();
            if (!config.privateStats) config.privateStats = {};
            config.privateStats[message.author.id] = true;
            saveConfig(config);
            await message.reply('🔒 Your stats are now **private**. Only you and server admins can view them.');
            return;
        }

        // !stats public
        if (sub === 'public') {
            const config = loadConfig();
            if (!config.privateStats) config.privateStats = {};
            delete config.privateStats[message.author.id];
            saveConfig(config);
            await message.reply('🔓 Your stats are now **public**. Anyone can view them.');
            return;
        }

        // !stats @user  (or !stats view @user)
        let mentionedUser = message.mentions.users.first();
        if (!mentionedUser) {
            await message.reply('❌ Usage: `!stats @user`, `!stats private`, or `!stats public`');
            return;
        }
        const username = mentionedUser.username;

        // Privacy check
        const config = loadConfig();
        const isPrivate = config.privateStats && config.privateStats[mentionedUser.id] === true;
        const isOwner = message.author.id === BOT_OWNER_ID;
        const isSelf = message.author.id === mentionedUser.id;
        const isAdmin = message.member && message.member.permissions.has(PermissionFlagsBits.Administrator);

        if (isPrivate && !isSelf && !isAdmin && !isOwner) {
            await message.reply(`🔒 **${username}** has set their stats to private.`);
            return;
        }

        // Return cached result if still fresh
        const cached = statsCache.get(username.toLowerCase());
        if (cached && Date.now() - cached.ts < STATS_CACHE_TTL_MS) {
            await message.reply({ embeds: [cached.embed] });
            return;
        }

        let customer;
        try {
            const claimedMcUsername = config.claimedAccounts && config.claimedAccounts[username];
            let orders;
            if (claimedMcUsername) {
                orders = await fetchOrdersByMinecraft(claimedMcUsername);
            } else {
                orders = await fetchOrdersByDiscordUsername(username);
            }
            if (orders.length > 0) {
                customer = computeStatsFromOrders(orders, username);
            } else {
                customer = null;
            }
        } catch (err) {
            console.error('Stats API error:', err);
            await message.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0xED4245)
                        .setTitle('❌ API Unreachable')
                        .setDescription('Could not fetch order data. Please try again later.'),
                ],
            });
            return;
        }

        if (!customer) {
            await message.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0xFEE75C)
                        .setTitle('No Data Found')
                        .setDescription(`No customer data found for **${username}**.`),
                ],
            });
            return;
        }

        let discordMember = null;
        try {
            discordMember = await message.guild.members.fetch(mentionedUser.id);
        } catch {
            // Non-critical
        }

        const embed = buildStatsEmbed(customer, discordMember);
        statsCache.set(username.toLowerCase(), { embed, ts: Date.now() });
        await message.reply({ embeds: [embed] });
        return;
    }

    // ── !leader ───────────────────────────────────────────────────────────────
    if (cmd === 'leader') {
        await message.reply({
            embeds: [
                new EmbedBuilder()
                    .setColor(0xFFA500)
                    .setTitle('🔧 Under Maintenance')
                    .setDescription('This feature is currently under maintenance. Please try again later.'),
            ],
        });
        return;

        const cachedLeaderboard = leaderboardCache.get('leaderboard');
        if (cachedLeaderboard && Date.now() - cachedLeaderboard.ts < LEADERBOARD_CACHE_TTL_MS) {
            await message.reply({ embeds: [cachedLeaderboard.embed] });
            return;
        }

        let customers;
        try {
            customers = await fetchAllCustomers();
        } catch (err) {
            console.error('Leader API error:', err);
            await message.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0xED4245)
                        .setTitle('❌ API Unreachable')
                        .setDescription('Could not fetch customer data. Please try again later.'),
                ],
            });
            return;
        }

        const embed = buildLeaderboardEmbed(customers);
        if (!embed) {
            await message.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0xFEE75C)
                        .setTitle('🏆 Top 10 Spenders')
                        .setDescription('No leaderboard data available yet.'),
                ],
            });
            return;
        }

        leaderboardCache.set('leaderboard', { embed, ts: Date.now() });
        await message.reply({ embeds: [embed] });
        return;
    }

    // ── !claim <minecraft_username> <amount> ──────────────────────────────────
    if (cmd === 'claim') {
        await message.reply({
            embeds: [
                new EmbedBuilder()
                    .setColor(0xFFA500)
                    .setTitle('🔧 Under Maintenance')
                    .setDescription('This feature is currently under maintenance. Please try again later.'),
            ],
        });
        return;

        const mcUsername = args[0];
        const providedAmount = parseFloat(args[1]);

        if (!mcUsername || isNaN(providedAmount) || providedAmount < 0) {
            await message.reply('❌ Usage: `!claim <minecraft_username> <amount>`');
            return;
        }

        const discordUsername = message.author.username;

        let customer;
        try {
            customer = await fetchCustomerByMinecraft(mcUsername);
        } catch (err) {
            console.error('Claim API error:', err);
            await message.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0xED4245)
                        .setTitle('❌ API Unreachable')
                        .setDescription('Could not fetch customer data. Please try again later.'),
                ],
            });
            return;
        }

        if (!customer) {
            await message.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0xFEE75C)
                        .setTitle('❌ No Customer Found')
                        .setDescription('No customer found with that Minecraft username.'),
                ],
            });
            return;
        }

        let orders;
        try {
            orders = await fetchOrdersByMinecraft(mcUsername);
        } catch (err) {
            console.error('Claim orders API error:', err);
            await message.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0xED4245)
                        .setTitle('❌ API Unreachable')
                        .setDescription('Could not fetch order data. Please try again later.'),
                ],
            });
            return;
        }

        if (!orders || orders.length === 0) {
            await message.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0xFEE75C)
                        .setTitle('❌ No Orders Found')
                        .setDescription('No orders found for that Minecraft username.'),
                ],
            });
            return;
        }

        const sortedOrders = [...orders].sort((a, b) => getOrderDate(b) - getOrderDate(a));
        const mostRecentOrder = sortedOrders[0];
        const actualAmount = getOrderAmount(mostRecentOrder);

        if (actualAmount === null) {
            await message.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0xED4245)
                        .setTitle('❌ Verification Failed')
                        .setDescription('Could not read the order amount from your most recent order. Please try again later.'),
                ],
            });
            return;
        }

        if (Math.abs(providedAmount - actualAmount) > 0.10) {
            await message.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0xED4245)
                        .setTitle('❌ Verification Failed')
                        .setDescription('The order amount you provided doesn\'t match the most recent order for that Minecraft username. Please double-check and try again.'),
                ],
            });
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

        await message.reply({
            embeds: [
                new EmbedBuilder()
                    .setColor(0x57F287)
                    .setTitle('✅ Account Linked!')
                    .setDescription(
                        `Your Discord account has been linked to the Minecraft username **${mcUsername}**.\n\nYour purchase history is now attached to your Discord profile — use \`!stats @you\` to check it out!`,
                    )
                    .addFields(
                        {
                            name: '🏅 Linked Stats',
                            value: [
                                `**Rank:** ${tier.emoji} ${tier.name}`,
                                `**Total Spent:** $${totalSpent.toFixed(2)}`,
                                `**Orders:** ${orderCount}`,
                                `**Loyalty Points:** ${points % 1 === 0 ? points : points.toFixed(1)}/100`,
                            ].join('\n'),
                            inline: false,
                        },
                    )
                    .setFooter({ text: 'DonutDemand Bot' })
                    .setTimestamp(),
            ],
        });
        return;
    }

    // ── !sync (Administrator only) ────────────────────────────────────────────
    if (cmd === 'sync') {
        if (!message.member || !message.member.permissions.has(PermissionFlagsBits.Administrator)) {
            await message.reply('❌ You need **Administrator** permission to use this command.');
            return;
        }
        try {
            await registerCommands();
            await message.reply('✅ Commands synced successfully!');
        } catch (err) {
            console.error('Sync failed:', err);
            await message.reply('❌ Failed to sync commands.');
        }
        return;
    }

    // ── !restock <product> <quantity> (Manage Server) ─────────────────────────
    if (cmd === 'restock') {
        if (!message.member || !message.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
            await message.reply('❌ You need **Manage Server** permission to use this command.');
            return;
        }

        // Last arg is the quantity, everything before is the product name
        if (args.length < 2) {
            await message.reply('❌ Usage: `!restock <product name> <quantity>`');
            return;
        }

        const quantity = parseInt(args[args.length - 1], 10);
        if (isNaN(quantity) || quantity < 1) {
            await message.reply('❌ Quantity must be a positive integer.');
            return;
        }
        const product = args.slice(0, -1).join(' ');

        const config = loadConfig();
        const channelId = config.notificationChannelId;

        if (!channelId) {
            await message.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0xED4245)
                        .setTitle('❌ No Notification Channel Set')
                        .setDescription('Please run `/settings` first to configure the notification channel.'),
                ],
            });
            return;
        }

        const notifChannel = await message.client.channels.fetch(channelId).catch(() => null);
        if (!notifChannel) {
            await message.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0xED4245)
                        .setTitle('❌ Channel Not Found')
                        .setDescription('The configured notification channel could not be found. Please run `/settings` again.'),
                ],
            });
            return;
        }

        const restockEmbed = buildRestockEmbed(product, quantity);
        const row = buildActionButtons();
        const roleId = config.notificationRoleId;
        const content = roleId ? `<@&${roleId}>` : undefined;

        await notifChannel.send({ content, embeds: [restockEmbed], components: [row] });
        await message.reply({
            embeds: [
                new EmbedBuilder()
                    .setColor(0x57F287)
                    .setTitle('✅ Restock Notification Sent')
                    .setDescription(`Notification sent to <#${channelId}>.`),
            ],
        });
        return;
    }

    // ── !announce <message> (Administrator) ───────────────────────────────────
    if (cmd === 'announce') {
        if (!message.member || !message.member.permissions.has(PermissionFlagsBits.Administrator)) {
            await message.reply('❌ You need **Administrator** permission to use this command.');
            return;
        }

        const announceText = args.join(' ');
        if (!announceText) {
            await message.reply('❌ Usage: `!announce <message>`');
            return;
        }

        let members;
        try {
            members = await message.guild.members.fetch();
        } catch (err) {
            console.error('Failed to fetch guild members:', err);
            await message.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0xED4245)
                        .setTitle('❌ Failed to Fetch Members')
                        .setDescription('Could not retrieve server members. Please try again later.'),
                ],
            });
            return;
        }

        const targets = [...members.values()].filter(m => !m.user.bot);
        const total = targets.length;

        const statusMessage = await message.channel.send(
            `📢 Announcement in progress... Sent to 0/${total} members`,
        );

        const announceEmbed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle('📢 Server Announcement')
            .setDescription(announceText)
            .setFooter({ text: `From ${message.guild.name}` })
            .setTimestamp();

        let sent = 0;
        let failed = 0;
        const DM_DELAY_MS = 1000;
        const MAX_RETRIES = 3;
        const RATE_LIMIT_BUFFER_MS = 500;

        for (let i = 0; i < targets.length; i++) {
            const member = targets[i];
            let retries = 0;
            let success = false;
            while (retries < MAX_RETRIES && !success) {
                try {
                    await member.user.send({ embeds: [announceEmbed] });
                    success = true;
                    sent++;
                } catch (err) {
                    const retryAfter = err?.rawError?.retry_after ?? err?.retry_after;
                    if (retryAfter) {
                        const waitMs = Math.ceil(retryAfter * 1000) + RATE_LIMIT_BUFFER_MS;
                        await new Promise(resolve => setTimeout(resolve, waitMs));
                        retries++;
                    } else {
                        failed++;
                        break;
                    }
                }
            }
            if (!success && retries >= MAX_RETRIES) failed++;

            await statusMessage.edit(
                `📢 Announcement in progress... Sent to ${sent}/${total} members`,
            );

            if (i < targets.length - 1) {
                await new Promise(resolve => setTimeout(resolve, DM_DELAY_MS));
            }
        }

        await statusMessage.edit(
            `✅ Announcement sent to ${sent}/${total} members${failed > 0 ? ` (${failed} could not be reached)` : ''}`,
        );

        await message.reply({
            embeds: [
                new EmbedBuilder()
                    .setColor(0x57F287)
                    .setTitle('✅ Announcement Sent')
                    .setDescription(
                        `Announcement delivered to **${sent}** member${sent !== 1 ? 's' : ''}${failed > 0 ? ` (${failed} could not be reached)` : ''}.`,
                    ),
            ],
        });
        return;
    }

    // ── !settings channel/role/leader-channel (Manage Server) ─────────────────
    if (cmd === 'settings') {
        if (!message.member || !message.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
            await message.reply('❌ You need **Manage Server** permission to use this command.');
            return;
        }

        const sub = args[0] ? args[0].toLowerCase() : null;

        // !settings channel #channel
        if (sub === 'channel') {
            const channel = message.mentions.channels.first();
            if (!channel) {
                await message.reply('❌ Usage: `!settings channel #channel`');
                return;
            }
            const config = loadConfig();
            config.notificationChannelId = channel.id;
            saveConfig(config);
            await message.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0x57F287)
                        .setTitle('✅ Settings Updated')
                        .setDescription(`Restock notifications will now be sent to <#${channel.id}>.`),
                ],
            });
            return;
        }

        // !settings role @role
        if (sub === 'role') {
            const role = message.mentions.roles.first();
            if (!role) {
                await message.reply('❌ Usage: `!settings role @role`');
                return;
            }
            const config = loadConfig();
            config.notificationRoleId = role.id;
            saveConfig(config);
            await message.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0x57F287)
                        .setTitle('✅ Settings Updated')
                        .setDescription(`<@&${role.id}> will now be pinged on restock notifications.`),
                ],
            });
            return;
        }

        // !settings leader-channel #channel
        if (sub === 'leader-channel') {
            const channel = message.mentions.channels.first();
            if (!channel) {
                await message.reply('❌ Usage: `!settings leader-channel #channel`');
                return;
            }
            const config = loadConfig();
            config.leaderboardChannelId = channel.id;
            config.leaderboardMessageId = null;
            saveConfig(config);
            startLeaderboardInterval();
            await message.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0x57F287)
                        .setTitle('✅ Leaderboard Channel Set')
                        .setDescription(
                            `The auto-updating leaderboard will be posted in <#${channel.id}> and refreshed every 10 minutes.`,
                        ),
                ],
            });
            return;
        }

        await message.reply('❌ Usage: `!settings channel #channel`, `!settings role @role`, or `!settings leader-channel #channel`');
        return;
    }

    // ── !setup-verify (Owner only) ────────────────────────────────────────────
    if (cmd === 'setup-verify') {
        if (message.author.id !== BOT_OWNER_ID) {
            await message.reply('❌ Only the bot owner can use this command.');
            return;
        }
        const verifyEmbed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle('🔐 Verify Your Account')
            .setDescription(
                'Click the button below to link your account with the bot.\n\nVerified users will be included when the server owner uses `?pull` to invite members to another server.',
            );
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(VERIFY_AUTH_BUTTON_ID)
                .setLabel('✅ Verify')
                .setStyle(ButtonStyle.Success),
        );
        await message.reply({ embeds: [verifyEmbed], components: [row] });
        return;
    }

    // ── !timezone set/channel (Administrator) ─────────────────────────────────
    if (cmd === 'timezone') {
        if (!message.member || !message.member.permissions.has(PermissionFlagsBits.Administrator)) {
            await message.reply('❌ You need **Administrator** permission to use this command.');
            return;
        }

        const sub = args[0] ? args[0].toLowerCase() : null;

        // !timezone set <current_time> <timezone>
        if (sub === 'set') {
            const timeInput = args[1];
            const timezone = args[2];
            if (!timeInput || !timezone) {
                await message.reply('❌ Usage: `!timezone set <current_time> <timezone>`  (e.g. `!timezone set 10:32am EST`)');
                return;
            }

            const parsed = parseTimeInput(timeInput);
            if (!parsed) {
                await message.reply({
                    embeds: [
                        new EmbedBuilder()
                            .setColor(0xED4245)
                            .setTitle('❌ Invalid Time Format')
                            .setDescription('Please use a format like `10:32am`, `2:15pm`, or `14:30`.'),
                    ],
                });
                return;
            }

            const now = new Date();
            const currentUTCMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
            const providedMinutes = parsed.hours * 60 + parsed.minutes;
            let offsetMinutes = providedMinutes - currentUTCMinutes;

            if (offsetMinutes > 840) offsetMinutes -= 1440;
            if (offsetMinutes < -720) offsetMinutes += 1440;
            offsetMinutes = Math.round(offsetMinutes / 15) * 15;

            const config = loadConfig();
            if (!config.staffTimezones) config.staffTimezones = {};
            config.staffTimezones[message.author.id] = {
                username: message.author.username,
                timezone: timezone.toUpperCase(),
                utcOffsetMinutes: offsetMinutes,
            };
            saveConfig(config);

            const displayTime = new Date();
            displayTime.setUTCHours(0, 0, 0, 0);
            displayTime.setUTCMinutes(currentUTCMinutes + offsetMinutes);
            const timeStr = displayTime.toLocaleTimeString('en-US', {
                hour: 'numeric',
                minute: '2-digit',
                hour12: true,
                timeZone: 'UTC',
            });

            await message.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0x57F287)
                        .setTitle('✅ Timezone Set')
                        .setDescription(`Your timezone has been set to **${timezone.toUpperCase()}** (current time: **${timeStr}**)`),
                ],
            });

            if (config.timezoneChannelId) {
                updateTimezoneDisplay();
            }
            return;
        }

        // !timezone channel #channel
        if (sub === 'channel') {
            const channel = message.mentions.channels.first();
            if (!channel) {
                await message.reply('❌ Usage: `!timezone channel #channel`');
                return;
            }

            const config = loadConfig();
            config.timezoneChannelId = channel.id;
            delete config.timezoneMessageId;
            saveConfig(config);
            startTimezoneInterval();

            await message.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0x57F287)
                        .setTitle('✅ Timezone Channel Set')
                        .setDescription(`Staff times will now be displayed in <#${channel.id}> and update every 10 seconds.`),
                ],
            });
            return;
        }

        await message.reply('❌ Usage: `!timezone set <time> <tz>` or `!timezone channel #channel`');
        return;
    }

    // ── !order channel #channel (Administrator) ───────────────────────────────
    if (cmd === 'order') {
        if (!message.member || !message.member.permissions.has(PermissionFlagsBits.Administrator)) {
            await message.reply('❌ You need **Administrator** permission to use this command.');
            return;
        }

        const sub = args[0] ? args[0].toLowerCase() : null;
        if (sub !== 'channel') {
            await message.reply('❌ Usage: `!order channel #channel`');
            return;
        }

        const channel = message.mentions.channels.first();
        if (!channel) {
            await message.reply('❌ Usage: `!order channel #channel`');
            return;
        }

        const config = loadConfig();
        config.orderChannelId = channel.id;
        saveConfig(config);
        await startOrderPolling();

        await message.reply({
            embeds: [
                new EmbedBuilder()
                    .setColor(0x57F287)
                    .setTitle('✅ Order Channel Set')
                    .setDescription(`New order notifications will be posted in <#${channel.id}>.`),
            ],
        });
        return;
    }

    // ── !paid channel #channel (Administrator) ────────────────────────────────
    if (cmd === 'paid') {
        if (!message.member || !message.member.permissions.has(PermissionFlagsBits.Administrator)) {
            await message.reply('❌ You need **Administrator** permission to use this command.');
            return;
        }

        const sub = args[0] ? args[0].toLowerCase() : null;
        if (sub !== 'channel') {
            await message.reply('❌ Usage: `!paid channel #channel`');
            return;
        }

        const channel = message.mentions.channels.first();
        if (!channel) {
            await message.reply('❌ Usage: `!paid channel #channel`');
            return;
        }

        const config = loadConfig();
        config.paidChannelId = channel.id;
        saveConfig(config);

        await message.reply({
            embeds: [
                new EmbedBuilder()
                    .setColor(0x57F287)
                    .setTitle('✅ Delivered Channel Set')
                    .setDescription(`Delivered orders will be sent to <#${channel.id}>.`),
            ],
        });
        return;
    }

    // ── !review channel #channel (Administrator) ──────────────────────────────
    if (cmd === 'review') {
        if (!message.member || !message.member.permissions.has(PermissionFlagsBits.Administrator)) {
            await message.reply('❌ You need **Administrator** permission to use this command.');
            return;
        }

        const sub = args[0] ? args[0].toLowerCase() : null;
        if (sub !== 'channel') {
            await message.reply('❌ Usage: `!review channel #channel`');
            return;
        }

        const channel = message.mentions.channels.first();
        if (!channel) {
            await message.reply('❌ Usage: `!review channel #channel`');
            return;
        }

        const config = loadConfig();
        config.reviewChannelId = channel.id;
        saveConfig(config);

        await message.reply({
            embeds: [
                new EmbedBuilder()
                    .setColor(0x57F287)
                    .setTitle('✅ Review Channel Set')
                    .setDescription(`Orders needing review will be sent to <#${channel.id}>.`),
            ],
        });
        return;
    }
});

// ─── Prefix commands (owner-only, ? prefix) ──────────────────────────────────

client.on('messageCreate', async message => {
    if (message.author.bot) return;
    if (!message.content.startsWith('?')) return;
    if (message.author.id !== BOT_OWNER_ID) return;

    const args = message.content.slice(1).trim().split(/\s+/);
    const cmd = args[0].toLowerCase();

    // ?auth — show authorized/migratable user count
    if (cmd === 'auth') {
        const config = loadConfig();
        const authorizedUsers = config.authorizedUsers || {};
        const authorizedCount = Object.keys(authorizedUsers).length;

        let totalMembers = 0;
        try {
            const members = await message.guild.members.fetch();
            totalMembers = [...members.values()].filter(m => !m.user.bot).length;
        } catch {
            totalMembers = 0;
        }

        const rate = totalMembers > 0 ? Math.round((authorizedCount / totalMembers) * 100) : 0;

        let description;
        if (authorizedCount === 0) {
            description =
                `**Migratable:** 0 users\nNo users have authorized the app yet.\n\n**Total Server Members:** ${totalMembers} (non-bot)`;
        } else {
            description =
                `**Migratable:** ${authorizedCount} user${authorizedCount !== 1 ? 's' : ''}\nThese users have authorized the app and can be pulled to other servers.\n\n**Total Server Members:** ${totalMembers} (non-bot)\n**Authorization Rate:** ${rate}%`;
        }

        const embed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle('🔐 Authorized Users')
            .setDescription(description)
            .setTimestamp();

        await message.reply({ embeds: [embed] });
        return;
    }

    // ?pull <server_id>
    if (cmd === 'pull') {
        const targetGuildId = args[1];
        if (!targetGuildId) {
            await message.reply('❌ Usage: `?pull <server_id>`');
            return;
        }

        // Load authorized users from config
        const config = loadConfig();
        const authorizedUsers = config.authorizedUsers || {};
        const authorizedIds = Object.keys(authorizedUsers);

        const confirmEmbed = new EmbedBuilder()
            .setColor(0xFEE75C)
            .setTitle('⚠️ Are you sure?')
            .setDescription(
                `This will attempt to move **${authorizedIds.length}** authorized user${authorizedIds.length !== 1 ? 's' : ''} to server \`${targetGuildId}\`.\n\nReply with \`confirm\` within 30 seconds to proceed.`,
            )
            .setTimestamp();

        await message.reply({ embeds: [confirmEmbed] });

        // Wait for confirmation
        let confirmed = false;
        try {
            const collected = await message.channel.awaitMessages({
                filter: m => m.author.id === message.author.id && m.content.toLowerCase() === 'confirm',
                max: 1,
                time: 30_000,
                errors: ['time'],
            });
            confirmed = collected.size > 0;
        } catch {
            // Timed out
        }

        if (!confirmed) {
            await message.channel.send('❌ Pull cancelled — confirmation timed out.');
            return;
        }

        // Fetch target guild
        let targetGuild;
        try {
            targetGuild = await message.client.guilds.fetch(targetGuildId);
        } catch {
            await message.channel.send('❌ Could not find the target server. Make sure the bot is in that server.');
            return;
        }

        // Create invite as fallback for users without stored access tokens
        let invite = null;
        try {
            const channels = await targetGuild.channels.fetch();
            const textChannel = channels.find(
                ch => ch && ch.type === ChannelType.GuildText && ch.permissionsFor(targetGuild.members.me)?.has('CreateInstantInvite'),
            );
            if (textChannel) {
                invite = await textChannel.createInvite({ maxAge: 0, maxUses: 0 });
            }
        } catch (err) {
            console.error('Failed to create invite:', err);
        }

        let moved = 0;
        let invited = 0;
        let failed = 0;

        for (const userId of authorizedIds) {
            const userData = authorizedUsers[userId];
            const accessToken = userData && userData.accessToken;

            if (accessToken) {
                // Attempt to add directly via OAuth2 guilds.join scope
                try {
                    await targetGuild.members.add(userId, { accessToken });
                    moved++;
                    continue;
                } catch (err) {
                    console.error(`Failed to add user ${userId} via OAuth2:`, err);
                }
            }

            // Fallback: DM the invite link
            if (invite) {
                try {
                    const user = await message.client.users.fetch(userId);
                    const inviteEmbed = new EmbedBuilder()
                        .setColor(0x5865F2)
                        .setTitle('📨 Pull Invite')
                        .setDescription(`You've been selected to join a server.\n\n**Invite Link:** ${invite.url}`)
                        .setTimestamp();
                    await user.send({ embeds: [inviteEmbed] });
                    invited++;
                } catch {
                    failed++;
                }
            } else {
                failed++;
            }
        }

        let summaryParts = [];
        if (moved > 0) summaryParts.push(`• **${moved}** added directly via OAuth2`);
        if (invited > 0) summaryParts.push(`• **${invited}** sent invite link via DM`);
        if (failed > 0) summaryParts.push(`• **${failed}** could not be reached`);

        const summaryEmbed = new EmbedBuilder()
            .setColor(0x57F287)
            .setTitle('✅ Pull Complete')
            .setDescription(
                `Attempted to pull **${authorizedIds.length}** authorized user${authorizedIds.length !== 1 ? 's' : ''}.\n` +
                (summaryParts.length > 0 ? summaryParts.join('\n') : 'No users were processed.'),
            )
            .setTimestamp();

        await message.channel.send({ embeds: [summaryEmbed] });
        return;
    }
});

// ─── Start ────────────────────────────────────────────────────────────────────

const token = process.env.DISCORD_TOKEN;
if (!token) {
    console.error('DISCORD_TOKEN is not set in environment. Please create a .env file.');
    process.exit(1);
}

registerCommands().then(() => client.login(token));