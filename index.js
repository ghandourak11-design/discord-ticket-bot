// Original index.js file with embed improvements for discord-ticket-bot

const Discord = require('discord.js');
const client = new Discord.Client();

client.on('ready', () => {
    console.log(`Logged in as ${client.user.tag}!`);
});

client.on('message', message => {
    if (message.content === '!ticket') {
        const embed = new Discord.MessageEmbed()
            .setColor('#0099ff')
            .setTitle('Ticket System')
            .setDescription('Click the button below to create a ticket.')
            .setFooter('This ticket will be deleted after closing.');

        message.channel.send(embed);
    }
});

client.login('YOUR_TOKEN');
