# WhatsApp Gateway API

A WhatsApp API gateway built with Baileys library that allows you to send and receive messages programmatically.

## Features

- Send text messages
- Send media (images, videos, documents, audio)
- Send contacts
- Send locations
- Get contacts and chats list
- Multiple device support
- Authentication (API Key or JWT)
- Rate limiting
- QR code authentication

## Setup

1. Clone or create the project
2. Install dependencies: `npm install`
3. Configure environment variables in `.env`
4. Start the server: `npm start`

## Environment Variables

Create a `.env` file in the root directory with the following:

```env
PORT=3000
NODE_ENV=production
API_KEY=your_api_key_here
JWT_SECRET=your_jwt_secret_here
```

## API Authentication

The API supports two authentication methods:

1. **API Key**: Include in the request header `x-api-key` or as query parameter `api_key`
2. **JWT Token**: Include in the request header `Authorization: Bearer <token>`

## API Endpoints

### Base URL
`http://154.12.116.201:3000`

### Authentication Required Endpoints

#### 1. Get QR Code for WhatsApp Connection
- **GET** `/api/qr/:phoneId?`
- Get QR code to scan with WhatsApp on your phone
- Optional `phoneId` parameter for multi-device support
- Response:
```json
{
  "success": true,
  "qr": "data:image/png;base64,...",
  "message": "QR code for default"
}
```

#### 2. Get Connection Status
- **GET** `/api/status/:phoneId?`
- Check if WhatsApp is connected
- Optional `phoneId` parameter for multi-device support
- Response:
```json
{
  "success": true,
  "connected": true,
  "user": {
    "id": "1234567890@s.whatsapp.net",
    "name": "John Doe",
    "verifiedName": "John Doe",
    "avg": null
  },
  "phoneId": "default"
}
```

#### 3. Send Text Message
- **POST** `/api/send-message`
- Send a text message to a WhatsApp number
- Headers: `x-api-key` or `Authorization: Bearer <token>`
- Request body:
```json
{
  "number": "1234567890",
  "message": "Hello, this is a test message!",
  "phoneId": "default",
  "options": {}
}
```
- Response:
```json
{
  "success": true,
  "message": "Message sent successfully",
  "response": { ... }
}
```

#### 4. Send Media
- **POST** `/api/send-media`
- Send media (image, video, document, audio)
- Headers: `x-api-key` or `Authorization: Bearer <token>`
- Request body:
```json
{
  "number": "1234567890",
  "mediaUrl": "https://example.com/image.jpg",
  "type": "image",
  "caption": "Here's an image",
  "phoneId": "default"
}
```
- Response:
```json
{
  "success": true,
  "message": "Media sent successfully",
  "response": { ... }
}
```

#### 5. Send Contact
- **POST** `/api/send-contact`
- Send a contact card
- Headers: `x-api-key` or `Authorization: Bearer <token>`
- Request body:
```json
{
  "number": "1234567890",
  "contact": {
    "fullName": "John Doe",
    "phoneNumber": "1234567890"
  },
  "phoneId": "default"
}
```
- Response:
```json
{
  "success": true,
  "message": "Contact sent successfully",
  "response": { ... }
}
```

#### 6. Send Location
- **POST** `/api/send-location`
- Send location coordinates
- Headers: `x-api-key` or `Authorization: Bearer <token>`
- Request body:
```json
{
  "number": "1234567890",
  "latitude": -6.200000,
  "longitude": 106.816666,
  "name": "Jakarta",
  "address": "Indonesia"
}
```
- Response:
```json
{
  "success": true,
  "message": "Location sent successfully",
  "response": { ... }
}
```

#### 7. Get Contacts List
- **GET** `/api/contacts/:phoneId?`
- Get list of all contacts
- Optional `phoneId` parameter for multi-device support
- Response:
```json
{
  "success": true,
  "contacts": [ ... ]
}
```

#### 8. Get Chats List
- **GET** `/api/chats/:phoneId?`
- Get list of all chats
- Optional `phoneId` parameter for multi-device support
- Response:
```json
{
  "success": true,
  "chats": [ ... ]
}
```

### Public Endpoints

#### Health Check
- **GET** `/health`
- Check if the server is running
- Response:
```json
{
  "success": true,
  "message": "WhatsApp Gateway is running",
  "timestamp": "2023-01-01T00:00:00.000Z"
}
```

## Usage Examples

### Using cURL

#### Send a text message:
```bash
curl -X POST http://154.12.116.201:3000/api/send-message \
  -H "Content-Type: application/json" \
  -H "x-api-key: whatsapp_gateway_default_key" \
  -d '{
    "number": "1234567890",
    "message": "Hello from WhatsApp Gateway!"
  }'
```

#### Send an image:
```bash
curl -X POST http://154.12.116.201:3000/api/send-media \
  -H "Content-Type: application/json" \
  -H "x-api-key: whatsapp_gateway_default_key" \
  -d '{
    "number": "1234567890",
    "mediaUrl": "https://example.com/image.jpg",
    "type": "image",
    "caption": "Here is an image"
  }'
```

#### Get QR code:
```bash
curl -H "x-api-key: whatsapp_gateway_default_key" \
  http://154.12.116.201:3000/api/qr
```

### Using JavaScript/Fetch

```javascript
const API_KEY = 'whatsapp_gateway_default_key';
const BASE_URL = 'http://154.12.116.201:3000';

// Send a message
async function sendMessage(to, message) {
  try {
    const response = await fetch(`${BASE_URL}/api/send-message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY
      },
      body: JSON.stringify({
        number: to,
        message: message
      })
    });
    
    const result = await response.json();
    console.log(result);
  } catch (error) {
    console.error('Error sending message:', error);
  }
}

// Example usage
sendMessage('1234567890', 'Hello from API!');
```

## Development

To run in development mode with auto-restart on changes:
```bash
npm run dev
```

## Security Considerations

- Use a strong, unique API key
- Use HTTPS in production
- Implement proper rate limiting in production
- Secure the server appropriately
- Don't expose the API to the public internet without proper authentication

## Troubleshooting

- If QR code doesn't appear, wait for the connection to be established
- Make sure your phone and server have internet connection
- Check the console logs for error messages
- Verify the phone number format (without +, just numbers)

## Notes

- The first connection requires scanning a QR code with your phone's WhatsApp app
- Session data is stored locally in the `auth_default` directory
- The API uses multi-device Baileys which requires WhatsApp Business to be linked
