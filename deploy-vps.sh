#!/bin/bash
# ============================================
# Veo Watermark Remover - VPS Deployment Script
# For Ubuntu VPS
# ============================================

set -e

echo "=========================================="
echo "  Veo Watermark Remover - VPS Setup"
echo "=========================================="

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Configuration
APP_NAME="veo-watermark-remover"
APP_DIR="/home/ubuntu/$APP_NAME"
DOMAIN="viotools.my.id"
EMAIL="admin@viotools.my.id"  # Change to your email for Let's Encrypt

# 1. Update system
echo -e "${YELLOW}[1/10] Updating system...${NC}"
sudo apt update && sudo apt upgrade -y

# 2. Install Node.js 20.x
echo -e "${YELLOW}[2/10] Installing Node.js...${NC}"
if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt install -y nodejs
fi
echo "Node.js version: $(node --version)"
echo "npm version: $(npm --version)"

# 3. Install PM2 (process manager)
echo -e "${YELLOW}[3/10] Installing PM2...${NC}"
if ! command -v pm2 &> /dev/null; then
    sudo npm install -g pm2
fi

# 4. Install Nginx
echo -e "${YELLOW}[4/10] Installing Nginx...${NC}"
if ! command -v nginx &> /dev/null; then
    sudo apt install -y nginx
    sudo systemctl enable nginx
fi

# 5. Install PostgreSQL
echo -e "${YELLOW}[5/10] Installing PostgreSQL...${NC}"
if ! command -v psql &> /dev/null; then
    sudo apt install -y postgresql postgresql-contrib
    sudo systemctl enable postgresql
    sudo systemctl start postgresql
fi

# 6. Install FFmpeg (for video processing fallback)
echo -e "${YELLOW}[6/10] Installing FFmpeg...${NC}"
if ! command -v ffmpeg &> /dev/null; then
    sudo apt install -y ffmpeg
fi

# 7. Create app directory
echo -e "${YELLOW}[7/10] Setting up app directory...${NC}"
mkdir -p $APP_DIR
cd $APP_DIR

# 8. Download VeoWatermarkRemover Linux binary
echo -e "${YELLOW}[8/10] Downloading VeoWatermarkRemover Linux binary...${NC}"
if [ ! -f "GeminiWatermarkTool-Video" ]; then
    # Get latest release URL
    LATEST_URL=$(curl -s https://api.github.com/repos/allenk/VeoWatermarkRemover/releases/latest | grep "browser_download_url" | grep "Linux" | head -1 | cut -d '"' -f 4)
    if [ -n "$LATEST_URL" ]; then
        echo "Downloading from: $LATEST_URL"
        curl -L -o veo-temp.zip "$LATEST_URL"
        unzip -o veo-temp.zip
        chmod +x GeminiWatermarkTool-Video
        rm -f veo-temp.zip
        echo -e "${GREEN}VeoWatermarkRemover downloaded successfully!${NC}"
    else
        echo -e "${RED}Warning: Could not download VeoWatermarkRemover. Please download manually.${NC}"
        echo "Visit: https://github.com/allenk/VeoWatermarkRemover/releases/latest"
    fi
else
    echo "VeoWatermarkRemover already exists."
fi

# 9. Setup PostgreSQL database
echo -e "${YELLOW}[9/10] Setting up PostgreSQL database...${NC}"
sudo -u postgres psql -c "CREATE DATABASE veo_watermark;" 2>/dev/null || echo "Database may already exist"
sudo -u postgres psql -c "CREATE USER veo_user WITH ENCRYPTED PASSWORD 'veo_password_2024';" 2>/dev/null || echo "User may already exist"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE veo_watermark TO veo_user;" 2>/dev/null || true

# Create tables
sudo -u postgres psql -d veo_watermark -c "
CREATE TABLE IF NOT EXISTS api_keys (
    id SERIAL PRIMARY KEY,
    key VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255),
    email VARCHAR(255),
    tier VARCHAR(50) DEFAULT 'free',
    daily_limit INTEGER DEFAULT 100,
    monthly_limit INTEGER DEFAULT 1000,
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    revoked_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS usage_logs (
    id SERIAL PRIMARY KEY,
    api_key VARCHAR(255) NOT NULL,
    endpoint VARCHAR(255) NOT NULL,
    status VARCHAR(50) DEFAULT 'success',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS jobs (
    id VARCHAR(255) PRIMARY KEY,
    api_key VARCHAR(255) NOT NULL,
    type VARCHAR(50) NOT NULL,
    status VARCHAR(50) DEFAULT 'pending',
    input_path TEXT,
    output_path TEXT,
    original_name VARCHAR(255),
    error TEXT,
    progress INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS telegram_users (
    chat_id BIGINT PRIMARY KEY,
    api_key VARCHAR(255) UNIQUE NOT NULL,
    tier VARCHAR(50) DEFAULT 'free',
    images_used INTEGER DEFAULT 0,
    videos_used INTEGER DEFAULT 0,
    daily_images_limit INTEGER DEFAULT 5,
    daily_videos_limit INTEGER DEFAULT 1,
    last_reset DATE DEFAULT CURRENT_DATE,
    joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert default API keys
INSERT INTO api_keys (key, name, email, tier, daily_limit, monthly_limit) 
VALUES 
    ('demo-key-12345', 'Demo Account', 'demo@example.com', 'free', 100, 1000),
    ('test-key-67890', 'Test Account', 'test@example.com', 'pro', 1000, 10000)
ON CONFLICT (key) DO NOTHING;
"

echo -e "${GREEN}PostgreSQL setup complete!${NC}"

# 10. Install Certbot for SSL
echo -e "${YELLOW}[10/12] Installing Certbot for SSL...${NC}"
if ! command -v certbot &> /dev/null; then
    sudo apt install -y certbot python3-certbot-nginx
fi

# 11. Create Nginx config
echo -e "${YELLOW}[11/12] Configuring Nginx...${NC}"
sudo tee /etc/nginx/sites-available/$APP_NAME > /dev/null << EOF
server {
    listen 80;
    server_name $DOMAIN www.$DOMAIN;

    client_max_body_size 500M;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        
        # Timeout for video processing
        proxy_read_timeout 600s;
        proxy_send_timeout 600s;
    }
}
EOF

sudo ln -sf /etc/nginx/sites-available/$APP_NAME /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx

# 12. Setup SSL (will be activated after DNS is pointed)
echo -e "${YELLOW}[12/12] SSL Setup...${NC}"
echo "Note: SSL will be activated after you point DNS to this VPS"
echo "Run this command after DNS is propagated:"
echo "  sudo certbot --nginx -d $DOMAIN -d www.$DOMAIN --email $EMAIL --agree-tos --non-interactive"

# 13. Create .env file
echo -e "${YELLOW}Creating .env file...${NC}"
cat > $APP_DIR/.env << EOF
# Server Configuration
PORT=3000
NODE_ENV=production
DOMAIN=$DOMAIN

# PostgreSQL Configuration
DB_HOST=localhost
DB_PORT=5432
DB_NAME=veo_watermark
DB_USER=veo_user
DB_PASSWORD=veo_password_2024

# Telegram Bot (optional)
TELEGRAM_TOKEN=YOUR_BOT_TOKEN_HERE
API_BASE_URL=https://$DOMAIN

# Security
API_RATE_LIMIT=100
EOF

echo -e "${GREEN}=========================================="
echo "  Setup Complete!"
echo "==========================================${NC}"
echo ""
echo "Domain: $DOMAIN"
echo "VPS IP: $(curl -s ifconfig.me)"
echo ""
echo "Next steps:"
echo "1. Point your domain DNS to this VPS IP:"
echo "   - A record: $DOMAIN -> $(curl -s ifconfig.me)"
echo "   - A record: www.$DOMAIN -> $(curl -s ifconfig.me)"
echo ""
echo "2. Upload your project files to $APP_DIR"
echo "   From your local machine:"
echo "   scp -r ./* ubuntu@<VPS_IP>:$APP_DIR/"
echo ""
echo "3. Install npm dependencies:"
echo "   cd $APP_DIR && npm install"
echo ""
echo "4. Start the app with PM2:"
echo "   pm2 start server.js --name veo-watermark"
echo "   pm2 save"
echo "   pm2 startup"
echo ""
echo "5. After DNS propagates (5-30 min), activate SSL:"
echo "   sudo certbot --nginx -d $DOMAIN -d www.$DOMAIN --email $EMAIL --agree-tos --non-interactive"
echo ""
echo "Database credentials:"
echo "  Host: localhost"
echo "  Database: veo_watermark"
echo "  User: veo_user"
echo "  Password: veo_password_2024"
echo ""
echo "To connect to PostgreSQL:"
echo "  psql -h localhost -U veo_user -d veo_watermark"
echo ""
echo "Useful commands:"
echo "  pm2 status          - Check app status"
echo "  pm2 logs             - View logs"
echo "  pm2 restart veo-watermark - Restart app"
echo "  sudo systemctl restart nginx - Restart Nginx"
echo ""
