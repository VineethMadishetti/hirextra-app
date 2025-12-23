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
// Replaces: uploadJobId_1_isDeleted_1
candidateSchema.index({ uploadJobId: 1, isDeleted: 1 });

// 2. Date & Sorting (Files created at time/date)
// Replaces: isDeleted_1_createdAt_-1
candidateSchema.index({ isDeleted: 1, createdAt: -1 });

// 3. Filter: Email (Unique lookup)
// Replaces: email_1
candidateSchema.index({ isDeleted: 1, email: 1 });

// 4. Filter: Company Name
// Replaces: company_1 AND company_1_isDeleted_1
candidateSchema.index({ isDeleted: 1, company: 1 });

// 5. Filter: Job Title
// Replaces: jobTitle_1_isDeleted_1
candidateSchema.index({ isDeleted: 1, jobTitle: 1 });

// 6. Filter: Location (General)
// Replaces: location_1
candidateSchema.index({ isDeleted: 1, location: 1 });

// 7. Filter: Skills
// This is a Multikey index. It allows efficient filtering where "skills" contains "Java".
candidateSchema.index({ isDeleted: 1, skills: 1 });

// 8. Filter: Name
// Supports searching by name (e.g., /^John/).
candidateSchema.index({ isDeleted: 1, fullName: 1 });

// 9. Filter: Hierarchical Location (Country/Locality)
// Replaces: country_1_locality_1_isDeleted_1 AND country_1 AND locality_1
candidateSchema.index({ isDeleted: 1, country: 1, locality: 1 });

// 10. Filter: User/Admin Created By (As requested)
// Ensure your schema has a 'createdBy' field for this to work.
candidateSchema.index({ isDeleted: 1, createdBy: 1 });

export default mongoose.model('Candidate', candidateSchema);
