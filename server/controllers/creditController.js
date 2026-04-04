import User from '../models/User.js';
import CreditTransaction from '../models/CreditTransaction.js';
import { addCredits } from '../utils/creditService.js';

// GET /api/credits/balance
export const getBalance = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('credits').lean();
    res.json({ credits: user?.credits ?? 0 });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// GET /api/credits/history?page=1&limit=20
export const getHistory = async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(50, parseInt(req.query.limit) || 20);
    const skip  = (page - 1) * limit;

    const [transactions, total] = await Promise.all([
      CreditTransaction.find({ userId: req.user._id })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      CreditTransaction.countDocuments({ userId: req.user._id }),
    ]);

    res.json({ transactions, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// POST /api/credits/mock-purchase  { amount }
// Mock purchase: adds credits directly without Stripe (for testing)
export const mockPurchase = async (req, res) => {
  try {
    const amount = parseInt(req.body.amount);
    if (!amount || amount < 5) {
      return res.status(400).json({ message: 'Minimum purchase is $5' });
    }

    const credits = amount * 10; // $1 = 10 credits
    const newBalance = await addCredits(
      req.user._id,
      credits,
      'MOCK_PURCHASE',
      `Mock purchase: $${amount} → ${credits} credits`
    );

    res.json({ credits: newBalance, added: credits, message: `${credits} credits added successfully` });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// GET /api/credits/all-history?page=1&limit=50&type=ADD  — admin only, all users
export const getAllHistory = async (req, res) => {
  try {
    const page   = Math.max(1, parseInt(req.query.page)  || 1);
    const limit  = Math.min(100, parseInt(req.query.limit) || 50);
    const skip   = (page - 1) * limit;
    const filter = {};
    if (req.query.type) filter.type = req.query.type;

    const [transactions, total] = await Promise.all([
      CreditTransaction.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('userId', 'name email')
        .populate('createdBy', 'name email')
        .lean(),
      CreditTransaction.countDocuments(filter),
    ]);

    res.json({ transactions, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// POST /api/credits/add  { userId, amount, description }  — admin only
export const adminAddCredits = async (req, res) => {
  try {
    const { userId, amount, description } = req.body;
    if (!userId || !amount || amount <= 0) {
      return res.status(400).json({ message: 'userId and positive amount are required' });
    }

    const target = await User.findById(userId).select('name credits').lean();
    if (!target) return res.status(404).json({ message: 'User not found' });

    const newBalance = await addCredits(
      userId,
      amount,
      'ADMIN_ADD',
      description || `Added by admin`,
      { createdBy: req.user._id }
    );

    res.json({ credits: newBalance, added: amount, message: `${amount} credits added to ${target.name}` });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
