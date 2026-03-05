import mongoose from 'mongoose';

const privateDatabaseSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 25,
    },
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    candidateCount: {
      type: Number,
      default: 0,
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

privateDatabaseSchema.index({ owner: 1, isDeleted: 1 });

const PrivateDatabase = mongoose.model('PrivateDatabase', privateDatabaseSchema);
export default PrivateDatabase;
