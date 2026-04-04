import mongoose from 'mongoose';

const creditTransactionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  type: {
    type: String,
    enum: ['DEDUCT', 'ADD'],
    required: true,
  },
  amount: {
    type: Number,
    required: true,
  },
  reason: {
    type: String,
    enum: ['SEARCH', 'ENRICH', 'AI_SOURCE', 'STRIPE_PURCHASE', 'MOCK_PURCHASE', 'ADMIN_ADD', 'SIGNUP_BONUS'],
    required: true,
  },
  description: { type: String, default: '' },
  balanceBefore: { type: Number, required: true },
  balanceAfter:  { type: Number, required: true },
  stripeSessionId: { type: String, default: null },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
}, { timestamps: true });

creditTransactionSchema.index({ userId: 1, createdAt: -1 });

// Auto-delete transactions older than 365 days
creditTransactionSchema.index({ createdAt: 1 }, { expireAfterSeconds: 365 * 24 * 60 * 60 });

export default mongoose.model('CreditTransaction', creditTransactionSchema);
