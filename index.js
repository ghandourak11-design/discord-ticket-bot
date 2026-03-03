const { Client, GatewayIntentBits, Events, EmbedBuilder, REST, Routes } = require('discord.js');

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const rest = new REST({ version: '10' }).setToken(TOKEN);

let stockData = {};
let pricesData = {};

async function fetchStockData() {
    try {
        const res = await fetch('https://donutdemand.net/api/stock');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        stockData = await res.json();
        console.log('✅ Stock updated');
    } catch (e) {
        console.error('Stock error:', e.message);
    }
}

async function fetchPricesData() {
    try {
        const res = await fetch('https://donutdemand.net/api/prices');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        pricesData = await res.json();
        console.log('✅ Prices updated');
    } catch (e) {
        console.error('Prices error:', e.message);
    }
}

client.once(Events.ClientReady, async () => {
    console.log(`✅ Bot ready as ${client.user.tag}`);
    
    try {
        await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), {
            body: [
                { name: 'stock', description: 'Show current stock' },
                { name: 'prices', description: 'Show current prices' },
            ],
        });
        console.log('✅ Commands registered');
    } catch (e) {
        console.error('Error registering commands:', e);
    }

    await fetchStockData();
    await fetchPricesData();
    
    setInterval(async () => {
        await fetchStockData();
        await fetchPricesData();
    }, 60000);
});

client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isChatInputCommand()) return;
    await interaction.deferReply();

    try {
        if (interaction.commandName === 'stock') {
            const embed = new EmbedBuilder()
                .setColor(0x0099ff)
                .setTitle('📦 Stock')
                .setTimestamp();
            
            if (stockData && Object.keys(stockData).length > 0) {
                for (const [item, qty] of Object.entries(stockData)) {
                    embed.addFields({ name: item, value: String(qty), inline: true });
                }
            } else {
                embed.addFields({ name: 'Status', value: 'No data' });
            }
            
            await interaction.editReply({ embeds: [embed] });
        } else if (interaction.commandName === 'prices') {
            const embed = new EmbedBuilder()
                .setColor(0xff6633)
                .setTitle('💰 Prices')
                .setTimestamp();
            
            if (pricesData && Object.keys(pricesData).length > 0) {
                for (const [item, price] of Object.entries(pricesData)) {
                    embed.addFields({ name: item, value: `$${price}`, inline: true });
                }
            } else {
                embed.addFields({ name: 'Status', value: 'No data' });
            }
            
            await interaction.editReply({ embeds: [embed] });
        }
    } catch (e) {
        await interaction.editReply('❌ Error');
        console.error(e);
    }
});

client.login(TOKEN);