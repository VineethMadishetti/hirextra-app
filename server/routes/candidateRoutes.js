import express from 'express';
import multer from 'multer';
import {
  uploadChunk, processFile, searchCandidates, getUploadHistory, getJobStatus, downloadProfile,
  getCandidateById,
  deleteUploadJob,
  deleteCandidate,
  getFileHeaders,
  nukeDatabase,
  softDeleteCandidate,
  undoDeleteCandidate,
  exportCandidates,
  resumeUploadJob,
  pauseUploadJob,
  getDeleteHistory,
  importResumes,
  analyzeSearchQuery
} from '../controllers/candidateController.js';
import { protect, adminOnly } from '../middleware/authMiddleware.js';

const router = express.Router();
import os from 'os';
import fs from 'fs';
import path from 'path';

const uploadDir = path.join(os.tmpdir(), 'temp_chunks');

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const upload = multer({ dest: uploadDir });


router.post('/upload-chunk', protect, adminOnly, upload.single('file'), uploadChunk);
router.post('/process', protect, adminOnly, processFile);
router.get('/history', protect, adminOnly, getUploadHistory);
router.get('/delete-history', protect, adminOnly, getDeleteHistory);
router.get('/job/:id/status', protect, adminOnly, getJobStatus); // Get job status for live updates
router.get('/search', protect, searchCandidates); // All authenticated users can search
router.post('/export', protect, exportCandidates); // Export selected candidates
router.get('/health', (req, res) => res.json({ status: 'OK', timestamp: new Date() })); // Health check
router.get('/:id/download', protect, downloadProfile); // Download profile
router.get('/:id', protect, getCandidateById); // Candidate details for view modal
router.delete('/job/:id', protect, adminOnly, deleteUploadJob); // Delete File Data
// router.delete('/:id', protect, adminOnly, deleteCandidate);     // Delete Single Row
router.post('/headers', protect, adminOnly, getFileHeaders);    // Get headers to re-map
router.delete('/nuke/all', protect, adminOnly, nukeDatabase);
router.delete('/:id', protect, adminOnly, softDeleteCandidate);
router.put('/:id/restore', protect, adminOnly, undoDeleteCandidate);
router.post('/:id/resume', protect, adminOnly, resumeUploadJob);
router.post('/:id/pause', protect, adminOnly, pauseUploadJob);

router.post('/import-resumes', protect, adminOnly, importResumes);
router.post('/analyze-search', protect, analyzeSearchQuery);

export default router;
