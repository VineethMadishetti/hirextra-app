import express from 'express';
import { protect, adminOnly } from '../middleware/authMiddleware.js';
import {
  getBalance,
  getHistory,
  getAllHistory,
  mockPurchase,
  adminAddCredits,
} from '../controllers/creditController.js';

const router = express.Router();

router.get('/balance', protect, getBalance);
router.get('/history', protect, getHistory);
router.post('/mock-purchase', protect, mockPurchase);
router.get('/all-history', protect, adminOnly, getAllHistory);
router.post('/add', protect, adminOnly, adminAddCredits);

export default router;
