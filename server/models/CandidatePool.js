import mongoose from 'mongoose';

/**
 * Permanent cache of LinkedIn profiles fetched from HarvestAPI (Apify).
 * Stored once, reused across future searches to avoid repeat credit spend.
 * Upserted by linkedinUrl — newest fetch wins on all fields.
 */
const candidatePoolSchema = new mongoose.Schema(
  {
    linkedinUrl:       { type: String, required: true, unique: true, lowercase: true, trim: true },
    publicIdentifier:  { type: String, default: null },
    name:              { type: String, default: null },
    jobTitle:          { type: String, default: null },
    company:           { type: String, default: null },
    location:          { type: String, default: null },
    headline:          { type: String, default: null },
    about:             { type: String, default: null },
    skills:            { type: [String], default: [] },
    education:         { type: String, default: null },
    educationGrade:    { type: String, default: null },
    educationYear:     { type: mongoose.Schema.Types.Mixed, default: null },
    totalExperience:   { type: String, default: null },
    experienceYears:   { type: Number, default: null },
    experienceTimeline:{ type: mongoose.Schema.Types.Mixed, default: [] },
    certifications:    { type: mongoose.Schema.Types.Mixed, default: [] },
    profilePic:        { type: String, default: null },
    connectionsCount:  { type: Number, default: null },
    followerCount:     { type: Number, default: null },
    premium:           { type: Boolean, default: false },
    verified:          { type: Boolean, default: false },
    openToWork:        { type: Boolean, default: false },
    // Raw Apify response kept for re-processing if schema changes
    rawProfile:        { type: mongoose.Schema.Types.Mixed, default: null },
    fetchedAt:         { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// Fast lookup by URL
candidatePoolSchema.index({ linkedinUrl: 1 }, { unique: true });
// Search by job title text
candidatePoolSchema.index({ jobTitle: 'text', headline: 'text' });
// Filter by location prefix
candidatePoolSchema.index({ location: 1 });
// Filter by skills
candidatePoolSchema.index({ skills: 1 });
// Sort/filter by freshness
candidatePoolSchema.index({ fetchedAt: -1 });

const CandidatePool = mongoose.model('CandidatePool', candidatePoolSchema);
export default CandidatePool;
