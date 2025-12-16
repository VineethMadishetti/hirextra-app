import express from 'express';
import { resetDatabase, deleteJob } from '../controllers/adminController.js';
import { protect, adminOnly } from '../middleware/authMiddleware.js';
import logger from '../utils/logger.js';

const router = express.Router();

logger.info('✅ Admin Routes loaded');

// Protect all routes with authentication and admin role
router.use(protect);
router.use(adminOnly);

// Reset the entire database
router.post('/reset-database', resetDatabase);

// Delete a specific job and its associated data
router.delete('/jobs/:id', deleteJob);

export default router;
