const Discord = require('discord.js');
const axios = require('axios');
const client = new Discord.Client();

const STOCK_COMMAND = '/stock';
const PRICES_COMMAND = '/prices';

let stockData = null;
let pricesData = null;

async function fetchStockData() {
    try {
        const response = await axios.get('https://donutdemand.net/api/stock');
        stockData = response.data;
        console.log('Stock data updated:', stockData);
    } catch (error) {
        console.error('Error fetching stock data:', error);
    }
}

async function fetchPricesData() {
    try {
        const response = await axios.get('https://donutdemand.net/api/prices');
        pricesData = response.data;
        console.log('Prices data updated:', pricesData);
    } catch (error) {
        console.error('Error fetching prices data:', error);
    }
}

//Discord Command Handling
client.on('message', async message => {
    if (message.content === STOCK_COMMAND) {
        if (stockData) {
            message.reply(`Stock Data: ${JSON.stringify(stockData)}`);
        } else {
            message.reply('Stock data not available. Please try again later.');
        }
    } else if (message.content === PRICES_COMMAND) {
        if (pricesData) {
            message.reply(`Prices Data: ${JSON.stringify(pricesData)}`);
        } else {
            message.reply('Prices data not available. Please try again later.');
        }
    }
});

// Auto-update data every 60 seconds
setInterval(() => {
    fetchStockData();
    fetchPricesData();
}, 60000);

// Discord Bot Login
client.login('YOUR_BOT_TOKEN');
