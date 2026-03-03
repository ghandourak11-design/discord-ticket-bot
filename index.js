// Restore content of index.js from commit 2f39f309ea587e1543652bd2d546faf8add89f82
// Additional code modifications will be made for /prices command

const { MessageEmbed } = require('discord.js'); // Assuming you are using discord.js

module.exports = {
    name: 'prices',
    description: 'Displays the prices of items.',
    async execute(interaction) {
        const embed = new MessageEmbed()
            .setColor('#0099ff')
            .setTitle('Prices List')
            .setDescription('Here are the current prices for the items you requested:')
            .addFields(
                { name: 'Item 1', value: '$10', inline: true },
                { name: 'Item 2', value: '$20', inline: true }
            )
            .setTimestamp()
            .setFooter({ text: 'Contact us for more details', iconURL: 'URL_to_icon' }); // Add an icon URL if needed

        await interaction.reply({ embeds: [embed] });
    },
};