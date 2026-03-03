const formatStockPrices = (stocks) => {
    const border = "+-" + "-".repeat(20) + "+-" + "-".repeat(10) + "+";
    let formattedTable = border + '\n';
    formattedTable += '| Stock Name         | Price       |\n';
    formattedTable += border + '\n';

    stocks.forEach(stock => {
        const { name, price } = stock;
        formattedTable += `| ${name.padEnd(18)} | $${price.toFixed(2).padStart(8)} |\n`;
    });

    formattedTable += border;
    return formattedTable;
};

// Example usage:
const stocks = [
    { name: 'AAPL', price: 150.55 },
    { name: 'GOOGL', price: 2800.12 },
    { name: 'AMZN', price: 3300.99 },
];

console.log(formatStockPrices(stocks));