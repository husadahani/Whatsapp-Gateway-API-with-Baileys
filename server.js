import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { Boom } from '@hapi/boom';
import fs from 'fs';
import path from 'path';

// Import Baileys
import Baileys, { 
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
  Browsers,
  jidNormalizedUser,
  proto,
  getContentType,
} from '@whiskeysockets/baileys';

const { default: makeWASocket } = Baileys;
const { makeInMemoryStore } = Baileys;

// Import authentication middleware
import { authenticate } from './auth.js';

// Import rate limiting
import rateLimit from 'express-rate-limit';

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

// In-memory store for messages, contacts, etc.
import pino from 'pino';
// In-memory store - temporarily disabled due to ES module compatibility
let store = null;


// Store connected sockets
const sockets = new Map();
const connections = new Map(); // Store connection details

// Function to connect to WhatsApp using phone number
async function connectWithPhoneNumber(phoneNumber, phoneId = 'default') {
  try {
    console.log(`Connecting to WhatsApp with phone number: ${phoneNumber} for ${phoneId}`);

    // Clean phone number (remove +, spaces, etc)
    const cleanNumber = phoneNumber.replace(/\D/g, '');
    
    // Validate phone number format
    if (!isValidPhoneNumber(cleanNumber)) {
      throw new Error(`Invalid phone number format: ${cleanNumber}`);
    }

    // Get auth state
    const { state, saveCreds } = await useMultiFileAuthState(`./auth_${phoneId}`);

    // Fetch latest version
    const { version, isLatest } = await fetchLatestBaileysVersion();
    console.log(`Using Baileys v${version}, isLatest: ${isLatest}`);

    // Create socket connection
    const sock = makeWASocket({
      version,
      logger: require('pino')({
        level: 'debug' // Change to 'debug' for debugging
      }),
      printQRInTerminal: false, // We'll handle QR code generation manually
      auth: state,
      browser: Browsers.ubuntu('Chrome'), // Specify browser
      syncFullHistory: true, // Enable full history sync
      shouldIgnoreJid: jid => isJidBroadcast(jid) || isJidGroup(jid) && jid.includes('status@broadcast'), // Ignore status broadcasts
      connectTimeoutMs: 60000,
      emitOwnEvents: true,
      defaultQueryTimeoutMs: 0,
      patchMessageBeforeSending: (message) => {
        const requiresPatch = !!(
          message.buttonsMessage ||
          message.templateMessage ||
          message.listMessage
        );
        if (requiresPatch) {
          message = {
            viewOnceMessage: {
              message: {
                messageContextInfo: {
                  deviceListMetadataVersion: 2,
                  deviceListMetadata: {},
                },
                ...message,
              },
            },
          };
        }

        return message;
      },
    });

    // Bind store to sock
    store.bind(sock.ev);

    // Store the socket
    sockets.set(phoneId, sock);
    connections.set(phoneId, {
      phoneNumber: cleanNumber,
      connected: false,
      connecting: true,
      reconnecting: false
    });

    // Handle socket events
    sock.ev.process(async (events) => {
      // Credentials update
      if (events['creds.update']) {
        await saveCreds();
      }

      // Connection update
      if (events['connection.update']) {
        const { connection, lastDisconnect, qr, isOnline } = events['connection.update'];

        // Handle QR code if needed
        if (qr) {
          console.log('QR code received, but connection should be initiated with phone number');
        }

        if (connection === 'open') {
          console.log(`WhatsApp connection opened for ${phoneId}`);
          connections.get(phoneId).connected = true;
          connections.get(phoneId).connecting = false;
          
          // Fetch full contact list after connection
          try {
            const contacts = await sock.contacts.upsert(sock.contacts.all());
            console.log(`Fetched ${Object.keys(contacts || {}).length} contacts for ${phoneId}`);
          } catch (err) {
            console.error('Error fetching contacts:', err);
          }
        } else if (connection === 'close') {
          console.log(`WhatsApp connection closed for ${phoneId}`);
          connections.get(phoneId).connected = false;
          const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
          
          if (shouldReconnect) {
            console.log(`Reconnecting for ${phoneId}...`);
            connections.get(phoneId).reconnecting = true;
            setTimeout(() => connectWithPhoneNumber(cleanNumber, phoneId), 5000);
          } else {
            console.log(`Logged out for ${phoneId}. Please authenticate again.`);
            connections.get(phoneId).reconnecting = false;
          }
        } else if (connection === 'connecting') {
          console.log(`Connecting to WhatsApp for ${phoneId}...`);
        }
      }

      // Authentication failure
      if (events['creds.update']) {
        console.log('Credentials updated');
      }

      // Messages update
      if (events['messages.upsert']) {
        const { messages, type } = events['messages.upsert'];
        
        if (type === 'notify') {
          for (const msg of messages) {
            console.log('Received message from:', msg.key.remoteJid);
            // Process incoming messages here if needed
            console.log('Message content:', msg.message);
          }
        }
      }

      // Message update
      if (events['messages.update']) {
        console.log('Message update received');
        for (const update of events['messages.update']) {
          if (update.key && update.update) {
            console.log('Message status updated:', update.key.id, update.update);
          }
        }
      }

      // Message relay ACK
      if (events['messages.relayAck']) {
        const { messageID, participant, result } = events['messages.relayAck'];
        console.log('Message relay ACK:', messageID, participant, result);
      }

      // Message reaction
      if (events['messages.reaction']) {
        console.log('Message reaction received');
        for (const reaction of events['messages.reaction']) {
          console.log('Reaction:', reaction);
        }
      }

      // Presence update
      if (events['presence.update']) {
        console.log('Presence update:', events['presence.update']);
      }

      // Group update
      if (events['groups.update']) {
        console.log('Groups update:', events['groups.update']);
      }

      // Group participants update
      if (events['group-participants.update']) {
        console.log('Group participants update:', events['group-participants.update']);
      }

      // Group creation
      if (events['groups.groupInvite']) {
        console.log('Group invite received:', events['groups.groupInvite']);
      }

      // Chats update
      if (events['chats.update']) {
        console.log('Chats update received');
        for (const chatUpdate of events['chats.update']) {
          console.log('Chat updated:', chatUpdate);
        }
      }

      // Chats upsert
      if (events['chats.upsert']) {
        console.log('New chats upserted');
        for (const chat of events['chats.upsert']) {
          console.log('New chat:', chat);
        }
      }

      // Chats delete
      if (events['chats.delete']) {
        console.log('Chats deleted:', events['chats.delete']);
      }

      // Contact update
      if (events['contacts.update']) {
        console.log('Contacts update received');
        for (const contact of events['contacts.update']) {
          console.log('Contact updated:', contact);
        }
      }

      // App state sync
      if (events['messaging-history.set']) {
        const { chats, contacts, messages, isLatest } = events['messaging-history.set'];
        console.log(`History sync received. Chats: ${chats.length}, Contacts: ${contacts.length}, Messages: ${messages.length}, Is latest: ${isLatest}`);
        
        // Store the history data
        store.chats.insertIfAbsent(...chats);
        store.contacts.insertAll(contacts);
        for (const msg of messages) {
          store.messages.upsert(msg);
        }
      }

      // AppState updates
      if (events['appstate.sync']) {
        console.log('AppState sync completed');
      }

      if (events['appstate.upsync']) {
        console.log('AppState upsync received');
      }
    });

    return sock;
  } catch (error) {
    console.error(`Error connecting to WhatsApp for ${phoneId}:`, error);
    throw error;
  }
}

// Function to connect with pairing code
async function connectWithPairingCode(phoneNumber, phoneId = 'default') {
  try {
    console.log(`Connecting to WhatsApp with pairing code for phone number: ${phoneNumber} and ${phoneId}`);

    // Clean phone number (remove +, spaces, etc)
    const cleanNumber = phoneNumber.replace(/\D/g, '');
    
    // Validate phone number format
    if (!isValidPhoneNumber(cleanNumber)) {
      throw new Error(`Invalid phone number format: ${cleanNumber}`);
    }

    // Get auth state
    const { state, saveCreds } = await useMultiFileAuthState(`./auth_${phoneId}`);

    // Fetch latest version
    const { version, isLatest } = await fetchLatestBaileysVersion();
    console.log(`Using Baileys v${version}, isLatest: ${isLatest}`);

    // Create socket connection with pairing code
    const sock = makeWASocket({
      version,
      logger: require('pino')({
        level: 'debug'
      }),
      printQRInTerminal: false,
      auth: state,
      browser: Browsers.ubuntu('Chrome'),
      syncFullHistory: true,
      connectTimeoutMs: 60000,
      pairingCode: true, // Enable pairing code
      mobile: false, // We're not connecting as a mobile device
      emitOwnEvents: true,
      defaultQueryTimeoutMs: 0,
    });

    // Bind store to sock
    store.bind(sock.ev);

    // Store the socket
    sockets.set(phoneId, sock);
    connections.set(phoneId, {
      phoneNumber: cleanNumber,
      connected: false,
      connecting: true,
      pairingCode: true,
      pairingCodeRequested: true
    });

    // Handle socket events
    sock.ev.process(async (events) => {
      // Credentials update
      if (events['creds.update']) {
        await saveCreds();
      }

      // Connection update
      if (events['connection.update']) {
        const { connection, lastDisconnect, qr, isOnline } = events['connection.update'];

        // Handle pairing code request
        if (connection === 'connecting' && connections.get(phoneId).pairingCodeRequested) {
          // Request pairing code
          if (!connections.get(phoneId).pairingCodeSent) {
            try {
              const code = await sock.requestPairingCode(cleanNumber);
              console.log(`Pairing code for ${cleanNumber}: ${code}`);
              // Store the pairing code temporarily for retrieval
              global[`pairingCode_${phoneId}`] = code;
              connections.get(phoneId).pairingCodeSent = true;
              connections.get(phoneId).pairingCode = code;
            } catch (err) {
              console.error('Error requesting pairing code:', err);
            }
          }
        }

        if (connection === 'open') {
          console.log(`WhatsApp connection opened for ${phoneId}`);
          connections.get(phoneId).connected = true;
          connections.get(phoneId).connecting = false;
          connections.get(phoneId).pairingCodeRequested = false;
          
          // Fetch full contact list after connection
          try {
            const contacts = await sock.contacts.upsert(sock.contacts.all());
            console.log(`Fetched ${Object.keys(contacts || {}).length} contacts for ${phoneId}`);
          } catch (err) {
            console.error('Error fetching contacts:', err);
          }
        } else if (connection === 'close') {
          console.log(`WhatsApp connection closed for ${phoneId}`);
          connections.get(phoneId).connected = false;
          const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
          
          if (shouldReconnect) {
            console.log(`Reconnecting for ${phoneId}...`);
            connections.get(phoneId).reconnecting = true;
            setTimeout(() => connectWithPairingCode(cleanNumber, phoneId), 5000);
          } else {
            console.log(`Logged out for ${phoneId}. Please authenticate again.`);
            connections.get(phoneId).reconnecting = false;
          }
        } else if (connection === 'connecting') {
          console.log(`Connecting to WhatsApp for ${phoneId}...`);
        }
      }

      // Messages update
      if (events['messages.upsert']) {
        const { messages, type } = events['messages.upsert'];
        
        if (type === 'notify') {
          for (const msg of messages) {
            console.log('Received message from:', msg.key.remoteJid);
            // Process incoming messages here if needed
            console.log('Message content:', msg.message);
          }
        }
      }

      // History sync
      if (events['messaging-history.set']) {
        const { chats, contacts, messages, isLatest } = events['messaging-history.set'];
        console.log(`History sync received. Chats: ${chats.length}, Contacts: ${contacts.length}, Messages: ${messages.length}, Is latest: ${isLatest}`);
        
        // Store the history data
        store.chats.insertIfAbsent(...chats);
        store.contacts.insertAll(contacts);
        for (const msg of messages) {
          store.messages.upsert(msg);
        }
      }

      // AppState updates
      if (events['appstate.sync']) {
        console.log('AppState sync completed');
      }

      if (events['appstate.upsync']) {
        console.log('AppState upsync received');
      }
    });

    return sock;
  } catch (error) {
    console.error(`Error connecting to WhatsApp for ${phoneId}:`, error);
    throw error;
  }
}

// Start default connection if phone number is provided in environment
if (process.env.DEFAULT_PHONE_NUMBER) {
  connectWithPhoneNumber(process.env.DEFAULT_PHONE_NUMBER, 'default').catch(console.error);
}

// API Routes

// Request pairing code for connection
app.post('/api/request-pairing-code', authenticate, async (req, res) => {
  try {
    const { phoneNumber, phoneId = 'default' } = req.body;

    if (!phoneNumber) {
      return res.status(400).json({
        success: false,
        message: 'Phone number is required'
      });
    }

    // Validate phone number format
    if (!isValidPhoneNumber(phoneNumber)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid phone number format'
      });
    }

    try {
      await connectWithPairingCode(phoneNumber, phoneId);
      
      // Wait a bit for the pairing code to be generated
      setTimeout(() => {
        const pairingCode = global[`pairingCode_${phoneId}`];
        if (pairingCode) {
          res.json({
            success: true,
            message: 'Pairing code requested successfully',
            pairingCode: pairingCode,
            phoneId: phoneId
          });
        } else {
          res.json({
            success: true,
            message: 'Pairing code requested, please wait...',
            phoneId: phoneId
          });
        }
      }, 2000);
    } catch (error) {
      console.error('Error requesting pairing code:', error);
      res.status(500).json({
        success: false,
        message: 'Error requesting pairing code',
        error: error.message
      });
    }
  } catch (error) {
    console.error('Error in request pairing code:', error);
    res.status(500).json({
      success: false,
      message: 'Error requesting pairing code',
      error: error.message
    });
  }
});

// Connect with phone number (initiate connection)
app.post('/api/connect', authenticate, async (req, res) => {
  try {
    const { phoneNumber, phoneId = 'default' } = req.body;

    if (!phoneNumber) {
      return res.status(400).json({
        success: false,
        message: 'Phone number is required'
      });
    }

    // Validate phone number format
    if (!isValidPhoneNumber(phoneNumber)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid phone number format'
      });
    }

    try {
      await connectWithPhoneNumber(phoneNumber, phoneId);
      
      res.json({
        success: true,
        message: 'Connection initiated',
        phoneId: phoneId
      });
    } catch (error) {
      console.error('Error connecting with phone number:', error);
      res.status(500).json({
        success: false,
        message: 'Error connecting to WhatsApp',
        error: error.message
      });
    }
  } catch (error) {
    console.error('Error in connect endpoint:', error);
    res.status(500).json({
      success: false,
      message: 'Error connecting to WhatsApp',
      error: error.message
    });
  }
});

// Get Connection Status (default phoneId)
app.get('/api/status', authenticate, (req, res) => {
  const phoneId = 'default';
  const connection = connections.get(phoneId);
  const sock = sockets.get(phoneId);

  if (connection) {
    res.json({
      success: true,
      connected: connection.connected,
      connecting: connection.connecting,
      reconnecting: connection.reconnecting,
      phoneNumber: connection.phoneNumber,
      pairingCode: connection.pairingCode,
      pairingCodeRequested: connection.pairingCodeRequested,
      pairingCodeSent: connection.pairingCodeSent,
      phoneId: phoneId,
      user: sock && sock.user ? sock.user : null
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
  const connection = connections.get(phoneId);
  const sock = sockets.get(phoneId);

  if (connection) {
    res.json({
      success: true,
      connected: connection.connected,
      connecting: connection.connecting,
      reconnecting: connection.reconnecting,
      phoneNumber: connection.phoneNumber,
      pairingCode: connection.pairingCode,
      pairingCodeRequested: connection.pairingCodeRequested,
      pairingCodeSent: connection.pairingCodeSent,
      phoneId: phoneId,
      user: sock && sock.user ? sock.user : null
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
          ...options,
          gifPlayback: options.gifPlayback || false
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

// Create Group
app.post('/api/create-group', authenticate, async (req, res) => {
  try {
    const { phoneId = 'default', groupName, participants } = req.body;

    if (!groupName) {
      return res.status(400).json({
        success: false,
        message: 'Group name is required'
      });
    }

    if (!participants || !Array.isArray(participants) || participants.length < 1) {
      return res.status(400).json({
        success: false,
        message: 'At least one participant is required'
      });
    }

    const sock = sockets.get(phoneId);
    if (!sock) {
      return res.status(404).json({
        success: false,
        message: `WhatsApp client for ${phoneId} not found. Please connect first.`
      });
    }

    // Format participants to JID format
    const jids = participants.map(p => {
      const cleanNum = p.replace(/\D/g, '');
      return `${cleanNum}@s.whatsapp.net`;
    });

    const group = await sock.groupCreate(groupName, jids);

    res.json({
      success: true,
      message: 'Group created successfully',
      group: group
    });
  } catch (error) {
    console.error('Error creating group:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating group',
      error: error.message
    });
  }
});

// Add participant to group
app.post('/api/group-add-participant', authenticate, async (req, res) => {
  try {
    const { phoneId = 'default', groupId, participants } = req.body;

    if (!groupId) {
      return res.status(400).json({
        success: false,
        message: 'Group ID is required'
      });
    }

    if (!participants || !Array.isArray(participants) || participants.length < 1) {
      return res.status(400).json({
        success: false,
        message: 'At least one participant is required'
      });
    }

    const sock = sockets.get(phoneId);
    if (!sock) {
      return res.status(404).json({
        success: false,
        message: `WhatsApp client for ${phoneId} not found. Please connect first.`
      });
    }

    // Format participants to JID format
    const jids = participants.map(p => {
      const cleanNum = p.replace(/\D/g, '');
      return `${cleanNum}@s.whatsapp.net`;
    });

    const result = await sock.groupParticipantsUpdate(groupId, jids, 'add');

    res.json({
      success: true,
      message: 'Participants added successfully',
      result: result
    });
  } catch (error) {
    console.error('Error adding participants to group:', error);
    res.status(500).json({
      success: false,
      message: 'Error adding participants to group',
      error: error.message
    });
  }
});

// Remove participant from group
app.post('/api/group-remove-participant', authenticate, async (req, res) => {
  try {
    const { phoneId = 'default', groupId, participants } = req.body;

    if (!groupId) {
      return res.status(400).json({
        success: false,
        message: 'Group ID is required'
      });
    }

    if (!participants || !Array.isArray(participants) || participants.length < 1) {
      return res.status(400).json({
        success: false,
        message: 'At least one participant is required'
      });
    }

    const sock = sockets.get(phoneId);
    if (!sock) {
      return res.status(404).json({
        success: false,
        message: `WhatsApp client for ${phoneId} not found. Please connect first.`
      });
    }

    // Format participants to JID format
    const jids = participants.map(p => {
      const cleanNum = p.replace(/\D/g, '');
      return `${cleanNum}@s.whatsapp.net`;
    });

    const result = await sock.groupParticipantsUpdate(groupId, jids, 'remove');

    res.json({
      success: true,
      message: 'Participants removed successfully',
      result: result
    });
  } catch (error) {
    console.error('Error removing participants from group:', error);
    res.status(500).json({
      success: false,
      message: 'Error removing participants from group',
      error: error.message
    });
  }
});

// Set group subject
app.post('/api/group-set-subject', authenticate, async (req, res) => {
  try {
    const { phoneId = 'default', groupId, subject } = req.body;

    if (!groupId || !subject) {
      return res.status(400).json({
        success: false,
        message: 'Group ID and subject are required'
      });
    }

    const sock = sockets.get(phoneId);
    if (!sock) {
      return res.status(404).json({
        success: false,
        message: `WhatsApp client for ${phoneId} not found. Please connect first.`
      });
    }

    await sock.groupUpdateSubject(groupId, subject);

    res.json({
      success: true,
      message: 'Group subject updated successfully'
    });
  } catch (error) {
    console.error('Error updating group subject:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating group subject',
      error: error.message
    });
  }
});

// Set group description
app.post('/api/group-set-description', authenticate, async (req, res) => {
  try {
    const { phoneId = 'default', groupId, description } = req.body;

    if (!groupId) {
      return res.status(400).json({
        success: false,
        message: 'Group ID is required'
      });
    }

    const sock = sockets.get(phoneId);
    if (!sock) {
      return res.status(404).json({
        success: false,
        message: `WhatsApp client for ${phoneId} not found. Please connect first.`
      });
    }

    await sock.groupUpdateDescription(groupId, description);

    res.json({
      success: true,
      message: 'Group description updated successfully'
    });
  } catch (error) {
    console.error('Error updating group description:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating group description',
      error: error.message
    });
  }
});

// Get group info
app.get('/api/group-info/:groupId', authenticate, async (req, res) => {
  try {
    const { phoneId = 'default', groupId } = req.params;

    if (!groupId) {
      return res.status(400).json({
        success: false,
        message: 'Group ID is required'
      });
    }

    const sock = sockets.get(phoneId);
    if (!sock) {
      return res.status(404).json({
        success: false,
        message: `WhatsApp client for ${phoneId} not found. Please connect first.`
      });
    }

    const groupMetadata = await sock.groupMetadata(groupId);

    res.json({
      success: true,
      groupInfo: groupMetadata
    });
  } catch (error) {
    console.error('Error getting group info:', error);
    res.status(500).json({
      success: false,
      message: 'Error getting group info',
      error: error.message
    });
  }
});

// Get all groups
app.get('/api/groups', authenticate, async (req, res) => {
  try {
    const { phoneId = 'default' } = req.query;

    const sock = sockets.get(phoneId);
    if (!sock) {
      return res.status(404).json({
        success: false,
        message: `WhatsApp client for ${phoneId} not found. Please connect first.`
      });
    }

    // Get all groups the user is part of
    const groups = Object.values(sock.groupMetadata).filter(chat => chat.id.endsWith('@g.us'));

    res.json({
      success: true,
      groups: groups
    });
  } catch (error) {
    console.error('Error getting groups:', error);
    res.status(500).json({
      success: false,
      message: 'Error getting groups',
      error: error.message
    });
  }
});

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

    // Get contacts from store
    const contacts = store.contacts ? store.contacts : sock.contacts || {};
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

    // Get contacts from store
    const contacts = store.contacts ? store.contacts : sock.contacts || {};
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

    // Get chats from store
    const chats = store.chats ? Array.from(store.chats.values()) : [];
    const chatList = chats;

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

    // Get chats from store
    const chats = store.chats ? Array.from(store.chats.values()) : [];
    const chatList = chats;

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

// Get privacy settings
app.get('/api/privacy-settings', authenticate, async (req, res) => {
  try {
    const { phoneId = 'default' } = req.query;

    const sock = sockets.get(phoneId);
    if (!sock) {
      return res.status(404).json({
        success: false,
        message: `WhatsApp client for ${phoneId} not found. Please connect first.`
      });
    }

    // Get privacy settings
    const privacySettings = await sock.fetchPrivacySettings();

    res.json({
      success: true,
      privacySettings: privacySettings
    });
  } catch (error) {
    console.error('Error getting privacy settings:', error);
    res.status(500).json({
      success: false,
      message: 'Error getting privacy settings',
      error: error.message
    });
  }
});

// Set privacy settings
app.post('/api/privacy-settings', authenticate, async (req, res) => {
  try {
    const { phoneId = 'default', settings } = req.body;

    if (!settings) {
      return res.status(400).json({
        success: false,
        message: 'Settings object is required'
      });
    }

    const sock = sockets.get(phoneId);
    if (!sock) {
      return res.status(404).json({
        success: false,
        message: `WhatsApp client for ${phoneId} not found. Please connect first.`
      });
    }

    // Update privacy settings
    await sock.updateReadReceiptsPrivacy(settings.readReceiptsPrivacy || 'all');
    await sock.updateProfilePicturePrivacy(settings.profilePicturePrivacy || 'all');
    await sock.updateStatusPrivacy(settings.statusPrivacy || 'all');
    await sock.updateOnlinePrivacy(settings.onlinePrivacy || 'all');
    await sock.updateLastSeenPrivacy(settings.lastSeenPrivacy || 'all');
    await sock.updateGroupsAddPrivacy(settings.groupsAddPrivacy || 'all');

    res.json({
      success: true,
      message: 'Privacy settings updated successfully'
    });
  } catch (error) {
    console.error('Error updating privacy settings:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating privacy settings',
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
    version: '2.0.0',
    endpoints: [
      { method: 'POST', path: '/api/connect', description: 'Connect with phone number' },
      { method: 'POST', path: '/api/request-pairing-code', description: 'Request pairing code for connection' },
      { method: 'GET', path: '/api/status', description: 'Get connection status for default phone ID' },
      { method: 'GET', path: '/api/status/:phoneId', description: 'Get connection status for specific phone ID' },
      { method: 'POST', path: '/api/send-message', description: 'Send text message' },
      { method: 'POST', path: '/api/send-media', description: 'Send media (image, video, document)' },
      { method: 'POST', path: '/api/send-contact', description: 'Send contact' },
      { method: 'POST', path: '/api/send-location', description: 'Send location' },
      { method: 'POST', path: '/api/create-group', description: 'Create a new group' },
      { method: 'POST', path: '/api/group-add-participant', description: 'Add participant to group' },
      { method: 'POST', path: '/api/group-remove-participant', description: 'Remove participant from group' },
      { method: 'POST', path: '/api/group-set-subject', description: 'Set group subject' },
      { method: 'POST', path: '/api/group-set-description', description: 'Set group description' },
      { method: 'GET', path: '/api/group-info/:groupId', description: 'Get group information' },
      { method: 'GET', path: '/api/groups', description: 'Get all groups' },
      { method: 'GET', path: '/api/contacts', description: 'Get contacts for default phone ID' },
      { method: 'GET', path: '/api/contacts/:phoneId', description: 'Get contacts for specific phone ID' },
      { method: 'GET', path: '/api/chats', description: 'Get chats for default phone ID' },
      { method: 'GET', path: '/api/chats/:phoneId', description: 'Get chats for specific phone ID' },
      { method: 'GET', path: '/api/privacy-settings', description: 'Get privacy settings' },
      { method: 'POST', path: '/api/privacy-settings', description: 'Update privacy settings' },
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
  // Remove all non-digit characters
  const cleanPhone = phone.replace(/\D/g, '');

  // Should be numeric and at least 7 digits, max 15 digits
  return /^\d{7,15}$/.test(cleanPhone);
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

export { connectWithPhoneNumber, connectWithPairingCode, sockets, connections };