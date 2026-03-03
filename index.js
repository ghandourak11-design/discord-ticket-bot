// index.js

const fetch = require('node-fetch'); // Make sure to install node-fetch if you haven't already
const BASE44_API_URL = 'https://your-base44-api-endpoint';

const client = new (require('discord.js')).Client();

client.on('ready', () => {
  console.log(`Logged in as ${client.user.tag}!`);
});

client.on('messageCreate', async message => {
  if (message.content.startsWith('!fetchData')) {
    try {
      const response = await fetch(BASE44_API_URL);
      const data = await response.json();
      message.channel.send(`Fetched data: ${JSON.stringify(data)}`);
    } catch (error) {
      console.error('Error fetching data:', error);
      message.channel.send('Failed to fetch data.');
    }
  }
});

client.login('YOUR_DISCORD_BOT_TOKEN'); // Replace with your Discord bot token