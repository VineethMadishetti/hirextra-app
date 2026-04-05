import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['ADMIN', 'USER'], default: 'USER' },

  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },

  // Account status: 'active' (default/grandfathered), 'pending' (self-registered, awaiting admin approval), 'rejected'
  status:                 { type: String, enum: ['active', 'pending', 'rejected'], default: 'active' },
  emailVerified:          { type: Boolean, default: true },  // true for admin-created/grandfathered users
  emailVerificationOTP:   { type: String,  default: null },
  otpExpiresAt:           { type: Date,    default: null },

  lastLoginAt:      { type: Date, default: null },
  isLocked:         { type: Boolean, default: false },
  creditFree:       { type: Boolean, default: false }, // employees: unlimited usage, no credit checks
  credits:          { type: Number, default: 0 },
  stripeCustomerId: { type: String, default: null },

}, { timestamps: true });

// FIX: Removed 'next' parameter. Just use async/await.
userSchema.pre('save', async function () {
  if (!this.isModified('password')) return;
  
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

userSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

export default mongoose.model('User', userSchema);