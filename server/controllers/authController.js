import User from '../models/User.js';
import jwt from 'jsonwebtoken';
import logger from '../utils/logger.js';
import { sendOTPEmail, sendAccountApprovedEmail } from '../utils/emailService.js';
import { body, validationResult } from 'express-validator';

function generateOTP() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

// Reusable validation rules
const emailRule   = body('email').isEmail().normalizeEmail().withMessage('Valid email address required');
const passwordRule = body('password')
  .isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
  .matches(/[A-Z]/).withMessage('Password must contain at least one uppercase letter')
  .matches(/[0-9]/).withMessage('Password must contain at least one number');
const nameRule    = body('name').trim().isLength({ min: 1, max: 100 }).withMessage('Name is required (max 100 characters)');

export const validateRegister  = [nameRule, emailRule, passwordRule];
export const validateLogin     = [emailRule, body('password').notEmpty().withMessage('Password is required')];
export const validateCreateUser = [nameRule, emailRule, passwordRule];

// Helper — returns first validation error or null
function getValidationError(req) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return errors.array()[0].msg;
  return null;
}

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
    { expiresIn: '30d' } // Increased to 30 days to prevent logout during long processing
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
// Public self-registration — creates a pending USER account and sends OTP
export const registerUser = async (req, res) => {
  const validationError = getValidationError(req);
  if (validationError) return res.status(400).json({ message: validationError });

  const { name, email, password } = req.body;
  try {
    const existing = await User.findOne({ email });
    if (existing) return res.status(400).json({ message: 'An account with this email already exists' });

    const otp = generateOTP();
    const user = await User.create({
      name,
      email,
      password,
      role: 'USER',
      status: 'pending',
      emailVerified: false,
      emailVerificationOTP: otp,
      otpExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
    });

    // Fire-and-forget — don't block registration on email delivery
    sendOTPEmail(email, name, otp).catch(e => logger.warn('OTP email failed:', e.message));

    res.status(201).json({
      message: 'Account created. Check your email for a verification code.',
      userId: user._id,
      email: user.email,
    });
  } catch (err) {
    logger.error('Registration error:', err);
    res.status(500).json({ message: err.message || 'Registration failed' });
  }
};

// Send or resend OTP
export const sendVerificationOTP = async (req, res) => {
  const { email } = req.body;
  try {
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ message: 'No account found with this email' });
    if (user.emailVerified) return res.status(400).json({ message: 'Email already verified' });

    const otp = generateOTP();
    await User.findByIdAndUpdate(user._id, {
      emailVerificationOTP: otp,
      otpExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
    });
    // Fire-and-forget
    sendOTPEmail(email, user.name, otp).catch(e => logger.warn('OTP email failed:', e.message));

    res.json({ message: 'Verification code sent' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Verify OTP — marks email as verified; account stays pending until admin approves
export const verifyEmailOTP = async (req, res) => {
  const { email, otp } = req.body;
  try {
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ message: 'Account not found' });
    if (user.emailVerified) return res.json({ message: 'Email already verified' });

    if (!user.emailVerificationOTP || user.emailVerificationOTP !== String(otp)) {
      return res.status(400).json({ message: 'Invalid verification code' });
    }
    if (!user.otpExpiresAt || new Date() > user.otpExpiresAt) {
      return res.status(400).json({ message: 'Verification code has expired. Request a new one.' });
    }

    await User.findByIdAndUpdate(user._id, {
      emailVerified: true,
      emailVerificationOTP: null,
      otpExpiresAt: null,
    });

    res.json({ message: 'Email verified. Your account is pending admin approval.' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Admin: approve a pending user
export const approveUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('name email status');
    if (!user) return res.status(404).json({ message: 'User not found' });

    // Also mark emailVerified so login check doesn't block them
    await User.findByIdAndUpdate(req.params.id, { status: 'active', emailVerified: true });
    sendAccountApprovedEmail(user.email, user.name).catch(e => logger.warn('Approval email failed:', e.message));

    res.json({ message: `${user.name} approved`, status: 'active' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Admin: reject a pending user
export const rejectUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('name status');
    if (!user) return res.status(404).json({ message: 'User not found' });

    await User.findByIdAndUpdate(req.params.id, { status: 'rejected' });
    res.json({ message: `${user.name} rejected`, status: 'rejected' });
  } catch (err) {
    res.status(500).json({ message: err.message });
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
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    });

    res.json({ message: 'Access token refreshed' });
  } catch (err) {
    return res.status(403).json({ message: 'Invalid refresh token' });
  }
};


export const loginUser = async (req, res) => {
  const validationError = getValidationError(req);
  if (validationError) return res.status(400).json({ message: validationError });

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

    if (user.isLocked) {
      return res.status(403).json({ message: 'Your account has been locked. Please contact your administrator.' });
    }

    if (!user.emailVerified) {
      return res.status(403).json({ code: 'EMAIL_NOT_VERIFIED', message: 'Please verify your email before signing in.' });
    }

    if (user.status === 'pending') {
      return res.status(403).json({ code: 'PENDING_APPROVAL', message: 'Your account is pending admin approval. You\'ll be notified once approved.' });
    }

    if (user.status === 'rejected') {
      return res.status(403).json({ code: 'ACCOUNT_REJECTED', message: 'Your account request was not approved. Please contact support.' });
    }

    await User.findByIdAndUpdate(user._id, { lastLoginAt: new Date() });

    const accessToken = generateAccessToken(user._id);
    const refreshToken = generateRefreshToken(user._id);

    res.cookie('jwt', accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
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
  const validationError = getValidationError(req);
  if (validationError) return res.status(400).json({ message: validationError });

  const { name, email, password, role } = req.body;
  try {
    const user = await User.create({
      name,
      email,
      password,
      role,
      status: 'active',       // admin-created users are immediately active
      emailVerified: true,    // admin vouches for the email
      createdBy: req.user._id,
    });
    res.status(201).json(user);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
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

export const toggleLockUser = async (req, res) => {
  try {
    if (req.user._id.toString() === req.params.id) {
      return res.status(400).json({ message: 'Cannot lock your own account' });
    }

    const user = await User.findById(req.params.id).select('isLocked');
    if (!user) return res.status(404).json({ message: 'User not found' });

    const newLockState = !user.isLocked;
    await User.findByIdAndUpdate(req.params.id, { isLocked: newLockState });

    res.json({ message: newLockState ? 'User locked' : 'User unlocked', isLocked: newLockState });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const toggleCreditFree = async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('creditFree name');
    if (!user) return res.status(404).json({ message: 'User not found' });

    const newState = !user.creditFree;
    await User.findByIdAndUpdate(req.params.id, { creditFree: newState });

    res.json({
      message: newState ? `${user.name} is now credit-free` : `Credit system enabled for ${user.name}`,
      creditFree: newState,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};