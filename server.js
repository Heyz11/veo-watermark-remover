require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const { pathToFileURL } = require('url');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');
const cors = require('cors');
const helmet = require('helmet');
const { authenticateApiKey } = require('./middleware/auth');
const { authenticateAdmin, adminLogin, adminLogout, adminStatus } = require('./middleware/adminAuth');
const apiRoutes = require('./routes/api');
const adminRoutes = require('./routes/admin');

// Use PostgreSQL database
const { db, pool } = require('./database');
const videoProcessor = require('./video-processor');

// Use Redis cache
const { cache } = require('./cache');

const app = express();
const PORT = process.env.PORT || 3000;

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
      formAction: ["'self'"],
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
  allowedHeaders: ['Content-Type', 'X-API-Key', 'X-Admin-Token'],
}));
app.use(express.json());

// Create necessary directories
const uploadsDir = path.join(__dirname, 'uploads');
const processedDir = path.join(__dirname, 'processed');
const batchDir = path.join(__dirname, 'batch');
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

// Serve static files
app.use(express.static('public'));
app.use('/processed', express.static(processedDir));
app.use('/uploads', express.static(uploadsDir));
app.use('/batch', express.static(batchDir));

// API routes (with authentication)
app.use('/api/v1', authenticateApiKey, apiRoutes);

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

// Image upload endpoint
app.post('/upload-image', imageUpload.single('image'), async (req, res) => {
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
      original: `/uploads/${req.file.filename}`,
      processed: `/processed/${inputName}_processed${ext}`
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
app.post('/upload-video', upload.single('video'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No video file uploaded' });
  }

  const inputPath = req.file.path;
  const inputName = path.parse(req.file.filename).name;
  const outputPath = path.join(processedDir, `${inputName}_processed.mp4`);
  const jobId = Date.now();

  console.log(`Processing video: ${req.file.originalname}`);

  // Get input file size for progress calculation
  const inputStats = fs.statSync(inputPath);
  const inputSize = inputStats.size;

  // Note: Watermark detection pre-check removed to prevent false positives from blocking video processing

  // Store job info
  const jobIdStr = String(jobId);
  activeJobs.set(jobIdStr, {
    filename: req.file.originalname,
    inputSize: inputSize,
    outputPath: outputPath,
    startTime: Date.now(),
    progress: 0,
    status: 'processing'
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
    progressUrl: `/video-progress/${jobId}`
  });

  // === Process video asynchronously via new engine (playwright headless chromium) ===
  const MAX_PROCESSING_TIME = 15 * 60 * 1000;
  const processStartTime = Date.now();
  videoProcessor.processVideo(inputPath, outputPath, {
    timeoutMs: MAX_PROCESSING_TIME,
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
app.get('/video-progress/:jobId', (req, res) => {
  const jobIdStr = req.params.jobId;
  const job = activeJobs.get(jobIdStr);

  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  res.json({
    jobId: jobIdStr,
    filename: job.filename,
    status: job.status,
    progress: job.progress,
    elapsed: Math.round((Date.now() - job.startTime) / 1000),
    ...(job.status === 'completed' && {
      original: job.original,
      processed: job.processed
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
app.post('/upload-batch', (req, res) => {
  batchUpload(req, res, ((err) => {
    if (err) {
      return res.status(400).json({ error: err.message });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    const batchId = Date.now();
    const batchFolder = path.join(batchDir, `batch-${batchId}`);
    fs.mkdirSync(batchFolder, { recursive: true });

    const jobs = req.files.map((file, index) => ({
      id: index,
      filename: file.originalname,
      inputPath: file.path,
      inputName: path.parse(file.filename).name,
      outputPath: path.join(batchFolder, `${path.parse(file.filename).name}_processed.mp4`),
      status: 'pending',
      progress: 0
    }));

    // Store batch info
    const batchInfo = {
      id: batchId,
      totalFiles: jobs.length,
      completedFiles: 0,
      jobs: jobs,
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
      await videoProcessor.processVideo(job.inputPath, job.outputPath, {});
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
app.get('/batch-status/:batchId', (req, res) => {
  const batchId = req.params.batchId;
  const batchFolder = path.join(batchDir, `batch-${batchId}`);
  const infoPath = path.join(batchFolder, 'batch-info.json');

  if (!fs.existsSync(infoPath)) {
    return res.status(404).json({ error: 'Batch not found' });
  }

  const batchInfo = JSON.parse(fs.readFileSync(infoPath, 'utf-8'));
  res.json(batchInfo);
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

// Register new user
app.post('/api/user/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    // Check if user already exists
    const existingUser = await db.users.findByEmail(email);
    if (existingUser) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    // Generate API key
    const crypto = require('crypto');
    const apiKey = 'user-' + crypto.randomBytes(16).toString('hex');

    // Create user in database
    await db.users.create(email, password, name, apiKey);

    console.log(`New user registered: ${email}`);

    res.json({
      success: true,
      message: 'Registration successful'
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Login user
app.post('/api/user/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const user = await db.users.findByEmail(email);

    if (!user || user.password !== password) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Generate session token
    const crypto = require('crypto');
    const token = crypto.randomBytes(32).toString('hex');
    
    // Store session in database
    await db.sessions.create(token, email);

    console.log(`User logged in: ${email}`);

    res.json({
      success: true,
      token,
      email: user.email,
      name: user.name
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Get user stats
app.get('/api/user/stats', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = authHeader.substring(7);
    const session = await db.sessions.findByToken(token);

    if (!session) {
      return res.status(401).json({ error: 'Invalid session' });
    }

    const stats = await db.users.getStats(session.email);
    
    if (!stats) {
      return res.status(401).json({ error: 'User not found' });
    }

    const user = await db.users.findByEmail(session.email);

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

// Logout user
app.post('/api/user/logout', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      await db.sessions.delete(token);
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ error: 'Logout failed' });
  }
});

// Worker API endpoints for Salad GPU
app.get('/api/worker/jobs/pending', async (req, res) => {
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

app.post('/api/worker/jobs/complete', multer().single('video'), async (req, res) => {
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

app.post('/api/worker/jobs/fail', async (req, res) => {
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
