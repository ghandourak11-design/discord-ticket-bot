function buildStockEmbed(stockData) {
    const embed = new MessageEmbed()
        .setColor('#3498db') // Professional blue color
        .setTitle(`Stock Information for ${stockData.symbol}`)
        .setDescription(`Latest price: $${stockData.price} \n
Market Open: ${stockData.marketOpen} \nMarket Close: ${stockData.marketClose}`)
        .addField('High', `$${stockData.high}`, true)
        .addField('Low', `$${stockData.low}`, true)
        .addField('Volume', `${stockData.volume}`, true)
        .setFooter('Stock data provided by Your API Name')
        .setTimestamp();

    return embed;
}