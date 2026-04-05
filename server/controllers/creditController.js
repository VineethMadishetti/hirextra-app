import Stripe from 'stripe';
import User from '../models/User.js';
import CreditTransaction from '../models/CreditTransaction.js';
import { addCredits } from '../utils/creditService.js';

// Lazy-init Stripe — safe to call even if key not set yet (returns null)
const getStripe = () => {
  if (!process.env.STRIPE_SECRET_KEY) return null;
  return new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-04-10' });
};

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

// POST /api/credits/create-checkout  { amount }
// Creates a Stripe Checkout Session and returns the hosted URL
export const createCheckout = async (req, res) => {
  try {
    const stripe = getStripe();
    if (!stripe) {
      return res.status(503).json({ message: 'Stripe is not configured yet. Please contact support.' });
    }

    const amount = parseFloat(req.body.amount);
    if (!amount || amount < 5) {
      return res.status(400).json({ message: 'Minimum purchase is $5' });
    }

    const credits = Math.floor(amount * 10); // $1 = 10 credits
    const amountCents = Math.round(amount * 100);

    // Find or create Stripe customer
    let stripeCustomerId = null;
    const user = await User.findById(req.user._id).select('name email stripeCustomerId');
    if (user.stripeCustomerId) {
      stripeCustomerId = user.stripeCustomerId;
    } else {
      const customer = await stripe.customers.create({
        email: user.email,
        name: user.name,
        metadata: { userId: String(req.user._id) },
      });
      stripeCustomerId = customer.id;
      user.stripeCustomerId = stripeCustomerId;
      await user.save();
    }

    const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';

    const session = await stripe.checkout.sessions.create({
      customer: stripeCustomerId,
      mode: 'payment',
      line_items: [{
        price_data: {
          currency: 'usd',
          unit_amount: amountCents,
          product_data: {
            name: `${credits} HireXtra Credits`,
            description: `$1 = 10 credits · Use for searches, sourcing & enrichment`,
          },
        },
        quantity: 1,
      }],
      metadata: {
        userId: String(req.user._id),
        credits: String(credits),
        amount: String(amount),
      },
      success_url: `${clientUrl}/dashboard?payment=success&credits=${credits}`,
      cancel_url:  `${clientUrl}/dashboard?payment=cancelled`,
    });

    res.json({ url: session.url });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// POST /api/credits/webhook  — Stripe webhook (raw body required)
export const handleWebhook = async (req, res) => {
  const stripe = getStripe();
  if (!stripe) return res.status(503).json({ message: 'Stripe not configured' });

  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    return res.status(503).json({ message: 'Webhook secret not configured' });
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    return res.status(400).json({ message: `Webhook signature failed: ${err.message}` });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const { userId, credits } = session.metadata || {};

    if (userId && credits) {
      try {
        await addCredits(
          userId,
          parseInt(credits),
          'STRIPE_PURCHASE',
          `Stripe purchase: $${session.metadata.amount} → ${credits} credits`,
          { stripeSessionId: session.id }
        );
      } catch (err) {
        // Log but always return 200 — Stripe retries on non-2xx
        console.error('[Webhook] Failed to add credits:', err.message);
      }
    }
  }

  // Always acknowledge immediately
  res.json({ received: true });
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
