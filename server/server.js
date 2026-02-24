import 'dotenv/config';
// 🔍 Enable garbage collection for manual cleanup during memory-intensive operations
// This allows calling global.gc() in processResumeJob to explicitly free memory
if (global.gc === undefined) {
	try {
		// Try to require gc module if available
		eval('require("gc")');
	} catch (e) {
		// gc not available - that's ok, we'll just use what's available
		// (Note: To enable, start Node with: node --expose-gc server.js)
	}
}
import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import connectDB from './config/db.js';
import logger from './utils/logger.js';
import { requestCache } from './requestCache.js';
import path from 'path';
import { fileURLToPath } from 'url';
import https from 'https';
import fs from 'fs';

// Routes
import authRoutes from './routes/authRoutes.js';
import candidateRoutes from './routes/candidateRoutes.js';
import adminRoutes from './routes/adminRoutes.js';

// Define __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Validate critical environment variables
const requiredEnvVars = ['JWT_SECRET', 'MONGO_URI'];
const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingVars.length > 0) {
  logger.error(`❌ Missing required environment variables: ${missingVars.join(', ')}`);
  logger.error('Please set these variables in your Render environment settings.');
  logger.error(`Note: MongoDB connection string should be set as 'MONGO_URI' (not 'MONGODB_URI')`);
  // process.exit(1); // Don't crash, just log error so server can respond with 500
}

// Validate JWT_SECRET is not default/empty
if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'your-super-secure-jwt-secret-key-here') {
  logger.error('❌ JWT_SECRET is not set or is using default value!');
  logger.error('Please set a secure JWT_SECRET in your Render environment variables.');
  // process.exit(1); // Don't crash
}

connectDB();

/* ---------------------------------------------------
   CREATE DEFAULT ADMIN
--------------------------------------------------- */
const createDefaultAdmin = async () => {
  try {
    const User = (await import('./models/User.js')).default;
    const adminExists = await User.findOne({ email: 'admin@stucrow.com' });

    if (!adminExists) {
      await User.create({
        name: 'Super Admin',
        email: 'admin@stucrow.com',
        password: 'pf_vuppala',
        role: 'ADMIN',
      });
      logger.info('Default admin user created');
    }
  } catch (error) {
    logger.error('Error creating default admin:', error);
  }
};

createDefaultAdmin();

const app = express();

/* ---------------------------------------------------
   REQUIRED FOR RENDER (SECURE COOKIES)
--------------------------------------------------- */
app.set('trust proxy', 1);

/* ---------------------------------------------------
   SECURITY
--------------------------------------------------- */
app.use(
  helmet({
    crossOriginResourcePolicy: false,
  })
);

/* ---------------------------------------------------
   CORS (STABLE – DO NOT OVER-ENGINEER)
--------------------------------------------------- */

const allowedOrigins = [
  "https://app.stucrow.com",
  "https://www.app.stucrow.com",
  "https://api.stucrow.com",
  "https://hirextra-frontend.onrender.com",
  "http://localhost:5173", // dev only
  process.env.CLIENT_URL, // Allow production domain via env var
]
  .filter(Boolean)
  .map(origin => origin.replace(/\/$/, "")); // Remove trailing slash

const corsOptions = {
  origin: function (origin, callback) {
    // allow server-to-server, curl, Postman
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    console.log(`[CORS] Blocked origin: ${origin}`);
    return callback(new Error("CORS not allowed"));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  optionsSuccessStatus: 200 // some legacy browsers (IE11, various SmartTVs) choke on 204
};

app.use(cors(corsOptions));

// handle preflight explicitly
app.options("*", cors(corsOptions));

/* ---------------------------------------------------
   BODY PARSERS & COOKIES
--------------------------------------------------- */
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

/* ---------------------------------------------------
   DEBUG LOGGING
--------------------------------------------------- */
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

/* ---------------------------------------------------
   RATE LIMIT (AFTER CORS)
--------------------------------------------------- */
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10000,
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(limiter);

/* ---------------------------------------------------
   COMPRESSION
--------------------------------------------------- */
app.use(compression());

/* ---------------------------------------------------
   HEALTH CHECKS
--------------------------------------------------- */
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
  });
});

app.get('/test', (req, res) => res.send('Server is alive!'));

/* ---------------------------------------------------
   ROUTES
--------------------------------------------------- */
app.use('/api/auth', authRoutes);
app.use('/api/candidates', requestCache(30), candidateRoutes);
app.use('/api/admin', adminRoutes);

/* ---------------------------------------------------
   GLOBAL ERROR HANDLER
--------------------------------------------------- */
app.use((err, req, res, next) => {
  logger.error(
    `${err.status || 500} - ${err.message} - ${req.originalUrl} - ${req.method}`
  );

  const isDev = process.env.NODE_ENV !== 'production';

  res.status(err.status || 500).json({
    message: isDev ? err.message : 'Internal Server Error',
    ...(isDev && { stack: err.stack }),
  });
});

/* ---------------------------------------------------
   SERVE STATIC ASSETS (DEPLOYMENT)
--------------------------------------------------- */
app.use(express.static(path.join(__dirname, '../client/dist')));

app.get('*', (req, res, next) => {
  if (req.originalUrl.startsWith('/api')) return next();
  res.sendFile(path.join(__dirname, '../client/dist/index.html'));
});

/* ---------------------------------------------------
   404 HANDLER
--------------------------------------------------- */
app.use('*', (req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

/* ---------------------------------------------------
   SERVER START
--------------------------------------------------- */
const PORT = process.env.PORT || 5000;

let server;

// Check if SSL paths are provided for standalone HTTPS (No Nginx)
if (process.env.SSL_KEY_PATH && process.env.SSL_CERT_PATH) {
  const httpsOptions = {
    key: fs.readFileSync(process.env.SSL_KEY_PATH),
    cert: fs.readFileSync(process.env.SSL_CERT_PATH),
  };
  server = https.createServer(httpsOptions, app).listen(PORT, () => {
    logger.info(`🚀 Secure Server (HTTPS) running on port ${PORT}`);
  });
} else {
  server = app.listen(PORT, () => {
    logger.info(`🚀 Server (HTTP) running on port ${PORT}`);
  });
}

/* ---------------------------------------------------
   GRACEFUL SHUTDOWN
--------------------------------------------------- */
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down');
  server.close(() => process.exit(0));
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down');
  server.close(() => process.exit(0));
});

export default app;
