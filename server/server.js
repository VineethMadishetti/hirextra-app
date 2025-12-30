import express from 'express';
import dotenv from 'dotenv';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import connectDB from './config/db.js';
import logger from './utils/logger.js';

// Routes
import authRoutes from './routes/authRoutes.js';
import candidateRoutes from './routes/candidateRoutes.js';
import adminRoutes from './routes/adminRoutes.js';

dotenv.config();

// Validate critical environment variables
const requiredEnvVars = ['JWT_SECRET', 'MONGO_URI'];
const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingVars.length > 0) {
  logger.error(`❌ Missing required environment variables: ${missingVars.join(', ')}`);
  logger.error('Please set these variables in your Render environment settings.');
  logger.error(`Note: MongoDB connection string should be set as 'MONGO_URI' (not 'MONGODB_URI')`);
  process.exit(1);
}

// Validate JWT_SECRET is not default/empty
if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'your-super-secure-jwt-secret-key-here') {
  logger.error('❌ JWT_SECRET is not set or is using default value!');
  logger.error('Please set a secure JWT_SECRET in your Render environment variables.');
  process.exit(1);
}

connectDB();

/* ---------------------------------------------------
   CREATE DEFAULT ADMIN
--------------------------------------------------- */
const createDefaultAdmin = async () => {
  try {
    const User = (await import('./models/User.js')).default;
    const adminExists = await User.findOne({ email: 'admin@test.com' });

    if (!adminExists) {
      await User.create({
        name: 'Super Admin',
        email: 'admin@test.com',
        password: 'password123',
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
app.use(
  cors({
    origin: [
      'http://localhost:5173',
      'https://hirextra-frontend.onrender.com',
      'http://stucrow.com',
      'https://stucrow.com',
    ],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      'Accept',
    ],
  })
);

/* ---------------------------------------------------
   BODY PARSERS & COOKIES
--------------------------------------------------- */
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

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
app.use('/api/candidates', candidateRoutes);
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
   404 HANDLER
--------------------------------------------------- */
app.use('*', (req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

/* ---------------------------------------------------
   SERVER START
--------------------------------------------------- */
const PORT = process.env.PORT || 5000;
const server = app.listen(PORT, () => {
  logger.info(
    `🚀 Server running on port ${PORT} in ${
      process.env.NODE_ENV || 'development'
    } mode`
  );
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
