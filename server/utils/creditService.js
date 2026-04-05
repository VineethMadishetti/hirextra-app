import User from '../models/User.js';
import CreditTransaction from '../models/CreditTransaction.js';

/**
 * Check if user has enough credits.
 * ADMINs are always exempt — returns true without checking balance.
 * Throws a structured error with status 402 if insufficient.
 */
export async function checkCredits(userId, userRole, required, creditFree = false) {
  if (userRole === 'ADMIN' || creditFree === true) return true;

  const user = await User.findById(userId).select('credits').lean();
  if (!user) throw { status: 404, message: 'User not found' };

  const available = user.credits ?? 0;
  if (available < required) {
    const err = new Error('Insufficient credits');
    err.status = 402;
    err.required = required;
    err.available = available;
    throw err;
  }
  return true;
}

/**
 * Atomically deduct credits from a user after a successful operation.
 * Uses $inc to prevent race conditions.
 * Writes a CreditTransaction record.
 */
export async function deductCredits(userId, amount, reason, description = '') {
  const user = await User.findByIdAndUpdate(
    userId,
    { $inc: { credits: -amount } },
    { new: true, select: 'credits' }
  );
  if (!user) return;

  await CreditTransaction.create({
    userId,
    type: 'DEDUCT',
    amount,
    reason,
    description,
    balanceBefore: user.credits + amount,
    balanceAfter: user.credits,
  });
}

/**
 * Add credits to a user (mock purchase, admin top-up, or Stripe).
 * Writes a CreditTransaction record.
 */
export async function addCredits(userId, amount, reason, description = '', { stripeSessionId = null, createdBy = null } = {}) {
  const user = await User.findByIdAndUpdate(
    userId,
    { $inc: { credits: amount } },
    { new: true, select: 'credits' }
  );
  if (!user) return null;

  await CreditTransaction.create({
    userId,
    type: 'ADD',
    amount,
    reason,
    description,
    balanceBefore: user.credits - amount,
    balanceAfter: user.credits,
    stripeSessionId,
    createdBy,
  });

  return user.credits;
}
