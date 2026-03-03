// Base44 API integration
const axios = require('axios');

const BASE44_API_URL = 'https://api.apps/698bba4de9e06a075e7c32be6/entities/Product';
const API_KEY = 'your_api_key_here'; // replace with your actual API key

async function getProducts() {
    try {
        const response = await axios.get(BASE44_API_URL, {
            headers: {
                'api_key': API_KEY
            }
        });
        console.log(response.data);
        // Handle the product data as needed
    } catch (error) {
        console.error('Error fetching products:', error);
    }
}

// Call the function to fetch products
getProducts();