// Complete bot code for Discord ticket bot

const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const BASE44_URL = 'https://example.com/api'; // Change to your actual endpoint

// Format stock embed with proper ASCII borders
function formatStockEmbed(stockData) {
    let embedContent = '```
Stock Items:
```
';
    stockData.forEach(item => {
        if (item.inStock) {
            embedContent += `• ${item.name}: ${item.price} (Quantity: ${item.quantity})\n`;
        }
    });
    return embedContent;
}

// Format prices embed with proper ASCII borders
function formatPricesEmbed(pricesData) {
    let embedContent = '```
Current Prices:
```
';
    pricesData.forEach(item => {
        embedContent += `• ${item.name}: ${item.currentPrice}\n`;
    });
    return embedContent;
}

client.on('ready', () => {
    console.log(`Bot is ready! Logged in as ${client.user.tag}`);
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;

    if (interaction.commandName === 'stock') {
        const response = await axios.get(`${BASE44_URL}/stock`);
        const stockEmbed = formatStockEmbed(response.data);
        await interaction.reply(stockEmbed);
    } else if (interaction.commandName === 'prices') {
        const response = await axios.get(`${BASE44_URL}/prices`);
        const pricesEmbed = formatPricesEmbed(response.data);
        await interaction.reply(pricesEmbed);
    }
});

client.login('YOUR_BOT_TOKEN'); // Add actual token here