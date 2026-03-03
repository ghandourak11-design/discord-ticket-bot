const fetch = require('node-fetch');

// Fetch data function
async function fetchData(endpoint) {
    const response = await fetch(`https://donutdemand.net/api/${endpoint}`);
    const data = await response.json();
    return data;
}

// /stock command
async function stockCommand(interaction) {
    const stockData = await fetchData('stock');
    // Handle stock data and send response
}

// /prices command
async function pricesCommand(interaction) {
    const pricesData = await fetchData('prices');
    // Handle prices data and send response
}

// Auto-update every minute
setInterval(async () => {
    // Logic for refreshing data for both commands
}, 60000);
