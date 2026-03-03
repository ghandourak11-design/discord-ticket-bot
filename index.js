// Assuming you're using a Discord bot framework like discord.js
const { Client, Intents, MessageEmbed } = require('discord.js');
const client = new Client({ intents: [Intents.FLAGS.GUILDS, Intents.FLAGS.GUILD_MESSAGES] });

client.on('messageCreate', async message => {
    if (message.content === '/stock') {
        const stockEmbed = new MessageEmbed()
            .setColor('#0099ff')
            .setTitle('Stock Information')
            .setDescription('Here is the current stock status.')
            .addField('Item 1', 'Stock: 100', true)
            .addField('Item 2', 'Stock: 200', true)
            .setFooter('Use /prices for pricing information.');
        await message.channel.send({ embeds: [stockEmbed] });
    }
    
    if (message.content === '/prices') {
        const pricesEmbed = new MessageEmbed()
            .setColor('#ffcc00')
            .setTitle('Price Information')
            .setDescription('Here are the current prices for our items.')
            .addField('Item 1', 'Price: $10', true)
            .addField('Item 2', 'Price: $20', true)
            .setFooter('Check back for updates.');
        await message.channel.send({ embeds: [pricesEmbed] });
    }
});

client.login('YOUR_BOT_TOKEN');
