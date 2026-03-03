const { Client, GatewayIntentBits, Events } = require('discord.js');
const axios = require('axios');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const fetchStockData = async () => {
    try {
        const response = await axios.get('https://donutdemand.net/api/stock');
        return response.data;
    } catch (error) {
        console.error('Error fetching stock data: ', error);
        return null;
    }
}

const fetchPricesData = async () => {
    try {
        const response = await axios.get('https://donutdemand.net/api/prices');
        return response.data;
    } catch (error) {
        console.error('Error fetching prices data: ', error);
        return null;
    }
}

client.once(Events.ClientReady, async () => {
    console.log(`Logged in as ${client.user.tag}`);

    // Register commands here (only once)
    const commands = [
        {
            name: 'stock',
            description: 'Get the current stock data',
        },
        {
            name: 'prices',
            description: 'Get the current prices data',
        },
    ];

    const data = await client.application.commands.set(commands);
    console.log('Registered commands:', data);

    // Fetch and update data every minute
    setInterval(async () => {
        const stockData = await fetchStockData();
        const pricesData = await fetchPricesData();
        // Here you can save or update this data as needed.
    }, 60000); // 60 seconds
});

client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isCommand()) return;

    await interaction.deferReply(); // Defer the reply

    if (interaction.commandName === 'stock') {
        const stockData = await fetchStockData();
        await interaction.editReply(`Stock data: ${JSON.stringify(stockData)}`);
    } else if (interaction.commandName === 'prices') {
        const pricesData = await fetchPricesData();
        await interaction.editReply(`Prices data: ${JSON.stringify(pricesData)}`);
    }
});

// Login to Discord with your client's token
client.login('YOUR_BOT_TOKEN');
