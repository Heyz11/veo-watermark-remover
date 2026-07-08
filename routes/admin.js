const express = require('express');
const { db } = require('../database');

const router = express.Router();

// GET /api/admin/dashboard - Get dashboard stats
router.get('/dashboard', async (req, res) => {
  try {
    // Total API keys
    const apiKeysResult = await db.query('SELECT COUNT(*) FROM api_keys WHERE active = true');
    const totalApiKeys = parseInt(apiKeysResult.rows[0].count);

    // Today's usage
    const today = new Date().toISOString().split('T')[0];
    const todayUsageResult = await db.query(
      'SELECT COUNT(*) FROM usage_logs WHERE DATE(created_at) = $1',
      [today]
    );
    const todayUsage = parseInt(todayUsageResult.rows[0].count);

    // Total usage
    const totalUsageResult = await db.query('SELECT COUNT(*) FROM usage_logs');
    const totalUsage = parseInt(totalUsageResult.rows[0].count);

    // Usage by endpoint
    const endpointStats = await db.query(
      'SELECT endpoint, COUNT(*) as count FROM usage_logs GROUP BY endpoint ORDER BY count DESC'
    );

    // Usage last 7 days
    const dailyUsage = await db.query(`
      SELECT DATE(created_at) as date, COUNT(*) as count 
      FROM usage_logs 
      WHERE created_at >= NOW() - INTERVAL '7 days'
      GROUP BY DATE(created_at) 
      ORDER BY date
    `);

    // Active jobs
    const activeJobsResult = await db.query(
      "SELECT COUNT(*) FROM jobs WHERE status = 'processing'"
    );
    const activeJobs = parseInt(activeJobsResult.rows[0].count);

    // Completed jobs
    const completedJobsResult = await db.query(
      "SELECT COUNT(*) FROM jobs WHERE status = 'completed'"
    );
    const completedJobs = parseInt(completedJobsResult.rows[0].count);

    res.json({
      stats: {
        totalApiKeys,
        todayUsage,
        totalUsage,
        activeJobs,
        completedJobs
      },
      endpointStats: endpointStats.rows,
      dailyUsage: dailyUsage.rows
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard data' });
  }
});

// GET /api/admin/users - Get all API key holders
router.get('/users', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        ak.id, ak.key, ak.name, ak.email, ak.tier, 
        ak.daily_limit, ak.monthly_limit, ak.active, ak.created_at,
        COALESCE(usage_count.count, 0) as total_usage,
        COALESCE(today_count.count, 0) as today_usage
      FROM api_keys ak
      LEFT JOIN (
        SELECT api_key, COUNT(*) as count FROM usage_logs GROUP BY api_key
      ) usage_count ON usage_count.api_key = ak.key
      LEFT JOIN (
        SELECT api_key, COUNT(*) as count FROM usage_logs 
        WHERE DATE(created_at) = CURRENT_DATE
        GROUP BY api_key
      ) today_count ON today_count.api_key = ak.key
      ORDER BY ak.created_at DESC
    `);

    res.json({ users: result.rows });
  } catch (error) {
    console.error('Users error:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// GET /api/admin/api-keys - Get all API keys
router.get('/api-keys', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        ak.id, ak.key, ak.name, ak.email, ak.tier,
        ak.daily_limit, ak.monthly_limit, ak.active, 
        ak.created_at, ak.revoked_at,
        COALESCE(today_count.count, 0) as today_usage
      FROM api_keys ak
      LEFT JOIN (
        SELECT api_key, COUNT(*) as count FROM usage_logs 
        WHERE DATE(created_at) = CURRENT_DATE
        GROUP BY api_key
      ) today_count ON today_count.api_key = ak.key
      ORDER BY ak.created_at DESC
    `);

    res.json({ apiKeys: result.rows });
  } catch (error) {
    console.error('API keys error:', error);
    res.status(500).json({ error: 'Failed to fetch API keys' });
  }
});

// POST /api/admin/api-keys - Generate new API key
router.post('/api-keys', async (req, res) => {
  try {
    const { name, email, tier = 'free' } = req.body;
    const crypto = require('crypto');
    const newKey = `vk_${crypto.randomUUID().replace(/-/g, '')}`;
    
    const dailyLimit = tier === 'pro' ? 1000 : 100;
    const monthlyLimit = tier === 'pro' ? 10000 : 1000;
    
    const result = await db.query(
      `INSERT INTO api_keys (key, name, email, tier, daily_limit, monthly_limit) 
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [newKey, name, email, tier, dailyLimit, monthlyLimit]
    );

    res.json({ success: true, apiKey: result.rows[0] });
  } catch (error) {
    console.error('Create API key error:', error);
    res.status(500).json({ error: 'Failed to create API key' });
  }
});

// DELETE /api/admin/api-keys/:id - Revoke API key
router.delete('/api-keys/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await db.query(
      'UPDATE api_keys SET active = false, revoked_at = NOW() WHERE id = $1',
      [id]
    );
    res.json({ success: true });
  } catch (error) {
    console.error('Revoke API key error:', error);
    res.status(500).json({ error: 'Failed to revoke API key' });
  }
});

// GET /api/admin/usage - Get usage statistics
router.get('/usage', async (req, res) => {
  try {
    // Last 30 days usage
    const dailyUsage = await db.query(`
      SELECT DATE(created_at) as date, COUNT(*) as count 
      FROM usage_logs 
      WHERE created_at >= NOW() - INTERVAL '30 days'
      GROUP BY DATE(created_at) 
      ORDER BY date
    `);

    // Usage by endpoint
    const endpointUsage = await db.query(`
      SELECT endpoint, COUNT(*) as count 
      FROM usage_logs 
      GROUP BY endpoint 
      ORDER BY count DESC
    `);

    // Top users
    const topUsers = await db.query(`
      SELECT api_key, COUNT(*) as count 
      FROM usage_logs 
      WHERE created_at >= NOW() - INTERVAL '7 days'
      GROUP BY api_key 
      ORDER BY count DESC 
      LIMIT 10
    `);

    res.json({
      dailyUsage: dailyUsage.rows,
      endpointUsage: endpointUsage.rows,
      topUsers: topUsers.rows
    });
  } catch (error) {
    console.error('Usage error:', error);
    res.status(500).json({ error: 'Failed to fetch usage data' });
  }
});

// GET /api/admin/jobs - Get recent jobs
router.get('/jobs', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT * FROM jobs 
      ORDER BY created_at DESC 
      LIMIT 50
    `);

    res.json({ jobs: result.rows });
  } catch (error) {
    console.error('Jobs error:', error);
    res.status(500).json({ error: 'Failed to fetch jobs' });
  }
});

// GET /api/admin/server - Get server status
router.get('/server', async (req, res) => {
  try {
    const os = require('os');
    
    // Database status
    const dbResult = await db.query('SELECT 1');
    const dbConnected = dbResult.rows.length > 0;

    // Active jobs
    const activeJobsResult = await db.query(
      "SELECT COUNT(*) FROM jobs WHERE status = 'processing'"
    );

    res.json({
      server: {
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        platform: os.platform(),
        cpus: os.cpus().length,
        totalMemory: os.totalmem(),
        freeMemory: os.freemem()
      },
      database: {
        connected: dbConnected
      },
      activeJobs: parseInt(activeJobsResult.rows[0].count)
    });
  } catch (error) {
    console.error('Server status error:', error);
    res.status(500).json({ error: 'Failed to fetch server status' });
  }
});

module.exports = router;
