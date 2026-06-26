const User = require('../models/User');
const Product = require('../models/Product');
const Wallet = require('../models/Wallet');
const Transaction = require('../models/Transaction');
const Withdrawal = require('../models/Withdrawal');
const Notification = require('../models/Notification');
const Offer = require('../models/Offer');

// @desc    Get Retailer Dashboard Overview
// @route   GET /api/retailer/dashboard
// @access  Private (Retailer only)
exports.getDashboard = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    const wallet = await Wallet.findOne({ userId: req.user.id });
    const currentBalance = wallet ? wallet.balance : 0;

    // Get total retailer benefits/cashback earned
    const credits = await Transaction.aggregate([
      { $match: { userId: req.user._id, type: 'credit_cashback', status: 'completed' } },
      { $group: { _id: null, totalEarned: { $sum: '$amount' } } },
    ]);
    const totalEarned = credits.length > 0 ? credits[0].totalEarned : 0;

    return res.status(200).json({
      success: true,
      dashboard: {
        shopDetails: user.shopDetails,
        walletBalance: currentBalance,
        totalEarned,
        kycStatus: user.kycStatus,
      },
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Update Shop Details
// @route   PUT /api/retailer/shop-details
// @access  Private (Retailer only)
exports.updateShopDetails = async (req, res) => {
  try {
    const { shopName, shopAddress, gstNumber } = req.body;

    if (!shopName || !shopAddress) {
      return res.status(400).json({ success: false, message: 'Please provide shop name and shop address' });
    }

    const user = await User.findById(req.user.id);
    user.shopDetails = {
      shopName,
      shopAddress,
      gstNumber: gstNumber || '',
    };

    await user.save();

    return res.status(200).json({
      success: true,
      message: 'Shop details updated successfully',
      shopDetails: user.shopDetails,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Get Available Offers and Schemes
// @route   GET /api/retailer/offers
// @access  Private (Retailer only)
exports.getOffersAndSchemes = async (req, res) => {
  try {
    const offers = await Offer.find({ isActive: true }).sort({ createdAt: -1 });
    return res.status(200).json({ success: true, count: offers.length, offers });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Request Bank Withdrawal
// @route   POST /api/retailer/withdraw
// @access  Private (Retailer only)
exports.requestWithdrawal = async (req, res) => {
  try {
    const { amount } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ success: false, message: 'Please provide a valid withdrawal amount' });
    }

    const user = await User.findById(req.user.id);
    if (
      !user.bankDetails ||
      !user.bankDetails.accountNumber ||
      !user.bankDetails.ifscCode ||
      !user.bankDetails.accountHolderName
    ) {
      return res.status(400).json({
        success: false,
        message: 'Please update your Bank Details in Profile before requesting a withdrawal',
      });
    }

    const wallet = await Wallet.findOne({ userId: user._id });
    if (!wallet || wallet.balance < amount) {
      return res.status(400).json({ success: false, message: 'Insufficient wallet balance' });
    }

    // Check outstanding pending withdrawals so user doesn't withdraw same balance twice
    const pendingWithdrawalsList = await Withdrawal.find({ userId: user._id, status: 'pending' });
    const totalPendingAmount = pendingWithdrawalsList.reduce((acc, curr) => acc + curr.amount, 0);

    if (wallet.balance - totalPendingAmount < amount) {
      return res.status(400).json({
        success: false,
        message: `Insufficient available balance. Current Wallet: ₹${wallet.balance}, Pending Withdrawals: ₹${totalPendingAmount}, Available: ₹${wallet.balance - totalPendingAmount}`,
      });
    }

    // Create withdrawal request with snapshot of current bank details
    const withdrawal = await Withdrawal.create({
      userId: user._id,
      amount,
      bankSnapshot: {
        accountHolderName: user.bankDetails.accountHolderName,
        accountNumber: user.bankDetails.accountNumber,
        ifscCode: user.bankDetails.ifscCode,
        bankName: user.bankDetails.bankName || 'Not Provided',
      },
      status: 'pending',
    });

    // Notify user
    await Notification.create({
      userId: user._id,
      title: 'Withdrawal Requested',
      message: `Your request to withdraw ₹${amount} has been submitted successfully for admin approval.`,
      type: 'withdrawal',
    });

    return res.status(201).json({
      success: true,
      message: 'Withdrawal request submitted successfully',
      withdrawal,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Get Transaction Ledger History
// @route   GET /api/retailer/transactions
// @access  Private (Retailer only)
exports.getTransactions = async (req, res) => {
  try {
    const transactions = await Transaction.find({ userId: req.user.id }).sort({ createdAt: -1 });
    return res.status(200).json({ success: true, count: transactions.length, transactions });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};
