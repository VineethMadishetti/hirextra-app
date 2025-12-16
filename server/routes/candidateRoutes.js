import express from 'express';
import multer from 'multer';
import { uploadChunk, processFile, searchCandidates, getUploadHistory, getJobStatus, downloadProfile,
  deleteUploadJob,   
  deleteCandidate,   
  getFileHeaders,
nukeDatabase,
softDeleteCandidate,
    undoDeleteCandidate,
    exportCandidates } from '../controllers/candidateController.js'; 
import { protect, adminOnly } from '../middleware/authMiddleware.js';

const router = express.Router();
const upload = multer({ dest: 'temp_chunks/' });
import fs from 'fs';
if (!fs.existsSync('temp_chunks')) fs.mkdirSync('temp_chunks');

router.post('/upload-chunk', protect, adminOnly, upload.single('file'), uploadChunk);
router.post('/process', protect, adminOnly, processFile);
router.get('/history', protect, adminOnly, getUploadHistory);
router.get('/job/:id/status', protect, adminOnly, getJobStatus); // Get job status for live updates
router.get('/search', protect, searchCandidates); // All authenticated users can search
router.post('/export', protect, exportCandidates); // Export selected candidates
router.get('/health', (req, res) => res.json({ status: 'OK', timestamp: new Date() })); // Health check
router.get('/:id/download', protect, downloadProfile); // Download profile
router.delete('/job/:id', protect, adminOnly, deleteUploadJob); // Delete File Data
// router.delete('/:id', protect, adminOnly, deleteCandidate);     // Delete Single Row
router.post('/headers', protect, adminOnly, getFileHeaders);    // Get headers to re-map
router.delete('/nuke/all', protect, adminOnly, nukeDatabase);
router.delete('/:id', protect, adminOnly, softDeleteCandidate);
router.put('/:id/restore', protect, adminOnly, undoDeleteCandidate);


export default router;