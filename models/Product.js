const mongoose = require('mongoose');

const ProductSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Please add a product name'],
      trim: true,
    },
    sku: {
      type: String,
      required: [true, 'Please add a product SKU'],
      unique: true,
      trim: true,
    },
    category: {
      type: String,
      required: [true, 'Please add a product category'],
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    cashbackConfig: {
      electricianAmount: {
        type: Number,
        required: true,
        default: 0,
      },
      retailerAmount: {
        type: Number,
        required: true,
        default: 0,
      },
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

module.exports = mongoose.model('Product', ProductSchema);
