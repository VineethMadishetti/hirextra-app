import mongoose from 'mongoose';
import crypto from 'crypto';

const shortlistSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    candidateIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Candidate' }],
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    shareToken: { type: String, unique: true },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

shortlistSchema.pre('save', function (next) {
  if (!this.shareToken) {
    this.shareToken = crypto.randomBytes(16).toString('hex');
  }
  next();
});

shortlistSchema.index({ createdBy: 1, createdAt: -1 });
shortlistSchema.index({ shareToken: 1 });

export default mongoose.model('Shortlist', shortlistSchema);
