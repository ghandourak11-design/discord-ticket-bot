// Import necessary libraries
const { Client, GatewayIntentBits } = require('discord.js');

// Use the TOKEN environment variable directly
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}!`);
});

client.on('messageCreate', message => {
    if (message.content === '!ping') {
        message.channel.send('Pong!');
    }
});

// Login to Discord with your app's token
client.login(process.env.TOKEN);