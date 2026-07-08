const crypto = require('crypto');
const { db } = require('../database');

// Authentication middleware
async function authenticateApiKey(req, res, next) {
  const apiKey = req.headers['x-api-key'] || req.query.apiKey;
  
  if (!apiKey) {
    return res.status(401).json({
      error: 'API key required',
      message: 'Please provide an API key in the X-API-Key header or as apiKey query parameter'
    });
  }
  
  try {
    const keyData = await db.apiKeys.findByKey(apiKey);
    
    if (!keyData) {
      return res.status(403).json({
        error: 'Invalid API key',
        message: 'The provided API key is not valid'
      });
    }
    
    if (!keyData.active) {
      return res.status(403).json({
        error: 'API key disabled',
        message: 'This API key has been disabled'
      });
    }
    
    // Check daily rate limit
    const todayUsage = await db.usage.getDailyUsage(apiKey);
    if (todayUsage >= keyData.daily_limit) {
      return res.status(429).json({
        error: 'Rate limit exceeded',
        message: `Daily limit of ${keyData.daily_limit} requests reached. Resets at midnight UTC.`,
        limit: keyData.daily_limit,
        used: todayUsage,
        remaining: 0
      });
    }
    
    // Attach API key data to request
    req.apiKey = apiKey;
    req.apiKeyData = keyData;
    req.remainingLimit = keyData.daily_limit - todayUsage;
    
    next();
  } catch (error) {
    console.error('Authentication error:', error);
    return res.status(500).json({
      error: 'Authentication error',
      message: 'An error occurred while validating the API key'
    });
  }
}

// Generate new API key
async function generateApiKey(name, email, tier = 'free') {
  const newKey = `vk_${crypto.randomUUID().replace(/-/g, '')}`;
  
  try {
    const keyData = await db.apiKeys.create(newKey, name, email, tier);
    return keyData;
  } catch (error) {
    console.error('Error generating API key:', error);
    throw error;
  }
}

// Revoke API key
async function revokeApiKey(apiKey) {
  try {
    const keyData = await db.apiKeys.revoke(apiKey);
    return keyData;
  } catch (error) {
    console.error('Error revoking API key:', error);
    throw error;
  }
}

// List all API keys
async function listApiKeys() {
  try {
    return await db.apiKeys.list();
  } catch (error) {
    console.error('Error listing API keys:', error);
    throw error;
  }
}

module.exports = {
  authenticateApiKey,
  generateApiKey,
  revokeApiKey,
  listApiKeys
};
