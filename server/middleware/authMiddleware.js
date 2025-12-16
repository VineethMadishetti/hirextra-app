import jwt from 'jsonwebtoken';
import User from '../models/User.js';

export const protect = async (req, res, next) => {
  let token = req.cookies.jwt;

  if (token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = await User.findById(decoded.userId).select('-password');
      next();
    } catch (error) {
      res.status(401).json({ message: 'Not authorized, invalid token' });
    }
  } else {
    res.status(401).json({ message: 'Not authorized, no token' });
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