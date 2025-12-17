import mongoose from 'mongoose';
import logger from '../utils/logger.js';

const connectDB = async () => {
  try {
    // Check for MONGO_URI (primary) or MONGODB_URI (alternative)
    const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
    
    if (!mongoUri) {
      logger.error('❌ MongoDB Connection Error: MONGO_URI or MONGODB_URI environment variable is not set');
      logger.error('Please set MONGO_URI in your Render environment settings.');
      process.exit(1);
    }
    
    await mongoose.connect(mongoUri);
    logger.info('✅ MongoDB Connected');
  } catch (error) {
    logger.error('❌ MongoDB Connection Error:', error);
    process.exit(1);
  }
};

export default connectDB;