#!/bin/bash
# Quick Deploy Script for Veo Watermark Remover
# Run this AFTER uploading project files to ~/veo-watermark-remover/

cd ~/veo-watermark-remover || exit 1

echo "=== Installing dependencies ==="
npm install

echo "=== Setting up .env ==="
if [ ! -f .env ]; then
    cp .env.example .env
fi

echo "=== Starting app with PM2 ==="
pm2 delete veo-watermark 2>/dev/null || true
pm2 start server.js --name veo-watermark
pm2 save

echo "=== Setting up PM2 startup ==="
pm2 startup systemd -u ubuntu --hp /home/ubuntu

echo "=== Checking status ==="
pm2 status

echo ""
echo "=== Deployment Complete! ==="
echo "App should be running at: http://$(curl -s ifconfig.me):3000"
echo ""
echo "Next steps:"
echo "1. Point DNS A record to: $(curl -s ifconfig.me)"
echo "2. After DNS propagates, run:"
echo "   sudo certbot --nginx -d viotools.my.id -d www.viotools.my.id"
echo ""
