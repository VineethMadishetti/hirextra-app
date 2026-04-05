import express from 'express';
import { body, validationResult } from 'express-validator';
import { protect, adminOnly } from '../middleware/authMiddleware.js';
import {
  getBalance,
  getHistory,
  getAllHistory,
  mockPurchase,
  createCheckout,
  resetAllCredits,
  adminAddCredits,
} from '../controllers/creditController.js';

const router = express.Router();

const validateCheckout = [
  body('amount')
    .isFloat({ min: 5 })
    .withMessage('Minimum purchase amount is $5'),
];

function checkValidation(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ message: errors.array()[0].msg });
  next();
}

router.get('/balance', protect, getBalance);
router.get('/history', protect, getHistory);
// webhook is handled directly in server.js before express.json()
router.post('/create-checkout', protect, validateCheckout, checkValidation, createCheckout);
router.post('/mock-purchase', protect, mockPurchase);
router.get('/all-history', protect, adminOnly, getAllHistory);
router.post('/reset-all', protect, adminOnly, resetAllCredits);
router.post('/add', protect, adminOnly, adminAddCredits);

export default router;
