const { Client, Intents, MessageEmbed } = require('discord.js');
const axios = require('axios');

const client = new Client({ intents: [Intents.FLAGS.GUILDS, Intents.FLAGS.GUILD_MESSAGES] });

// Load environment variables
const BASE44_API_KEY = process.env.BASE44_API_KEY;
const BASE44_BASE_URL = process.env.BASE44_BASE_URL;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const REGISTER_SCOPE = process.env.REGISTER_SCOPE;
const TOKEN = process.env.TOKEN;

client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}`);
});

client.on('messageCreate', async message => {
    if (message.content.startsWith('/stock')) {
        try {
            const response = await axios.get(`${BASE44_BASE_URL}/stock`, {
                headers: {
                    'Authorization': `Bearer ${BASE44_API_KEY}`
                }
            });
            const stockData = response.data;
            const embed = new MessageEmbed()
                .setColor('#0099ff')
                .setTitle('Stock Information')
                .addField('Stock Name', stockData.name)
                .addField('Current Price', stockData.price)
                .addField('Change', stockData.change);
            message.channel.send({ embeds: [embed] });
        } catch (error) {
            console.error('Error fetching stock data:', error);
            message.channel.send('There was an error fetching the stock data.');
        }
    }

    if (message.content.startsWith('/prices')) {
        try {
            const response = await axios.get(`${BASE44_BASE_URL}/prices`, {
                headers: {
                    'Authorization': `Bearer ${BASE44_API_KEY}`
                }
            });
            const pricesData = response.data;
            const embed = new MessageEmbed()
                .setColor('#0099ff')
                .setTitle('Price Information')
                .addField('Prices', pricesData.prices.join(', '));
            message.channel.send({ embeds: [embed] });
        } catch (error) {
            console.error('Error fetching prices data:', error);
            message.channel.send('There was an error fetching the prices data.');
        }
    }
});

client.login(TOKEN);