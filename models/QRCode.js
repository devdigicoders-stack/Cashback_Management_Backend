const mongoose = require('mongoose');

const QRCodeSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
    },
    qrType: {
      type: String,
      enum: ['electrician', 'retailer'],
      default: 'electrician',
    },
    status: {
      type: String,
      enum: ['generated', 'assigned', 'scanned'],
      default: 'generated',
    },
    generatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    scannedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User', // Electrician
    },
    scannedAt: {
      type: Date,
    },
    cashbackAmountCredited: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('QRCode', QRCodeSchema);
