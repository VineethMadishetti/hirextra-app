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

// Routes
import authRoutes from './routes/authRoutes.js';
import candidateRoutes from './routes/candidateRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import enrichmentRoutes from './routes/enrichmentRoutes.js';
import sourcingRoutes from './routes/sourcingRoutes.js';
import privateDbRoutes from './routes/privateDbRoutes.js';
import jobRoutes from './routes/jobRoutes.js';
import shortlistRoutes from './routes/shortlistRoutes.js';
import creditRoutes from './routes/creditRoutes.js';
import { handleWebhook } from './controllers/creditController.js';

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
   CORS — defined first so allowedOrigins is available
   to the manual middleware below
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

/* ---------------------------------------------------
   MANUAL CORS — must be FIRST middleware, before helmet.
   Phusion Passenger can intercept OPTIONS before Express
   runs app.use(cors()), so we answer OPTIONS immediately
   here before any other processing.
--------------------------------------------------- */
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    res.setHeader('Vary', 'Origin');
  }
  // Answer preflight immediately — no further middleware needed
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  next();
});

/* ---------------------------------------------------
   SECURITY
--------------------------------------------------- */
app.use(
  helmet({
    crossOriginResourcePolicy: false,
  })
);

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    console.log(`[CORS] Blocked origin: ${origin}`);
    return callback(new Error("CORS not allowed"));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

/* ---------------------------------------------------
   STRIPE WEBHOOK — raw body MUST be registered before express.json()
   Stripe signature verification requires the unmodified raw body.
--------------------------------------------------- */
app.post('/api/credits/webhook', express.raw({ type: 'application/json' }), handleWebhook);

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
   CORS DIAGNOSTIC ENDPOINT
   Purpose: Debug CORS issues on dedicated servers
   ✅ NEW: Helps diagnose CORS authorization problems
--------------------------------------------------- */
app.options('/cors-diagnostic', cors(corsOptions)); // Enable CORS for this endpoint
app.get('/cors-diagnostic', (req, res) => {
  const origin = req.get('origin') || 'No origin header';
  const isOriginAllowed = allowedOrigins.includes(origin);

  res.json({
    message: 'CORS Diagnostic Information',
    requestOrigin: origin,
    allowedOrigins: allowedOrigins,
    isOriginAllowed: isOriginAllowed,
    corsHeadersSent: {
      'Access-Control-Allow-Origin': res.get('Access-Control-Allow-Origin'),
      'Access-Control-Allow-Credentials': res.get('Access-Control-Allow-Credentials'),
      'Access-Control-Allow-Methods': res.get('Access-Control-Allow-Methods'),
      'Access-Control-Allow-Headers': res.get('Access-Control-Allow-Headers')
    },
    recommendation: isOriginAllowed
      ? '✅ Origin is allowed. CORS should work.'
      : '❌ Origin is not in allowedOrigins. Add it to server.js with process.env.CLIENT_URL'
  });
});

/* ---------------------------------------------------
   ROUTES
--------------------------------------------------- */
app.use('/api/auth', authRoutes);
app.use('/api/candidates', requestCache(30), candidateRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/enrich-contact', enrichmentRoutes);
app.use('/api/ai-source', sourcingRoutes);
app.use('/api/private-db', privateDbRoutes);
app.use('/api/jobs', jobRoutes);
app.use('/api/shortlists', shortlistRoutes);
app.use('/api/credits', creditRoutes);

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
   Apache handles SSL termination — Node runs plain HTTP
--------------------------------------------------- */
const PORT = process.env.PORT || 3000;

const server = app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
});

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
