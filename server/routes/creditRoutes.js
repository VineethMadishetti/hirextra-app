import express from 'express';
import { protect, adminOnly } from '../middleware/authMiddleware.js';
import {
  getBalance,
  getHistory,
  getAllHistory,
  mockPurchase,
  createCheckout,
  adminAddCredits,
} from '../controllers/creditController.js';

const router = express.Router();

router.get('/balance', protect, getBalance);
router.get('/history', protect, getHistory);
// webhook is handled directly in server.js before express.json()
router.post('/create-checkout', protect, createCheckout);
router.post('/mock-purchase', protect, mockPurchase);
router.get('/all-history', protect, adminOnly, getAllHistory);
router.post('/add', protect, adminOnly, adminAddCredits);

export default router;
