import mongoose from 'mongoose';
import logger from '../utils/logger.js';

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    logger.info('✅ MongoDB Connected');
  } catch (error) {
    logger.error('❌ MongoDB Connection Error:', error);
    process.exit(1);
  }
};

export default connectDB;