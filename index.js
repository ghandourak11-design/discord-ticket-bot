const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const BASE44_API_KEY = process.env.BASE44_API_KEY;

const BASE44_URL = 'https://app.base44.com/api/apps/698bba4e9e06a075e7c32be6/entities/Product';

client.once('ready', () => {
    console.log('✅ Bot ready!');
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    
    await interaction.deferReply();
    
    const { commandName } = interaction;

    if (commandName === 'stock') {
        try {
            const response = await fetch(BASE44_URL, {
                method: 'GET',
                headers: {
                    'api_key': BASE44_API_KEY,
                    'Content-Type': 'application/json'
                }
            });
            
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const products = await response.json();
            
            const items = [];
            const crates = [];
            const bundles = [];
            let hasOutOfStock = false;

            if (Array.isArray(products)) {
                products.forEach(product => {
                    const quantity = product.quantity || 0;
                    
                    if (quantity === 0) {
                        hasOutOfStock = true;
                        return;
                    }
                    
                    const type = product.type?.toLowerCase() || 'item';
                    const field = {
                        name: product.name || 'Unknown',
                        value: `${quantity} units`,
                        inline: true
                    };
                    
                    if (type.includes('bundle')) {
                        bundles.push(field);
                    } else if (type.includes('crate')) {
                        crates.push(field);
                    } else {
                        items.push(field);
                    }
                });
            }

            const embed = new EmbedBuilder()
                .setTitle('📦 Donut Demand - Stock Levels')
                .setColor(0xFFD700)
                .setTimestamp();
            
            if (items.length > 0) {
                embed.addFields({ name: '📌 Items', value: '\u200b', inline: false });
                embed.addFields(...items);
            }
            
            if (crates.length > 0) {
                embed.addFields({ name: '📦 Crates', value: '\u200b', inline: false });
                embed.addFields(...crates);
            }
            
            if (bundles.length > 0) {
                embed.addFields({ name: '🎁 Bundles', value: '\u200b', inline: false });
                embed.addFields(...bundles);
            }
            
            if (items.length === 0 && crates.length === 0 && bundles.length === 0) {
                embed.addFields({
                    name: 'Status',
                    value: 'All products are out of stock',
                    inline: false
                });
            } else if (hasOutOfStock) {
                embed.addFields({
                    name: '\u200b',
                    value: '*Items not shown are out of stock*',
                    inline: false
                });
            }
            
            await interaction.editReply({ embeds: [embed] });
        } catch (e) {
            console.error(e);
            await interaction.editReply('❌ Error fetching stock data');
        }
    } else if (commandName === 'prices') {
        try {
            const response = await fetch(BASE44_URL, {
                method: 'GET',
                headers: {
                    'api_key': BASE44_API_KEY,
                    'Content-Type': 'application/json'
                }
            });
            
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const products = await response.json();
            
            const items = [];
            const crates = [];
            const bundles = [];

            if (Array.isArray(products)) {
                products.forEach(product => {
                    const price = product.price || 0;
                    
                    const type = product.type?.toLowerCase() || 'item';
                    const field = {
                        name: product.name || 'Unknown',
                        value: `$${price.toFixed(2)}`,
                        inline: true
                    };
                    
                    if (type.includes('bundle')) {
                        bundles.push(field);
                    } else if (type.includes('crate')) {
                        crates.push(field);
                    } else {
                        items.push(field);
                    }
                });
            }

            const embed = new EmbedBuilder()
                .setTitle('💰 Donut Demand - Prices')
                .setColor(0x00FF00)
                .setTimestamp();
            
            if (items.length > 0) {
                embed.addFields({ name: '📌 Items', value: '\u200b', inline: false });
                embed.addFields(...items);
            }
            
            if (crates.length > 0) {
                embed.addFields({ name: '📦 Crates', value: '\u200b', inline: false });
                embed.addFields(...crates);
            }
            
            if (bundles.length > 0) {
                embed.addFields({ name: '🎁 Bundles', value: '\u200b', inline: false });
                embed.addFields(...bundles);
            }
            
            if (items.length === 0 && crates.length === 0 && bundles.length === 0) {
                embed.addFields({
                    name: 'Status',
                    value: 'No products available',
                    inline: false
                });
            }
            
            await interaction.editReply({ embeds: [embed] });
        } catch (e) {
            console.error(e);
            await interaction.editReply('❌ Error fetching price data');
        }
    }
});

const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v9');

const commands = [
    { name: 'stock', description: 'Check current stock levels' },
    { name: 'prices', description: 'Check current prices' },
];

const rest = new REST({ version: '9' }).setToken(TOKEN);

(async () => {
    try {
        console.log('Registering commands...');
        await rest.put(
            Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
            { body: commands }
        );
        console.log('✅ Commands registered');
    } catch (error) {
        console.error(error);
    }
})();

client.login(TOKEN);