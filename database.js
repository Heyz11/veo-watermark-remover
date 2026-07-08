const { Pool } = require('pg');
require('dotenv').config();

// PostgreSQL connection pool
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'veo_watermark',
  user: process.env.DB_USER || 'veo_user',
  password: process.env.DB_PASSWORD || 'veo_password_2024',
  max: 20, // Maximum number of clients in the pool
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Test connection
pool.on('connect', () => {
  console.log('Connected to PostgreSQL database');
});

pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL error:', err);
  process.exit(-1);
});

// Database helper functions
const db = {
  // Query helper
  query: async (text, params) => {
    const start = Date.now();
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    console.log('Executed query', { text: text.substring(0, 50), duration, rows: res.rowCount });
    return res;
  },

  // Get client for transactions
  getClient: () => pool.connect(),

  // API Keys
  apiKeys: {
    findByKey: async (key) => {
      const result = await pool.query('SELECT * FROM api_keys WHERE key = $1 AND active = true', [key]);
      return result.rows[0];
    },

    create: async (key, name, email, tier = 'free') => {
      const dailyLimit = tier === 'pro' ? 1000 : 100;
      const monthlyLimit = tier === 'pro' ? 10000 : 1000;
      const result = await pool.query(
        `INSERT INTO api_keys (key, name, email, tier, daily_limit, monthly_limit) 
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [key, name, email, tier, dailyLimit, monthlyLimit]
      );
      return result.rows[0];
    },

    revoke: async (key) => {
      const result = await pool.query(
        'UPDATE api_keys SET active = false, revoked_at = NOW() WHERE key = $1 RETURNING *',
        [key]
      );
      return result.rows[0];
    },

    list: async () => {
      const result = await pool.query('SELECT * FROM api_keys ORDER BY created_at DESC');
      return result.rows;
    },
  },

  // Usage tracking
  usage: {
    log: async (apiKey, endpoint, status = 'success') => {
      await pool.query(
        'INSERT INTO usage_logs (api_key, endpoint, status) VALUES ($1, $2, $3)',
        [apiKey, endpoint, status]
      );
    },

    getStats: async (apiKey) => {
      const today = new Date().toISOString().split('T')[0];
      
      // Today's usage
      const todayResult = await pool.query(
        `SELECT COUNT(*) as count FROM usage_logs 
         WHERE api_key = $1 AND DATE(created_at) = $2`,
        [apiKey, today]
      );

      // Total usage
      const totalResult = await pool.query(
        'SELECT COUNT(*) as count FROM usage_logs WHERE api_key = $1',
        [apiKey]
      );

      // Usage by endpoint
      const endpointResult = await pool.query(
        `SELECT endpoint, COUNT(*) as count FROM usage_logs 
         WHERE api_key = $1 GROUP BY endpoint`,
        [apiKey]
      );

      // Usage by date (last 7 days)
      const dateResult = await pool.query(
        `SELECT DATE(created_at) as date, COUNT(*) as count FROM usage_logs 
         WHERE api_key = $1 AND created_at >= NOW() - INTERVAL '7 days'
         GROUP BY DATE(created_at) ORDER BY date`,
        [apiKey]
      );

      return {
        today: parseInt(todayResult.rows[0].count),
        total: parseInt(totalResult.rows[0].count),
        byEndpoint: endpointResult.rows.reduce((acc, row) => {
          acc[row.endpoint] = parseInt(row.count);
          return acc;
        }, {}),
        byDate: dateResult.rows.reduce((acc, row) => {
          acc[row.date] = parseInt(row.count);
          return acc;
        }, {}),
      };
    },

    getDailyUsage: async (apiKey) => {
      const today = new Date().toISOString().split('T')[0];
      const result = await pool.query(
        `SELECT COUNT(*) as count FROM usage_logs 
         WHERE api_key = $1 AND DATE(created_at) = $2`,
        [apiKey, today]
      );
      return parseInt(result.rows[0].count);
    },
  },

  // Jobs
  jobs: {
    create: async (id, apiKey, type, inputPath, outputPath, originalName) => {
      const result = await pool.query(
        `INSERT INTO jobs (id, api_key, type, status, input_path, output_path, original_name) 
         VALUES ($1, $2, $3, 'processing', $4, $5, $6) RETURNING *`,
        [id, apiKey, type, inputPath, outputPath, originalName]
      );
      return result.rows[0];
    },

    updateStatus: async (id, status, error = null, progress = null) => {
      const completedAt = status === 'completed' || status === 'failed' ? new Date() : null;
      const result = await pool.query(
        `UPDATE jobs SET status = $1, error = $2, progress = $3, completed_at = $4 
         WHERE id = $5 RETURNING *`,
        [status, error, progress, completedAt, id]
      );
      return result.rows[0];
    },

    findById: async (id) => {
      const result = await pool.query('SELECT * FROM jobs WHERE id = $1', [id]);
      return result.rows[0];
    },

    findByApiKey: async (apiKey, limit = 50) => {
      const result = await pool.query(
        'SELECT * FROM jobs WHERE api_key = $1 ORDER BY created_at DESC LIMIT $2',
        [apiKey, limit]
      );
      return result.rows;
    },
  },

  // Telegram users
  telegram: {
    findByChatId: async (chatId) => {
      const result = await pool.query('SELECT * FROM telegram_users WHERE chat_id = $1', [chatId]);
      return result.rows[0];
    },

    create: async (chatId, apiKey) => {
      const result = await pool.query(
        `INSERT INTO telegram_users (chat_id, api_key) VALUES ($1, $2) RETURNING *`,
        [chatId, apiKey]
      );
      return result.rows[0];
    },

    updateUsage: async (chatId, type) => {
      const today = new Date().toISOString().split('T')[0];
      
      // Reset daily counter if new day
      await pool.query(
        `UPDATE telegram_users SET images_used = 0, videos_used = 0, last_reset = $1 
         WHERE chat_id = $2 AND last_reset < $1`,
        [today, chatId]
      );

      // Increment usage
      const column = type === 'image' ? 'images_used' : 'videos_used';
      await pool.query(
        `UPDATE telegram_users SET ${column} = ${column} + 1 WHERE chat_id = $1`,
        [chatId]
      );
    },

    checkLimit: async (chatId, type) => {
      const today = new Date().toISOString().split('T')[0];
      
      // Reset if new day
      await pool.query(
        `UPDATE telegram_users SET images_used = 0, videos_used = 0, last_reset = $1 
         WHERE chat_id = $2 AND last_reset < $1`,
        [today, chatId]
      );

      const result = await pool.query(
        `SELECT images_used, videos_used, daily_images_limit, daily_videos_limit 
         FROM telegram_users WHERE chat_id = $1`,
        [chatId]
      );

      if (result.rows.length === 0) return true; // No limit for non-existent users

      const user = result.rows[0];
      if (type === 'image') {
        return user.images_used < user.daily_images_limit;
      } else {
        return user.videos_used < user.daily_videos_limit;
      }
    },
  },
};

module.exports = { pool, db };
