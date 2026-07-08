require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');
const cors = require('cors');
const helmet = require('helmet');
const { authenticateApiKey } = require('./middleware/auth');
const apiRoutes = require('./routes/api');
const { db, pool } = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet());
app.use(cors());
app.use(express.json());

// Create necessary directories
const uploadsDir = path.join(__dirname, 'uploads');
const processedDir = path.join(__dirname, 'processed');
const batchDir = path.join(__dirname, 'batch');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);
if (!fs.existsSync(processedDir)) fs.mkdirSync(processedDir);
if (!fs.existsSync(batchDir)) fs.mkdirSync(batchDir);

// Get the correct executable path based on OS
function getVideoProcessorPath() {
  const isWindows = os.platform() === 'win32';
  const exeName = isWindows ? 'GeminiWatermarkTool-Video.exe' : 'GeminiWatermarkTool-Video';
  const exePath = path.join(__dirname, exeName);
  
  console.log(`Video processor path: ${exePath}`);
  console.log(`OS: ${os.platform()}, Exists: ${fs.existsSync(exePath)}`);
  
  return exePath;
}

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

// Serve static files
app.use(express.static('public'));
app.use('/processed', express.static(processedDir));
app.use('/uploads', express.static(uploadsDir));
app.use('/batch', express.static(batchDir));

// API routes (with authentication)
app.use('/api/v1', authenticateApiKey, apiRoutes);

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

// Single video upload endpoint
app.post('/upload-video', upload.single('video'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No video file uploaded' });
  }

  const inputPath = req.file.path;
  const inputName = path.parse(req.file.filename).name;
  const outputPath = path.join(processedDir, `${inputName}_processed.mp4`);
  const exePath = getVideoProcessorPath();

  console.log(`Processing video: ${req.file.originalname}`);
  console.log(`Using processor: ${exePath}`);

  execFile(exePath, [inputPath, '-o', outputPath], { maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
    if (error) {
      console.error('Error processing video:', error);
      return res.status(500).json({ 
        error: 'Video processing failed', 
        details: stderr || error.message 
      });
    }

    if (fs.existsSync(outputPath)) {
      res.json({ 
        success: true, 
        original: `/uploads/${req.file.filename}`,
        processed: `/processed/${inputName}_processed.mp4`,
        filename: req.file.originalname
      });
    } else {
      res.status(500).json({ error: 'Output file was not created' });
    }
  });
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

// Process batch videos sequentially
function processBatchSequentially(jobs, batchFolder, batchId) {
  const exePath = getVideoProcessorPath();
  let currentIndex = 0;

  function processNext() {
    if (currentIndex >= jobs.length) {
      console.log(`Batch ${batchId} completed!`);
      createBatchZip(batchFolder, batchId);
      return;
    }

    const job = jobs[currentIndex];
    console.log(`Processing batch ${batchId}: ${job.filename} (${currentIndex + 1}/${jobs.length})`);

    execFile(exePath, [job.inputPath, '-o', job.outputPath], { maxBuffer: 1024 * 1024 * 10 }, (error) => {
      if (error) {
        job.status = 'failed';
        job.error = error.message;
      } else if (fs.existsSync(job.outputPath)) {
        job.status = 'completed';
        job.processedUrl = `/batch/batch-${batchId}/${path.basename(job.outputPath)}`;
      } else {
        job.status = 'failed';
        job.error = 'Output file not created';
      }

      // Update batch info
      const batchInfo = JSON.parse(fs.readFileSync(path.join(batchFolder, 'batch-info.json'), 'utf-8'));
      batchInfo.jobs[currentIndex] = job;
      batchInfo.completedFiles = jobs.filter(j => j.status === 'completed').length;
      fs.writeFileSync(path.join(batchFolder, 'batch-info.json'), JSON.stringify(batchInfo, null, 2));

      currentIndex++;
      processNext();
    });
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

// Start server
app.listen(PORT, async () => {
  console.log(`\n========================================`);
  console.log(`  Veo Watermark Remover Web App`);
  console.log(`========================================`);
  console.log(`  Server running at: http://localhost:${PORT}`);
  console.log(`  Domain: ${process.env.DOMAIN || 'Not configured'}`);
  console.log(`  Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`  OS: ${os.platform()}`);
  console.log(`  Video processor: ${getVideoProcessorPath()}`);
  console.log(`\n  Features:`);
  console.log(`  - Images: Browser-based processing`);
  console.log(`  - Videos: Server-based processing`);
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
