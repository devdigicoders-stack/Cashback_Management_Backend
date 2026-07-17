const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const UserSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Please add a name'],
    },
    phone: {
      type: String,
      required: [true, 'Please add a phone number'],
      unique: true,
      trim: true,
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
    },
    firmName: {
      type: String,
    },
    profileImage: {
      type: String,
      default: '',
    },
    password: {
      type: String,
      required: [true, 'Please add a password'],
      minlength: 6,
    },
    role: {
      type: String,
      enum: ['admin', 'sub-admin', 'retailer', 'electrician'],
      default: 'electrician',
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    kycStatus: {
      aadhar: {
        type: String,
        enum: ['pending', 'submitted', 'approved', 'rejected'],
        default: 'pending',
      },
      pan: {
        type: String,
        enum: ['pending', 'submitted', 'approved', 'rejected'],
        default: 'pending',
      },
    },
    kycDetails: {
      aadharNumber: { type: String },
      aadharFrontUrl: { type: String },
      aadharBackUrl: { type: String },
      panNumber: { type: String },
      panCardUrl: { type: String },
      rejectionReason: { type: String, default: '' },
    },
    shopDetails: {
      shopName: { type: String },
      shopAddress: { type: String },
      gstNumber: { type: String },
    },
    bankDetails: {
      accountHolderName: { type: String },
      accountNumber: { type: String },
      ifscCode: { type: String },
      bankName: { type: String },
    },
  },
  {
    timestamps: true,
  }
);

// Encrypt password before saving
UserSchema.pre('save', async function () {
  if (!this.isModified('password')) {
    return;
  }
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

// Compare user password
UserSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

module.exports = mongoose.model('User', UserSchema);
