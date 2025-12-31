import mongoose from 'mongoose';

const deleteLogSchema = new mongoose.Schema({
  entityType: { type: String, enum: ['FILE', 'DATABASE'], required: true },
  entityName: { type: String, required: true },
  deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  deletedAt: { type: Date, default: Date.now }
});

export default mongoose.model('DeleteLog', deleteLogSchema);