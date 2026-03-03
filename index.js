const Discord = require('discord.js');

function buildStockEmbed(stockData) {
    const embed = new Discord.MessageEmbed();
    embed.setTitle('Stock Information');

    // Use fields instead of description
    stockData.forEach(item => {
        embed.addField(item.name, `Quantity: ${item.quantity}`, true);
    });

    return embed;
}

function buildPricesEmbed(pricesData) {
    const embed = new Discord.MessageEmbed();
    embed.setTitle('Current Prices');

    // Use fields instead of description
    pricesData.forEach(item => {
        embed.addField(item.product, `Price: ${item.price}`, true);
    });

    return embed;
}