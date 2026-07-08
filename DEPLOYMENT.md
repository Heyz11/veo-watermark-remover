# 🚀 Deployment Guide - Veo Watermark Remover

## Domain: **https://viotools.my.id**
## VPS: **43.134.68.31** (Ubuntu)

---

## 📋 What's Been Updated

### Files Modified:
1. ✅ `server.js` - Updated for Linux + PostgreSQL + auto-detect OS
2. ✅ `database.js` - NEW - PostgreSQL connection & helpers
3. ✅ `middleware/auth.js` - Updated to use PostgreSQL
4. ✅ `routes/api.js` - Updated to use PostgreSQL
5. ✅ `package.json` - Added `pg` and `dotenv` dependencies
6. ✅ `deploy-vps.sh` - Complete VPS setup script
7. ✅ `.env.example` - Environment variables template
8. ✅ `DNS_SETUP.md` - DNS configuration guide

---

## 🎯 Deployment Steps

### Step 1: SSH into VPS

Open PowerShell on your local machine:
```powershell
ssh ubuntu@43.134.68.31
```
Password: `ocean-98%-ninja`

---

### Step 2: Upload Deploy Script

Open a **NEW PowerShell window** (keep the SSH one open):
```powershell
scp "C:\Users\anasz\Desktop\GOOGLE VEO 3 WATERMARK\deploy-vps.sh" ubuntu@43.134.68.31:~/
```

---

### Step 3: Run Deploy Script

In the SSH session:
```bash
chmod +x ~/deploy-vps.sh
~/deploy-vps.sh
```

This will install:
- Node.js 20.x
- PM2 (process manager)
- Nginx (reverse proxy)
- PostgreSQL + database + tables
- FFmpeg
- VeoWatermarkRemover Linux binary
- Certbot (for SSL)
- Nginx config for viotools.my.id

---

### Step 4: Upload Project Files

In a **NEW PowerShell window**:
```powershell
# Navigate to project folder
cd "C:\Users\anasz\Desktop\GOOGLE VEO 3 WATERMARK"

# Upload all necessary files
scp server.js ubuntu@43.134.68.31:~/veo-watermark-remover/
scp database.js ubuntu@43.134.68.31:~/veo-watermark-remover/
scp package.json ubuntu@43.134.68.31:~/veo-watermark-remover/
scp .env.example ubuntu@43.134.68.31:~/veo-watermark-remover/
scp -r public ubuntu@43.134.68.31:~/veo-watermark-remover/
scp -r routes ubuntu@43.134.68.31:~/veo-watermark-remover/
scp -r middleware ubuntu@43.134.68.31:~/veo-watermark-remover/
```

---

### Step 5: Install Dependencies & Start App

In the SSH session:
```bash
cd ~/veo-watermark-remover

# Copy .env.example to .env
cp .env.example .env

# Install npm dependencies
npm install

# Start with PM2
pm2 start server.js --name veo-watermark

# Save PM2 config
pm2 save

# Setup PM2 to start on boot
pm2 startup
```

---

### Step 6: Point DNS to VPS

Login to your domain registrar and add these DNS records:

| Type | Host | Value | TTL |
|------|------|-------|-----|
| A | @ | 43.134.68.31 | 3600 |
| A | www | 43.134.68.31 | 3600 |

See `DNS_SETUP.md` for detailed instructions.

---

### Step 7: Activate SSL (After DNS Propagates)

Wait 5-30 minutes for DNS to propagate, then:
```bash
sudo certbot --nginx -d viotools.my.id -d www.viotools.my.id --email admin@viotools.my.id --agree-tos --non-interactive
```

---

### Step 8: Test Your Website

Open browser:
- https://viotools.my.id
- https://www.viotools.my.id

---

## 🗄️ Database Info

```
Host: localhost
Port: 5432
Database: veo_watermark
User: veo_user
Password: veo_password_2024
```

### Connect to PostgreSQL:
```bash
psql -h localhost -U veo_user -d veo_watermark
```

### Default API Keys:
- `demo-key-12345` (Free tier - 100 requests/day)
- `test-key-67890` (Pro tier - 1000 requests/day)

---

## 🔧 Useful Commands

### PM2 (App Management)
```bash
pm2 status                    # Check app status
pm2 logs                      # View logs
pm2 logs --lines 100          # View last 100 lines
pm2 restart veo-watermark     # Restart app
pm2 stop veo-watermark        # Stop app
pm2 delete veo-watermark      # Delete from PM2
```

### Nginx
```bash
sudo systemctl status nginx   # Check status
sudo systemctl restart nginx  # Restart
sudo nginx -t                 # Test config
```

### PostgreSQL
```bash
sudo systemctl status postgresql
sudo systemctl restart postgresql
psql -h localhost -U veo_user -d veo_watermark
```

### View Logs
```bash
# App logs
pm2 logs veo-watermark

# Nginx logs
sudo tail -f /var/log/nginx/error.log
sudo tail -f /var/log/nginx/access.log
```

---

## 🔄 Updating the App

When you make changes locally:

```powershell
# From local PowerShell
cd "C:\Users\anasz\Desktop\GOOGLE VEO 3 WATERMARK"
scp server.js ubuntu@43.134.68.31:~/veo-watermark-remover/
```

Then in SSH:
```bash
cd ~/veo-watermark-remover
pm2 restart veo-watermark
```

---

## 📊 Video Processing

The app uses **VeoWatermarkRemover** (allenk/VeoWatermarkRemover) for video processing.

- **Windows**: Uses `GeminiWatermarkTool-Video.exe`
- **Linux**: Uses `GeminiWatermarkTool-Video` (no extension)

The app auto-detects the OS and uses the correct binary.

### Check if binary exists:
```bash
ls -la ~/veo-watermark-remover/GeminiWatermarkTool-Video
```

### Make it executable (if needed):
```bash
chmod +x ~/veo-watermark-remover/GeminiWatermarkTool-Video
```

---

## 🔒 Security Notes

1. **Change PostgreSQL password** in production:
   ```bash
   sudo -u postgres psql
   ALTER USER veo_user WITH PASSWORD 'new_secure_password';
   ```
   Then update `.env` file.

2. **Update .env file** with your actual Telegram bot token (if using).

3. **Consider changing API keys** from the defaults.

4. **Enable firewall** (if not already):
   ```bash
   sudo ufw allow 22/tcp    # SSH
   sudo ufw allow 80/tcp    # HTTP
   sudo ufw allow 443/tcp   # HTTPS
   sudo ufw enable
   ```

---

## 🐛 Troubleshooting

### App won't start
```bash
pm2 logs veo-watermark --lines 50
```

### Database connection error
```bash
sudo systemctl status postgresql
psql -h localhost -U veo_user -d veo_watermark -c "SELECT 1"
```

### Nginx 502 Bad Gateway
```bash
pm2 status
pm2 restart veo-watermark
```

### Video processing not working
```bash
# Check if binary exists
ls -la ~/veo-watermark-remover/GeminiWatermarkTool-Video

# Test binary directly
~/veo-watermark-remover/GeminiWatermarkTool-Video --version
```

### SSL not working
```bash
# Check certificate
sudo certbot certificates

# Renew manually
sudo certbot renew
```

---

## 📝 Next Steps

1. ✅ Deploy to VPS
2. ✅ Point DNS
3. ✅ Activate SSL
4. 🔲 Test video/image processing
5. 🔲 Setup Telegram bot (optional)
6. 🔲 Configure monitoring (optional)
7. 🔲 Setup backups (recommended)

---

## 🆘 Support

If you encounter issues:
1. Check logs: `pm2 logs veo-watermark`
2. Check Nginx logs: `sudo tail -f /var/log/nginx/error.log`
3. Verify database: `psql -h localhost -U veo_user -d veo_watermark`
4. Check DNS: `nslookup viotools.my.id`

---

**Good luck with your deployment! 🚀**
