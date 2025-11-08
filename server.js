require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const QRCode = require('qrcode');
const qrcodeTerminal = require('qrcode-terminal');
const { Boom } = require('@hapi/boom');
const fs = require('fs');
const path = require('path');

// Import Baileys
const {
  default: makeWASocket,
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
  Browsers,
  jidNormalizedUser,
  proto,
  getContentType
} = require('@whiskeysockets/baileys');

// Import authentication middleware
const { authenticate } = require('./auth');

// Import rate limiting
const rateLimit = require('express-rate-limit');

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: {
    success: false,
    message: 'Too many requests from this IP, please try again later.'
  }
});

const messageLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20, // limit each IP to 20 message requests per windowMs
  message: {
    success: false,
    message: 'Too many message requests from this IP, please try again later.'
  }
});

// Middleware
app.use(helmet());
app.use(cors());
app.use(morgan('combined'));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(limiter); // Apply rate limiting to all requests

// Optional: Store for session data (can be implemented separately if needed)
// const store = makeInMemoryStore({
//   logger: require('pino')({
//     level: 'silent' // Change to 'debug' for debugging
//   })
// });
let store = null;

// Store connected sockets
const sockets = new Map();

// Function to connect to WhatsApp
async function connectToWhatsApp(phoneId = 'default') {
  try {
    // Get auth state
    const { state, saveCreds } = await useMultiFileAuthState(`./auth_${phoneId}`);

    // Fetch latest version
    const { version, isLatest } = await fetchLatestBaileysVersion();
    console.log(`Using Baileys v${version}, isLatest: ${isLatest}`);

    // Create socket connection
    const sock = makeWASocket({
      version,
      logger: require('pino')({
      level: 'silent' // Change to 'debug' for debugging
    }),
      printQRInTerminal: false, // We'll handle QR code generation manually
      auth: state,
      browser: Browsers.ubuntu('Chrome'), // Specify browser
    });

    // Store the socket
    sockets.set(phoneId, sock);
    if (store) {
      store.bind(sock.ev);
    }

    // Handle socket events
    sock.ev.process(async (events) => {
      // Credentials update
      if (events['creds.update']) {
        await saveCreds();
      }

      // Connection update
      if (events['connection.update']) {
        const { connection, lastDisconnect, qr } = events['connection.update'];
        
        if (qr) {
          console.log(`QR Code for ${phoneId}:`);
          qrcodeTerminal.generate(qr, { small: true });
          
          // Also generate QR code as image data
          try {
            const qrDataUrl = await QRCode.toDataURL(qr);
            // Store QR data temporarily
            global[`qr_${phoneId}`] = qrDataUrl;
          } catch (err) {
            console.error('Error generating QR code image:', err);
          }
        }

        if (connection === 'open') {
          console.log(`WhatsApp connection opened for ${phoneId}`);
        } else if (connection === 'close') {
          console.log(`WhatsApp connection closed for ${phoneId}`);
          const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
          if (shouldReconnect) {
            console.log(`Reconnecting for ${phoneId}...`);
            setTimeout(() => connectToWhatsApp(phoneId), 5000);
          } else {
            console.log(`Logged out for ${phoneId}. Please scan QR again.`);
          }
        }
      }

      // Messages
      if (events['messages.upsert']) {
        const { messages, type } = events['messages.upsert'];
        if (type === 'notify') {
          for (const msg of messages) {
            // Process incoming messages here if needed
            console.log('Received message:', msg.key.remoteJid, msg.message);
          }
        }
      }
    });

    return sock;
  } catch (error) {
    console.error(`Error connecting to WhatsApp for ${phoneId}:`, error);
    throw error;
  }
}

// Start default connection
connectToWhatsApp('default').catch(console.error);

// API Routes
// Get QR Code
// Get QR Code
app.get('/api/qr', authenticate, (req, res) => {
  const phoneId = 'default';
  const qrData = global[`qr_${phoneId}`];
  
  if (qrData) {
    res.json({
      success: true,
      qr: qrData,
      message: `QR code for ${phoneId}`
    });
  } else {
    // Check if socket is already connected
    const sock = sockets.get(phoneId);
    if (sock && sock.user) {
      res.json({
        success: true,
        connected: true,
        user: sock.user,
        message: `Already connected for ${phoneId}`
      });
    } else {
      res.json({
        success: false,
        message: `No QR code available for ${phoneId}. Device may be connected or not initialized yet.`
      });
    }
  }
});

// Get QR Code with phoneId
app.get('/api/qr/:phoneId', authenticate, (req, res) => {
  const phoneId = req.params.phoneId;
  const qrData = global[`qr_${phoneId}`];
  
  if (qrData) {
    res.json({
      success: true,
      qr: qrData,
      message: `QR code for ${phoneId}`
    });
  } else {
    // Check if socket is already connected
    const sock = sockets.get(phoneId);
    if (sock && sock.user) {
      res.json({
        success: true,
        connected: true,
        user: sock.user,
        message: `Already connected for ${phoneId}`
      });
    } else {
      res.json({
        success: false,
        message: `No QR code available for ${phoneId}. Device may be connected or not initialized yet.`
      });
    }
  }
});

// Get Connection Status
// Get Connection Status (default phoneId)
app.get('/api/status', authenticate, (req, res) => {
  const phoneId = 'default';
  const sock = sockets.get(phoneId);
  
  if (sock && sock.user) {
    res.json({
      success: true,
      connected: true,
      user: sock.user,
      phoneId: phoneId
    });
  } else {
    res.json({
      success: false,
      connected: false,
      phoneId: phoneId
    });
  }
});

// Get Connection Status with phoneId
app.get('/api/status/:phoneId', authenticate, (req, res) => {
  const phoneId = req.params.phoneId;
  const sock = sockets.get(phoneId);
  
  if (sock && sock.user) {
    res.json({
      success: true,
      connected: true,
      user: sock.user,
      phoneId: phoneId
    });
  } else {
    res.json({
      success: false,
      connected: false,
      phoneId: phoneId
    });
  }
});

// Send Text Message
app.post('/api/send-message', authenticate, messageLimiter, async (req, res) => {
  try {
    const { phoneId = 'default', number, message, options = {} } = req.body;
    
    if (!number || !message) {
      return res.status(400).json({
        success: false,
        message: 'Number and message are required'
      });
    }

    // Validate phone number format
    if (!isValidPhoneNumber(number)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid phone number format. Use international format without + or with @s.whatsapp.net suffix.'
      });
    }

    const sock = sockets.get(phoneId);
    if (!sock) {
      return res.status(404).json({
        success: false,
        message: `WhatsApp client for ${phoneId} not found. Please connect first.`
      });
    }

    const jid = number.includes('@') ? number : `${number}@s.whatsapp.net`;
    
    const response = await sock.sendMessage(
      jid,
      { 
        text: message,
        ...options
      }
    );

    res.json({
      success: true,
      message: 'Message sent successfully',
      response: response
    });
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({
      success: false,
      message: 'Error sending message',
      error: error.message
    });
  }
});

// Send Media (Image, Video, Document, etc.)
app.post('/api/send-media', authenticate, messageLimiter, async (req, res) => {
  try {
    const { 
      phoneId = 'default', 
      number, 
      mediaUrl, 
      caption = '', 
      type = 'image', // image, video, document, audio
      fileName = 'file',
      options = {}
    } = req.body;
    
    if (!number || !mediaUrl) {
      return res.status(400).json({
        success: false,
        message: 'Number and media URL are required'
      });
    }

    // Validate phone number format
    if (!isValidPhoneNumber(number)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid phone number format. Use international format without + or with @s.whatsapp.net suffix.'
      });
    }

    // Validate media URL
    try {
      new URL(mediaUrl);
    } catch (e) {
      return res.status(400).json({
        success: false,
        message: 'Invalid media URL'
      });
    }

    const sock = sockets.get(phoneId);
    if (!sock) {
      return res.status(404).json({
        success: false,
        message: `WhatsApp client for ${phoneId} not found. Please connect first.`
      });
    }

    const jid = number.includes('@') ? number : `${number}@s.whatsapp.net`;
    
    // Determine message type based on media type
    let message = {};
    switch (type) {
      case 'image':
        message = {
          image: { url: mediaUrl },
          caption: caption,
          ...options
        };
        break;
      case 'video':
        message = {
          video: { url: mediaUrl },
          caption: caption,
          ...options
        };
        break;
      case 'document':
        message = {
          document: { url: mediaUrl },
          mimetype: options.mimetype || 'application/pdf',
          fileName: fileName,
          caption: caption,
          ...options
        };
        break;
      case 'audio':
        message = {
          audio: { url: mediaUrl },
          ptt: options.ptt || false,
          ...options
        };
        break;
      default:
        return res.status(400).json({
          success: false,
          message: 'Invalid media type. Use: image, video, document, or audio'
        });
    }

    const response = await sock.sendMessage(jid, message);

    res.json({
      success: true,
      message: 'Media sent successfully',
      response: response
    });
  } catch (error) {
    console.error('Error sending media:', error);
    res.status(500).json({
      success: false,
      message: 'Error sending media',
      error: error.message
    });
  }
});

// Send Contact
app.post('/api/send-contact', authenticate, messageLimiter, async (req, res) => {
  try {
    const { phoneId = 'default', number, contact } = req.body;
    
    if (!number || !contact) {
      return res.status(400).json({
        success: false,
        message: 'Number and contact information are required'
      });
    }

    // Validate phone number format
    if (!isValidPhoneNumber(number)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid phone number format. Use international format without + or with @s.whatsapp.net suffix.'
      });
    }

    // Validate contact data
    if (!contact.phoneNumber || !contact.fullName) {
      return res.status(400).json({
        success: false,
        message: 'Contact must include phoneNumber and fullName'
      });
    }

    const sock = sockets.get(phoneId);
    if (!sock) {
      return res.status(404).json({
        success: false,
        message: `WhatsApp client for ${phoneId} not found. Please connect first.`
      });
    }

    const jid = number.includes('@') ? number : `${number}@s.whatsapp.net`;
    
    // Format contact
    const vcard = `BEGIN:VCARD
VERSION:3.0
FN:${contact.fullName}
TEL;type=CELL;type=pref:${contact.phoneNumber}
END:VCARD`;

    const response = await sock.sendMessage(
      jid,
      {
        contacts: {
          displayName: contact.fullName,
          contacts: [{ 
            displayName: contact.fullName,
            vcard 
          }]
        }
      }
    );

    res.json({
      success: true,
      message: 'Contact sent successfully',
      response: response
    });
  } catch (error) {
    console.error('Error sending contact:', error);
    res.status(500).json({
      success: false,
      message: 'Error sending contact',
      error: error.message
    });
  }
});

// Send Location
app.post('/api/send-location', authenticate, messageLimiter, async (req, res) => {
  try {
    const { phoneId = 'default', number, latitude, longitude, name, address } = req.body;
    
    if (!number || latitude === undefined || longitude === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Number, latitude, and longitude are required'
      });
    }

    // Validate phone number format
    if (!isValidPhoneNumber(number)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid phone number format. Use international format without + or with @s.whatsapp.net suffix.'
      });
    }

    // Validate coordinates
    if (typeof latitude !== 'number' || typeof longitude !== 'number' || 
        latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      return res.status(400).json({
        success: false,
        message: 'Invalid coordinates. Latitude must be between -90 and 90, longitude between -180 and 180.'
      });
    }

    const sock = sockets.get(phoneId);
    if (!sock) {
      return res.status(404).json({
        success: false,
        message: `WhatsApp client for ${phoneId} not found. Please connect first.`
      });
    }

    const jid = number.includes('@') ? number : `${number}@s.whatsapp.net`;
    
    const response = await sock.sendMessage(
      jid,
      {
        location: {
          degreesLatitude: latitude,
          degreesLongitude: longitude,
          name: name,
          address: address
        }
      }
    );

    res.json({
      success: true,
      message: 'Location sent successfully',
      response: response
    });
  } catch (error) {
    console.error('Error sending location:', error);
    res.status(500).json({
      success: false,
      message: 'Error sending location',
      error: error.message
    });
  }
});

// Get Contacts List
// Get Contacts List (default phoneId)
app.get('/api/contacts', authenticate, async (req, res) => {
  try {
    const phoneId = 'default';
    const sock = sockets.get(phoneId);
    
    if (!sock) {
      return res.status(404).json({
        success: false,
        message: `WhatsApp client for ${phoneId} not found. Please connect first.`
      });
    }

    // Get contacts from store (if available)
    let contacts = {};
    if (store && store.contacts) {
      contacts = store.contacts;
    }
    const contactList = Object.values(contacts).filter(contact => 
      contact.id && contact.id.endsWith('@s.whatsapp.net')
    );

    res.json({
      success: true,
      contacts: contactList
    });
  } catch (error) {
    console.error('Error getting contacts:', error);
    res.status(500).json({
      success: false,
      message: 'Error getting contacts',
      error: error.message
    });
  }
});

// Get Contacts List with phoneId
app.get('/api/contacts/:phoneId', authenticate, async (req, res) => {
  try {
    const phoneId = req.params.phoneId;
    const sock = sockets.get(phoneId);
    
    if (!sock) {
      return res.status(404).json({
        success: false,
        message: `WhatsApp client for ${phoneId} not found. Please connect first.`
      });
    }

    // Get contacts from store (if available)
    let contacts = {};
    if (store && store.contacts) {
      contacts = store.contacts;
    }
    const contactList = Object.values(contacts).filter(contact => 
      contact.id && contact.id.endsWith('@s.whatsapp.net')
    );

    res.json({
      success: true,
      contacts: contactList
    });
  } catch (error) {
    console.error('Error getting contacts:', error);
    res.status(500).json({
      success: false,
      message: 'Error getting contacts',
      error: error.message
    });
  }
});

// Get Chats List (default phoneId)
app.get('/api/chats', authenticate, async (req, res) => {
  try {
    const phoneId = 'default';
    const sock = sockets.get(phoneId);
    
    if (!sock) {
      return res.status(404).json({
        success: false,
        message: `WhatsApp client for ${phoneId} not found. Please connect first.`
      });
    }

    // Get chats from store (if available)
    let chats = new Map();
    if (store && store.chats) {
      chats = store.chats;
    }
    const chatList = Array.from(chats.values());

    res.json({
      success: true,
      chats: chatList
    });
  } catch (error) {
    console.error('Error getting chats:', error);
    res.status(500).json({
      success: false,
      message: 'Error getting chats',
      error: error.message
    });
  }
});

// Get Chats List with phoneId
app.get('/api/chats/:phoneId', authenticate, async (req, res) => {
  try {
    const phoneId = req.params.phoneId;
    const sock = sockets.get(phoneId);
    
    if (!sock) {
      return res.status(404).json({
        success: false,
        message: `WhatsApp client for ${phoneId} not found. Please connect first.`
      });
    }

    // Get chats from store (if available)
    let chats = new Map();
    if (store && store.chats) {
      chats = store.chats;
    }
    const chatList = Array.from(chats.values());

    res.json({
      success: true,
      chats: chatList
    });
  } catch (error) {
    console.error('Error getting chats:', error);
    res.status(500).json({
      success: false,
      message: 'Error getting chats',
      error: error.message
    });
  }
});

// Health Check
app.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'WhatsApp Gateway is running',
    timestamp: new Date().toISOString()
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'WhatsApp Gateway API',
    version: '1.0.0',
    endpoints: [
      { method: 'GET', path: '/api/qr', description: 'Get QR code for default connection' },
      { method: 'GET', path: '/api/qr/:phoneId', description: 'Get QR code for specific phone ID' },
      { method: 'GET', path: '/api/status', description: 'Get connection status for default phone ID' },
      { method: 'GET', path: '/api/status/:phoneId', description: 'Get connection status for specific phone ID' },
      { method: 'POST', path: '/api/send-message', description: 'Send text message' },
      { method: 'POST', path: '/api/send-media', description: 'Send media (image, video, document)' },
      { method: 'POST', path: '/api/send-contact', description: 'Send contact' },
      { method: 'POST', path: '/api/send-location', description: 'Send location' },
      { method: 'GET', path: '/api/contacts', description: 'Get contacts for default phone ID' },
      { method: 'GET', path: '/api/contacts/:phoneId', description: 'Get contacts for specific phone ID' },
      { method: 'GET', path: '/api/chats', description: 'Get chats for default phone ID' },
      { method: 'GET', path: '/api/chats/:phoneId', description: 'Get chats for specific phone ID' },
      { method: 'GET', path: '/health', description: 'Health check' }
    ]
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    message: 'Something went wrong!',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Endpoint not found'
  });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`WhatsApp Gateway Server running on port ${PORT}`);
  console.log(`API Documentation: http://${process.env.HOST || '0.0.0.0'}:${PORT}/`);
});

// Helper function to validate phone number
function isValidPhoneNumber(phone) {
  // Check if phone number is in the format "1234567890" (without + or @s.whatsapp.net)
  if (!phone.includes('@')) {
    // Should be numeric and at least 7 digits
    return /^\d{7,15}$/.test(phone);
  }
  
  // Check if phone number is in the format "1234567890@s.whatsapp.net"
  return /@s\.whatsapp\.net$/.test(phone);
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down WhatsApp Gateway...');
  
  // Disconnect all sockets
  for (const [phoneId, sock] of sockets) {
    if (sock && sock.logout) {
      try {
        await sock.logout();
        console.log(`Logged out ${phoneId}`);
      } catch (error) {
        console.error(`Error logging out ${phoneId}:`, error);
      }
    }
  }
  
  process.exit(0);
});

module.exports = { connectToWhatsApp, sockets };