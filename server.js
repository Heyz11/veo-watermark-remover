require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const { pathToFileURL } = require('url');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { execFile } = require('child_process');
const cors = require('cors');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const { authenticateApiKey } = require('./middleware/auth');
const { authenticateFirebase } = require('./firebase-admin');
const { authenticateAdmin, adminLogin, adminLogout, adminStatus } = require('./middleware/adminAuth');
const apiRoutes = require('./routes/api');
const adminRoutes = require('./routes/admin');
const { createMcpRouter } = require('./mcp');
const { createOAuthRouter, oauthBearer } = require('./oauth');

// Use PostgreSQL database
const { db, pool } = require('./database');

// Firebase proves identity; PostgreSQL controls whether that identity may use
// application resources. Keep this check before multer so rejected requests do
// not write large unauthorised files to disk.
async function requireActiveUser(req, res, next) {
  await authenticateFirebase(req, res, async () => {
    try {
      const result = await pool.query(
        `SELECT id, email, name, COALESCE(status, 'active') AS status
         FROM users WHERE firebase_uid = $1 LIMIT 1`,
        [req.firebaseUser.uid]
      );
      if (result.rowCount === 0) {
        return res.status(403).json({ code: 'NOT_REGISTERED', error: 'Account not registered. Please sign up first.' });
      }
      const user = result.rows[0];
      if (user.status !== 'active') {
        return res.status(403).json({ code: 'ACCOUNT_INACTIVE', status: user.status, error: `Account is ${user.status}.` });
      }
      req.appUser = user;
      next();
    } catch (error) {
      console.error('Application authorization failed:', error);
      res.status(500).json({ code: 'AUTHORIZATION_FAILED', error: 'Unable to verify account access' });
    }
  });
}

function authenticateWorker(req, res, next) {
  const configured = process.env.WORKER_API_SECRET;
  const supplied = req.headers['x-worker-secret'];
  if (!configured) {
    console.error('WORKER_API_SECRET is not configured; worker API denied');
    return res.status(503).json({ error: 'Worker API is not configured' });
  }
  if (typeof supplied !== 'string') return res.status(401).json({ error: 'Unauthorized worker' });
  const expectedBuffer = Buffer.from(configured);
  const suppliedBuffer = Buffer.from(supplied);
  if (expectedBuffer.length !== suppliedBuffer.length || !crypto.timingSafeEqual(expectedBuffer, suppliedBuffer)) {
    return res.status(401).json({ error: 'Unauthorized worker' });
  }
  next();
}
const videoProcessor = require('./video-processor');
const upscaleProcessor = require('./upscale-processor');

// Use Redis cache
const { cache } = require('./cache');

const app = express();
const PORT = process.env.PORT || 3000;
app.set('trust proxy', 1);

// Simple cookie parser (no external dependency)
app.use((req, res, next) => {
  req.cookies = {};
  const cookieHeader = req.headers.cookie;
  if (cookieHeader) {
    cookieHeader.split(';').forEach(cookie => {
      const [name, ...rest] = cookie.split('=');
      req.cookies[name.trim()] = rest.join('=').trim();
    });
  }
  next();
});

// Security middleware - tightened CSP
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "https://cdn.tailwindcss.com", "https://cdn.jsdelivr.net", "'sha256-i0zyOzmM/XlaTKpUrgOwQAF9vrlRFpYKfOnagt2oddk='"],
      styleSrc: ["'self'", "https:", "'unsafe-inline'"],
      fontSrc: ["'self'", "https:", "data:"],
      imgSrc: ["'self'", "data:", "https:", "blob:"],
      connectSrc: ["'self'", "https:"],
      mediaSrc: ["'self'", "blob:"],
      frameAncestors: ["'self'"],
      baseUri: ["'self'"],
      formAction: [
        "'self'",
        "https://viotools.my.id",
        "https://www.viotools.my.id",
        "https://oauth-redirect.googleusercontent.com",
        "https://oauth-redirect-test.googleusercontent.com",
        "https://oauth-redirect-sandbox.googleusercontent.com",
      ],
      upgradeInsecureRequests: [],
    },
  },
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: { policy: "same-origin" },
  crossOriginResourcePolicy: { policy: "same-origin" },
  referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  xFrameOptions: { action: "sameorigin" },
  permissionsPolicy: {
    features: {
      camera: [],
      microphone: [],
      geolocation: [],
      payment: [],
    },
  },
}));

// CORS - whitelist specific origins
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, curl, etc)
    if (!origin) return callback(null, true);
    const allowed = [
      'https://viotools.my.id',
      'https://www.viotools.my.id',
      'http://localhost:3000',
    ];
    if (allowed.indexOf(origin) !== -1 || origin.endsWith('.viotools.my.id')) {
      callback(null, true);
    } else {
      callback(null, false);
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-Admin-Token'],
}));
app.use(cookieParser());
app.use(express.json());
app.use(createOAuthRouter({ authenticateApiKey }));
app.use('/mcp', createMcpRouter({ authenticateApiKey, oauthBearer }));

// Create necessary directories
const uploadsDir = path.join(__dirname, 'uploads');
const processedDir = path.join(__dirname, 'processed');
const batchDir = path.join(__dirname, 'batch');
const mediaRoots = { uploads: uploadsDir, processed: processedDir, batch: batchDir };
const mediaUrlSecret = process.env.MEDIA_URL_SECRET;

if (process.env.NODE_ENV === 'production' && (!mediaUrlSecret || mediaUrlSecret.length < 32)) {
  throw new Error('MEDIA_URL_SECRET must contain at least 32 characters in production');
}

function signMediaUrl(uid, publicPath, ttlSeconds = 3600) {
  if (!publicPath || !uid) return publicPath;
  const relativePath = publicPath.replace(/^\//, '');
  const scope = relativePath.split('/')[0];
  if (!mediaRoots[scope]) return publicPath;
  const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
  const signature = crypto.createHmac('sha256', mediaUrlSecret || 'development-only-media-secret')
    .update(`${uid}\n${relativePath}\n${expires}`)
    .digest('hex');
  return `/media/${relativePath}?uid=${encodeURIComponent(uid)}&expires=${expires}&signature=${signature}`;
}
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);
if (!fs.existsSync(processedDir)) fs.mkdirSync(processedDir);
if (!fs.existsSync(batchDir)) fs.mkdirSync(batchDir);

// Video engine: new client-side engine wrapped server-side via video-processor.js
// (replaces old GeminiWatermarkTool-Video.exe CUDA binary)

// Configure multer for video file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + '-' + file.originalname;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    const allowedTypes = /mp4|mov|mkv|avi/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = file.mimetype.startsWith('video/');
    if (extname || mimetype) {
      return cb(null, true);
    }
    cb(new Error('Only video files are allowed!'));
  },
  limits: { fileSize: 500 * 1024 * 1024 }
});

const imageUpload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    const allowedTypes = /png|jpg|jpeg|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = file.mimetype.startsWith('image/');
    if (extname || mimetype) {
      return cb(null, true);
    }
    cb(new Error('Only image files (PNG, JPG, WEBP) are allowed!'));
  },
  limits: { fileSize: 20 * 1024 * 1024 }
});

// Batch upload middleware
const batchUpload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    const allowedTypes = /mp4|mov|mkv|avi/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = file.mimetype.startsWith('video/');
    if (extname || mimetype) {
      return cb(null, true);
    }
    cb(new Error('Only video files are allowed!'));
  },
  limits: { fileSize: 500 * 1024 * 1024 }
}).array('videos', 10); // Max 10 files

// Serve favicon
app.get('/favicon.ico', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'favicon.ico'));
});

// Developer documentation (clean URL + legacy redirect)
app.get('/docs-api', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'docs-api.html'));
});
app.get('/api-docs.html', (req, res) => res.redirect(301, '/docs-api'));

// Admin panel (clean URL)
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Video tool clean route
app.get('/tool', (req, res) => {
  const webUrl = process.env.WEB_APP_URL;
  if (webUrl) return res.redirect(302, `${webUrl.replace(/\/$/, '')}/tool`);
  res.status(410).send('The legacy tool has been retired. Use the authenticated web application.');
});

// Serve static files
app.use(express.static('public'));
// Media is served through short-lived, UID-bound signatures. This preserves
// native video range requests without exposing uploads and outputs publicly.
app.get(/^\/media\/(uploads|processed|batch)\/(.+)$/, (req, res) => {
  const scope = req.params[0];
  const relativeFile = req.params[1];
  const uid = String(req.query.uid || '');
  const expires = Number(req.query.expires);
  const signature = String(req.query.signature || '');
  const relativePath = `${scope}/${relativeFile}`;
  if (!uid || !Number.isSafeInteger(expires) || expires < Math.floor(Date.now() / 1000)) {
    return res.status(403).json({ error: 'Media URL is invalid or expired' });
  }
  const expected = crypto.createHmac('sha256', mediaUrlSecret || 'development-only-media-secret')
    .update(`${uid}\n${relativePath}\n${expires}`)
    .digest('hex');
  const valid = signature.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  if (!valid) return res.status(403).json({ error: 'Invalid media signature' });

  const root = mediaRoots[scope];
  const filePath = path.resolve(root, relativeFile);
  if (!filePath.startsWith(path.resolve(root) + path.sep)) {
    return res.status(400).json({ error: 'Invalid media path' });
  }
  res.sendFile(filePath, err => {
    if (err && !res.headersSent) res.status(err.statusCode || 404).json({ error: 'Media not found' });
  });
});

// API routes (with authentication)
app.use('/api/v1', authenticateApiKey, apiRoutes);
// ChatGPT/Custom Action multipart alias (field: `video`) for asynchronous upscale.
app.post('/api/upload', authenticateApiKey, (req, res, next) => {
  req.url = '/upscale/video';
  apiRoutes(req, res, next);
});

// Admin auth routes (no auth required)
app.post('/api/admin/login', adminLogin);
app.post('/api/admin/logout', adminLogout);
app.get('/api/admin/status', adminStatus);

// Admin routes (with authentication)
app.use('/api/admin', authenticateAdmin, adminRoutes);

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    // Check database connection
    await pool.query('SELECT 1');
    res.json({ 
      status: 'healthy', 
      database: 'connected',
      timestamp: new Date().toISOString(),
      domain: process.env.DOMAIN || 'localhost'
    });
  } catch (error) {
    res.status(500).json({ 
      status: 'unhealthy', 
      database: 'disconnected',
      error: error.message 
    });
  }
});

// Store active video processing jobs
const activeJobs = new Map();
const MAX_CONCURRENT_UPSCALES = Number(process.env.MAX_CONCURRENT_UPSCALES || 2);
let activeUpscales = 0;

const upscaleRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: Number(process.env.UPSCALE_RATE_LIMIT_PER_HOUR || 5),
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Upscale limit reached. Try again later.', code: 'RATE_LIMITED' }
});

// ponytail: Local-disk retention only; move lifecycle policies to object storage when files leave this VPS.
const FILE_RETENTION_MS = Number(process.env.FILE_RETENTION_HOURS || 24) * 60 * 60 * 1000;
function cleanupExpiredFiles(now = Date.now()) {
  const activePaths = new Set([...activeJobs.values()].flatMap(job => [job.inputPath, job.outputPath]).filter(Boolean));
  let removed = 0;
  for (const dir of [uploadsDir, processedDir]) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const filePath = path.join(dir, entry.name);
      if (!activePaths.has(filePath) && now - fs.statSync(filePath).mtimeMs > FILE_RETENTION_MS) {
        try { fs.unlinkSync(filePath); removed++; } catch (error) { console.error(`Cleanup failed for ${filePath}: ${error.message}`); }
      }
    }
  }
  if (removed) console.log(`Cleaned up ${removed} expired video file(s)`);
  return removed;
}

cleanupExpiredFiles();
setInterval(cleanupExpiredFiles, 60 * 60 * 1000).unref();

// === Upload debugging: recent error ring buffer + request tracing ===
const recentUploadErrors = [];
const MAX_RECENT_ERRORS = 50;

function logUploadError(entry) {
  const record = { time: new Date().toISOString(), ...entry };
  recentUploadErrors.unshift(record);
  if (recentUploadErrors.length > MAX_RECENT_ERRORS) recentUploadErrors.pop();
  console.error('[upload-debug]', JSON.stringify(record));
}

// Trace all upload/progress requests with a request id so client + server logs correlate
app.use((req, res, next) => {
  if (!/^\/(upload-|video-progress|batch-status)/.test(req.path)) return next();
  req.requestId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  res.setHeader('X-Request-Id', req.requestId);
  const start = Date.now();
  console.log(`[upload-trace ${req.requestId}] ${req.method} ${req.path} content-length=${req.headers['content-length'] || 'unknown'} content-type=${req.headers['content-type'] || 'none'}`);
  res.on('finish', () => {
    console.log(`[upload-trace ${req.requestId}] -> ${res.statusCode} in ${Date.now() - start}ms`);
  });
  next();
});

// Debug endpoint: view recent upload errors (no secrets, safe to expose)
app.get('/debug/upload-errors', requireActiveUser, (req, res) => {
  res.json({ count: recentUploadErrors.length, errors: recentUploadErrors });
});

// Wrap a multer middleware so upload failures return JSON with a request id
// and get recorded in the debug ring buffer.
function withMulter(multerMiddleware, fieldHint) {
  return (req, res, next) => {
    multerMiddleware(req, res, (err) => {
      if (!err) return next();
      req.releaseUpscaleSlot?.();
      const info = {
        requestId: req.requestId,
        route: req.path,
        field: fieldHint,
        code: err.code || 'UPLOAD_ERROR',
        message: err.message,
        contentLength: req.headers['content-length'] || null,
        contentType: req.headers['content-type'] || null
      };
      logUploadError(info);
      const friendly = err.code === 'LIMIT_FILE_SIZE'
        ? 'File too large! Max 500MB'
        : err.code === 'LIMIT_FILE_COUNT'
          ? 'Too many files! Max 10 per batch'
          : err.code === 'LIMIT_UNEXPECTED_FILE'
            ? `Unexpected upload field (expected "${fieldHint}")`
            : err.message;
      res.status(400).json({ error: friendly, code: err.code || 'UPLOAD_ERROR', requestId: req.requestId });
    });
  };
}


// Image upload endpoint
app.post('/upload-image', requireActiveUser, imageUpload.single('image'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No image file uploaded' });
  }

  const inputPath = req.file.path;
  const inputName = path.parse(req.file.filename).name;
  const ext = path.extname(req.file.originalname) || '.png';
  const outputPath = path.join(processedDir, `${inputName}_processed${ext}`);

  try {
    const sharp = require('sharp');
    const inputBuffer = fs.readFileSync(inputPath);
    const { data, info } = await sharp(inputBuffer)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const sdkPath = path.join(__dirname, 'gemini-watermark-remover', 'src', 'sdk', 'node.js');
    const { removeWatermarkFromBuffer } = await import(pathToFileURL(sdkPath).href);

    const result = await removeWatermarkFromBuffer(inputBuffer, {
      mimeType: req.file.mimetype || 'image/png',
      filePath: inputPath,
      decodeImageData: async (buf) => {
        const img = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        return {
          width: img.info.width,
          height: img.info.height,
          data: new Uint8Array(img.data)
        };
      },
      encodeImageData: async (imageData, meta) => {
        const buf = Buffer.from(imageData.data);
        return sharp(buf, {
          raw: {
            width: imageData.width,
            height: imageData.height,
            channels: 4
          }
        }).png().toBuffer();
      }
    });

    fs.writeFileSync(outputPath, result.buffer);

    res.json({
      success: true,
      original: signMediaUrl(req.firebaseUser.uid, `/uploads/${req.file.filename}`),
      processed: signMediaUrl(req.firebaseUser.uid, `/processed/${inputName}_processed${ext}`)
    });
  } catch (error) {
    console.error('Image processing failed:', error);
    if (fs.existsSync(outputPath)) {
      try { fs.unlinkSync(outputPath); } catch (e) {}
    }
    res.status(500).json({ error: 'Image watermark removal failed: ' + error.message });
  }
});

// Single video upload endpoint
app.post('/upload-video', requireActiveUser, withMulter(upload.single('video'), 'video'), async (req, res) => {
  if (!req.file) {
    logUploadError({ requestId: req.requestId, route: '/upload-video', code: 'NO_FILE', message: 'No video file in request (client disconnect, proxy body limit, or wrong field name)', contentLength: req.headers['content-length'] || null });
    return res.status(400).json({ error: 'No video file uploaded', code: 'NO_FILE', requestId: req.requestId });
  }
  console.log(`[upload-trace ${req.requestId}] received file: ${req.file.originalname} (${req.file.size} bytes, ${req.file.mimetype})`);


  const inputPath = req.file.path;
  const inputName = path.parse(req.file.filename).name;
  const outputPath = path.join(processedDir, `${inputName}_processed.mp4`);
  const jobId = crypto.randomUUID();
  const model = ['dola', 'dola-landscape', 'dola-blur'].includes(req.body?.model) ? req.body.model : 'veo';

  console.log(`Processing video: ${req.file.originalname} [model=${model}]`);

  // Get input file size for progress calculation
  const inputStats = fs.statSync(inputPath);
  const inputSize = inputStats.size;

  // Note: Watermark detection pre-check removed to prevent false positives from blocking video processing

  // Store job info
  const jobIdStr = String(jobId);
  activeJobs.set(jobIdStr, {
    ownerUid: req.firebaseUser.uid,
    filename: req.file.originalname,
    inputSize: inputSize,
    outputPath: outputPath,
    startTime: Date.now(),
    progress: 0,
    status: 'processing',
    model
  });

  // Start progress monitoring
  const progressInterval = setInterval(() => {
    const job = activeJobs.get(jobIdStr);
    if (!job) {
      clearInterval(progressInterval);
      return;
    }

    if (fs.existsSync(outputPath)) {
      const outputStats = fs.statSync(outputPath);
      const outputSize = outputStats.size;
      // Estimate progress based on output file size (assuming output is ~same size as input)
      const estimatedProgress = Math.min(95, Math.round((outputSize / inputSize) * 100));
      job.progress = estimatedProgress;
    }
  }, 1000);

  // Return job ID immediately
  res.json({ 
    success: true,
    jobId: jobId,
    progressUrl: `/video-progress/${jobId}`,
    requestId: req.requestId
  });


  // === Process video asynchronously via new engine (playwright headless chromium) ===
  const MAX_PROCESSING_TIME = 15 * 60 * 1000;
  const processStartTime = Date.now();
  videoProcessor.processVideo(inputPath, outputPath, {
    model,
    timeoutMs: MAX_PROCESSING_TIME,
    // The web tool should attempt cleanup after upload even when automatic
    // detection is conservative; the old pre-check was removed for the same
    // reason (false negatives on valid Veo videos).
    allowLowConfidence: true,
    onProgress: ({ progress }) => {
      const job = activeJobs.get(jobIdStr);
      if (job && job.status === 'processing' && Number.isFinite(progress)) {
        job.progress = Math.max(job.progress, Math.min(99, Math.round(progress)));
      }
    }
  })
    .then((result) => {
      clearInterval(progressInterval);
      const processDuration = Math.round((Date.now() - processStartTime) / 1000);
      const job = activeJobs.get(jobIdStr);
      console.log(`Video processing completed: ${req.file.originalname}, Duration: ${processDuration}s`);

      if (job) {
        job.status = 'completed';
        job.progress = 100;
        job.original = `/uploads/${req.file.filename}`;
        job.processed = `/processed/${inputName}_processed.mp4`;
        job.meta = result.meta || null;
      }
    })
    .catch((err) => {
      clearInterval(progressInterval);
      const processDuration = Math.round((Date.now() - processStartTime) / 1000);
      const job = activeJobs.get(jobIdStr);
      console.error(`Video processing failed: ${req.file.originalname}, Duration: ${processDuration}s, Error: ${err.message}`);
      logUploadError({ requestId: req.requestId, route: '/upload-video', code: 'PROCESSING_FAILED', filename: req.file.originalname, model, durationSec: processDuration, message: err.message });

      if (job) {
        job.status = 'failed';
        job.error = err.message;
        job.progress = 0;
      }
      if (fs.existsSync(outputPath)) {
        try { fs.unlinkSync(outputPath); } catch (e) {}
      }
    });
});

// Video upscale endpoint (Fgsi enchantVideo API)

app.post('/upload-upscale', requireActiveUser, upscaleRateLimit, (req, res, next) => {
  if (activeUpscales >= MAX_CONCURRENT_UPSCALES) {
    return res.status(503).json({ error: 'Upscale service is busy. Try again later.', code: 'UPSCALE_BUSY' });
  }
  activeUpscales++;
  let released = false;
  req.releaseUpscaleSlot = () => {
    if (!released) { released = true; activeUpscales--; }
  };
  next();
}, withMulter(upload.single('video'), 'video'), async (req, res) => {
  if (!req.file) {
    req.releaseUpscaleSlot();
    logUploadError({ requestId: req.requestId, route: '/upload-upscale', code: 'NO_FILE', message: 'No video file in request (client disconnect, proxy body limit, or wrong field name)', contentLength: req.headers['content-length'] || null });
    return res.status(400).json({ error: 'No video file uploaded', code: 'NO_FILE', requestId: req.requestId });
  }
  console.log(`[upload-trace ${req.requestId}] received file: ${req.file.originalname} (${req.file.size} bytes, ${req.file.mimetype})`);


  const inputPath = req.file.path;
  const inputName = path.parse(req.file.filename).name;
  const outputPath = path.join(processedDir, `${inputName}_upscaled.mp4`);
  const jobId = crypto.randomUUID();
  const jobIdStr = String(jobId);

  console.log(`Upscaling video: ${req.file.originalname}`);

  activeJobs.set(jobIdStr, {
    ownerUid: req.firebaseUser.uid,
    filename: req.file.originalname,
    inputPath,
    inputSize: fs.statSync(inputPath).size,
    outputPath: outputPath,
    startTime: Date.now(),
    progress: 0,
    status: 'processing',
    model: 'upscale'
  });

  res.json({
    success: true,
    jobId: jobId,
    progressUrl: `/video-progress/${jobId}`
  });

  const processStartTime = Date.now();
  upscaleProcessor.upscaleVideo(inputPath, outputPath, {
    onProgress: ({ progress }) => {
      const job = activeJobs.get(jobIdStr);
      if (job && job.status === 'processing' && Number.isFinite(progress)) {
        job.progress = Math.max(job.progress, Math.min(99, Math.round(progress)));
      }
    }
  })
    .then((result) => {
      const processDuration = Math.round((Date.now() - processStartTime) / 1000);
      const job = activeJobs.get(jobIdStr);
      console.log(`Video upscale completed: ${req.file.originalname}, Duration: ${processDuration}s`);

      if (job) {
        job.status = 'completed';
        job.progress = 100;
        job.original = `/uploads/${req.file.filename}`;
        job.processed = `/processed/${inputName}_upscaled.mp4`;
        job.meta = result.meta || null;
      }
    })
    .catch((err) => {
      const processDuration = Math.round((Date.now() - processStartTime) / 1000);
      const job = activeJobs.get(jobIdStr);
      console.error(`Video upscale failed: ${req.file.originalname}, Duration: ${processDuration}s, Error: ${err.message}`);
      logUploadError({ requestId: req.requestId, route: '/upload-upscale', code: 'UPSCALE_FAILED', filename: req.file.originalname, durationSec: processDuration, message: err.message });

      if (job) {
        job.status = 'failed';
        job.error = err.message;
        job.progress = 0;
      }
      if (fs.existsSync(outputPath)) {
        try { fs.unlinkSync(outputPath); } catch (e) {}
      }
    })
    .finally(req.releaseUpscaleSlot);
});


// === FAIL-FAST: Detect Gemini/Veo watermark in first frame ===
// Uses ffmpeg to extract first frame, then checks pixel pattern
// at the typical watermark location (bottom-right corner)
async function detectGeminiWatermark(videoPath) {
  return new Promise((resolve) => {
    const tmpFrame = `/tmp/wm-check-${Date.now()}.png`;
    
    // Extract first frame at 0.5s (skip intro black frames)
    execFile('ffmpeg', [
      '-y',
      '-ss', '0.5',
      '-i', videoPath,
      '-vframes', '1',
      '-vf', 'scale=128:-1',
      tmpFrame
    ], { timeout: 5000 }, (err) => {
      if (err) {
        // Can't extract frame — assume watermark exists (let processor try)
        return resolve({ hasWatermark: true, reason: 'frame_extract_failed' });
      }
      
      // Read pixel data from bottom-right area (where Veo watermark usually is)
      try {
        const sharp = require('sharp');
        sharp(tmpFrame)
          .raw()
          .toBuffer({ resolveWithObject: true })
          .then(({ data, info }) => {
            const w = info.width;
            const h = info.height;
            
            // Check bottom-right 80x40 region for high contrast/text pattern
            // Veo watermark typically has bright white pixels with transparency
            const regionSize = { w: 80, h: 40 };
            const startX = Math.max(0, w - regionSize.w - 10);
            const startY = Math.max(0, h - regionSize.h - 10);
            const channels = info.channels;
            
            let brightPixels = 0;
            let totalPixels = 0;
            let maxBrightness = 0;
            let minBrightness = 255;
            
            for (let y = startY; y < startY + regionSize.h && y < h; y++) {
              for (let x = startX; x < startX + regionSize.w && x < w; x++) {
                const idx = (y * w + x) * channels;
                const r = data[idx] || 0;
                const g = data[idx + 1] || 0;
                const b = data[idx + 2] || 0;
                const brightness = (r + g + b) / 3;
                
                if (brightness > 200) brightPixels++;
                maxBrightness = Math.max(maxBrightness, brightness);
                minBrightness = Math.min(minBrightness, brightness);
                totalPixels++;
              }
            }
            
            // Cleanup
            try { fs.unlinkSync(tmpFrame); } catch (e) {}
            
            // Heuristic: watermark region should have high contrast
            // (bright logo text on dark background or vice versa)
            const contrast = maxBrightness - minBrightness;
            const brightRatio = brightPixels / totalPixels;
            
            // No watermark if region is too uniform (low contrast)
            if (contrast < 80) {
              return resolve({
                hasWatermark: false,
                reason: `low_contrast_${Math.round(contrast)}_in_bottom_right`
              });
            }
            
            // No watermark if no bright pixels (logo text)
            if (brightRatio < 0.05) {
              return resolve({
                hasWatermark: false,
                reason: `no_bright_text_pattern_${Math.round(brightRatio * 100)}pct`
              });
            }
            
            // Looks like watermark present
            return resolve({
              hasWatermark: true,
              contrast: Math.round(contrast),
              brightRatio: Math.round(brightRatio * 100)
            });
          })
          .catch(() => {
            // Sharp not available or failed — let processor try
            resolve({ hasWatermark: true, reason: 'sharp_unavailable' });
          });
      } catch (e) {
        resolve({ hasWatermark: true, reason: 'sharp_error' });
      }
    });
  });
}

// Video progress endpoint
app.get('/video-progress/:jobId', requireActiveUser, (req, res) => {
  const jobIdStr = req.params.jobId;
  const job = activeJobs.get(jobIdStr);

  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  if (job.ownerUid !== req.firebaseUser.uid) {
    return res.status(404).json({ error: 'Job not found' });
  }

  res.json({
    jobId: jobIdStr,
    filename: job.filename,
    status: job.status,
    progress: job.progress,
    elapsed: Math.round((Date.now() - job.startTime) / 1000),
    ...(job.status === 'completed' && {
      original: signMediaUrl(req.firebaseUser.uid, job.original),
      processed: signMediaUrl(req.firebaseUser.uid, job.processed)
    }),
    ...(job.status === 'failed' && {
      error: job.error
    })
  });

  // Clean up completed/failed jobs after 5 minutes
  if (job.status === 'completed' || job.status === 'failed') {
    setTimeout(() => {
      activeJobs.delete(jobIdStr);
    }, 5 * 60 * 1000);
  }
});

// Batch video upload endpoint
app.post('/upload-batch', requireActiveUser, (req, res) => {
  batchUpload(req, res, ((err) => {
    if (err) {
      return res.status(400).json({ error: err.message });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    const batchId = crypto.randomUUID();
    const model = ['dola', 'dola-landscape', 'dola-blur'].includes(req.body?.model) ? req.body.model : 'veo';
    const batchFolder = path.join(batchDir, `batch-${batchId}`);
    fs.mkdirSync(batchFolder, { recursive: true });

    const jobs = req.files.map((file, index) => ({
      id: index,
      filename: file.originalname,
      inputPath: file.path,
      inputName: path.parse(file.filename).name,
      outputPath: path.join(batchFolder, `${path.parse(file.filename).name}_processed.mp4`),
      model,
      status: 'pending',
      progress: 0
    }));

    // Store batch info
    const batchInfo = {
      id: batchId,
      totalFiles: jobs.length,
      completedFiles: 0,
      jobs: jobs,
      ownerUid: req.firebaseUser.uid,
      createdAt: new Date().toISOString()
    };

    // Save batch info
    fs.writeFileSync(
      path.join(batchFolder, 'batch-info.json'),
      JSON.stringify(batchInfo, null, 2)
    );

    // Process videos sequentially
    processBatchSequentially(jobs, batchFolder, batchId);

    res.json({
      success: true,
      batchId: batchId,
      totalFiles: jobs.length,
      statusUrl: `/batch-status/${batchId}`
    });
  }));
});

// Process batch videos sequentially via new engine
function processBatchSequentially(jobs, batchFolder, batchId) {
  let currentIndex = 0;

  async function processNext() {
    if (currentIndex >= jobs.length) {
      console.log(`Batch ${batchId} completed!`);
      createBatchZip(batchFolder, batchId);
      return;
    }

    const job = jobs[currentIndex];
    console.log(`Processing batch ${batchId}: ${job.filename} (${currentIndex + 1}/${jobs.length})`);

    try {
      await videoProcessor.processVideo(job.inputPath, job.outputPath, {
        model: job.model,
        allowLowConfidence: true
      });
      if (fs.existsSync(job.outputPath)) {
        job.status = 'completed';
        job.processedUrl = `/batch/batch-${batchId}/${path.basename(job.outputPath)}`;
      } else {
        job.status = 'failed';
        job.error = 'Output file not created';
      }
    } catch (error) {
      job.status = 'failed';
      job.error = error.message;
    }

    // Update batch info
    const batchInfo = JSON.parse(fs.readFileSync(path.join(batchFolder, 'batch-info.json'), 'utf-8'));
    batchInfo.jobs[currentIndex] = job;
    batchInfo.completedFiles = jobs.filter(j => j.status === 'completed').length;
    fs.writeFileSync(path.join(batchFolder, 'batch-info.json'), JSON.stringify(batchInfo, null, 2));

    currentIndex++;
    processNext();
  }

  processNext();
}

// Create ZIP file for batch download
async function createBatchZip(batchFolder, batchId) {
  const archiver = (await import('archiver')).default;
  const zipPath = path.join(batchDir, `batch-${batchId}.zip`);
  const output = fs.createWriteStream(zipPath);
  const archive = archiver('zip', { zlib: { level: 9 } });

  output.on('close', () => {
    console.log(`Batch ZIP created: ${zipPath} (${archive.pointer()} bytes)`);
    
    // Update batch info with zip URL
    const batchInfo = JSON.parse(fs.readFileSync(path.join(batchFolder, 'batch-info.json'), 'utf-8'));
    batchInfo.zipUrl = `/batch/batch-${batchId}.zip`;
    batchInfo.status = 'completed';
    fs.writeFileSync(path.join(batchFolder, 'batch-info.json'), JSON.stringify(batchInfo, null, 2));
  });

  archive.on('error', (err) => {
    console.error('ZIP creation error:', err);
  });

  archive.pipe(output);

  // Add all processed videos to ZIP
  const batchInfo = JSON.parse(fs.readFileSync(path.join(batchFolder, 'batch-info.json'), 'utf-8'));
  batchInfo.jobs.forEach(job => {
    if (job.status === 'completed' && fs.existsSync(job.outputPath)) {
      archive.file(job.outputPath, { name: job.filename.replace(/\.[^/.]+$/, '') + '_processed.mp4' });
    }
  });

  archive.finalize();
}

// Get batch status
app.get('/batch-status/:batchId', requireActiveUser, (req, res) => {
  const batchId = req.params.batchId;
  const batchFolder = path.join(batchDir, `batch-${batchId}`);
  const infoPath = path.join(batchFolder, 'batch-info.json');

  if (!fs.existsSync(infoPath)) {
    return res.status(404).json({ error: 'Batch not found' });
  }

  const batchInfo = JSON.parse(fs.readFileSync(infoPath, 'utf-8'));
  if (batchInfo.ownerUid !== req.firebaseUser.uid) {
    return res.status(404).json({ error: 'Batch not found' });
  }
  const response = {
    ...batchInfo,
    jobs: batchInfo.jobs.map(job => ({
      ...job,
      processedUrl: signMediaUrl(req.firebaseUser.uid, job.processedUrl)
    })),
    zipUrl: signMediaUrl(req.firebaseUser.uid, batchInfo.zipUrl)
  };
  res.json(response);
});

// Error handling middleware
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File too large! Max 500MB' });
    }
    return res.status(400).json({ error: error.message });
  }
  res.status(500).json({ error: error.message });
});

// ============================================
// USER AUTHENTICATION ENDPOINTS
// ============================================

// Validate a Firebase login against PostgreSQL. Only signup may create an account.
app.post('/api/user/session', authenticateFirebase, async (req, res) => {
  const client = await pool.connect();
  try {
    const { uid, email, name: tokenName } = req.firebaseUser;
    if (!email) return res.status(400).json({ error: 'Firebase account has no email' });
    const name = String(req.body.name || tokenName || email.split('@')[0]).trim().slice(0, 255);
    const createAccount = req.body.create === true;
    const crypto = require('crypto');
    const apiKey = 'user-' + crypto.randomBytes(24).toString('hex');
    await client.query('BEGIN');
    let result;
    if (createAccount) {
      result = await client.query(
      `INSERT INTO users (email, password, name, api_key, firebase_uid, videos_used, last_reset, status)
       VALUES ($1, NULL, $2, $3, $4, 0, CURRENT_DATE, 'active')
       ON CONFLICT (email) DO UPDATE SET
         firebase_uid = EXCLUDED.firebase_uid,
         name = CASE WHEN users.name IS NULL OR users.name = '' THEN EXCLUDED.name ELSE users.name END,
         password = NULL
       RETURNING email, name, api_key, status`,
      [email.toLowerCase(), name, apiKey, uid]
      );
    } else {
      result = await client.query(
        `UPDATE users SET firebase_uid = $1
         WHERE LOWER(email) = $2
         RETURNING email, name, api_key, status`,
        [uid, email.toLowerCase()]
      );
      if (result.rowCount === 0) {
        await client.query('ROLLBACK');
        return res.status(403).json({ code: 'NOT_REGISTERED', error: 'Account not registered. Please sign up first.' });
      }
    }
    const user = result.rows[0];
    if (user.status !== 'active') {
      await client.query('ROLLBACK');
      return res.status(403).json({ code: 'ACCOUNT_INACTIVE', status: user.status, error: `Account is ${user.status}.` });
    }
    await client.query(
      `INSERT INTO api_keys (key, name, email, tier, daily_limit, monthly_limit)
       VALUES ($1, $2, $3, 'free', 100, 1000)
       ON CONFLICT (key) DO NOTHING`,
      [user.api_key, user.name, user.email]
    );
    await client.query('COMMIT');
    res.json({ success: true, email: user.email, name: user.name });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Firebase user sync error:', error);
    res.status(500).json({ error: 'Failed to prepare account' });
  } finally {
    client.release();
  }
});

// Get user stats
app.get('/api/user/stats', requireActiveUser, async (req, res) => {
  try {
    const stats = await db.users.getStats(req.firebaseUser.email.toLowerCase());
    
    if (!stats) {
      return res.status(401).json({ error: 'User not found' });
    }

    const user = await db.users.findByEmail(req.firebaseUser.email.toLowerCase());

    res.json({
      email: user.email,
      name: user.name,
      ...stats
    });
  } catch (error) {
    console.error('Stats error:', error);
    res.status(500).json({ error: 'Failed to load stats' });
  }
});

// Generate or Regenerate API key for user
app.post('/api/user/key/generate', requireActiveUser, async (req, res) => {
  try {
    const email = req.firebaseUser.email.toLowerCase();
    const user = await db.users.findByEmail(email);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const crypto = require('crypto');
    const newKey = 'user-' + crypto.randomBytes(24).toString('hex');

    await pool.query(
      'UPDATE users SET api_key = $1 WHERE email = $2',
      [newKey, email]
    );

    // Sync into api_keys table for API auth middleware
    await pool.query(
      `INSERT INTO api_keys (key, name, email, tier, daily_limit, monthly_limit)
       VALUES ($1, $2, $3, 'free', 100, 1000)
       ON CONFLICT (key) DO NOTHING`,
      [newKey, user.name || 'User', email]
    );

    res.json({ success: true, apiKey: newKey });
  } catch (error) {
    console.error('Generate API key error:', error);
    res.status(500).json({ error: 'Failed to generate API key' });
  }
});

// Revoke API key for user
app.delete('/api/user/key/revoke', requireActiveUser, async (req, res) => {
  try {
    const email = req.firebaseUser.email.toLowerCase();
    await pool.query('UPDATE users SET api_key = NULL WHERE email = $1', [email]);
    res.json({ success: true, message: 'API key revoked' });
  } catch (error) {
    console.error('Revoke API key error:', error);
    res.status(500).json({ error: 'Failed to revoke API key' });
  }
});

// Worker API endpoints for Salad GPU
app.get('/api/worker/jobs/pending', authenticateWorker, async (req, res) => {
  try {
    const workerId = req.headers['x-worker-id'];
    if (!workerId) return res.status(401).json({ error: 'Worker ID required' });
    
    const result = await pool.query(
      "SELECT id, filename, input_url FROM jobs WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1"
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'No pending jobs' });
    }
    
    const job = result.rows[0];
    await pool.query("UPDATE jobs SET status = 'processing', worker_id = $1 WHERE id = $2", [workerId, job.id]);
    
    res.json({ job: { id: job.id, filename: job.filename, inputUrl: job.input_url } });
  } catch (error) {
    console.error('Worker poll error:', error);
    res.status(500).json({ error: 'Failed to fetch jobs' });
  }
});

app.post('/api/worker/jobs/complete', authenticateWorker, multer().single('video'), async (req, res) => {
  try {
    const workerId = req.headers['x-worker-id'];
    const { jobId } = req.body;
    
    if (!workerId || !jobId) {
      return res.status(400).json({ error: 'Worker ID and jobId required' });
    }
    
    if (!req.file) {
      return res.status(400).json({ error: 'No video file uploaded' });
    }
    
    const outputPath = path.join(__dirname, 'processed', `${jobId}_processed.mp4`);
    fs.writeFileSync(outputPath, req.file.buffer);
    
    await pool.query(
      "UPDATE jobs SET status = 'completed', output_url = $1, completed_at = NOW() WHERE id = $2",
      [`/processed/${jobId}_processed.mp4`, jobId]
    );
    
    res.json({ success: true });
  } catch (error) {
    console.error('Worker complete error:', error);
    res.status(500).json({ error: 'Failed to complete job' });
  }
});

app.post('/api/worker/jobs/fail', authenticateWorker, async (req, res) => {
  try {
    const { jobId, error } = req.body;
    
    await pool.query(
      "UPDATE jobs SET status = 'failed', error_message = $1, completed_at = NOW() WHERE id = $2",
      [error, jobId]
    );
    
    res.json({ success: true });
  } catch (err) {
    console.error('Worker fail error:', err);
    res.status(500).json({ error: 'Failed to update job' });
  }
});

// Start server
app.listen(PORT, async () => {
  console.log(`\n========================================`);
  console.log(`  Veo Watermark Remover Web App`);
  console.log(`========================================`);
  console.log(`  Server running at: http://localhost:${PORT}`);
  console.log(`  Domain: ${process.env.DOMAIN || 'Not configured'}`);
  console.log(`  Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`  OS: ${os.platform()}`);
  console.log(`  Video engine: ${videoProcessor.engineInfo().engine}`);
  console.log(`\n  Features:`);
  console.log(`  - Videos: Server-based processing (WebGPU/WASM engine)`);
  console.log(`  - Batch: Multi-file processing`);
  console.log(`  - API: http://localhost:${PORT}/api/v1`);
  console.log(`  - Health: http://localhost:${PORT}/health`);
  console.log(`\n  Database: PostgreSQL`);
  
  // Test database connection
  try {
    await pool.query('SELECT 1');
    console.log(`  Database status: Connected ✓`);
  } catch (error) {
    console.log(`  Database status: Disconnected ✗`);
    console.log(`  Error: ${error.message}`);
  }
  
  console.log(`\n  Demo API Keys:`);
  console.log(`  - demo-key-12345 (Free tier)`);
  console.log(`  - test-key-67890 (Pro tier)`);
  console.log(`========================================\n`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully...');
  await pool.end();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down gracefully...');
  await pool.end();
  process.exit(0);
});
