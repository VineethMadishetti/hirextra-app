import express from 'express';
import {
  loginUser, logoutUser, getAllUsers, createUser, deleteUser,
  verifyPassword, toggleLockUser, toggleCreditFree,
  registerUser, sendVerificationOTP, verifyEmailOTP,
  approveUser, rejectUser,
} from '../controllers/authController.js';
import { protect, adminOnly } from '../middleware/authMiddleware.js';
import logger from '../utils/logger.js';
import { refreshAccessToken } from '../controllers/authController.js';

const router = express.Router();

logger.info('✅ Auth Routes loaded');

// Public
router.post('/login',       loginUser);
router.post('/logout',      logoutUser);
router.post('/refresh',     refreshAccessToken);
router.post('/register',    registerUser);
router.post('/send-otp',    sendVerificationOTP);
router.post('/verify-otp',  verifyEmailOTP);

// Authenticated
router.get('/me', protect, (req, res) => {
  res.json({
    _id: req.user._id,
    name: req.user.name,
    email: req.user.email,
    role: req.user.role,
    emailVerified: req.user.emailVerified,
    status: req.user.status,
    creditFree: req.user.creditFree,
  });
});
router.post('/verify-password', protect, verifyPassword);

// Admin only
router.get('/users',                    protect, adminOnly, getAllUsers);
router.post('/users',                   protect, adminOnly, createUser);
router.delete('/users/:id',             protect, adminOnly, deleteUser);
router.patch('/users/:id/lock',         protect, adminOnly, toggleLockUser);
router.patch('/users/:id/credit-free',  protect, adminOnly, toggleCreditFree);
router.patch('/users/:id/approve',      protect, adminOnly, approveUser);
router.patch('/users/:id/reject',       protect, adminOnly, rejectUser);

export default router;
