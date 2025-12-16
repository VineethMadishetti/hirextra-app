import express from 'express';
import { registerUser, loginUser, logoutUser, getAllUsers, createUser, deleteUser, verifyPassword } from '../controllers/authController.js';
import { protect, adminOnly } from '../middleware/authMiddleware.js';
import rateLimit from 'express-rate-limit';
import logger from '../utils/logger.js';

const router = express.Router();

logger.info('✅ Auth Routes loaded');

// Rate limiter for registration to prevent abuse
const registerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // limit each IP to 5 registration requests per windowMs
  message: 'Too many registration attempts from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

router.post('/register', registerLimiter, registerUser);
router.post('/login', loginUser);
router.post('/logout', logoutUser);
router.get('/users', protect, adminOnly, getAllUsers);
router.post('/users', protect, adminOnly, createUser);
router.post('/verify-password', protect, verifyPassword);
router.delete('/users/:id', protect, adminOnly, deleteUser);

export default router;