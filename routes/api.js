const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { execFile } = require('child_process');
const rateLimit = require('express-rate-limit');
const { db } = require('../database');
const os = require('os');

const router = express.Router();

// Generate UUID using crypto
function generateUUID() {
  return crypto.randomUUID();
}

// Configure multer for API uploads
const apiStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const apiUploadsDir = path.join(__dirname, '..', 'api-uploads');
    if (!fs.existsSync(apiUploadsDir)) fs.mkdirSync(apiUploadsDir, { recursive: true });
    cb(null, apiUploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${req.apiKey}-${Date.now()}-${file.originalname}`;
    cb(null, uniqueName);
  }
});

const apiUpload = multer({
  storage: apiStorage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = /mp4|mov|mkv|avi|jpg|jpeg|png|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    if (extname) {
      return cb(null, true);
    }
    cb(new Error('Only image and video files are allowed!'));
  }
});

// Rate limiter for API endpoints
const apiLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000, // 24 hours
  max: 100, // 100 requests per day per API key
  message: {
    error: 'Too many requests, please try again later',
    limit: 100,
    window: '24 hours'
  },
  keyGenerator: (req) => req.apiKey
});

// Apply rate limiter to all API routes
router.use(apiLimiter);

// Get the correct executable path based on OS
function getVideoProcessorPath() {
  const isWindows = os.platform() === 'win32';
  const exeName = isWindows ? 'GeminiWatermarkTool-Video.exe' : 'GeminiWatermarkTool-Video';
  return path.join(__dirname, '..', exeName);
}

// POST /api/v1/remove/image - Remove watermark from image
router.post('/remove/image', apiUpload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file uploaded' });
    }

    const inputPath = req.file.path;
    const outputFileName = `${path.parse(req.file.filename).name}_processed.png`;
    const outputPath = path.join(__dirname, '..', 'api-processed', outputFileName);
    
    // Ensure output directory exists
    const outputDir = path.join(__dirname, '..', 'api-processed');
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    // For now, we'll use a simple approach - copy the file
    // In production, you'd integrate the GargantuaX library here
    // This is a placeholder for the actual image processing
    
    // TODO: Integrate GargantuaX library for actual watermark removal
    // For now, just copy the file as a placeholder
    fs.copyFileSync(inputPath, outputPath);
    
    // Track usage in PostgreSQL
    await db.usage.log(req.apiKey, '/remove/image');
    
    // Generate download URL
    const downloadUrl = `/api/v1/download/${outputFileName}`;
    
    res.json({
      success: true,
      message: 'Image processed successfully',
      downloadUrl: downloadUrl,
      filename: outputFileName,
      meta: {
        originalName: req.file.originalname,
        size: req.file.size,
        processedAt: new Date().toISOString()
      }
    });
    
  } catch (error) {
    console.error('API image processing error:', error);
    res.status(500).json({ 
      error: 'Image processing failed', 
      details: error.message 
    });
  }
});

// POST /api/v1/remove/video - Remove watermark from video (async)
router.post('/remove/video', apiUpload.single('video'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No video file uploaded' });
    }

    const jobId = generateUUID();
    const inputPath = req.file.path;
    const outputFileName = `${path.parse(req.file.filename).name}_processed.mp4`;
    const outputPath = path.join(__dirname, '..', 'api-processed', outputFileName);
    
    // Ensure output directory exists
    const outputDir = path.join(__dirname, '..', 'api-processed');
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    // Create job record in PostgreSQL
    await db.jobs.create(jobId, req.apiKey, 'video', inputPath, outputPath, req.file.originalname);

    // Process video asynchronously
    const exePath = getVideoProcessorPath();
    
    console.log(`Processing video with: ${exePath}`);
    console.log(`Input: ${inputPath}`);
    console.log(`Output: ${outputPath}`);
    
    execFile(exePath, [inputPath, '-o', outputPath], { maxBuffer: 1024 * 1024 * 10 }, async (error) => {
      try {
        // Update job status in PostgreSQL
        if (error) {
          await db.jobs.updateStatus(jobId, 'failed', error.message);
          console.error('Video processing error:', error);
        } else {
          await db.jobs.updateStatus(jobId, 'completed');
          await db.usage.log(req.apiKey, '/remove/video');
          console.log(`Video processing completed: ${jobId}`);
        }
      } catch (dbError) {
        console.error('Database error while updating job:', dbError);
      }
    });

    // Return job ID immediately
    res.json({
      success: true,
      message: 'Video processing started',
      jobId: jobId,
      statusUrl: `/api/v1/status/${jobId}`,
      estimatedTime: '2-5 minutes depending on video length'
    });
    
  } catch (error) {
    console.error('API video processing error:', error);
    res.status(500).json({ 
      error: 'Video processing failed', 
      details: error.message 
    });
  }
});

// GET /api/v1/status/:jobId - Check job status
router.get('/status/:jobId', async (req, res) => {
  try {
    const jobId = req.params.jobId;
    
    const job = await db.jobs.findById(jobId);
    
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }
    
    // Verify API key matches
    if (job.api_key !== req.apiKey) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    
    const response = {
      jobId: job.id,
      status: job.status,
      type: job.type,
      createdAt: job.created_at,
      completedAt: job.completed_at || null,
      progress: job.progress || 0
    };
    
    if (job.status === 'completed') {
      response.downloadUrl = `/api/v1/download/${path.basename(job.output_path)}`;
      response.filename = path.basename(job.output_path);
    }
    
    if (job.status === 'failed') {
      response.error = job.error;
    }
    
    res.json(response);
  } catch (error) {
    console.error('Error checking job status:', error);
    res.status(500).json({ 
      error: 'Error checking job status', 
      details: error.message 
    });
  }
});

// GET /api/v1/download/:filename - Download processed file
router.get('/download/:filename', (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(__dirname, '..', 'api-processed', filename);
  
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }
  
  res.download(filePath, filename);
});

// GET /api/v1/usage - Get API usage stats
router.get('/usage', async (req, res) => {
  try {
    const stats = await db.usage.getStats(req.apiKey);
    
    res.json({
      apiKey: req.apiKey,
      total: stats.total,
      today: stats.today,
      byEndpoint: stats.byEndpoint,
      byDate: stats.byDate,
      limit: req.apiKeyData.daily_limit,
      remaining: Math.max(0, req.apiKeyData.daily_limit - stats.today),
      window: '24 hours',
      lastUsed: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error getting usage stats:', error);
    res.status(500).json({ 
      error: 'Error getting usage stats', 
      details: error.message 
    });
  }
});

module.exports = router;
