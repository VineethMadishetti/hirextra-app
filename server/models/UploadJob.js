import mongoose from 'mongoose';

const uploadJobSchema = new mongoose.Schema({
  fileName: String,
  originalName: String,
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  status: { 
    type: String, 
    enum: ['UPLOADING', 'MAPPING_PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'DELETED'], 
    default: 'UPLOADING' 
  },
  totalRows: { type: Number, default: 0 },
  successRows: { type: Number, default: 0 },
  failedRows: { type: Number, default: 0 },
  mapping: Object, // Store what mapping was used
  headers: [String], // ✅ Store the exact headers used for processing
  startedAt: Date,
  completedAt: Date,
  isDeleted: { type: Boolean, default: false },
  deletedAt: Date,
  deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

export default mongoose.model('UploadJob', uploadJobSchema);