import User from '../models/User.js';
import jwt from 'jsonwebtoken';
import logger from '../utils/logger.js';

const generateToken = (res, userId) => {
  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET is not configured');
  }
  
  const token = jwt.sign(
    { userId },
    process.env.JWT_SECRET,
    { expiresIn: '30d' }
  );

  res.cookie('jwt', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production', // True in prod, False in dev
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
};

const generateAccessToken = (userId) => {
  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET is not configured');
  }
  
  return jwt.sign(
    { userId },
    process.env.JWT_SECRET,
    { expiresIn: '1h' } // Increased to 1 hour for smoother user experience
  );
};

const generateRefreshToken = (userId) => {
  const refreshSecret = process.env.REFRESH_TOKEN_SECRET || process.env.JWT_SECRET;
  if (!refreshSecret) {
    throw new Error('REFRESH_TOKEN_SECRET or JWT_SECRET is not configured');
  }
  
  return jwt.sign(
    { userId },
    refreshSecret,
    { expiresIn: '30d' } // 30 days
  );
};
export const registerUser = async (req, res) => {
  const { name, email, password, role } = req.body;
  try {
    // Check JWT_SECRET is configured
    if (!process.env.JWT_SECRET) {
      logger.error('❌ JWT_SECRET is not configured - cannot create tokens');
      return res.status(500).json({ 
        message: 'Server configuration error: JWT_SECRET is not set',
        code: 'JWT_CONFIG_ERROR'
      });
    }

    // Allow admin registration for demo purposes
    // if (role === 'ADMIN') {
    //   return res.status(403).json({ message: 'Admin registration not allowed through public API' });
    // }

    const userExists = await User.findOne({ email });
    if (userExists) return res.status(400).json({ message: 'User already exists' });

    // Allow specified role or default to USER
    const userRole = (role === 'ADMIN' || role === 'USER') ? role : 'USER';

    const user = await User.create({ name, email, password, role: userRole });
    if (user) {
      generateToken(res, user._id);
      res.status(201).json({ _id: user._id, name: user.name, role: user.role });
    }
  } catch (err) {
    logger.error('Registration error:', err);
    res.status(500).json({ 
      message: err.message || 'Registration failed',
      code: err.message?.includes('JWT') ? 'JWT_CONFIG_ERROR' : 'REGISTRATION_ERROR'
    });
  }
};

export const refreshAccessToken = async (req, res) => {
  try {
    const token = req.cookies.refreshToken;

    if (!token) {
      return res.status(401).json({ message: 'No refresh token' });
    }

    const decoded = jwt.verify(token, process.env.REFRESH_TOKEN_SECRET);

    const accessToken = generateAccessToken(decoded.userId);

    res.cookie('jwt', accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      maxAge: 60 * 60 * 1000, // 1 hour
    });

    res.json({ message: 'Access token refreshed' });
  } catch (err) {
    return res.status(403).json({ message: 'Invalid refresh token' });
  }
};


export const loginUser = async (req, res) => {
  const { email, password } = req.body;

  try {
    // Check JWT_SECRET is configured
    if (!process.env.JWT_SECRET) {
      logger.error('❌ JWT_SECRET is not configured - cannot create tokens');
      return res.status(500).json({ 
        message: 'Server configuration error: JWT_SECRET is not set',
        code: 'JWT_CONFIG_ERROR'
      });
    }

    const user = await User.findOne({ email });

    if (!user || !(await user.matchPassword(password))) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const accessToken = generateAccessToken(user._id);
    const refreshToken = generateRefreshToken(user._id);

    res.cookie('jwt', accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      maxAge: 60 * 60 * 1000, // 1 hour
    });

    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    });

    res.json({
      _id: user._id,
      name: user.name,
      role: user.role,
    });
  } catch (err) {
    logger.error('Login error:', err);
    res.status(500).json({ 
      message: err.message || 'Login failed',
      code: err.message?.includes('JWT') ? 'JWT_CONFIG_ERROR' : 'LOGIN_ERROR'
    });
  }
};


export const logoutUser = (req, res) => {
  res.cookie('jwt', '', { 
    httpOnly: true, 
    expires: new Date(0),
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax'
  });
  res.cookie('refreshToken', '', { 
    httpOnly: true, 
    expires: new Date(0),
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax'
  });
  res.status(200).json({ message: 'Logged out' });
};


// User Management (Admin Only)
export const getAllUsers = async (req, res) => {
  try {
    const users = await User.find()
  .select('-password')
  .populate('createdBy', 'name email') // ✅ THIS IS REQUIRED
  .sort({ createdAt: -1 });

    res.json(users);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const createUser = async (req, res) => {
  const { name, email, password, role } = req.body;

  const user = await User.create({
    name,
    email,
    password,
    role,
    createdBy: req.user._id, // ✅ LOGGED-IN ADMIN
  });

  res.status(201).json(user);
};


export const verifyPassword = async (req, res) => {
  try {
    const { password } = req.body;
    const user = await User.findById(req.user._id);
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const isMatch = await user.matchPassword(password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Incorrect password' });
    }

    res.json({ message: 'Password verified' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const deleteUser = async (req, res) => {
  try {
    // Prevent deleting yourself
    if (req.user._id.toString() === req.params.id) {
      return res.status(400).json({ message: 'Cannot delete your own account' });
    }
    
    await User.findByIdAndDelete(req.params.id);
    res.json({ message: 'User deleted' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};