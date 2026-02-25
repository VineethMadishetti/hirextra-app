import express from 'express';
import { protect } from '../middleware/authMiddleware.js';
import {
  sourceCandidates,
  saveSourcingResult,
  getSourcingHistory,
  getSourcingStats,
  exportSourcedCandidatesCSV,
  exportCandidatesAsCSV,
} from '../controllers/sourcingController.js';

const router = express.Router();

/**
 * AI Sourcing Routes
 * All routes require authentication
 */

// Main sourcing endpoint - accepts job description and returns candidates
router.post('/', protect, sourceCandidates);

// Save a sourced candidate to the database
router.post('/save-candidate', protect, saveSourcingResult);

// Export all sourced candidates as CSV (from database)
router.get('/export/csv', protect, exportSourcedCandidatesCSV);

// Export specific candidates from modal as CSV
router.post('/export/csv', protect, exportCandidatesAsCSV);

// Get user's sourcing history (previous searches & candidates)
router.get('/history', protect, getSourcingHistory);

// Get sourcing statistics
router.get('/stats', protect, getSourcingStats);

export default router;
