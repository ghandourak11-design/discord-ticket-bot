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
        .setName('setup-verify')
        .setDescription('Post a verification button for users to authorize with the bot')
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

const STOCK_API_URL =
    'https://app.base44.com/api/apps/698bba4e9e06a075e7c32be6/entities/Product';

const SHOW_STOCK_BUTTON_ID = 'show_current_stock';
const ORDER_NOW_BUTTON_ID = 'order_now';
const UPDATESTOCK_SELECT_PREFIX = 'updatestock_select:';
const VALUE_SEPARATOR = '::::';
const VERIFY_AUTH_BUTTON_ID = 'verify_auth_button';

function fetchCurrentStock() {
    return new Promise((resolve, reject) => {
        https
            .get(STOCK_API_URL, res => {
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
            })
            .on('error', reject);
    });
}

function updateProductStock(productId, quantity) {
    return new Promise((resolve, reject) => {
        const apiUrl = new URL(`${STOCK_API_URL}/${encodeURIComponent(productId)}`);
        const body = JSON.stringify({ quantity });

        const options = {
            hostname: apiUrl.hostname,
            path: apiUrl.pathname,
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body),
            },
        };

        const req = https.request(options, res => {
            if (res.statusCode < 200 || res.statusCode >= 300) {
                res.resume();
                reject(new Error(`Update API returned status ${res.statusCode}`));
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
 * Builds a visual progress bar using emoji squares (20 segments wide).
 *
 * @param {number} points  0–100
 * @returns {string}
 */
function buildLoyaltyBar(points) {
    const TOTAL_SEGMENTS = 20;
    const filled = Math.round((points / 100) * TOTAL_SEGMENTS);
    const empty = TOTAL_SEGMENTS - filled;
    return '🟩'.repeat(filled) + '⬜'.repeat(empty);
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
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body),
                'api_key': STATS_API_KEY,
            },
        };

        const req = https.request(options, res => {
            if (res.statusCode < 200 || res.statusCode >= 300) {
                res.resume();
                reject(new Error(`Customer API returned status ${res.statusCode}`));
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
        .setDescription(`🟢 **Loyalty Points: ${points % 1 === 0 ? points : points.toFixed(1)}/100**\n${bar}\n${separator}`)
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
});

client.on('interactionCreate', async interaction => {
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

    if (!interaction.isChatInputCommand()) return;

    // /help
    if (interaction.commandName === 'help') {
        const helpEmbed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle('📋 Bot Commands')
            .setDescription('Here is a list of all available commands:')
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

// ─── Prefix commands (owner-only) ─────────────────────────────────────────────

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