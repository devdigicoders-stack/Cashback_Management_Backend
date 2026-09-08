const mongoose = require('mongoose');

const SalesPersonSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Please provide sales person name'],
      trim: true,
    },
    code: {
      type: String,
      required: [true, 'Please provide sales person code'],
      unique: true,
      trim: true,
      uppercase: true,
    },
    phone: {
      type: String,
      trim: true,
      default: '',
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: '',
    },
    city: {
      type: String,
      trim: true,
      default: '',
    },
    area: {
      type: String,
      trim: true,
      default: '',
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    notes: {
      type: String,
      default: '',
    },
  },
  {
    timestamps: true,
  }
);

// Index code for fast lookups
SalesPersonSchema.index({ code: 1 });

module.exports = mongoose.model('SalesPerson', SalesPersonSchema);
