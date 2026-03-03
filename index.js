const { Client, GatewayIntentBits } = require('discord.js');
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const BASE44_API_KEY = process.env.BASE44_API_KEY;

client.once('ready', () => {
    console.log('✅ Bot ready!');
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    const { commandName } = interaction;

    if (commandName === 'stock') {
        try {
            const response = await fetch('https://api.apps/698bba4de9e06a075e7c32be6/entities/Product', {
                method: 'GET',
                headers: { 'api_key': BASE44_API_KEY, 'Content-Type': 'application/json' },
            });
            const data = await response.json();
            await interaction.reply(`📦 Stock: ${JSON.stringify(data)}`);
        } catch (e) {
            await interaction.reply('❌ Error fetching stock');
        }
    } else if (commandName === 'prices') {
        try {
            const response = await fetch('https://api.apps/698bba4de9e06a075e7c32be6/entities/Product', {
                method: 'GET',
                headers: { 'api_key': BASE44_API_KEY, 'Content-Type': 'application/json' },
            });
            const data = await response.json();
            await interaction.reply(`💰 Prices: ${JSON.stringify(data)}`);
        } catch (e) {
            await interaction.reply('❌ Error fetching prices');
        }
    }
});

const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v9');

const commands = [
    { name: 'stock', description: 'Get stock information' },
    { name: 'prices', description: 'Get prices information' },
];

const rest = new REST({ version: '9' }).setToken(TOKEN);

(async () => {
    try {
        console.log('Registering commands...');
        await rest.put(
            Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
            { body: commands },
        );
        console.log('✅ Commands registered');
    } catch (error) {
        console.error(error);
    }
})();

client.login(TOKEN);