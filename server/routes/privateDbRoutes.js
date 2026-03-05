import express from 'express';
import { protect } from '../middleware/authMiddleware.js';
import {
  createDatabase,
  listDatabases,
  deleteDatabase,
  uploadResume,
  uploadResumeMiddleware,
  searchPrivateDb,
  getDatabaseStats,
} from '../controllers/privateDbController.js';

const router = express.Router();

// All routes require authentication (USER or ADMIN)
router.use(protect);

// Database management
router.get('/', listDatabases);
router.post('/', createDatabase);
router.delete('/:id', deleteDatabase);
router.get('/:id/stats', getDatabaseStats);

// Resume upload & search within a database
router.post('/:id/upload', uploadResumeMiddleware, uploadResume);
router.get('/:id/search', searchPrivateDb);

export default router;
