const { Client, GatewayIntentBits } = require('discord.js');
const { EmbedBuilder } = require('discord.js');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

client.on('messageCreate', (message) => {
    if (message.content === '!embed') {
        const embed = new EmbedBuilder()
            .setTitle('Title')
            .setDescription('Description');
        message.channel.send({ embeds: [embed] });
    }
});

client.login('YOUR_TOKEN');