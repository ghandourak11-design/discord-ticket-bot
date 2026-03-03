const { Client, Intents } = require('discord.js');
const fetch = require('node-fetch');

const client = new Client({ intents: [Intents.FLAGS.GUILDS, Intents.FLAGS.GUILD_MESSAGES] });
const BASE44_URL = 'https://example.com/api'; // Replace with actual BASE44_URL

const formatStockEmbed = (stockData) => {
    // Filter and format stock data
    const embedContent = stockData
        .filter(item => item.stock > 0) // Hide out of stock items
        .map(item => `┌─────┐\n│ ${item.name} │\n│ Stock: ${item.stock} │\n└─────┘`)
        .join('\n');
    return embedContent;
};

const formatPricesEmbed = (pricesData) => {
    // Format prices data
    const embedContent = pricesData
        .filter(item => item.price > 0) // Filter out irrelevant items
        .map(item => `┌─────┐\n│ ${item.name} - $${item.price} │\n└─────┘`)
        .join('\n');
    return embedContent;
};

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isCommand()) return;

    if (interaction.commandName === 'stock') {
        const response = await fetch(`${BASE44_URL}/stock`);
        const stockData = await response.json();
        const embed = formatStockEmbed(stockData);
        await interaction.reply(embed);
    } else if (interaction.commandName === 'prices') {
        const response = await fetch(`${BASE44_URL}/prices`);
        const pricesData = await response.json();
        const embed = formatPricesEmbed(pricesData);
        await interaction.reply(embed);
    }
});

client.login('YOUR_BOT_TOKEN'); // Replace with your bot token