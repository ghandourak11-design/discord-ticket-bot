const { Client, GatewayIntentBits } = require('discord.js');
const fetch = require('node-fetch');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const updateInterval = 60000; // 60 seconds
let stockData = {};
let priceData = {};

async function fetchData() {
    try {
        const stockResponse = await fetch('https://donutdemand.net/stock');
        const pricesResponse = await fetch('https://donutdemand.net/prices');
        
        stockData = await stockResponse.json();
        priceData = await pricesResponse.json();
        
        console.log("Data updated");
    } catch (error) {
        console.error("Error fetching data:", error);
    }
}

client.on('ready', () => {
    console.log(`Logged in as ${client.user.tag}`);
    fetchData(); // Initial fetch
    setInterval(fetchData, updateInterval); // Auto-update every 60 seconds
});

client.on('messageCreate', (message) => {
    if (message.content === '/stock') {
        message.channel.send(`Current stock: ${JSON.stringify(stockData)}`);
    } else if (message.content === '/prices') {
        message.channel.send(`Current prices: ${JSON.stringify(priceData)}`);
    }
});

client.login('YOUR_DISCORD_BOT_TOKEN'); // Replace with your actual token
