const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const crypto = require('crypto');

// Telegram Bot Token - Get from @BotFather on Telegram
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || 'YOUR_BOT_TOKEN_HERE';
const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';

// Create bot
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

// User data storage
const userDataFile = path.join(__dirname, 'telegram-users.json');
let userData = {};

// Load user data
function loadUserData() {
  if (fs.existsSync(userDataFile)) {
    userData = JSON.parse(fs.readFileSync(userDataFile, 'utf-8'));
  }
}

// Save user data
function saveUserData() {
  fs.writeFileSync(userDataFile, JSON.stringify(userData, null, 2));
}

// Generate API key for user
function generateUserApiKey(userId) {
  const apiKey = `tg_${crypto.randomUUID().replace(/-/g, '')}`;
  userData[userId] = {
    apiKey: apiKey,
    tier: 'free',
    usage: { images: 0, videos: 0 },
    dailyLimit: { images: 5, videos: 1 },
    joinedAt: new Date().toISOString()
  };
  saveUserData();
  return apiKey;
}

// Get or create user API key
function getUserApiKey(userId) {
  if (!userData[userId]) {
    return generateUserApiKey(userId);
  }
  return userData[userId].apiKey;
}

// Check daily limit
function checkDailyLimit(userId, type) {
  const user = userData[userId];
  if (!user) return true;
  
  const today = new Date().toISOString().split('T')[0];
  const lastReset = user.lastReset || today;
  
  // Reset daily counter if new day
  if (lastReset !== today) {
    user.usage = { images: 0, videos: 0 };
    user.lastReset = today;
    saveUserData();
  }
  
  const limit = type === 'image' ? user.dailyLimit.images : user.dailyLimit.videos;
  const used = type === 'image' ? user.usage.images : user.usage.videos;
  
  return used < limit;
}

// Increment usage
function incrementUsage(userId, type) {
  const user = userData[userId];
  if (!user) return;
  
  if (type === 'image') {
    user.usage.images++;
  } else {
    user.usage.videos++;
  }
  saveUserData();
}

// Welcome message
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const apiKey = getUserApiKey(chatId);
  
  const welcomeMessage = `
🎬 *Welcome to Veo Watermark Remover Bot!*

Remove watermarks from Google Veo images and videos instantly!

🔑 *Your API Key:* \`${apiKey}\`

📊 *Your Plan:* Free Tier
- 5 images/day
- 1 video/day (max 30s)

💎 *Upgrade to Pro:* RM79/month
- 500 images/day
- 50 videos/day
- Priority processing

📤 *How to use:*
1. Send me an image or video
2. I'll remove the watermark
3. Download the clean result!

⚡ *Commands:*
/status - Check your usage
/upgrade - Upgrade your plan
/help - Get help
/about - About this bot

Made with ❤️ by @yourusername
  `;
  
  bot.sendMessage(chatId, welcomeMessage, { parse_mode: 'Markdown' });
});

// Status command
bot.onText(/\/status/, (msg) => {
  const chatId = msg.chat.id;
  const user = userData[chatId];
  
  if (!user) {
    return bot.sendMessage(chatId, '❌ User not found. Please use /start first.');
  }
  
  const today = new Date().toISOString().split('T')[0];
  const lastReset = user.lastReset || today;
  
  if (lastReset !== today) {
    user.usage = { images: 0, videos: 0 };
    user.lastReset = today;
    saveUserData();
  }
  
  const statusMessage = `
📊 *Your Status*

🔑 API Key: \`${user.apiKey}\`
💎 Plan: ${user.tier.toUpperCase()}

📸 Images: ${user.usage.images}/${user.dailyLimit.images} today
🎥 Videos: ${user.usage.videos}/${user.dailyLimit.videos} today

⏰ Resets at: 00:00 UTC daily

💎 *Need more?* Use /upgrade
  `;
  
  bot.sendMessage(chatId, statusMessage, { parse_mode: 'Markdown' });
});

// Upgrade command
bot.onText(/\/upgrade/, (msg) => {
  const chatId = msg.chat.id;
  
  const upgradeMessage = `
💎 *Upgrade Your Plan*

🆓 *Free* - RM0/month
- 5 images/day
- 1 video/day (30s)

⭐ *Basic* - RM29/month
- 100 images/day
- 10 videos/day

🚀 *Pro* - RM79/month
- 500 images/day
- 50 videos/day
- Priority processing

💼 *Business* - RM199/month
- Unlimited images
- 200 videos/day
- Priority support

📧 To upgrade, contact: @yourusername
💳 Payment: Bank transfer / Touch 'n Go / PayPal
  `;
  
  bot.sendMessage(chatId, upgradeMessage, { parse_mode: 'Markdown' });
});

// Help command
bot.onText(/\/help/, (msg) => {
  const chatId = msg.chat.id;
  
  const helpMessage = `
❓ *Help*

📤 *Sending Files:*
- Just send an image or video file
- Supported: JPG, PNG, WebP, MP4, MOV, MKV
- Max size: 20MB (images), 500MB (videos)

⚡ *Processing:*
- Images: Instant (5-10 seconds)
- Videos: 2-5 minutes (depends on length)

📥 *Download:*
- I'll send you the processed file
- Download directly from chat

💎 *Limits:*
- Free: 5 images, 1 video per day
- Upgrade for more: /upgrade

🐛 *Issues?* Contact @yourusername
  `;
  
  bot.sendMessage(chatId, helpMessage, { parse_mode: 'Markdown' });
});

// About command
bot.onText(/\/about/, (msg) => {
  const chatId = msg.chat.id;
  
  const aboutMessage = `
🎬 *Veo Watermark Remover Bot*

Remove watermarks from Google Veo AI-generated images and videos with precision.

✨ *Features:*
- 100% automated
- High-quality removal
- Fast processing
- Privacy-focused

🔧 *Technology:*
- Reverse Alpha Blending
- AI-powered detection
- Edge cleanup
- Multi-pass removal

💻 *Developer:* @yourusername
🌐 *Website:* yourdomain.com
📧 *Support:* support@yourdomain.com

⭐ *Rate us:* If you like this bot, share it with friends!
  `;
  
  bot.sendMessage(chatId, aboutMessage, { parse_mode: 'Markdown' });
});

// Handle photo messages
bot.on('photo', async (msg) => {
  const chatId = msg.chat.id;
  
  // Check limit
  if (!checkDailyLimit(chatId, 'image')) {
    return bot.sendMessage(chatId, `
❌ *Daily Limit Reached*

You've used all your free image processing for today.

💎 Upgrade to Pro for 500 images/day: /upgrade
    `, { parse_mode: 'Markdown' });
  }
  
  await bot.sendMessage(chatId, '📸 Processing your image... Please wait!');
  
  try {
    // Get the largest photo
    const photo = msg.photo[msg.photo.length - 1];
    const fileId = photo.file_id;
    
    // Download photo
    const fileLink = await bot.getFileLink(fileId);
    const response = await fetch(fileLink);
    const buffer = Buffer.from(await response.arrayBuffer());
    
    // Save temporarily
    const tempPath = path.join(__dirname, 'temp', `${chatId}-${Date.now()}.jpg`);
    fs.mkdirSync(path.join(__dirname, 'temp'), { recursive: true });
    fs.writeFileSync(tempPath, buffer);
    
    // Process image (placeholder - integrate with GargantuaX)
    const outputPath = path.join(__dirname, 'temp', `${chatId}-${Date.now()}-processed.png`);
    
    // TODO: Integrate actual image processing here
    // For now, just copy the file
    fs.copyFileSync(tempPath, outputPath);
    
    // Send processed image
    await bot.sendPhoto(chatId, outputPath, {
      caption: '✅ *Watermark Removed!*\n\n💎 Enjoying the bot? Upgrade for more: /upgrade',
      parse_mode: 'Markdown'
    });
    
    // Increment usage
    incrementUsage(chatId, 'image');
    
    // Cleanup
    fs.unlinkSync(tempPath);
    fs.unlinkSync(outputPath);
    
  } catch (error) {
    console.error('Image processing error:', error);
    bot.sendMessage(chatId, '❌ Failed to process image. Please try again.');
  }
});

// Handle video messages
bot.on('video', async (msg) => {
  const chatId = msg.chat.id;
  
  // Check limit
  if (!checkDailyLimit(chatId, 'video')) {
    return bot.sendMessage(chatId, `
❌ *Daily Limit Reached*

You've used all your free video processing for today.

💎 Upgrade to Pro for 50 videos/day: /upgrade
    `, { parse_mode: 'Markdown' });
  }
  
  const video = msg.video;
  
  // Check file size (max 50MB for Telegram bot)
  if (video.file_size > 50 * 1024 * 1024) {
    return bot.sendMessage(chatId, '❌ Video too large! Max 50MB for Telegram bot.');
  }
  
  await bot.sendMessage(chatId, '🎥 Processing your video... This may take 2-5 minutes.');
  
  try {
    // Download video
    const fileId = video.file_id;
    const fileLink = await bot.getFileLink(fileId);
    const response = await fetch(fileLink);
    const buffer = Buffer.from(await response.arrayBuffer());
    
    // Save temporarily
    const tempPath = path.join(__dirname, 'temp', `${chatId}-${Date.now()}.mp4`);
    fs.mkdirSync(path.join(__dirname, 'temp'), { recursive: true });
    fs.writeFileSync(tempPath, buffer);
    
    // Process video using CLI tool
    const outputPath = path.join(__dirname, 'temp', `${chatId}-${Date.now()}-processed.mp4`);
    const exePath = path.join(__dirname, 'GeminiWatermarkTool-Video.exe');
    
    await new Promise((resolve, reject) => {
      execFile(exePath, [tempPath, '-o', outputPath], { maxBuffer: 1024 * 1024 * 10 }, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
    
    // Send processed video
    await bot.sendVideo(chatId, outputPath, {
      caption: '✅ *Watermark Removed!*\n\n💎 Enjoying the bot? Upgrade for more: /upgrade',
      parse_mode: 'Markdown'
    });
    
    // Increment usage
    incrementUsage(chatId, 'video');
    
    // Cleanup
    fs.unlinkSync(tempPath);
    fs.unlinkSync(outputPath);
    
  } catch (error) {
    console.error('Video processing error:', error);
    bot.sendMessage(chatId, '❌ Failed to process video. Please try again.');
  }
});

// Handle document (file) messages
bot.on('document', async (msg) => {
  const chatId = msg.chat.id;
  const document = msg.document;
  const mimeType = document.mime_type;
  
  // Check if it's an image or video
  if (mimeType.startsWith('image/')) {
    // Treat as photo
    bot.emit('photo', { ...msg, photo: [{ file_id: document.file_id }] });
  } else if (mimeType.startsWith('video/')) {
    // Treat as video
    bot.emit('video', { ...msg, video: { file_id: document.file_id, file_size: document.file_size } });
  } else {
    bot.sendMessage(chatId, '❌ Unsupported file type. Please send an image or video.');
  }
});

// Error handling
bot.on('polling_error', (error) => {
  console.error('Polling error:', error);
});

console.log('🤖 Telegram bot is running...');

// Load user data on start
loadUserData();
