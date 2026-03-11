// Discord Ticket Bot — includes restock notification feature

require('dotenv').config();

const {
    Client,
    GatewayIntentBits,
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
        .setDescription('Check the loyalty stats of a Discord user')
        .addUserOption(opt =>
            opt
                .setName('user')
                .setDescription('Mention the Discord user to look up (e.g. @johndoe)')
                .setRequired(true),
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

const STOCK_API_URL =
    'https://app.base44.com/api/apps/698bba4e9e06a075e7c32be6/entities/Product';

const SHOW_STOCK_BUTTON_ID = 'show_current_stock';
const ORDER_NOW_BUTTON_ID = 'order_now';
const UPDATESTOCK_SELECT_PREFIX = 'updatestock_select:';
const VALUE_SEPARATOR = '::::';

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

// ─── Stats / customer system ──────────────────────────────────────────────────

const BASE44_API_BASE_URL = process.env.BASE44_API_URL || 'https://app.base44.com';
const STATS_API_KEY = process.env.BASE44_API_KEY || '';
const BASE44_APP_ID = process.env.BASE44_APP_ID || '698bba4e9e06a075e7c32be6';

// Customer endpoint: /api/apps/{APP_ID}/entities/Customer
const CUSTOMER_API_URL = `${BASE44_API_BASE_URL.replace(/\/$/, '')}/api/apps/${BASE44_APP_ID}/entities/Customer`;

// Simple in-memory cache to avoid hammering the API
const statsCache = new Map();
const STATS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Fetches customer data for a given Discord username from the Base44 Customer API.
 *
 * @param {string} discordUsername
 * @returns {Promise<object|null>}  The first matching customer record, or null if not found.
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
 * Formats a date string or ISO timestamp into a human-readable form (e.g. "Mar 11, 2026").
 * Returns "N/A" if the value is falsy.
 *
 * @param {string|null|undefined} dateValue
 * @returns {string}
 */
function formatDate(dateValue) {
    if (!dateValue) return 'N/A';
    const d = new Date(dateValue);
    if (isNaN(d.getTime())) return 'N/A';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const LOYALTY_FIRST_ORDER_POINTS = 25;
const LOYALTY_ADDITIONAL_ORDER_POINTS = 2;
const LOYALTY_MAX_POINTS = 100;
const LOYALTY_BAR_SEGMENTS = 20;

/**
 * Calculates loyalty points from order count.
 * First order = 25 points, each additional order = 2 points, max 100.
 *
 * @param {number} orderCount
 * @returns {number}
 */
function calcLoyaltyPoints(orderCount) {
    return orderCount >= 1
        ? Math.min(LOYALTY_MAX_POINTS, LOYALTY_FIRST_ORDER_POINTS + (orderCount - 1) * LOYALTY_ADDITIONAL_ORDER_POINTS)
        : 0;
}

/**
 * Builds a visual progress bar using emoji squares (20 segments).
 *
 * @param {number} points  0–100
 * @returns {string}
 */
function buildLoyaltyBar(points) {
    const clampedPoints = Math.min(LOYALTY_MAX_POINTS, Math.max(0, points));
    const filled = Math.round((clampedPoints / LOYALTY_MAX_POINTS) * LOYALTY_BAR_SEGMENTS);
    const empty = LOYALTY_BAR_SEGMENTS - filled;
    return '🟩'.repeat(filled) + '⬜'.repeat(empty);
}

function buildStatsEmbed(customerData, discordMember) {
    const username = discordMember ? discordMember.user.username : (customerData?.discord_username ?? 'Unknown');
    const avatarUrl = discordMember ? discordMember.user.displayAvatarURL({ size: 128 }) : null;

    const orderCount = typeof customerData?.order_count === 'number' ? customerData.order_count : 0;
    const totalSpent = typeof customerData?.total_spent === 'number' ? customerData.total_spent : 0;
    const loyaltyClaimed = typeof customerData?.loyalty_dollars_claimed === 'number' ? customerData.loyalty_dollars_claimed : 0;
    const firstPurchase = formatDate(customerData?.first_purchase_date);
    const lastPurchase = formatDate(customerData?.last_purchase_date);

    const points = calcLoyaltyPoints(orderCount);
    const bar = buildLoyaltyBar(points);

    const embed = new EmbedBuilder()
        .setColor(0x1E1F22)
        .setTitle(`Profile — ${username}`)
        .setDescription(`🟢 **Loyalty Points: ${points}/${LOYALTY_MAX_POINTS}**\n${bar} ${points}/${LOYALTY_MAX_POINTS}`)
        .addFields(
            {
                name: '📊 Standing',
                value: [
                    `💰 Total Spent: $${totalSpent.toFixed(2)}`,
                    `📦 Orders: ${orderCount}`,
                    `🎁 Loyalty $ Claimed: $${loyaltyClaimed.toFixed(2)}`,
                ].join('\n'),
                inline: true,
            },
            {
                name: '📈 Activity',
                value: [
                    `🗓️ First Purchase: ${firstPurchase}`,
                    `🕐 Last Purchase: ${lastPurchase}`,
                ].join('\n'),
                inline: true,
            },
        )
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
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
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
                    name: '`/stats user:@user`',
                    value: 'Display the loyalty stats and profile for a customer by mentioning them.',
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

    // /stats
    if (interaction.commandName === 'stats') {
        const mentionedUser = interaction.options.getUser('user');
        const username = mentionedUser.username;

        await interaction.deferReply();

        // Return cached result if still fresh
        const cached = statsCache.get(username.toLowerCase());
        if (cached && Date.now() - cached.ts < STATS_CACHE_TTL_MS) {
            await interaction.editReply({ embeds: [cached.embed] });
            return;
        }

        let customerData;
        try {
            customerData = await fetchCustomerData(username);
        } catch (err) {
            console.error('Stats API error:', err);
            await interaction.editReply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0xED4245)
                        .setTitle('❌ API Unreachable')
                        .setDescription('Could not fetch stats data. Please try again later.'),
                ],
            });
            return;
        }

        if (!customerData) {
            await interaction.editReply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0xFEE75C)
                        .setTitle('No Customer Data Found')
                        .setDescription(`No customer record found for **${username}**.`),
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

        const embed = buildStatsEmbed(customerData, discordMember);

        statsCache.set(username.toLowerCase(), { embed, ts: Date.now() });

        await interaction.editReply({ embeds: [embed] });
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