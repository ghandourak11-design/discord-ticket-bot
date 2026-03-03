// Updated index.js with improved embed formatting for /prices and /stock commands

const { EmbedBuilder } = require('discord.js');

// Assuming you have commands defined for prices and stock

// Improved /prices command
const pricesEmbed = new EmbedBuilder()
    .setColor('#3498db') // A clean blue color
    .setTitle('🔥 Current Prices 🔥')
    .setDescription('Here are the latest prices for our products:')
    .addFields(
        { name: 'Product A', value: '$10.00', inline: true },
        { name: 'Product B', value: '$15.00', inline: true },
        { name: 'Product C', value: '$20.00', inline: true }
    )
    .setFooter({ text: 'Prices may vary' })
    .setTimestamp();

// Improved /stock command
const stockEmbed = new EmbedBuilder()
    .setColor('#1abc9c') // A clean green color
    .setTitle('📦 Current Stock Levels 📦')
    .setDescription('Check the availability of our products:')
    .addFields(
        { name: 'Product A', value: 'In stock: 100', inline: true },
        { name: 'Product B', value: 'In stock: 50', inline: true },
        { name: 'Product C', value: 'In stock: 0', inline: true }
    )
    .setFooter({ text: 'Stock is updated daily' })
    .setTimestamp();

// Continue with your command handlers here...