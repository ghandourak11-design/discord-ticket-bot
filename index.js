const { Client, GatewayIntentBits, REST, Routes, InteractionType, EmbedBuilder } = require('discord.js');

// Environment Variables
const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const BASE44_API_KEY = process.env.BASE44_API_KEY;
const BASE44_BASE_URL = process.env.BASE44_BASE_URL;

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const rest = new REST({ version: '9' }).setToken(TOKEN);

// Deploying Slash Commands
(async () => {
    const commands = [
        {
            name: 'ping',
            description: 'Replies with Pong!',
        },
        {
            name: 'info',
            description: 'Displays information about the bot',
        },
    ];

    try {
        console.log('Started refreshing application (/) commands.');

        await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), {
            body: commands,
        });

        console.log('Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error(error);
    }
})();

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isCommand()) return;

    const { commandName } = interaction;

    if (commandName === 'ping') {
        await interaction.reply('Pong!');
    } else if (commandName === 'info') {
        const embed = new EmbedBuilder()
            .setColor(0x0099ff)
            .setTitle('Bot Info')
            .setDescription('This bot is built using Discord.js v14.');
        await interaction.reply({ embeds: [embed] });
    }
});

client.login(TOKEN);