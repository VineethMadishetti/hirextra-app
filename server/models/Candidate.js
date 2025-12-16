import mongoose from 'mongoose';

const candidateSchema = new mongoose.Schema({
  fullName: { type: String, index: "text" },
  email: { type: String, index: true },
  phone: String,
  company: String,
  industry: String,
  jobTitle: { type: String, index: "text" },
  skills: { type: String, index: "text" },
  country: { type: String, index: true },
  locality: { type: String, index: true },
  location: { type: String, index: true },
  linkedinUrl: String,
  githubUrl: String,
  birthYear: String,
  summary: String,
  
  // Meta
  sourceFile: String, 
  uploadJobId: { type: mongoose.Schema.Types.ObjectId, ref: 'UploadJob' },
  isDeleted: { type: Boolean, default: false, index: true }  // Link to the job
}, { timestamps: true });

// Index for sorting by creation date
candidateSchema.index({ createdAt: -1 });

// Compound Index for Search
candidateSchema.index({ 
  fullName: 'text', 
  jobTitle: 'text', 
  skills: 'text',
  country: 'text',
  locality: 'text',
  location: 'text',
  industry: 'text'
});

export default mongoose.model('Candidate', candidateSchema);