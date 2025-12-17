import express from 'express';
import { loginUser, logoutUser, getAllUsers, createUser, deleteUser, verifyPassword } from '../controllers/authController.js';
import { protect, adminOnly } from '../middleware/authMiddleware.js';
import logger from '../utils/logger.js';
import { refreshAccessToken } from '../controllers/authController.js';

const router = express.Router();

logger.info('✅ Auth Routes loaded');

router.post('/login', loginUser);
router.post('/logout', logoutUser);
router.post('/refresh', refreshAccessToken);
router.get('/me', protect, (req, res) => {
  // Return current user info
  res.json({
    _id: req.user._id,
    name: req.user.name,
    email: req.user.email,
    role: req.user.role,
  });
});
router.get('/users', protect, adminOnly, getAllUsers);
router.post('/users', protect, adminOnly, createUser);
router.post('/verify-password', protect, verifyPassword);
router.delete('/users/:id', protect, adminOnly, deleteUser);

export default router;