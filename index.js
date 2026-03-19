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
        .setDescription('Configure bot settings')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand(sub =>
            sub
                .setName('channel')
                .setDescription('Set the channel for restock notifications')
                .addChannelOption(opt =>
                    opt
                        .setName('channel')
                        .setDescription('The channel to send restock notifications in')
                        .setRequired(true),
                ),
        )
        .addSubcommand(sub =>
            sub
                .setName('role')
                .setDescription('Set the role to ping on restock notifications')
                .addRoleOption(opt =>
                    opt
                        .setName('role')
                        .setDescription('The role to mention in restock notifications')
                        .setRequired(true),
                ),
        )
        .addSubcommand(sub =>
            sub
                .setName('leader-channel')
                .setDescription('Set a channel for the auto-updating leaderboard')
                .addChannelOption(opt =>
                    opt
                        .setName('channel')
                        .setDescription('The channel to post the live leaderboard in')
                        .setRequired(true),
                ),
        ),

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

// ─── Discord client ───────────────────────────────────────────────────────────

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

client.once('ready', () => {
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

    if (!interaction.isChatInputCommand()) return;

    // /help
    if (interaction.commandName === 'help') {
        const helpEmbed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle('📋 Bot Commands')
            .setDescription('Here is a list of all available commands.\nAll commands also work with the `!` prefix (e.g. `!help`, `!stats @user`).')
            .addFields(
                {
                    name: '`/help`',
                    value: 'Show this command list.',
                    inline: false,
                },
                {
                    name: '`/settings channel <#channel>`',
                    value: 'Set the channel where restock notifications are sent.\n🔒 Requires **Manage Server** permission.',
                    inline: false,
                },
                {
                    name: '`/settings role <@role>`',
                    value: 'Set the role to ping in restock notifications.\n🔒 Requires **Manage Server** permission.',
                    inline: false,
                },
                {
                    name: '`/restock product:<name> quantity:<n>`',
                    value: 'Send a restock notification embed to the configured channel.\n🔒 Requires **Manage Server** permission.',
                    inline: false,
                },
                {
                    name: '`/announce message:<text> [role:<@role>]`',
                    value: 'Send an announcement DM to all members, or only to members with a specific role.\n🔒 Requires **Administrator** permission.',
                    inline: false,
                },
                {
                    name: '`/updatestock quantity:<n>`',
                    value: 'Select a product from a dropdown and set its stock to a new quantity.\n🔒 Requires **Administrator** permission.',
                    inline: false,
                },
                {
                    name: '`/addproduct name:<name> price:<$> quantity:<n> [category:<cat>] [description:<text>] [image_url:<url>]`',
                    value: 'Add a new product to the store with a name, price, and quantity. Optionally set a category, description, and image.\n🔒 Requires **Administrator** permission.',
                    inline: false,
                },
                {
                    name: '`/editproduct field:<field> value:<new_value>`',
                    value: 'Select a product from a dropdown and update one of its fields (Name, Price, Quantity, Category, Description, or Image URL).\n🔒 Requires **Administrator** permission.',
                    inline: false,
                },
                {
                    name: '`/claim minecraft_username:<name> amount:<dollars>`',
                    value: 'Link your Discord account to your purchase history. Provide the Minecraft username you used at checkout and your most recent order amount in USD for verification.',
                    inline: false,
                },
                {
                    name: '`/stats view user:@user`',
                    value: 'Display the loyalty profile, points, and order history for a customer.',
                    inline: false,
                },
                {
                    name: '`/stats private`',
                    value: 'Set your stats to private — only you and server admins can view them.',
                    inline: false,
                },
                {
                    name: '`/stats public`',
                    value: 'Set your stats back to public — anyone can view them.',
                    inline: false,
                },
                {
                    name: '`/sync`',
                    value: 'Re-sync all bot slash commands with Discord.\n🔒 Requires **Administrator** permission.',
                    inline: false,
                },
                {
                    name: '`/setup-verify`',
                    value: 'Post a verification button for users to authorize with the bot.\n🔒 Requires **Administrator** permission.',
                    inline: false,
                },
                {
                    name: '`?auth`',
                    value: 'Show how many users have authorized the app (migratable users).\n🔒 Owner only.',
                    inline: false,
                },
                {
                    name: '`?pull <server_id>`',
                    value: 'Pull all authorized users to the specified server.\n🔒 Owner only.',
                    inline: false,
                },
                {
                    name: '`/leader`',
                    value: 'Display the top 10 spenders leaderboard.',
                    inline: false,
                },
                {
                    name: '`/settings leader-channel <#channel>`',
                    value: 'Set a channel for the auto-updating leaderboard (refreshes every 10 minutes).\n🔒 Requires **Manage Server** permission.',
                    inline: false,
                },
                {
                    name: '`/timezone set current_time:<time> timezone:<tz>`',
                    value: 'Set your current local time and timezone for the staff clock display.\n🔒 Requires **Administrator** permission.',
                    inline: false,
                },
                {
                    name: '`/timezone channel <#channel>`',
                    value: 'Set the channel for the live-updating staff times display.\n🔒 Requires **Administrator** permission.',
                    inline: false,
                },
                {
                    name: '`/order channel <#channel>`',
                    value: 'Set the channel where new order notifications are posted.\n🔒 Requires **Administrator** permission.',
                    inline: false,
                },
                {
                    name: '`/paid channel <#channel>`',
                    value: 'Set the channel where orders are forwarded when marked as **Delivered**.\n🔒 Requires **Administrator** permission.',
                    inline: false,
                },
                {
                    name: '`/review channel <#channel>`',
                    value: 'Set the channel where orders are forwarded when marked as **Needs Review**.\n🔒 Requires **Administrator** permission.',
                    inline: false,
                },
            )
            .setFooter({ text: 'Use /settings channel first before running /restock.' })
            .setTimestamp();

        await interaction.reply({ embeds: [helpEmbed], ephemeral: true });
        return;
    }

    // /settings channel
    if (
        interaction.commandName === 'settings' &&
        interaction.options.getSubcommand() === 'channel'
    ) {
        const channel = interaction.options.getChannel('channel');
        const config = loadConfig();
        config.notificationChannelId = channel.id;
        saveConfig(config);

        await interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setColor(0x57F287)
                    .setTitle('✅ Settings Updated')
                    .setDescription(
                        `Restock notifications will now be sent to <#${channel.id}>.`,
                    ),
            ],
            ephemeral: true,
        });
        return;
    }

    // /settings role
    if (
        interaction.commandName === 'settings' &&
        interaction.options.getSubcommand() === 'role'
    ) {
        const role = interaction.options.getRole('role');
        const config = loadConfig();
        config.notificationRoleId = role.id;
        saveConfig(config);

        await interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setColor(0x57F287)
                    .setTitle('✅ Settings Updated')
                    .setDescription(
                        `<@&${role.id}> will now be pinged on restock notifications.`,
                    ),
            ],
            ephemeral: true,
        });
        return;
    }

    // /settings leader-channel
    if (
        interaction.commandName === 'settings' &&
        interaction.options.getSubcommand() === 'leader-channel'
    ) {
        const channel = interaction.options.getChannel('channel');
        const config = loadConfig();
        config.leaderboardChannelId = channel.id;
        config.leaderboardMessageId = null;
        saveConfig(config);

        startLeaderboardInterval();

        await interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setColor(0x57F287)
                    .setTitle('✅ Leaderboard Channel Set')
                    .setDescription(
                        `The auto-updating leaderboard will be posted in <#${channel.id}> and refreshed every 10 minutes.`,
                    ),
            ],
            ephemeral: true,
        });
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
                            'Please run `/settings channel` first to configure the notification channel.',
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
                            'The configured notification channel could not be found. Please run `/settings channel` again.',
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
            // Check if this Discord user has a claimed Minecraft username mapping
            const claimedMcUsername = config.claimedAccounts && config.claimedAccounts[username];
            if (claimedMcUsername) {
                customer = await fetchCustomerByMinecraft(claimedMcUsername);
            } else {
                customer = await fetchCustomerData(username);
            }
        } catch (err) {
            console.error('Stats API error:', err);
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

    // /leader
    if (interaction.commandName === 'leader') {
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
});

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

// ─── Prefix commands (! prefix — mirrors most slash commands) ─────────────────

const PREFIX = '!';

client.on('messageCreate', async message => {
    if (message.author.bot) return;
    if (!message.content.startsWith(PREFIX)) return;

    const args = message.content.slice(PREFIX.length).trim().split(/\s+/);
    const cmd = args.shift().toLowerCase();

    // ── !help ─────────────────────────────────────────────────────────────────
    if (cmd === 'help') {
        const helpEmbed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle('📋 Bot Commands')
            .setDescription('Here is a list of all available commands.\nAll commands work with both `/` slash and `!` prefix.')
            .addFields(
                {
                    name: '`!help`',
                    value: 'Show this command list.',
                    inline: false,
                },
                {
                    name: '`!settings channel <#channel>`',
                    value: 'Set the channel where restock notifications are sent.\n🔒 Requires **Manage Server** permission.',
                    inline: false,
                },
                {
                    name: '`!settings role <@role>`',
                    value: 'Set the role to ping in restock notifications.\n🔒 Requires **Manage Server** permission.',
                    inline: false,
                },
                {
                    name: '`!settings leader-channel <#channel>`',
                    value: 'Set a channel for the auto-updating leaderboard (refreshes every 10 minutes).\n🔒 Requires **Manage Server** permission.',
                    inline: false,
                },
                {
                    name: '`!restock <product> <quantity>`',
                    value: 'Send a restock notification embed to the configured channel.\n🔒 Requires **Manage Server** permission.',
                    inline: false,
                },
                {
                    name: '`!announce <message>`',
                    value: 'Send an announcement DM to all members.\n🔒 Requires **Administrator** permission.',
                    inline: false,
                },
                {
                    name: '`!claim <minecraft_username> <amount>`',
                    value: 'Link your Discord account to your purchase history. Provide the Minecraft username you used at checkout and your most recent order amount in USD for verification.',
                    inline: false,
                },
                {
                    name: '`!stats @user`',
                    value: 'Display the loyalty profile, points, and order history for a customer.',
                    inline: false,
                },
                {
                    name: '`!stats private`',
                    value: 'Set your stats to private — only you and server admins can view them.',
                    inline: false,
                },
                {
                    name: '`!stats public`',
                    value: 'Set your stats back to public — anyone can view them.',
                    inline: false,
                },
                {
                    name: '`!leader`',
                    value: 'Display the top 10 spenders leaderboard.',
                    inline: false,
                },
                {
                    name: '`!sync`',
                    value: 'Re-sync all bot slash commands with Discord.\n🔒 Requires **Administrator** permission.',
                    inline: false,
                },
                {
                    name: '`!setup-verify`',
                    value: 'Post a verification button for users to authorize with the bot.\n🔒 Requires **Administrator** permission.',
                    inline: false,
                },
                {
                    name: '`!timezone set <time> <tz>`',
                    value: 'Set your current local time and timezone for the staff clock display.\n🔒 Requires **Administrator** permission.',
                    inline: false,
                },
                {
                    name: '`!timezone channel <#channel>`',
                    value: 'Set the channel for the live-updating staff times display.\n🔒 Requires **Administrator** permission.',
                    inline: false,
                },
                {
                    name: '`!order channel <#channel>`',
                    value: 'Set the channel where new order notifications are posted.\n🔒 Requires **Administrator** permission.',
                    inline: false,
                },
                {
                    name: '`!paid channel <#channel>`',
                    value: 'Set the channel where orders are forwarded when marked as **Delivered**.\n🔒 Requires **Administrator** permission.',
                    inline: false,
                },
                {
                    name: '`!review channel <#channel>`',
                    value: 'Set the channel where orders are forwarded when marked as **Needs Review**.\n🔒 Requires **Administrator** permission.',
                    inline: false,
                },
                {
                    name: '`?auth`',
                    value: 'Show how many users have authorized the app (migratable users).\n🔒 Owner only.',
                    inline: false,
                },
                {
                    name: '`?pull <server_id>`',
                    value: 'Pull all authorized users to the specified server.\n🔒 Owner only.',
                    inline: false,
                },
            )
            .setFooter({ text: 'Use !settings channel first before running !restock.' })
            .setTimestamp();

        await message.reply({ embeds: [helpEmbed] });
        return;
    }

    // ── !stats ────────────────────────────────────────────────────────────────
    if (cmd === 'stats') {
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
            if (claimedMcUsername) {
                customer = await fetchCustomerByMinecraft(claimedMcUsername);
            } else {
                customer = await fetchCustomerData(username);
            }
        } catch (err) {
            console.error('Stats API error:', err);
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
                        .setDescription('Please run `!settings channel #channel` first to configure the notification channel.'),
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
                        .setDescription('The configured notification channel could not be found. Please run `!settings channel` again.'),
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
            `📢 Announcement in progress... Sent to 0/${total} all members`,
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
                `📢 Announcement in progress... Sent to ${sent}/${total} all members`,
            );

            if (i < targets.length - 1) {
                await new Promise(resolve => setTimeout(resolve, DM_DELAY_MS));
            }
        }

        await statusMessage.edit(
            `✅ Announcement sent to ${sent}/${total} all members${failed > 0 ? ` (${failed} could not be reached)` : ''}`,
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