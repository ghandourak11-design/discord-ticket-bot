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
            
            const embed = new EmbedBuilder()
                .setTitle('📦 Donut Demand - Stock')
                .setColor(0x3498db)
                .setTimestamp();
            
            if (Array.isArray(products) && products.length > 0) {
                products.forEach(product => {
                    if (product.name && product.quantity !== undefined) {
                        embed.addFields({
                            name: product.name,
                            value: `${product.quantity} units`,
                            inline: true
                        });
                    }
                });
            } else {
                embed.addFields({
                    name: 'Status',
                    value: 'No products available',
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
            
            const embed = new EmbedBuilder()
                .setTitle('💰 Donut Demand - Prices')
                .setColor(0xf39c12)
                .setTimestamp();
            
            if (Array.isArray(products) && products.length > 0) {
                products.forEach(product => {
                    if (product.name && product.price !== undefined) {
                        embed.addFields({
                            name: product.name,
                            value: `$${product.price.toFixed(2)}`,
                            inline: true
                        });
                    }
                });
            } else {
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