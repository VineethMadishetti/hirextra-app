import mongoose from 'mongoose';

const candidateSchema = new mongoose.Schema(
  {
    // -------------------------
    // Core searchable fields
    // -------------------------
    fullName: { type: String },
    jobTitle: { type: String },
    skills: { type: String },
    experience: { type: String },

    // -------------------------
    // Location filtering
    // -------------------------
    country: { type: String }, // Part of compound index
    locality: { type: String }, // Part of compound index
    location: { type: String },

    // -------------------------
    // Contact / metadata
    // -------------------------
    email: { type: String }, // Has its own unique, sparse index
    phone: String,
    company: { type: String }, // Part of compound index
    industry: { type: String }, // Not indexed to improve write speed
    education: { type: String },

    linkedinUrl: String,
    githubUrl: String,
    source: {
      type: String,
      enum: ['UPLOAD', 'AI_SOURCING', 'MANUAL', 'API'],
      default: 'UPLOAD',
    },
    sourceCountry: { type: String },
    enrichmentStatus: {
      type: String,
      enum: ['NEW', 'ENRICHED', 'FAILED'],
      default: 'NEW',
    },
    enrichmentMetadata: {
      enrichedAt: Date,
      source: String,
      confidence: { type: Number, default: 0 },
    },
    pipelineStage: {
      type: String,
      enum: ['DISCOVERED', 'CONTACT_ENRICHED', 'SEQUENCED', 'CALL_QUEUED', 'SHORTLISTED'],
      default: 'DISCOVERED',
    },
    sequenceStatus: {
      type: String,
      enum: ['NOT_STARTED', 'QUEUED', 'SENT'],
      default: 'NOT_STARTED',
    },
    callStatus: {
      type: String,
      enum: ['NOT_SCHEDULED', 'QUEUED', 'COMPLETED'],
      default: 'NOT_SCHEDULED',
    },
    shortlistedAt: Date,
    summary: String,
    availability: {
      type: String,
      enum: ['IMMEDIATE', '15_DAYS', '30_DAYS', 'UNKNOWN'],
      default: 'UNKNOWN'
    },
    candidateStatus: {
      type: String,
      enum: ['ACTIVE', 'PASSIVE', 'NOT_AVAILABLE'],
      default: 'ACTIVE'
    },
    internalTags: { type: String, default: '' },
    recruiterNotes: { type: String, default: '' },
    parsedResume: { type: mongoose.Schema.Types.Mixed },
    parseStatus: { type: String, enum: ['PARSED', 'PARTIAL', 'FAILED'], default: 'PARSED' },
    parseWarnings: [String],
    enrichment: {
      completenessScore: { type: Number, default: 0 },
      missingFields: { type: [String], default: [] },
      needsEnrichment: { type: Boolean, default: true },
      staleDays: { type: Number, default: 0 },
      verificationStatus: {
        type: String,
        enum: ['NEEDS_REVIEW', 'VERIFIED', 'NOT_VERIFIED'],
        default: 'NEEDS_REVIEW'
      },
      suggestionStatus: {
        type: String,
        enum: ['NONE', 'PENDING', 'APPLIED', 'REJECTED'],
        default: 'NONE'
      },
      lastEnrichedAt: Date,
      lastReviewedAt: Date,
      lastVerifiedAt: Date,
      lastReviewedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
      lastVerifiedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
      provider: String,
      suggestedUpdates: { type: mongoose.Schema.Types.Mixed, default: null },
    },

    // -------------------------
    // Upload & lifecycle
    // -------------------------
    sourceFile: { type: String }, // Not indexed
    uploadJobId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'UploadJob',
    },

    // Private database reference (null = global PeopleFinder DB)
    privateDbId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PrivateDatabase',
      default: null,
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },

    isDeleted: { type: Boolean, default: false },
  },
  {
    timestamps: true, // creates createdAt + updatedAt
  }
);

//
// =====================================================
// INDEX STRATEGY (SCALE-SAFE)
// =====================================================
//

// 1. Core Operational Index (Required for your queue.js delete job)
// Optimized: Simple index for hard deletes (doesn't care about isDeleted status)
candidateSchema.index({ uploadJobId: 1 });
candidateSchema.index({ sourceFile: 1, isDeleted: 1 });

// 2. Date & Sorting (Files created at time/date)
// Optimized: Partial Index (Only indexes active candidates)
candidateSchema.index({ createdAt: -1, _id: -1 }, { partialFilterExpression: { isDeleted: false } });

// 3. Filter: Email (Unique lookup)
candidateSchema.index({ email: 1 }, { partialFilterExpression: { isDeleted: false } });

// 3a. PDL contact lookup — find a record by linkedinUrl that has email or phone
// Partial index: only indexes documents that actually have a linkedinUrl value.
// Used by the enrichment controller to resolve contacts from the local 416M PDL dataset
// before calling any paid external API.
candidateSchema.index(
  { linkedinUrl: 1 },
  { partialFilterExpression: { linkedinUrl: { $exists: true, $ne: '' }, isDeleted: false }, background: true, name: 'CandidateLinkedinUrlIdx' }
);

// 4. Filter: Company Name
candidateSchema.index({ company: 1 }, { partialFilterExpression: { isDeleted: false } });

// 5. Filter: Job Title
candidateSchema.index({ jobTitle: 1 }, { partialFilterExpression: { isDeleted: false } });

// 6. Filter: Location (General)
candidateSchema.index({ location: 1, createdAt: -1 }, { partialFilterExpression: { isDeleted: false } });

// 7. Filter: Skills
// This is a Multikey index. It allows efficient filtering where "skills" contains "Java".
candidateSchema.index({ skills: 1 }, { partialFilterExpression: { isDeleted: false } });

// 8. Filter: Name
// Supports searching by name (e.g., /^John/).
candidateSchema.index({ fullName: 1 }, { partialFilterExpression: { isDeleted: false } });

// 9. Filter: Hierarchical Location (Country/Locality)
candidateSchema.index({ locality: 1, createdAt: -1 }, { partialFilterExpression: { isDeleted: false } });
candidateSchema.index({ country: 1, createdAt: -1 }, { partialFilterExpression: { isDeleted: false } });

// 10. Filter: User/Admin Created By (As requested)
// Ensure your schema has a 'createdBy' field for this to work.
candidateSchema.index({ privateDbId: 1, isDeleted: 1 });
candidateSchema.index({ createdBy: 1 }, { partialFilterExpression: { isDeleted: false } });
candidateSchema.index({ createdBy: 1, source: 1, createdAt: -1 }, { partialFilterExpression: { isDeleted: false } });
candidateSchema.index(
  { createdBy: 1, source: 1, pipelineStage: 1, createdAt: -1 },
  { partialFilterExpression: { isDeleted: false } }
);

// 11. Compound Filter Index (High Performance for Search Page)
// Matches the common filter pattern: Job Title + Location + Skills + Sort by Date
candidateSchema.index(
  { jobTitle: 1, locality: 1, skills: 1, createdAt: -1 },
  { partialFilterExpression: { isDeleted: false }, background: true }
);

// 12. Full Text Search Index (CRITICAL for "Search..." performance)
// Replaces slow regex $or queries with high-performance text search
candidateSchema.index({
  fullName: 'text',
  jobTitle: 'text',
  skills: 'text',
  company: 'text',
  location: 'text',
  locality: 'text',
  summary: 'text'
}, {
  weights: { fullName: 10, jobTitle: 5, skills: 5 },
  name: "CandidateTextIndex"
});

candidateSchema.index(
  { "enrichment.needsEnrichment": 1, "enrichment.completenessScore": 1, updatedAt: -1 },
  { partialFilterExpression: { isDeleted: false }, background: true, name: "CandidateEnrichmentQueueIdx" }
);

export default mongoose.model('Candidate', candidateSchema);
