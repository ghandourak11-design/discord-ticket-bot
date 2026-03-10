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
        .setName('rank')
        .setDescription('Check the loyalty tier of a Discord user')
        .addStringOption(opt =>
            opt
                .setName('username')
                .setDescription('The Discord username to look up (e.g. johndoe)')
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

// ─── Rank / tier system ───────────────────────────────────────────────────────

const RANK_USERS_API_URL = process.env.BASE44_API_URL || '';
const RANK_API_KEY = process.env.BASE44_API_KEY || '';

const TIERS = [
    {
        name: 'Diamond',
        color: 0xB9F2FF,
        emoji: '💎',
        check: (spent, orders) => spent >= 2000 && orders >= 50,
    },
    {
        name: 'Platinum',
        color: 0xE5E4E2,
        emoji: '🏆',
        check: (spent, orders) => spent >= 2000 || orders >= 50,
    },
    {
        name: 'Gold',
        color: 0xFFD700,
        emoji: '🥇',
        check: (spent, orders) => spent >= 500 || orders >= 16,
    },
    {
        name: 'Silver',
        color: 0xC0C0C0,
        emoji: '🥈',
        check: (spent, orders) => spent >= 100 || orders >= 5,
    },
    {
        name: 'Bronze',
        color: 0xCD7F32,
        emoji: '🥉',
        check: () => true,
    },
];

function getTier(totalSpent, orderCount) {
    for (const tier of TIERS) {
        if (tier.check(totalSpent, orderCount)) {
            return tier;
        }
    }
    return TIERS[TIERS.length - 1];
}

// Tiers in ascending order with the requirements to REACH each tier
const TIER_ORDER = ['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond'];
const TIER_GOALS = {
    Silver:   { type: 'or',  spent: 100,  orders: 5 },
    Gold:     { type: 'or',  spent: 500,  orders: 16 },
    Platinum: { type: 'or',  spent: 2000, orders: 50 },
    Diamond:  { type: 'and', spent: 2000, orders: 50 },
};

function getTierProgress(totalSpent, orderCount, currentTierName) {
    const currentIndex = TIER_ORDER.indexOf(currentTierName);
    if (currentIndex === -1 || currentIndex === TIER_ORDER.length - 1) {
        return 'You have reached the highest tier!';
    }

    const nextTierName = TIER_ORDER[currentIndex + 1];
    const goal = TIER_GOALS[nextTierName];

    const parts = [];
    if (totalSpent < goal.spent) {
        parts.push(`$${(goal.spent - totalSpent).toFixed(2)} more spent`);
    }
    if (orderCount < goal.orders) {
        parts.push(`${goal.orders - orderCount} more order${goal.orders - orderCount !== 1 ? 's' : ''}`);
    }

    if (parts.length === 0) return 'You have reached the highest tier!';

    const joiner = goal.type === 'and' ? ' and ' : ' or ';
    return `To reach **${nextTierName}**: ${parts.join(joiner)}`;
}

// Simple in-memory cache to avoid hammering the API
const rankCache = new Map();
const RANK_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function fetchUserRankData(discordUsername) {
    return new Promise((resolve, reject) => {
        if (!RANK_USERS_API_URL) {
            reject(new Error('BASE44_API_URL is not configured'));
            return;
        }

        let urlObj;
        try {
            urlObj = new URL(RANK_USERS_API_URL);
        } catch {
            reject(new Error('BASE44_API_URL is not a valid URL'));
            return;
        }

        // Filter by discord_username field; adjust query param if your schema differs
        urlObj.searchParams.set('discord_username', discordUsername);

        const reqOptions = {
            hostname: urlObj.hostname,
            path: urlObj.pathname + urlObj.search,
            method: 'GET',
            headers: {
                'Accept': 'application/json',
                ...(RANK_API_KEY ? { 'Authorization': `Bearer ${RANK_API_KEY}` } : {}),
            },
        };

        https
            .get(reqOptions, res => {
                if (res.statusCode < 200 || res.statusCode >= 300) {
                    res.resume();
                    reject(new Error(`Rank API returned status ${res.statusCode}`));
                    return;
                }
                let raw = '';
                res.on('data', chunk => { raw += chunk; });
                res.on('end', () => {
                    try {
                        resolve(JSON.parse(raw));
                    } catch {
                        reject(new Error('Failed to parse rank API response'));
                    }
                });
            })
            .on('error', reject);
    });
}

function buildRankEmbed(userData, tier, discordMember) {
    const username =
        userData.discord_username ||
        userData.username ||
        userData.name ||
        (discordMember ? discordMember.user.username : 'Unknown');

    const totalSpent =
        typeof (userData.total_spent ?? userData.totalSpent ?? userData.spent) === 'number'
            ? (userData.total_spent ?? userData.totalSpent ?? userData.spent)
            : 0;

    const orderCount =
        typeof (userData.order_count ?? userData.orderCount ?? userData.orders) === 'number'
            ? (userData.order_count ?? userData.orderCount ?? userData.orders)
            : 0;

    const avatarUrl = discordMember
        ? discordMember.user.displayAvatarURL({ size: 128 })
        : null;

    const embed = new EmbedBuilder()
        .setColor(tier.color)
        .setTitle(`${tier.emoji} ${username}'s Rank`)
        .addFields(
            { name: '🏅 Tier', value: `**${tier.name}**`, inline: true },
            { name: '💰 Total Spent', value: `$${totalSpent.toFixed(2)}`, inline: true },
            { name: '📦 Total Orders', value: `${orderCount}`, inline: true },
            { name: '📈 Progress', value: getTierProgress(totalSpent, orderCount, tier.name), inline: false },
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
                    name: '`/rank username:<name>`',
                    value: 'Display the loyalty tier and order history for a customer by Discord username.',
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

    // /rank
    if (interaction.commandName === 'rank') {
        const username = interaction.options.getString('username').trim();

        await interaction.deferReply();

        // Return cached result if still fresh
        const cached = rankCache.get(username.toLowerCase());
        if (cached && Date.now() - cached.ts < RANK_CACHE_TTL_MS) {
            await interaction.editReply({ embeds: [cached.embed] });
            return;
        }

        if (!RANK_USERS_API_URL) {
            await interaction.editReply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0xED4245)
                        .setTitle('❌ Rank Unavailable')
                        .setDescription(
                            'The rank system is not configured. Please ask an admin to set `BASE44_API_URL` in the bot environment.',
                        ),
                ],
            });
            return;
        }

        let apiResult;
        try {
            apiResult = await fetchUserRankData(username);
        } catch (err) {
            console.error('Rank API error:', err);
            await interaction.editReply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0xED4245)
                        .setTitle('❌ API Unreachable')
                        .setDescription('Could not fetch rank data. Please try again later.'),
                ],
            });
            return;
        }

        // API may return an array of matching records or a single object
        const record = Array.isArray(apiResult) ? apiResult[0] : apiResult;

        if (!record) {
            await interaction.editReply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0xFEE75C)
                        .setTitle('🔍 User Not Found')
                        .setDescription(
                            `No customer record found for **${username}**. Make sure the username matches exactly.`,
                        ),
                ],
            });
            return;
        }

        const totalSpent =
            typeof (record.total_spent ?? record.totalSpent ?? record.spent) === 'number'
                ? (record.total_spent ?? record.totalSpent ?? record.spent)
                : 0;

        const orderCount =
            typeof (record.order_count ?? record.orderCount ?? record.orders) === 'number'
                ? (record.order_count ?? record.orderCount ?? record.orders)
                : 0;

        const tier = getTier(totalSpent, orderCount);

        // Try to resolve a guild member so we can show their avatar
        let discordMember = null;
        try {
            const members = await interaction.guild.members.search({ query: username, limit: 1 });
            discordMember = members.first() ?? null;
        } catch {
            // Non-critical — avatar just won't appear
        }

        const embed = buildRankEmbed(record, tier, discordMember);

        rankCache.set(username.toLowerCase(), { embed, ts: Date.now() });

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