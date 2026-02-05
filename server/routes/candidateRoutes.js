import express from 'express';
import multer from 'multer';
import {
  uploadChunk, processFile, searchCandidates, getUploadHistory, getJobStatus, downloadProfile,
  deleteUploadJob,
  deleteCandidate,
  getFileHeaders,
  nukeDatabase,
  softDeleteCandidate,
  undoDeleteCandidate,
  exportCandidates,
  resumeUploadJob,
  pauseUploadJob,
  getDeleteHistory
} from '../controllers/candidateController.js';
import { protect, adminOnly } from '../middleware/authMiddleware.js';
import { listS3Files } from "../utils/s3Service.js";
import UploadJob from "../models/UploadJob.js";
import importQueue from "../utils/queue.js";

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
router.delete('/job/:id', protect, adminOnly, deleteUploadJob); // Delete File Data
// router.delete('/:id', protect, adminOnly, deleteCandidate);     // Delete Single Row
router.post('/headers', protect, adminOnly, getFileHeaders);    // Get headers to re-map
router.delete('/nuke/all', protect, adminOnly, nukeDatabase);
router.delete('/:id', protect, adminOnly, softDeleteCandidate);
router.put('/:id/restore', protect, adminOnly, undoDeleteCandidate);
router.post('/:id/resume', protect, adminOnly, resumeUploadJob);
router.post('/:id/pause', protect, adminOnly, pauseUploadJob);

router.post("/import-resumes", protect, adminOnly, async (req, res) => {
    try {
        if (!importQueue) {
            return res.status(503).json({ 
                message: "Background processing queue is not available. Please check Redis connection." 
            });
        }

        const { folderPath } = req.body;
        if (!folderPath) {
            return res.status(400).json({ message: "Folder path is required" });
        }

        // 1. List files from S3
        const files = await listS3Files(folderPath);
        
        // 2. Filter for PDF and DOCX files
        const resumeFiles = files.filter(f => 
            f.Key && (f.Key.toLowerCase().endsWith('.pdf') || f.Key.toLowerCase().endsWith('.docx'))
        );

        if (resumeFiles.length === 0) {
            return res.status(404).json({ message: "No PDF or DOCX files found in the specified folder." });
        }

        // 3. Create a parent Job to track progress
        const job = await UploadJob.create({
            fileName: folderPath,
            originalName: `Bulk Import: ${folderPath}`,
            status: "PROCESSING",
            totalRows: resumeFiles.length,
            successRows: 0,
            failedRows: 0,
            uploadedBy: req.user?._id // Assuming you have auth middleware attached
        });

        // 4. Add individual files to the queue
        const jobPromises = resumeFiles.map(file => 
            importQueue.add("resume-import", {
                jobId: job._id,
                s3Key: file.Key
            })
        );

        await Promise.all(jobPromises);

        res.status(200).json({
            message: "Resume import started",
            jobId: job._id,
            fileCount: resumeFiles.length
        });

    } catch (error) {
        console.error("Import error:", error);
        res.status(500).json({ message: "Failed to start import process", error: error.message });
    }
});

export default router;