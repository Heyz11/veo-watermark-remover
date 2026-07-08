const crypto = require('crypto');

// Admin credentials - stored in .env
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'veoadmin2024';

// Simple session store (in-memory)
const sessions = new Map();

// Generate session token
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// Admin authentication middleware
function authenticateAdmin(req, res, next) {
  // Check for session token in cookie or header
  const token = req.cookies?.admin_token || req.headers['x-admin-token'];
  
  if (!token || !sessions.has(token)) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Admin authentication required'
    });
  }
  
  const session = sessions.get(token);
  
  // Check if session expired (24 hours)
  if (Date.now() - session.createdAt > 24 * 60 * 60 * 1000) {
    sessions.delete(token);
    return res.status(401).json({
      error: 'Session expired',
      message: 'Please login again'
    });
  }
  
  req.admin = session;
  req.adminToken = token;
  next();
}

// Login handler
function adminLogin(req, res) {
  const { username, password } = req.body;
  
  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    const token = generateToken();
    sessions.set(token, {
      username,
      createdAt: Date.now(),
      lastActivity: Date.now()
    });
    
    // Set cookie (24 hours)
    res.cookie('admin_token', token, {
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000,
      sameSite: 'strict'
    });
    
    return res.json({
      success: true,
      message: 'Login successful',
      token
    });
  }
  
  return res.status(401).json({
    error: 'Invalid credentials',
    message: 'Wrong username or password'
  });
}

// Logout handler
function adminLogout(req, res) {
  const token = req.cookies?.admin_token || req.headers['x-admin-token'];
  if (token) {
    sessions.delete(token);
  }
  
  res.clearCookie('admin_token');
  return res.json({
    success: true,
    message: 'Logged out successfully'
  });
}

// Check auth status
function adminStatus(req, res) {
  const token = req.cookies?.admin_token || req.headers['x-admin-token'];
  
  if (token && sessions.has(token)) {
    return res.json({
      authenticated: true,
      username: sessions.get(token).username
    });
  }
  
  return res.json({
    authenticated: false
  });
}

module.exports = {
  authenticateAdmin,
  adminLogin,
  adminLogout,
  adminStatus
};
