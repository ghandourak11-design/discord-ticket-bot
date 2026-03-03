// Import necessary libraries and configure your bot
const { Client, Intents, MessageEmbed } = require('discord.js');
const client = new Client({ intents: [Intents.FLAGS.GUILDS] });

// Command to get stock prices
client.on('messageCreate', async message => {
    if (message.content === '/stock') {
        const embed = new MessageEmbed()
            .setColor('#0099ff')
            .setTitle('Stock Prices')
            .setDescription('Here are the latest stock prices:')
            .addFields(
                { name: 'AAPL', value: '$150', inline: true },
                { name: 'GOOGL', value: '$2800', inline: true }
            )
            .setTimestamp();
        message.channel.send({ embeds: [embed] });
    }
});

// New command to get prices
client.on('messageCreate', async message => {
    if (message.content === '/prices') {
        const embed = new MessageEmbed()
            .setColor('#ff6633')
            .setTitle('Prices Information')
            .setDescription('Here are the latest prices of the products:')
            .addFields(
                { name: 'Product 1', value: '$20', inline: true },
                { name: 'Product 2', value: '$35', inline: true }
            )
            .setFooter({ text: 'For more information, contact support.' })
            .setTimestamp();
        message.channel.send({ embeds: [embed] });
    }
});

// Log in your bot using the token
client.login('YOUR_BOT_TOKEN');