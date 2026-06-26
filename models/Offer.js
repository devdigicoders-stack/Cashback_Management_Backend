const mongoose = require('mongoose');

const OfferSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'Please add an offer title'],
      trim: true,
    },
    description: {
      type: String,
      required: [true, 'Please add an offer description'],
      trim: true,
    },
    bannerUrl: {
      type: String,
      default: '',
    },
    validUntil: {
      type: Date,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('Offer', OfferSchema);
