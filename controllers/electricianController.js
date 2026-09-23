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

    // 1. Enforce KYC verification (PAN is optional for Electrician, only Aadhar is mandatory)
    const user = await User.findById(req.user.id);
    if (user.kycStatus.aadhar !== 'approved') {
      return res.status(400).json({
        success: false,
        message: 'Your Aadhaar KYC verification is pending. Please wait for admin approval to scan and redeem cashback.',
        kycStatus: user.kycStatus,
      });
    }

    const trimmedCode = code.trim();

    // 2. Fetch the QR Code details (supports full code, shortCode, or end suffix)
    const initialQR = await QRCode.findOne({
      $or: [
        { code: trimmedCode },
        { shortCode: trimmedCode.toUpperCase() },
        { code: { $regex: `${trimmedCode}$`, $options: 'i' } }
      ]
    });

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
      { _id: initialQR._id, status: 'generated' }, // Must still be 'generated'
      {
        status: 'scanned',
        scannedBy: user._id,
        scannedAt: Date.now(),
        cashbackAmountCredited: cashbackAmount,
      },
      { new: true }
    );

    if (!qrcode) {
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

    // 6. Automatically queue payout into Admin's Pending Transfer list (Point 10)
    let pendingWithdrawal = await Withdrawal.findOne({
      userId: user._id,
      status: 'pending',
    });

    const bankSnap = {
      accountHolderName: user.bankDetails?.accountHolderName || user.name,
      accountNumber: user.bankDetails?.accountNumber || 'Pending Details',
      ifscCode: user.bankDetails?.ifscCode || 'Pending',
      bankName: user.bankDetails?.bankName || 'Pending',
    };

    if (pendingWithdrawal) {
      pendingWithdrawal.amount += cashbackAmount;
      if (user.bankDetails?.accountNumber) {
        pendingWithdrawal.bankSnapshot = bankSnap;
      }
      await pendingWithdrawal.save();
    } else {
      pendingWithdrawal = await Withdrawal.create({
        userId: user._id,
        amount: cashbackAmount,
        bankSnapshot: bankSnap,
        status: 'pending',
        adminRemarks: 'Automated payout queued from product scans (Monthly payout: 1st–10th)',
      });
    }

    // 7. Notify the user
    await Notification.create({
      userId: user._id,
      title: 'Cashback Credited!',
      message: `₹${cashbackAmount} has been credited for scanning ${product.name}. Payout is queued for transfer to your bank between 1st–10th.`,
      type: 'cashback',
    });

    return res.status(200).json({
      success: true,
      message: 'QR Code scanned successfully. Cashback queued for bank transfer.',
      cashbackCredited: cashbackAmount,
      newWalletBalance: wallet.balance,
      transaction,
      pendingWithdrawalId: pendingWithdrawal._id,
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

    // Check outstanding pending/processing withdrawals so user doesn't withdraw same balance twice
    const pendingWithdrawalsList = await Withdrawal.find({ userId: user._id, status: { $in: ['pending', 'processing'] } });
    const totalPendingAmount = pendingWithdrawalsList.reduce((acc, curr) => acc + curr.amount, 0);

    if (wallet.balance - totalPendingAmount < amount) {
      return res.status(400).json({
        success: false,
        message: `Insufficient available balance. Current Wallet: ₹${wallet.balance}, In-Process/Pending: ₹${totalPendingAmount}, Available: ₹${wallet.balance - totalPendingAmount}`,
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
      title: 'Payout Queued',
      message: `Your payout of ₹${amount} is queued and will be credited to your bank account between the 1st and 10th of the month.`,
      type: 'withdrawal',
    });

    return res.status(201).json({
      success: true,
      message: 'Payouts are automatically queued upon QR scan and credited between the 1st and 10th of the month.',
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
    const transactions = (await Transaction.find({ userId: req.user.id }).lean()).map((t) => ({
      ...t,
      transactionNumber: t.transactionNumber || '',
    }));
    const activeWithdrawals = await Withdrawal.find({ userId: req.user.id, status: { $in: ['pending', 'processing'] } }).lean();

    const merged = [
      ...transactions,
      ...activeWithdrawals.map((w) => ({
        _id: w._id,
        type: 'debit_withdrawal',
        amount: w.amount,
        status: w.status,
        description: w.status === 'processing'
          ? 'Payment in process (Bank RTGS/NEFT transfer queued)'
          : 'Payout queued - Pending Bank Transfer (Credit: 1st–10th)',
        createdAt: w.createdAt,
        transactionNumber: w.transactionNumber || '',
      }))
    ];

    merged.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    return res.status(200).json({ success: true, count: merged.length, transactions: merged });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};
