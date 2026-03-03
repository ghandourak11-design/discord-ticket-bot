// Restored content of index.js from commit 2f39f309ea587e1543652bd2d546faf8add89f82

// Your restored code goes here...

// Include the /prices command handler
client.on('message', async (message) => {
    if (message.content.startsWith('/prices')) {
        const pricesEmbed = new Discord.MessageEmbed() // Assuming using discord.js v12 or later
            .setColor('#0099ff')
            .setTitle('Current Prices')
            .setDescription('Here are the current prices.');
        // Add fields as per your /stock structure
        pricesEmbed.addField('Stock 1', '$100');
        pricesEmbed.addField('Stock 2', '$200');
        pricesEmbed.addField('Stock 3', '$300');

        await message.channel.send({ embeds: [pricesEmbed] });
    }
});