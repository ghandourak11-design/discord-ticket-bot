// Improved embed functions for /prices and /stock commands

const { MessageEmbed } = require('discord.js');

// Function to create the embed for prices
const createPricesEmbed = (pricesData) => {
    const embed = new MessageEmbed()
        .setTitle('Current Prices')
        .setColor('#0099ff');

    pricesData.forEach(price => {
        embed.addField(price.name, `$${price.value}`, true);
    });

    return embed;
};

// Function to create the embed for stock
const createStockEmbed = (stockData) => {
    const embed = new MessageEmbed()
        .setTitle('Current Stock Status')
        .setColor('#ff9900');

    stockData.forEach(stock => {
        embed.addField(stock.item, `Available: ${stock.available}`, true);
    });

    return embed;
};

module.exports = { createPricesEmbed, createStockEmbed };