import mongoose from 'mongoose';

const jobSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    client: { type: String, trim: true },
    location: { type: String, trim: true },
    skills: { type: String, trim: true },
    description: { type: String, trim: true },
    status: {
      type: String,
      enum: ['OPEN', 'ON_HOLD', 'CLOSED'],
      default: 'OPEN',
    },
    priority: {
      type: String,
      enum: ['LOW', 'MEDIUM', 'HIGH'],
      default: 'MEDIUM',
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

jobSchema.index({ createdBy: 1, status: 1, createdAt: -1 });

export default mongoose.model('Job', jobSchema);
