# HireXtra - Production Deployment Guide

## 🚀 Production Setup

### Prerequisites
- Node.js 18+
- MongoDB (Atlas recommended for production)
- Redis (Cloud Redis or ElastiCache recommended)
- PM2 for process management
- AWS S3 bucket (for file storage)

### 1. Environment Setup

```bash
# Copy environment template
cp .env.example .env

# Edit .env with your production values
nano .env
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Install PM2 Globally

```bash
npm install -g pm2
```

### 4. Production Startup

```bash
# Start with PM2
pm2 start ecosystem.config.js --env production

# Save PM2 configuration
pm2 save

# Set up PM2 to start on boot
pm2 startup
```

### 5. Nginx Configuration (Optional)

```nginx
server {
    listen 80;
    server_name yourdomain.com;

    location / {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### 6. SSL Certificate (Let's Encrypt)

```bash
# Install certbot
sudo apt install certbot python3-certbot-nginx

# Get SSL certificate
sudo certbot --nginx -d yourdomain.com
```

## 🔍 Monitoring

### Health Check
```
GET /health
```

### Logs
```bash
# View PM2 logs
pm2 logs

# View application logs
tail -f logs/all.log
```

### PM2 Commands
```bash
pm2 restart hirextra-server
pm2 stop hirextra-server
pm2 delete hirextra-server
pm2 monit
```

## 📊 Production Checklist

- [ ] Environment variables configured
- [ ] MongoDB connection tested
- [ ] Redis connection tested
- [ ] AWS S3 bucket configured and tested
- [ ] SSL certificate installed
- [ ] PM2 process running
- [ ] Nginx configured (if used)
- [ ] Firewall configured
- [ ] Backups scheduled
- [ ] Monitoring alerts set up

## 🔧 Troubleshooting

### Common Issues

1. **Port already in use**
   ```bash
   lsof -i :5000
   kill -9 <PID>
   ```

2. **MongoDB connection failed**
   - Check MONGO_URI in .env
   - Verify network access
   - Check MongoDB Atlas IP whitelist

3. **Redis connection failed**
   - Check REDIS_HOST and REDIS_PORT
   - Verify Redis service is running

4. **File upload issues**
   - Check AWS S3 credentials in .env file
   - Verify bucket permissions (PutObject, GetObject, DeleteObject)
   - Check file size limits
   - Ensure AWS_REGION matches your bucket region
   - Verify AWS_S3_BUCKET name is correct

## 📈 Scaling

### Horizontal Scaling
- Increase PM2 instances in ecosystem.config.js
- Use load balancer (Nginx, AWS ALB)
- Implement Redis clustering

### Database Scaling
- Enable MongoDB sharding
- Use read replicas
- Implement connection pooling

### File Storage Scaling
- Use CloudFront CDN
- Implement file compression
- Set up automated cleanup