import express from 'express';
import multer from 'multer';
import { protect } from '../middleware/authMiddleware.js';
import {
  extractRequirements,
  sourceCandidates,
  updateCandidateStage,
  parseSearchQuery,
  saveSourcingResult,
  getSourcingHistory,
  getSourcingStats,
  exportSourcedCandidatesCSV,
  exportCandidatesAsCSV,
} from '../controllers/sourcingController.js';

const router = express.Router();
const jdUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 }, // 8 MB
});

/**
 * AI Sourcing Routes
 * All routes require authentication
 */

// Main sourcing endpoint - accepts job description and returns candidates
router.post('/', protect, sourceCandidates);

// Extract structured requirements from JD text/file
router.post('/requirements', protect, jdUpload.single('jdFile'), extractRequirements);

// Update stage: sequence/call/shortlist
router.post('/candidate-stage', protect, updateCandidateStage);

// Parse AI search text into structured filters
router.post('/parse-query', protect, parseSearchQuery);

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
