import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    // Optional display name shown in the user menu; falls back to the email
    name: { type: String, default: '', trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ['admin', 'member'], default: 'member' },
    apiKey: { type: String, unique: true, sparse: true, index: true },
    active: { type: Boolean, default: true },
  },
  { timestamps: true, collection: 'users' }
);

userSchema.methods.toSafeJSON = function toSafeJSON() {
  return {
    _id: this._id,
    email: this.email,
    name: this.name,
    role: this.role,
    apiKey: this.apiKey,
    active: this.active,
    createdAt: this.createdAt,
  };
};

export const User = mongoose.model('User', userSchema);
export default User;
