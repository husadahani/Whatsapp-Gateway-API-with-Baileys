// auth.js - Authentication middleware
require('dotenv').config();
const jwt = require('jsonwebtoken');

// Generate a simple API key authentication
const API_KEY = process.env.API_KEY || 'whatsapp_gateway_default_key';

// JWT-based authentication middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Access token required'
    });
  }

  jwt.verify(token, process.env.JWT_SECRET || 'whatsapp_jwt_secret', (err, user) => {
    if (err) {
      return res.status(403).json({
        success: false,
        message: 'Invalid or expired token'
      });
    }
    req.user = user;
    next();
  });
};

// API Key authentication middleware
const authenticateApiKey = (req, res, next) => {
  const apiKey = req.headers['x-api-key'] || req.query.api_key;
  
  if (!apiKey || apiKey !== API_KEY) {
    return res.status(401).json({
      success: false,
      message: 'Invalid API key'
    });
  }
  
  next();
};

// Combined authentication - either JWT token or API key
const authenticate = (req, res, next) => {
  // Check for JWT token first
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authenticateToken(req, res, next);
  }
  
  // Check for API key
  const apiKey = req.headers['x-api-key'] || req.query.api_key;
  if (apiKey) {
    return authenticateApiKey(req, res, next);
  }
  
  // No authentication provided
  return res.status(401).json({
    success: false,
    message: 'Authentication required - provide either Authorization header (Bearer token) or x-api-key header'
  });
};

module.exports = {
  authenticate,
  authenticateToken,
  authenticateApiKey
};