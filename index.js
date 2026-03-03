const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const axios = require('axios');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// Replace 'your_api_key' with your actual API key
const API_KEY = 'your_api_key';
const API_URL = 'https://app.base44.com/api/apps/698bba4e9e06a075e7c32be6/entities/Product';

client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}`);
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isCommand()) return;

    if (interaction.commandName === 'stock') {
        try {
            const response = await axios.get(API_URL, { headers: { 'api_key': API_KEY } });
            const data = response.data;
            const embed = new EmbedBuilder()
                .setColor('#0099ff')
                .setTitle('Current Stock')
                .setDescription('Here is the current stock information')
                .addFields(
                    ...data.map(item => ({ name: item.productName, value: `Stock: ${item.stock}`, inline: true }))
                );
            await interaction.reply({ embeds: [embed] });
        } catch (error) {
            console.error(error);
            await interaction.reply('There was an error fetching the stock data.');
        }
    }

    if (interaction.commandName === 'prices') {
        try {
            const response = await axios.get(API_URL, { headers: { 'api_key': API_KEY } });
            const data = response.data;
            const embed = new EmbedBuilder()
                .setColor('#00ff99')
                .setTitle('Current Prices')
                .setDescription('Here are the current price listings')
                .addFields(
                    ...data.map(item => ({ name: item.productName, value: `Price: ${item.price}`, inline: true }))
                );
            await interaction.reply({ embeds: [embed] });
        } catch (error) {
            console.error(error);
            await interaction.reply('There was an error fetching the price data.');
        }
    }
});

client.login('your_bot_token');