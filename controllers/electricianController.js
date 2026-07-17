const User = require('../models/User');
const Product = require('../models/Product');
const QRCode = require('../models/QRCode');
const Wallet = require('../models/Wallet');
const Transaction = require('../models/Transaction');
const Withdrawal = require('../models/Withdrawal');
const Notification = require('../models/Notification');

// @desc    Get Electrician Dashboard Stats
// @route   GET /api/electrician/dashboard
// @access  Private (Electrician only)
exports.getDashboard = async (req, res) => {
  try {
    const wallet = await Wallet.findOne({ userId: req.user.id });
    const currentBalance = wallet ? wallet.balance : 0;

    // Get total cashback earned (sum of all credit transactions)
    const credits = await Transaction.aggregate([
      { $match: { userId: req.user._id, type: 'credit_cashback', status: 'completed' } },
      { $group: { _id: null, totalEarned: { $sum: '$amount' } } },
    ]);
    const totalEarned = credits.length > 0 ? credits[0].totalEarned : 0;

    // Get total scans
    const totalScans = await QRCode.countDocuments({ scannedBy: req.user.id, status: 'scanned' });

    return res.status(200).json({
      success: true,
      dashboard: {
        walletBalance: currentBalance,
        totalEarned,
        totalScans,
      },
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Scan QR Code & Get Instant Cashback
// @route   POST /api/electrician/scan-qr
// @access  Private (Electrician only)
exports.scanQRCode = async (req, res) => {
  try {
    const { code } = req.body;

    if (!code) {
      return res.status(400).json({ success: false, message: 'Please provide QR code string' });
    }

    // 1. Enforce KYC verification
    const user = await User.findById(req.user.id);
    if (user.kycStatus.aadhar !== 'approved' || user.kycStatus.pan !== 'approved') {
      return res.status(400).json({
        success: false,
        message: 'Your Aadhaar & PAN KYC verification is pending. Please wait for admin approval to scan and redeem cashback.',
        kycStatus: user.kycStatus,
      });
    }

    // 2. Fetch the QR Code details first (to know which product and cashback rate is configured)
    const initialQR = await QRCode.findOne({ code });
    if (!initialQR) {
      return res.status(404).json({ success: false, message: 'Invalid QR Code' });
    }

    if (initialQR.qrType !== 'electrician') {
      return res.status(400).json({ success: false, message: 'This QR Code is not valid for Electricians.' });
    }

    if (initialQR.status === 'scanned') {
      return res.status(400).json({ success: false, message: 'This QR Code has already been scanned and redeemed.' });
    }

    const product = await Product.findById(initialQR.productId);
    if (!product || !product.isActive) {
      return res.status(404).json({ success: false, message: 'Associated product is not found or inactive' });
    }

    const cashbackAmount = product.cashbackConfig.electricianAmount;
    if (cashbackAmount <= 0) {
      return res.status(400).json({ success: false, message: 'This product does not have any active cashback configured' });
    }

    // 3. Atomically update the QR code status to 'scanned' to prevent race conditions (double scans)
    const qrcode = await QRCode.findOneAndUpdate(
      { code, status: 'generated' }, // Must still be 'generated' (or not scanned)
      {
        status: 'scanned',
        scannedBy: user._id,
        scannedAt: Date.now(),
        cashbackAmountCredited: cashbackAmount,
      },
      { new: true }
    );

    if (!qrcode) {
      // If null, it means status changed from 'generated' in the split-second between our check and update
      return res.status(400).json({ success: false, message: 'This QR Code was just scanned by another process' });
    }

    // 4. Update the Electrician's Wallet
    let wallet = await Wallet.findOne({ userId: user._id });
    if (!wallet) {
      wallet = await Wallet.create({ userId: user._id, balance: 0 });
    }

    wallet.balance += cashbackAmount;
    await wallet.save();

    // 5. Log the ledger transaction
    const transaction = await Transaction.create({
      walletId: wallet._id,
      userId: user._id,
      type: 'credit_cashback',
      amount: cashbackAmount,
      referenceId: qrcode._id,
      status: 'completed',
      description: `Cashback credited for scanning ${product.name} (SKU: ${product.sku})`,
    });

    // 6. Notify the user
    await Notification.create({
      userId: user._id,
      title: 'Cashback Credited!',
      message: `₹${cashbackAmount} has been instantly credited to your wallet for scanning ${product.name}.`,
      type: 'cashback',
    });

    return res.status(200).json({
      success: true,
      message: 'QR Code scanned successfully. Cashback credited.',
      cashbackCredited: cashbackAmount,
      newWalletBalance: wallet.balance,
      transaction,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Initiate a Withdrawal Request
// @route   POST /api/electrician/withdraw
// @access  Private (Electrician only)
exports.requestWithdrawal = async (req, res) => {
  try {
    const { amount } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ success: false, message: 'Please provide a valid withdrawal amount' });
    }

    const user = await User.findById(req.user.id);
    // Enforce bank details are set
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
      message: `Your request to withdraw ₹${amount} is submitted and is pending admin approval.`,
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

// @desc    Get Cashback/Scan History
// @route   GET /api/electrician/scans
// @access  Private (Electrician only)
exports.getScanHistory = async (req, res) => {
  try {
    const scans = await QRCode.find({ scannedBy: req.user.id, status: 'scanned' })
      .populate('productId', 'name sku category')
      .sort({ scannedAt: -1 });

    return res.status(200).json({ success: true, count: scans.length, scans });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Get Transaction Ledger History
// @route   GET /api/electrician/transactions
// @access  Private (Electrician only)
exports.getTransactions = async (req, res) => {
  try {
    const transactions = await Transaction.find({ userId: req.user.id }).lean();
    const pendingWithdrawals = await Withdrawal.find({ userId: req.user.id, status: 'pending' }).lean();

    const merged = [
      ...transactions,
      ...pendingWithdrawals.map((w) => ({
        _id: w._id,
        type: 'debit_withdrawal',
        amount: w.amount,
        status: 'pending',
        description: 'Withdrawal request pending admin approval',
        createdAt: w.createdAt,
      }))
    ];

    merged.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    return res.status(200).json({ success: true, count: merged.length, transactions: merged });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};
