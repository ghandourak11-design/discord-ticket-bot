// Updated index.js

const { Client, GatewayIntentBits } = require('discord.js');
const fetch = require('node-fetch');
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// Your command handling and other setup code goes here

client.on('ready', () => {
    console.log(`Logged in as ${client.user.tag}!`);
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;

    const { commandName } = interaction;

    if (commandName === 'yourcommand') {
        // Use Fetch API instead of Axios
        const response = await fetch('https://API_URL', { method: 'GET' });
        const data = await response.json();
 
        await interaction.reply({ content: `Response data: ${data}`, ephemeral: true });
    }
});

// Log in with your bot token
client.login('YOUR_BOT_TOKEN');