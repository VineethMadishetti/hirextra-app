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

    linkedinUrl: String,
    githubUrl: String,
    summary: String,

    // -------------------------
    // Upload & lifecycle
    // -------------------------
    sourceFile: { type: String }, // Not indexed
    uploadJobId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'UploadJob',
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

// 2. Date & Sorting (Files created at time/date)
// Optimized: Partial Index (Only indexes active candidates)
candidateSchema.index({ createdAt: -1, _id: -1 }, { partialFilterExpression: { isDeleted: false } });

// 3. Filter: Email (Unique lookup)
candidateSchema.index({ email: 1 }, { partialFilterExpression: { isDeleted: false } });

// 4. Filter: Company Name
candidateSchema.index({ company: 1 }, { partialFilterExpression: { isDeleted: false } });

// 5. Filter: Job Title
candidateSchema.index({ jobTitle: 1 }, { partialFilterExpression: { isDeleted: false } });

// 6. Filter: Location (General)
candidateSchema.index({ location: 1 }, { partialFilterExpression: { isDeleted: false } });

// 7. Filter: Skills
// This is a Multikey index. It allows efficient filtering where "skills" contains "Java".
candidateSchema.index({ skills: 1 }, { partialFilterExpression: { isDeleted: false } });

// 8. Filter: Name
// Supports searching by name (e.g., /^John/).
candidateSchema.index({ fullName: 1 }, { partialFilterExpression: { isDeleted: false } });

// 9. Filter: Hierarchical Location (Country/Locality)
candidateSchema.index({ locality: 1 }, { partialFilterExpression: { isDeleted: false } });

// 10. Filter: User/Admin Created By (As requested)
// Ensure your schema has a 'createdBy' field for this to work.
candidateSchema.index({ createdBy: 1 }, { partialFilterExpression: { isDeleted: false } });

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

export default mongoose.model('Candidate', candidateSchema);
