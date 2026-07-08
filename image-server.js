const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3001;

// Create uploads directory
const uploadsDir = path.join(__dirname, 'image-uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer for image uploads
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
        const allowedTypes = /jpeg|jpg|png|gif|webp/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        if (extname && mimetype) {
            return cb(null, true);
        }
        cb(new Error('Only image files are allowed!'));
    },
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// Serve static files
app.use(express.static('public'));
app.use('/uploads', express.static(uploadsDir));

// Upload endpoint
app.post('/upload', upload.single('image'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }
    
    res.json({
        success: true,
        filename: req.file.filename,
        path: `/uploads/${req.file.filename}`,
        message: 'Image uploaded successfully!'
    });
});

// List all uploaded images
app.get('/images', (req, res) => {
    const files = fs.readdirSync(uploadsDir);
    const images = files.filter(file => 
        /\.(jpg|jpeg|png|gif|webp)$/i.test(file)
    ).map(file => ({
        filename: file,
        path: `/uploads/${file}`
    }));
    
    res.json(images);
});

app.listen(PORT, () => {
    console.log(`\n========================================`);
    console.log(`  Image Upload Server Running!`);
    console.log(`========================================`);
    console.log(`  Open: http://localhost:${PORT}`);
    console.log(`  Upload images and share with AI!`);
    console.log(`========================================\n`);
});
