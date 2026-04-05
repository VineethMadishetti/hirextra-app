import express from 'express';
import rateLimit from 'express-rate-limit';
import {
  loginUser, logoutUser, getAllUsers, createUser, deleteUser,
  verifyPassword, toggleLockUser, toggleCreditFree,
  registerUser, sendVerificationOTP, verifyEmailOTP,
  approveUser, rejectUser,
  validateRegister, validateLogin, validateCreateUser,
} from '../controllers/authController.js';
import { protect, adminOnly } from '../middleware/authMiddleware.js';
import logger from '../utils/logger.js';
import { refreshAccessToken } from '../controllers/authController.js';

const router = express.Router();

logger.info('✅ Auth Routes loaded');

// ── Per-route rate limiters ──────────────────────────────────────────────────
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  message: { message: 'Too many login attempts. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  message: { message: 'Too many registration attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const otpLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  message: { message: 'Too many OTP requests. Please wait before requesting another code.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const verifyOtpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  message: { message: 'Too many verification attempts. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Public
router.post('/login',       loginLimiter,    ...validateLogin,      loginUser);
router.post('/logout',      logoutUser);
router.post('/refresh',     refreshAccessToken);
router.post('/register',    registerLimiter, ...validateRegister,   registerUser);
router.post('/send-otp',    otpLimiter,      sendVerificationOTP);
router.post('/verify-otp',  verifyOtpLimiter, verifyEmailOTP);

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
router.post('/users',                   protect, adminOnly, ...validateCreateUser, createUser);
router.delete('/users/:id',             protect, adminOnly, deleteUser);
router.patch('/users/:id/lock',         protect, adminOnly, toggleLockUser);
router.patch('/users/:id/credit-free',  protect, adminOnly, toggleCreditFree);
router.patch('/users/:id/approve',      protect, adminOnly, approveUser);
router.patch('/users/:id/reject',       protect, adminOnly, rejectUser);

export default router;
