# DNS Setup Guide for Viotools.my.id

## Step 1: Point DNS to VPS

Login to your domain registrar (where you bought viotools.my.id) and add these DNS records:

### A Records (Required)

| Type | Host/Name | Value | TTL |
|------|-----------|-------|-----|
| A | @ | 43.134.68.31 | 3600 |
| A | www | 43.134.68.31 | 3600 |

### Explanation:
- `@` = root domain (viotools.my.id)
- `www` = www.viotools.my.id
- `43.134.68.31` = Your VPS IP address
- `TTL` = Time To Live (3600 seconds = 1 hour)

## Step 2: Verify DNS Propagation

After adding the records, wait 5-30 minutes for DNS to propagate.

Check if DNS is working:

### On Windows (PowerShell):
```powershell
nslookup viotools.my.id
nslookup www.viotools.my.id
```

### On Linux/Mac:
```bash
dig viotools.my.id
dig www.viotools.my.id
```

### Online tools:
- https://dnschecker.org/
- https://www.whatsmydns.net/

You should see `43.134.68.31` as the response.

## Step 3: Activate SSL Certificate

Once DNS is propagated, SSH into your VPS and run:

```bash
sudo certbot --nginx -d viotools.my.id -d www.viotools.my.id --email admin@viotools.my.id --agree-tos --non-interactive
```

This will:
- Generate a free SSL certificate from Let's Encrypt
- Configure Nginx to use HTTPS
- Set up auto-renewal

## Step 4: Test Your Website

Open your browser and go to:
- https://viotools.my.id
- https://www.viotools.my.id

You should see your Veo Watermark Remover app with a secure HTTPS connection!

## Troubleshooting

### DNS not propagating?
- Wait up to 48 hours (usually much faster)
- Check if you entered the correct IP address
- Clear your local DNS cache: `ipconfig /flushdns` (Windows)

### SSL certificate not working?
- Make sure DNS is fully propagated first
- Check if port 80 and 443 are open on your VPS firewall
- Run: `sudo ufw allow 'Nginx Full'`

### Website not loading?
- Check if PM2 is running: `pm2 status`
- Check Nginx status: `sudo systemctl status nginx`
- Check logs: `pm2 logs veo-watermark`

## Firewall Setup (if needed)

If your VPS has a firewall, open the required ports:

```bash
sudo ufw allow 22/tcp    # SSH
sudo ufw allow 80/tcp    # HTTP
sudo ufw allow 443/tcp   # HTTPS
sudo ufw enable
```

## Auto-Renewal for SSL

Certbot sets up auto-renewal automatically. To test it:

```bash
sudo certbot renew --dry-run
```

Certificates renew automatically every 60-90 days.
