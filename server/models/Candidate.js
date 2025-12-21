import mongoose from 'mongoose';

const candidateSchema = new mongoose.Schema(
  {
    // -------------------------
    // Core searchable fields
    // -------------------------
    fullName: { type: String },
    jobTitle: { type: String },
    skills: { type: String }, // Part of text index
    experience: { type: String },

    // -------------------------
    // Location filtering
    // -------------------------
    country: { type: String }, // Part of compound index
    locality: { type: String }, // Part of compound index
    location: { type: String }, // Not indexed directly, searched via text index or regex

    // -------------------------
    // Contact / metadata
    // -------------------------
    email: { type: String }, // Has its own unique, sparse index
    phone: String,
    company: { type: String }, // Part of compound index
    industry: { type: String }, // Not indexed to improve write speed

    linkedinUrl: String,
    githubUrl: String,
    birthYear: String,
    summary: String,

    // -------------------------
    // Upload & lifecycle
    // -------------------------
    sourceFile: { type: String }, // Not indexed
    uploadJobId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'UploadJob',
    },

    isDeleted: { type: Boolean, default: false, index: true },
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

// 1️⃣ TEXT INDEX (for keyword search: 'q' parameter)
// Used for: name, skills, job title, keyword search
candidateSchema.index(
  {
    fullName: 'text',
    jobTitle: 'text',
    skills: 'text',
  },
  {
    weights: {
      fullName: 10,
      jobTitle: 6,
      skills: 4,
    },
    name: 'CandidateTextSearch',
  }
);

// 2️⃣ DEFAULT SORTING INDEX (for the main candidate list)
// Used for: fetching latest candidates, pagination
candidateSchema.index({
  isDeleted: 1,
  createdAt: -1,
});

// 3️⃣ EMAIL INDEX (for login, existence checks, and preventing duplicates)
// `unique` prevents duplicate emails.
// `sparse` means it only indexes documents that HAVE an email field, saving space.
candidateSchema.index({ email: 1 }, { unique: true, sparse: true });

// 4️⃣ LOCATION FILTERING INDEX
// Used for: filtering by country and city. This index supports queries on `country` alone,
// or queries on `country` and `locality` together.
candidateSchema.index({
  country: 1,
  locality: 1,
  isDeleted: 1,
});

// 5️⃣ JOB-BASED FILTERING (for viewing candidates from a specific upload)
// Used for: viewing candidates from a specific upload
candidateSchema.index({
  uploadJobId: 1,
  isDeleted: 1,
});

// 6️⃣ COMMON FILTERS (Job Title & Company)
// These are frequently used in searches, so they deserve compound indexes.
candidateSchema.index({
  jobTitle: 1,
  isDeleted: 1
});
candidateSchema.index({ company: 1, isDeleted: 1 });

export default mongoose.model('Candidate', candidateSchema);
