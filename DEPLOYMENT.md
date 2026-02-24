# Hirextra - Live Deployment Guide

## 🚀 Free Hosting Setup for Demo

This guide will help you deploy Hirextra to free hosting services for demonstration purposes.

### Prerequisites
- GitHub account
- MongoDB Atlas account
- Render account
- Upstash account (for Redis)

### 1. Database Setup (MongoDB Atlas)

1. Go to [MongoDB Atlas](https://www.mongodb.com/atlas) and create a free account
2. Create a new project and cluster (free tier M0)
3. Create a database user with read/write permissions
4. Get your connection string:
   ```
   mongodb+srv://username:password@cluster0.xxxxx.mongodb.net/hirextra?retryWrites=true&w=majority
   ```

### 2. Redis Setup (Upstash)

1. Go to [Upstash](https://upstash.com/) and create a free account
2. Create a new Redis database
3. Get your Redis URL and password from the dashboard

### 3. Deploy Backend to Render

1. **Connect GitHub Repository:**
   - Push your code to GitHub
   - Go to [Render](https://render.com) and sign up/login
   - Click "New" > "Web Service"

2. **Configure Service:**
   - **Name:** hirextra-backend
   - **Environment:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Root Directory:** server

3. **Environment Variables:**
   Add these environment variables:

   ```
   MONGO_URI=mongodb+srv://username:password@cluster0.xxxxx.mongodb.net/hirextra?retryWrites=true&w=majority
   JWT_SECRET=your_super_secret_jwt_key_here_generate_random_string
   REDIS_HOST=your-redis-host.upstash.io
   REDIS_PASSWORD=your-redis-password
   NODE_ENV=production
   FRONTEND_URL=https://hirextra-frontend.onrender.com
   ```

4. **Deploy:** Click "Create Web Service"

### 4. Deploy Frontend to Render

1. **Create Another Web Service:**
   - Click "New" > "Static Site"

2. **Configure Static Site:**
   - **Name:** hirextra-frontend
   - **Environment:** Static Site
   - **Build Command:** `npm run build`
   - **Publish Directory:** dist
   - **Root Directory:** client

3. **Environment Variables:**
   ```
   VITE_API_URL=https://hirextra-backend.onrender.com/api
   ```

4. **Deploy:** Click "Create Static Site"

### 5. Update Backend CORS

After both are deployed, update the backend's `FRONTEND_URL` environment variable to match your frontend URL.

### 6. Testing

After deployment:
1. Visit your frontend URL
2. Login with the default admin credentials:
   - **Email:** admin@test.com
   - **Password:** password123
3. Test the search functionality
4. **Note:** File upload processing may be slow on free tiers due to queue processing
5. For demo, use small CSV files (< 1MB) for best performance

### ⚠️ Free Tier Limitations

- **File Processing:** Large CSV files may timeout (free tiers have execution time limits)
- **Cold Starts:** Services may take 10-30 seconds to wake up
- **Memory:** Limited RAM may cause issues with large files
- **Storage:** MongoDB Atlas free tier has 512MB limit

### Performance Tips for Demo

- Use small CSV files (under 100KB) for quick demos
- Pre-populate some sample data in the database
- Test all features with small datasets first
- Be prepared for occasional delays due to free tier limitations

### Alternative: Vercel Deployment

If you prefer Vercel:

1. Deploy backend to Vercel with the same environment variables
2. Deploy frontend separately to Vercel
3. Set `VITE_API_URL` to your backend Vercel URL

### Performance Optimizations

- **Database:** Already optimized with proper indexes
- **Caching:** React Query handles client-side caching
- **File Upload:** Limited processing for demo
- **Error Handling:** Comprehensive error boundaries

### Free Tier Limits

- **MongoDB Atlas:** 512MB storage, shared clusters
- **Render:** 750 hours/month free, sleeps after 15min inactivity
- **Upstash Redis:** 10,000 requests/day

### Troubleshooting

**Cold Starts:** Free tiers may have delays (Render sleeps services)
**File Upload:** Large files may timeout on free tiers
**Memory:** Monitor usage as free tiers have limits

**Connection Refused (localhost):**
If you see `net::ERR_CONNECTION_REFUSED` pointing to `localhost` in your browser console after deployment:
1. This means the frontend was built with the default development API URL.
2. Rebuild the frontend with your production URL:
   ```bash
   # Replace with your actual backend URL
   export VITE_API_URL=https://your-api-domain.com/api
   npm run build
   ```
3. Re-upload the `dist` folder to your server.

### ⚠️ Critical: Fixing "Network Error" / "localhost" Issues

If you see `net::ERR_CONNECTION_REFUSED` pointing to `localhost` in your browser console after deployment, it means your **local development URL** was baked into the production build.

**To fix this permanently:**

1. Create a file named `.env.production` in your `client` folder.
2. Add this line to it: `VITE_API_URL=` (leave the value empty).
3. Run `npm run build` again.
4. Upload the new `dist` folder to CPanel.

This forces the app to use relative paths (`/api`) in production, which works correctly with CPanel when the Node.js app is mapped to the `/api` route.