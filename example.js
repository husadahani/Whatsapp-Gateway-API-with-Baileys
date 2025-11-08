// example.js - Example usage of WhatsApp Gateway

require('dotenv').config();
const axios = require('axios');

const API_BASE_URL = 'http://localhost:3000';
const API_KEY = process.env.API_KEY || 'whatsapp_gateway_default_key';

// Function to get QR code
async function getQRCode() {
  try {
    const response = await axios.get(`${API_BASE_URL}/api/qr`, {
      headers: {
        'x-api-key': API_KEY
      }
    });
    console.log('QR Code Response:', response.data);
    return response.data;
  } catch (error) {
    console.error('Error getting QR code:', error.response?.data || error.message);
  }
}

// Function to send a text message
async function sendTextMessage(number, message) {
  try {
    const response = await axios.post(`${API_BASE_URL}/api/send-message`, {
      number: number,
      message: message
    }, {
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY
      }
    });
    console.log('Send Message Response:', response.data);
    return response.data;
  } catch (error) {
    console.error('Error sending message:', error.response?.data || error.message);
  }
}

// Function to send media
async function sendMedia(number, mediaUrl, type = 'image', caption = '') {
  try {
    const response = await axios.post(`${API_BASE_URL}/api/send-media`, {
      number: number,
      mediaUrl: mediaUrl,
      type: type,
      caption: caption
    }, {
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY
      }
    });
    console.log('Send Media Response:', response.data);
    return response.data;
  } catch (error) {
    console.error('Error sending media:', error.response?.data || error.message);
  }
}

// Function to send location
async function sendLocation(number, latitude, longitude, name, address) {
  try {
    const response = await axios.post(`${API_BASE_URL}/api/send-location`, {
      number: number,
      latitude: latitude,
      longitude: longitude,
      name: name,
      address: address
    }, {
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY
      }
    });
    console.log('Send Location Response:', response.data);
    return response.data;
  } catch (error) {
    console.error('Error sending location:', error.response?.data || error.message);
  }
}

// Function to get connection status
async function getStatus() {
  try {
    const response = await axios.get(`${API_BASE_URL}/api/status`, {
      headers: {
        'x-api-key': API_KEY
      }
    });
    console.log('Status Response:', response.data);
    return response.data;
  } catch (error) {
    console.error('Error getting status:', error.response?.data || error.message);
  }
}

// Example usage
async function runExamples() {
  console.log('WhatsApp Gateway - Example Usage');
  console.log('================================');
  
  // First, check connection status
  console.log('\n1. Getting connection status...');
  await getStatus();
  
  // Get QR code if needed
  console.log('\n2. Getting QR code...');
  await getQRCode();
  
  // Send a text message (replace with actual number)
  console.log('\n3. Sending text message...');
  // await sendTextMessage('1234567890', 'Hello from WhatsApp Gateway API!');
  
  // Send an image (replace with actual number and URL)
  console.log('\n4. Sending image...');
  // await sendMedia('1234567890', 'https://via.placeholder.com/300', 'image', 'Example image from API');
  
  // Send location (replace with actual number)
  console.log('\n5. Sending location...');
  // await sendLocation('1234567890', 40.7128, -74.0060, 'New York', 'New York, USA');
  
  console.log('\nExamples completed!');
}

// Uncomment to run examples
// runExamples();

module.exports = {
  getQRCode,
  sendTextMessage,
  sendMedia,
  sendLocation,
  getStatus
};