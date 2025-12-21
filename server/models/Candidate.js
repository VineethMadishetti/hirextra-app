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
    country: { type: String, index: true },
    locality: { type: String, index: true },
    location: { type: String, index: true },

    // -------------------------
    // Contact / metadata
    // -------------------------
    email: { type: String, index: true },
    phone: String,
    company: { type: String, index: true },
    industry: { type: String, index: true },

    linkedinUrl: String,
    githubUrl: String,
    birthYear: String,
    summary: String,

    // -------------------------
    // Upload & lifecycle
    // -------------------------
    sourceFile: { type: String, index: true },
    uploadJobId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'UploadJob',
      index: true,
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

// 1️⃣ SINGLE TEXT INDEX (keywords search)
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

// 2️⃣ Default listing & sorting
// Used for: latest candidates, pagination
candidateSchema.index({
  isDeleted: 1,
  createdAt: -1,
});

// 3️⃣ Location-based filtering
// Used for: country / city filters
candidateSchema.index({
  country: 1,
  locality: 1,
  isDeleted: 1,
});

// 4️⃣ Upload/job-based filtering
// Used for: viewing candidates from a specific upload
candidateSchema.index({
  uploadJobId: 1,
  isDeleted: 1,
});

// 5️⃣ Email lookup (fast existence checks)
candidateSchema.index({
  email: 1,
});

// ------------------------------------------------------

export default mongoose.model('Candidate', candidateSchema);
