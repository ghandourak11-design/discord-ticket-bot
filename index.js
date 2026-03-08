// Discord Ticket Bot — includes restock notification feature

require('dotenv').config();

const {
    Client,
    GatewayIntentBits,
    SlashCommandBuilder,
    EmbedBuilder,
    PermissionFlagsBits,
    REST,
    Routes,
} = require('discord.js');
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

// ─── Restock embed builder ────────────────────────────────────────────────────

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

// ─── Discord client ───────────────────────────────────────────────────────────

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', () => {
    console.log(`Bot is ready! Logged in as ${client.user.tag}`);
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

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
        await notifChannel.send({ embeds: [embed] });

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
});

// ─── Start ────────────────────────────────────────────────────────────────────

const token = process.env.DISCORD_TOKEN;
if (!token) {
    console.error('DISCORD_TOKEN is not set in environment. Please create a .env file.');
    process.exit(1);
}

registerCommands().then(() => client.login(token));