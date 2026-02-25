import mongoose from 'mongoose';

const enrichedContactSchema = new mongoose.Schema(
  {
    // Link to candidate
    candidateId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Candidate',
      required: true,
      index: true,
    },

    // Enriched contact data
    email: { type: String, sparse: true },
    phone: { type: String, sparse: true },
    linkedinUrl: String,

    // Quality metrics
    confidence: {
      type: Number,
      min: 0,
      max: 1,
      default: 0,
    },
    source: {
      type: String,
      enum: ['skrapp', 'pdl', 'lusha', 'cached', 'manual'],
      required: true,
    },

    // Validation
    verifiedAt: Date,
    verifiedBy: String, // Who verified it

    // Tracking
    discoveredAt: {
      type: Date,
      default: Date.now,
    },
    expiresAt: {
      type: Date,
      index: { expireAfterSeconds: 0 }, // MongoDB TTL index - auto-deletes after this date
      default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
    },

    // API Cost tracking
    apiBilling: {
      source: String,
      costUSD: Number,
      requestId: String,
    },

    // Error tracking
    lastError: String,
    errorCount: { type: Number, default: 0 },
  },
  {
    timestamps: true,
    collection: 'enriched_contacts',
  }
);

// Index for fast lookup by candidateId
enrichedContactSchema.index({ candidateId: 1 });

// Index for TTL expiration
enrichedContactSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Compound index for deduplication check
enrichedContactSchema.index({ email: 1, candidateId: 1 });

const EnrichedContact = mongoose.model('EnrichedContact', enrichedContactSchema);

export default EnrichedContact;
