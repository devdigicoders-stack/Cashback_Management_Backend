const mongoose = require('mongoose');

const AppConfigSchema = new mongoose.Schema(
  {
    privacyPolicy: {
      type: String,
      default: 'Privacy Policy details go here...',
    },
    termsAndConditions: {
      type: String,
      default: 'Terms and Conditions details go here...',
    },
    aboutUs: {
      type: String,
      default: 'About Us details go here...',
    },
    faq: [
      {
        question: String,
        answer: String,
      },
    ],
    contactPhone: {
      type: String,
      default: '+919999999999',
    },
    contactEmail: {
      type: String,
      default: 'support@cashback.com',
    },
    rateUsUrl: {
      type: String,
      default: 'https://play.google.com/store/apps',
    },
    shareAppText: {
      type: String,
      default: 'Download our Cashback Loyalty App now and earn rewards instantly!',
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('AppConfig', AppConfigSchema);
