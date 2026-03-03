// Import necessary modules
require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const fetch = require('node-fetch');

// Create a new client instance
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });

// Create slash command details
const command = { 
    name: 'ticket', 
    description: 'Create a support ticket', 
};

// Log into Discord
client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}`);
});

// Register the slash command
client.on('ready', async () => {
    const data = await client.application.commands.create(command);
    console.log(`Registered command: ${data.name}`);
});

// Handle the command interaction
client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;

    const { commandName } = interaction;

    if (commandName === 'ticket') {
        await interaction.reply('Your support ticket has been created!');
        // Here you can add code to handle ticket creation
    }
});

// Log in the client using the token stored in environment variables
client.login(process.env.BOT_TOKEN);