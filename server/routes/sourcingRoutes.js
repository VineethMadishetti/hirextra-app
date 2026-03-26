import express from 'express';
import multer from 'multer';
import { protect } from '../middleware/authMiddleware.js';
import {
  extractRequirements,
  sourceCandidates,
  searchInternalDb,
  updateCandidateStage,
  parseSearchQuery,
  saveSourcingResult,
  getSourcingHistory,
  getSourcingStats,
  exportSourcedCandidatesCSV,
  exportCandidatesAsCSV,
  getSourcingSessions,
  getSessionById,
  updateCandidateNotes,
  generateOutreachMessage,
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

// Main sourcing endpoint - internet/CSE sourcing
router.post('/', protect, sourceCandidates);

// Internal DB sourcing - Boolean match scoring against MongoDB
router.post('/internal-db', protect, searchInternalDb);

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

// Recent search sessions
router.get('/sessions', protect, getSourcingSessions);
router.get('/sessions/:id', protect, getSessionById);

// Save/update recruiter notes for a candidate
router.post('/notes', protect, updateCandidateNotes);

// Generate personalized LinkedIn outreach message
router.post('/generate-message', protect, generateOutreachMessage);

export default router;
