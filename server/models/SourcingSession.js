import mongoose from 'mongoose';

/**
 * SourcingSession
 *
 * Persists each AI sourcing run so users can revisit results.
 * Candidates are capped at 50 per session to keep documents small.
 * Sessions auto-expire after 60 days via TTL index.
 */
const sourcingSessionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    // Human-readable summary shown in the "Recent Searches" list
    jobTitle:      { type: String, default: '' },
    location:      { type: String, default: '' },
    dataSource:    { type: String, default: 'unknown' }, // 'apify' | 'serper' | etc.
    candidateCount:{ type: Number, default: 0 },

    // Enough context to replay the search or display the requirements panel
    parsedRequirements: { type: mongoose.Schema.Types.Mixed, default: {} },

    // Top candidates (capped at 50) — formatted shape from formatCandidates()
    candidates: { type: [mongoose.Schema.Types.Mixed], default: [] },

    // Auto-delete after 60 days
    expiresAt: { type: Date, default: () => new Date(Date.now() + 60 * 24 * 60 * 60 * 1000) },
  },
  { timestamps: true }
);

// TTL index — MongoDB removes expired documents automatically
sourcingSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Compound index for fast per-user listing (newest first)
sourcingSessionSchema.index({ userId: 1, createdAt: -1 });

export default mongoose.model('SourcingSession', sourcingSessionSchema);
