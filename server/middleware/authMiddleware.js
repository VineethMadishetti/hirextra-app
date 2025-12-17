import jwt from 'jsonwebtoken';
import User from '../models/User.js';

export const protect = async (req, res, next) => {
  const accessToken = req.cookies.jwt;

  // 1️⃣ No access token at all
  if (!accessToken) {
    return res.status(401).json({
      message: 'Access token missing',
      code: 'NO_ACCESS_TOKEN',
    });
  }

  try {
    // 2️⃣ Verify access token
    const decoded = jwt.verify(accessToken, process.env.JWT_SECRET);

    // 3️⃣ Attach user to request
    req.user = await User.findById(decoded.userId).select('-password');

    if (!req.user) {
      return res.status(401).json({
        message: 'User not found',
        code: 'USER_NOT_FOUND',
      });
    }

    next();
  } catch (error) {
    // 4️⃣ Token expired → frontend should refresh
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        message: 'Access token expired',
        code: 'ACCESS_TOKEN_EXPIRED',
      });
    }

    // 5️⃣ Invalid token
    return res.status(401).json({
      message: 'Invalid access token',
      code: 'INVALID_ACCESS_TOKEN',
    });
  }
};

export const adminOnly = (req, res, next) => {
  if (req.user && (req.user.role === 'ADMIN' || req.user.role === 'SUPER_ADMIN')) {
    next();
  } else {
    res.status(403).json({ message: 'Access denied. Admin only.' });
  }
};

export const userOnly = (req, res, next) => {
  // Allow both USER and ADMIN roles to access
  if (req.user && (req.user.role === 'USER' || req.user.role === 'ADMIN' || req.user.role === 'SUPER_ADMIN')) {
    next();
  } else {
    res.status(403).json({ message: 'Access denied.' });
  }
};