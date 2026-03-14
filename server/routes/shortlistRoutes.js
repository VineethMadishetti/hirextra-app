import express from 'express';
import { getShortlists, createShortlist, deleteShortlist, getPublicShortlist } from '../controllers/shortlistController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/', protect, getShortlists);
router.post('/', protect, createShortlist);
router.delete('/:id', protect, deleteShortlist);
router.get('/public/:token', getPublicShortlist); // No auth — client-facing

export default router;
