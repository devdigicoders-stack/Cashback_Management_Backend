const User = require('../models/User');
const Product = require('../models/Product');
const QRCode = require('../models/QRCode');
const Wallet = require('../models/Wallet');
const Transaction = require('../models/Transaction');
const Withdrawal = require('../models/Withdrawal');
const Notification = require('../models/Notification');
const ServiceRequest = require('../models/ServiceRequest');
const AppConfig = require('../models/AppConfig');
const Offer = require('../models/Offer');
const SalesPerson = require('../models/SalesPerson');
const crypto = require('crypto');
const { sendPushNotification, sendBulkPushNotifications } = require('../config/firebase');

// @desc    Get Admin Dashboard Stats
// @route   GET /api/admin/dashboard
// @access  Private (Admin only)
exports.getDashboardStats = async (req, res) => {
  try {
    const totalElectricians = await User.countDocuments({ role: 'electrician' });
    const totalRetailers = await User.countDocuments({ role: 'retailer' });

    const totalActiveElectricians = await User.countDocuments({ role: 'electrician', isActive: true });
    const totalActiveRetailers = await User.countDocuments({ role: 'retailer', isActive: true });

    const pendingWithdrawals = await Withdrawal.countDocuments({ status: 'pending' });

    const pendingAadharKYC = await User.countDocuments({ 'kycStatus.aadhar': 'submitted' });
    const pendingPanKYC = await User.countDocuments({ 'kycStatus.pan': 'submitted' });

    // Total cashback paid is sum of cashbackAmountCredited in scanned QR codes
    const qrsScanned = await QRCode.aggregate([
      { $match: { status: 'scanned' } },
      { $group: { _id: null, totalPaid: { $sum: '$cashbackAmountCredited' } } },
    ]);
    const totalCashbackPaid = qrsScanned.length > 0 ? qrsScanned[0].totalPaid : 0;

    return res.status(200).json({
      success: true,
      stats: {
        totalElectricians,
        totalRetailers,
        totalActiveElectricians,
        totalActiveRetailers,
        pendingWithdrawals,
        pendingKYC: pendingAadharKYC + pendingPanKYC,
        totalCashbackPaid,
      },
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    List all Electricians and Retailers
// @route   GET /api/admin/users
// @access  Private (Admin only)
exports.getUsers = async (req, res) => {
  try {
    const { role, kycStatus } = req.query;
    let query = { role: { $in: ['electrician', 'retailer'] } };

    if (role) {
      query.role = role;
    }
    if (kycStatus) {
      query.$or = [
        { 'kycStatus.aadhar': kycStatus },
        { 'kycStatus.pan': kycStatus },
      ];
    }

    const users = await User.find(query)
      .select('-password')
      .populate('salesPerson', 'name code phone email')
      .sort({ createdAt: -1 });
    return res.status(200).json({ success: true, count: users.length, users });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Get details of a specific user
// @route   GET /api/admin/users/:id
// @access  Private (Admin only)
exports.getUserById = async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
      .select('-password')
      .populate('salesPerson', 'name code phone email city area');
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const wallet = await Wallet.findOne({ userId: user._id });
    const transactions = await Transaction.find({ userId: user._id }).sort({ createdAt: -1 }).limit(10);

    return res.status(200).json({ success: true, user, wallet, transactions });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Approve/Reject Aadhar or PAN Verification
// @route   PUT /api/admin/users/:id/kyc-process
// @access  Private (Admin only)
exports.processKYC = async (req, res) => {
  try {
    const { documentType, action, rejectionReason } = req.body; // documentType: 'aadhar' or 'pan', action: 'approve' or 'reject'

    if (!documentType || !['aadhar', 'pan'].includes(documentType)) {
      return res.status(400).json({ success: false, message: 'Invalid document type. Must be aadhar or pan.' });
    }
    if (!action || !['approve', 'reject'].includes(action)) {
      return res.status(400).json({ success: false, message: 'Invalid action. Must be approve or reject.' });
    }

    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const statusValue = action === 'approve' ? 'approved' : 'rejected';

    if (documentType === 'aadhar') {
      user.kycStatus.aadhar = statusValue;
    } else {
      user.kycStatus.pan = statusValue;
    }

    if (action === 'reject') {
      user.kycDetails.rejectionReason = rejectionReason || 'Documents uploaded are invalid or unclear';
    } else {
      user.kycDetails.rejectionReason = '';
    }

    await user.save();

    // Create a notification for the user
    await Notification.create({
      userId: user._id,
      title: `${documentType.toUpperCase()} KYC ${action === 'approve' ? 'Approved' : 'Rejected'}`,
      message: action === 'approve'
        ? `Your ${documentType.toUpperCase()} has been verified successfully.`
        : `Your ${documentType.toUpperCase()} verification failed. Reason: ${user.kycDetails.rejectionReason}`,
      type: 'kyc',
    });

    if (user.fcmToken) {
      await sendPushNotification(
        user.fcmToken,
        `${documentType.toUpperCase()} KYC ${action === 'approve' ? 'Approved' : 'Rejected'}`,
        action === 'approve'
          ? `Your ${documentType.toUpperCase()} has been verified successfully.`
          : `Your ${documentType.toUpperCase()} verification failed.`
      );
    }

    return res.status(200).json({
      success: true,
      message: `KYC for ${documentType.toUpperCase()} ${action}d successfully.`,
      kycStatus: user.kycStatus,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Add a product with cashback configurations
// @route   POST /api/admin/products
// @access  Private (Admin only)
exports.addProduct = async (req, res) => {
  try {
    const { name, sku, barcode, category, description, size, cashbackConfig } = req.body;

    if (!name || !sku || !barcode || !category) {
      return res.status(400).json({ success: false, message: 'Please provide name, sku, barcode, and category' });
    }

    const productExists = await Product.findOne({ barcode });
    if (productExists) {
      return res.status(400).json({ success: false, message: 'Product Barcode already exists' });
    }

    const product = await Product.create({
      name,
      sku,
      barcode,
      category,
      description,
      size,
      cashbackConfig,
    });

    return res.status(201).json({ success: true, message: 'Product added successfully', product });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Get list of all products
// @route   GET /api/admin/products
// @access  Private (Admin / Users)
exports.getProducts = async (req, res) => {
  try {
    const products = await Product.find({});
    return res.status(200).json({ success: true, count: products.length, products });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Update product details and cashback values
// @route   PUT /api/admin/products/:id
// @access  Private (Admin only)
exports.updateProduct = async (req, res) => {
  try {
    if (req.body.barcode) {
      const existingProduct = await Product.findOne({ barcode: req.body.barcode, _id: { $ne: req.params.id } });
      if (existingProduct) {
        return res.status(400).json({ success: false, message: 'Product Barcode already exists' });
      }
    }

    const product = await Product.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });

    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    return res.status(200).json({ success: true, message: 'Product updated successfully', product });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Delete a product
// @route   DELETE /api/admin/products/:id
// @access  Private (Admin only)
exports.deleteProduct = async (req, res) => {
  try {
    const product = await Product.findByIdAndDelete(req.params.id);

    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    return res.status(200).json({ success: true, message: 'Product deleted successfully' });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Generate batch QR Codes for a product
// @route   POST /api/admin/qrcodes/generate
// @access  Private (Admin only)
exports.generateQRCodes = async (req, res) => {
  try {
    const { productId, count, qrType = 'electrician' } = req.body; // count: number of QR codes to generate

    if (!productId || !count || count <= 0) {
      return res.status(400).json({ success: false, message: 'Please provide productId and a valid count > 0' });
    }
    
    if (!['electrician', 'retailer'].includes(qrType)) {
      return res.status(400).json({ success: false, message: 'Invalid qrType' });
    }

    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    const generatedCodes = [];
    const now = Date.now();

    for (let i = 0; i < count; i++) {
      // Create a unique hash format code: SKU-timestamp-randomHex
      const randomHex = crypto.randomBytes(6).toString('hex').toUpperCase();
      const codeString = `${product.sku}-${now}-${randomHex}`;

      generatedCodes.push({
        code: codeString,
        productId: product._id,
        qrType: qrType,
        status: 'generated',
        generatedBy: req.user._id,
      });
    }

    const qrcodes = await QRCode.insertMany(generatedCodes);

    return res.status(201).json({
      success: true,
      message: `Successfully generated ${count} QR codes for product ${product.name}`,
      count: qrcodes.length,
      qrcodes: qrcodes.map((qr) => ({ id: qr._id, code: qr.code, status: qr.status, qrType: qr.qrType })),
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Get QR Codes list with filters & reports
// @route   GET /api/admin/qrcodes
// @access  Private (Admin only)
exports.getQRCodes = async (req, res) => {
  try {
    const { status, productId, qrType, startDate, endDate, search } = req.query;
    let filter = {};

    if (status && status !== 'all') filter.status = status;
    if (productId && productId !== 'all') filter.productId = productId;
    if (qrType && qrType !== 'all') filter.qrType = qrType;

    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) {
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        filter.createdAt.$gte = start;
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        filter.createdAt.$lte = end;
      }
    }

    let qrcodes = await QRCode.find(filter)
      .populate('productId', 'name sku category points cashbackAmount')
      .populate('scannedBy', 'name phone role')
      .sort({ createdAt: -1 });

    if (search) {
      const q = search.toLowerCase();
      qrcodes = qrcodes.filter((qr) => {
        const code = qr.code?.toLowerCase() || '';
        const prodName = qr.productId?.name?.toLowerCase() || '';
        const prodSku = qr.productId?.sku?.toLowerCase() || '';
        const scannerName = qr.scannedBy?.name?.toLowerCase() || '';
        const scannerPhone = qr.scannedBy?.phone || '';
        return (
          code.includes(q) ||
          prodName.includes(q) ||
          prodSku.includes(q) ||
          scannerName.includes(q) ||
          scannerPhone.includes(q)
        );
      });
    }

    // Compute Summary Stats
    const allQrs = await QRCode.find({});
    const summary = {
      totalCount: allQrs.length,
      scannedCount: allQrs.filter((q) => q.status === 'scanned').length,
      generatedCount: allQrs.filter((q) => q.status === 'generated').length,
      totalCashbackDisbursed: allQrs
        .filter((q) => q.status === 'scanned')
        .reduce((sum, q) => sum + (q.cashbackAmountCredited || 0), 0),
    };

    return res.status(200).json({
      success: true,
      count: qrcodes.length,
      summary,
      qrcodes,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Get all Withdrawal Requests
// @route   GET /api/admin/withdrawals
// @access  Private (Admin only)
exports.getWithdrawals = async (req, res) => {
  try {
    const { status, startDate, endDate, search } = req.query;
    let query = {};

    if (status && status !== 'all') {
      query.status = status;
    }

    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) {
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        query.createdAt.$gte = start;
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        query.createdAt.$lte = end;
      }
    }

    let withdrawals = await Withdrawal.find(query)
      .populate('userId', 'name phone email role firmName bankDetails salesCode salesPerson')
      .populate('approvedOrRejectedBy', 'name phone role')
      .sort({ createdAt: -1 });

    if (search) {
      const q = search.toLowerCase();
      withdrawals = withdrawals.filter((w) => {
        const userName = w.userId?.name?.toLowerCase() || '';
        const userPhone = w.userId?.phone || '';
        const bankName = w.bankSnapshot?.bankName?.toLowerCase() || '';
        const accHolder = w.bankSnapshot?.accountHolderName?.toLowerCase() || '';
        const accNo = w.bankSnapshot?.accountNumber || '';
        const ifsc = w.bankSnapshot?.ifscCode?.toLowerCase() || '';
        const txnNo = w.transactionNumber?.toLowerCase() || '';
        return (
          userName.includes(q) ||
          userPhone.includes(q) ||
          bankName.includes(q) ||
          accHolder.includes(q) ||
          accNo.includes(q) ||
          ifsc.includes(q) ||
          txnNo.includes(q)
        );
      });
    }

    // Compute Summary Stats
    const allWithdrawals = await Withdrawal.find({});
    const summary = {
      totalCount: allWithdrawals.length,
      totalAmount: allWithdrawals.reduce((sum, w) => sum + (w.amount || 0), 0),
      pendingCount: allWithdrawals.filter((w) => w.status === 'pending').length,
      pendingAmount: allWithdrawals
        .filter((w) => w.status === 'pending')
        .reduce((sum, w) => sum + (w.amount || 0), 0),
      processingCount: allWithdrawals.filter((w) => w.status === 'processing').length,
      processingAmount: allWithdrawals
        .filter((w) => w.status === 'processing')
        .reduce((sum, w) => sum + (w.amount || 0), 0),
      approvedCount: allWithdrawals.filter((w) => w.status === 'approved').length,
      approvedAmount: allWithdrawals
        .filter((w) => w.status === 'approved')
        .reduce((sum, w) => sum + (w.amount || 0), 0),
      rejectedCount: allWithdrawals.filter((w) => w.status === 'rejected').length,
      rejectedAmount: allWithdrawals
        .filter((w) => w.status === 'rejected')
        .reduce((sum, w) => sum + (w.amount || 0), 0),
    };

    return res.status(200).json({
      success: true,
      count: withdrawals.length,
      summary,
      withdrawals,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Bulk Mark Payouts as Processing (Download RTGS / In-Process)
// @route   POST /api/admin/withdrawals/bulk-processing
// @access  Private (Admin only)
exports.bulkProcessWithdrawals = async (req, res) => {
  try {
    const { withdrawalIds } = req.body;
    if (!withdrawalIds || !Array.isArray(withdrawalIds) || withdrawalIds.length === 0) {
      return res.status(400).json({ success: false, message: 'No withdrawal IDs provided' });
    }

    const withdrawals = await Withdrawal.find({
      _id: { $in: withdrawalIds },
      status: 'pending',
    });

    if (withdrawals.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No eligible pending withdrawals found to mark as processing',
      });
    }

    const updatedIds = [];
    for (const w of withdrawals) {
      w.status = 'processing';
      w.processingDate = new Date();
      w.approvedOrRejectedBy = req.user._id;
      await w.save();
      updatedIds.push(w._id);

      // Send User in-app notification
      try {
        await Notification.create({
          userId: w.userId,
          title: 'Withdrawal In Bank Processing',
          message: `Your withdrawal request of ₹${w.amount} has been queued for bank RTGS/NEFT transfer.`,
          type: 'withdrawal',
        });

        const user = await User.findById(w.userId);
        if (user && user.fcmToken) {
          await sendPushNotification(
            user.fcmToken,
            'Withdrawal In Process',
            `Your payout of ₹${w.amount} is currently being processed by the bank via RTGS/NEFT.`
          );
        }
      } catch (notifyErr) {
        console.error('Notification error in bulk processing:', notifyErr);
      }
    }

    return res.status(200).json({
      success: true,
      message: `Successfully marked ${updatedIds.length} payout(s) as processing`,
      processedCount: updatedIds.length,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: 'Server error during bulk processing' });
  }
};

// @desc    Process Withdrawal Request (Approve/Complete or Reject)
// @route   PUT /api/admin/withdrawals/:id/process
// @access  Private (Admin only)
exports.processWithdrawal = async (req, res) => {
  try {
    const { action, adminRemarks, transactionNumber } = req.body; // action: 'approve' | 'complete' | 'reject'

    if (!action || !['approve', 'complete', 'reject'].includes(action)) {
      return res.status(400).json({ success: false, message: 'Invalid action. Must be approve, complete, or reject.' });
    }

    const withdrawal = await Withdrawal.findById(req.params.id);
    if (!withdrawal) {
      return res.status(404).json({ success: false, message: 'Withdrawal request not found' });
    }

    if (withdrawal.status === 'approved' || withdrawal.status === 'rejected') {
      return res.status(400).json({ success: false, message: 'Withdrawal request has already been finalized' });
    }

    const wallet = await Wallet.findOne({ userId: withdrawal.userId });
    if (!wallet) {
      return res.status(404).json({ success: false, message: 'Wallet not found for the user' });
    }

    if (action === 'approve' || action === 'complete') {
      // Validate wallet balance
      if (wallet.balance < withdrawal.amount) {
        return res.status(400).json({ success: false, message: 'Insufficient wallet balance' });
      }

      // Deduct from wallet
      wallet.balance -= withdrawal.amount;
      await wallet.save();

      const txnNo = transactionNumber?.trim() || '';

      // Log transaction
      await Transaction.create({
        walletId: wallet._id,
        userId: withdrawal.userId,
        type: 'debit_withdrawal',
        amount: withdrawal.amount,
        referenceId: withdrawal._id,
        status: 'completed',
        description: `Withdrawal transfer to bank completed. ${txnNo ? `Ref/UTR: ${txnNo}` : ''}`,
      });

      withdrawal.status = 'approved';
      withdrawal.transactionNumber = txnNo;
    } else {
      withdrawal.status = 'rejected';
    }

    withdrawal.adminRemarks = adminRemarks || (withdrawal.status === 'approved' ? 'Payment processed successfully' : 'Withdrawal request rejected');
    withdrawal.approvedOrRejectedBy = req.user._id;
    withdrawal.processedAt = Date.now();
    await withdrawal.save();

    // Notify user
    const isApproved = withdrawal.status === 'approved';
    const txnNote = withdrawal.transactionNumber ? ` (UTR/Ref No: ${withdrawal.transactionNumber})` : '';

    await Notification.create({
      userId: withdrawal.userId,
      title: `Withdrawal ${isApproved ? 'Paid & Completed' : 'Rejected'}`,
      message: isApproved
        ? `Your withdrawal of ₹${withdrawal.amount} has been successfully transferred to your bank account${txnNote}.`
        : `Your request for withdrawal of ₹${withdrawal.amount} was rejected. Reason: ${withdrawal.adminRemarks}`,
      type: 'withdrawal',
    });

    const user = await User.findById(withdrawal.userId);
    if (user && user.fcmToken) {
      await sendPushNotification(
        user.fcmToken,
        `Withdrawal ${isApproved ? 'Completed' : 'Rejected'}`,
        isApproved
          ? `Your withdrawal of ₹${withdrawal.amount} is completed${txnNote}.`
          : `Your withdrawal of ₹${withdrawal.amount} was rejected.`
      );
    }

    return res.status(200).json({
      success: true,
      message: `Withdrawal ${isApproved ? 'completed' : 'rejected'} successfully`,
      withdrawal,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Update Website Content / App configuration
// @route   PUT /api/admin/app-config
// @access  Private (Admin only)
exports.updateAppConfig = async (req, res) => {
  try {
    let config = await AppConfig.findOne({});
    if (!config) {
      config = new AppConfig();
    }

    const { privacyPolicy, termsAndConditions, aboutUs, faq, contactPhone, contactEmail, rateUsUrl, shareAppText } = req.body;

    if (privacyPolicy) config.privacyPolicy = privacyPolicy;
    if (termsAndConditions) config.termsAndConditions = termsAndConditions;
    if (aboutUs) config.aboutUs = aboutUs;
    if (faq) config.faq = faq;
    if (contactPhone) config.contactPhone = contactPhone;
    if (contactEmail) config.contactEmail = contactEmail;
    if (rateUsUrl) config.rateUsUrl = rateUsUrl;
    if (shareAppText) config.shareAppText = shareAppText;

    await config.save();

    return res.status(200).json({ success: true, message: 'Website content and app config updated successfully', config });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    List all Service Requests / Help tickets
// @route   GET /api/admin/service-requests
// @access  Private (Admin only)
exports.getServiceRequestsAdmin = async (req, res) => {
  try {
    const requests = await ServiceRequest.find({})
      .populate('userId', 'name phone role')
      .sort({ createdAt: -1 });

    return res.status(200).json({ success: true, count: requests.length, requests });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Process Service Request / support ticket (update status and remarks)
// @route   PUT /api/admin/service-requests/:id
// @access  Private (Admin only)
exports.updateServiceRequestAdmin = async (req, res) => {
  try {
    const { status, adminRemarks } = req.body;

    if (!status || !['pending', 'in-progress', 'resolved'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' });
    }

    const request = await ServiceRequest.findById(req.params.id);
    if (!request) {
      return res.status(404).json({ success: false, message: 'Service request not found' });
    }

    request.status = status;
    request.adminRemarks = adminRemarks || '';
    await request.save();

    // Create a notification for the user about ticket resolution
    await Notification.create({
      userId: request.userId,
      title: `Support Request: ${status.toUpperCase()}`,
      message: `Your ticket "${request.title}" is now ${status}. Remarks: ${request.adminRemarks}`,
      type: 'general',
    });

    const user = await User.findById(request.userId);
    if (user && user.fcmToken) {
      await sendPushNotification(
        user.fcmToken,
        `Support Request Update`,
        `Your ticket "${request.title}" is now ${status}.`
      );
    }

    return res.status(200).json({ success: true, message: 'Service request updated successfully', request });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Send bulk notifications
// @route   POST /api/admin/notifications/bulk
// @access  Private (Admin only)
exports.sendBulkNotification = async (req, res) => {
  try {
    const { targetRole, title, message } = req.body; // targetRole: 'electrician', 'retailer', or 'all'

    if (!title || !message) {
      return res.status(400).json({ success: false, message: 'Please provide notification title and message' });
    }

    let filter = {};
    if (targetRole && ['electrician', 'retailer'].includes(targetRole)) {
      filter.role = targetRole;
    } else {
      filter.role = { $in: ['electrician', 'retailer'] };
    }

    const users = await User.find(filter).select('_id fcmToken');
    const notificationsToInsert = users.map((user) => ({
      userId: user._id,
      title,
      message,
      type: 'general',
    }));

    await Notification.insertMany(notificationsToInsert);

    const tokens = users.map(user => user.fcmToken).filter(token => token && token.trim() !== '');
    if (tokens.length > 0) {
      await sendBulkPushNotifications(tokens, title, message);
    }

    return res.status(200).json({
      success: true,
      message: `Bulk notification sent to ${users.length} users successfully`,
      count: users.length,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Get sent bulk notifications history
// @route   GET /api/admin/notifications
// @access  Private (Admin only)
exports.getNotificationsHistoryAdmin = async (req, res) => {
  try {
    const history = await Notification.aggregate([
      { $match: { type: 'general' } },
      {
        $group: {
          _id: { title: '$title', message: '$message' },
          count: { $sum: 1 },
          createdAt: { $max: '$createdAt' }
        }
      },
      {
        $project: {
          _id: 0,
          title: '$_id.title',
          message: '$_id.message',
          recipientsCount: '$count',
          sentAt: '$createdAt'
        }
      },
      { $sort: { sentAt: -1 } }
    ]);

    return res.status(200).json({ success: true, count: history.length, history });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Delete a bulk notification (broadcast)
// @route   DELETE /api/admin/notifications/bulk
// @access  Private (Admin only)
exports.deleteBulkNotification = async (req, res) => {
  try {
    const { title, message } = req.body;

    if (!title || !message) {
      return res.status(400).json({ success: false, message: 'Title and message are required' });
    }

    // Delete all matching general notifications
    const result = await Notification.deleteMany({ title, message, type: 'general' });

    if (result.deletedCount === 0) {
      return res.status(404).json({ success: false, message: 'No matching notifications found' });
    }

    return res.status(200).json({ 
      success: true, 
      message: `Successfully deleted ${result.deletedCount} notifications` 
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Get Detailed Analytic Reports
// @route   GET /api/admin/reports
// @access  Private (Admin only)
exports.getReportsAdmin = async (req, res) => {
  try {
    // 1. User registration statistics
    const userStats = await User.aggregate([
      { $group: { _id: '$role', count: { $sum: 1 } } },
    ]);

    // 2. Scan statistics
    const scanStats = await QRCode.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          totalCashback: { $sum: '$cashbackAmountCredited' },
        },
      },
    ]);

    // 3. Recent high-value transactions
    const recentTransactions = await Transaction.find({})
      .populate('userId', 'name phone role')
      .sort({ createdAt: -1 })
      .limit(10);

    return res.status(200).json({
      success: true,
      reports: {
        userDistribution: userStats,
        scanPerformance: scanStats,
        recentTransactions,
      },
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Add a promotional offer / scheme
// @route   POST /api/admin/offers
// @access  Private (Admin only)
exports.addOffer = async (req, res) => {
  try {
    const { title, description, bannerUrl, validUntil } = req.body;

    if (!title || !description) {
      return res.status(400).json({ success: false, message: 'Please provide title and description' });
    }

    const offer = await Offer.create({
      title,
      description,
      bannerUrl,
      validUntil,
    });

    return res.status(201).json({ success: true, message: 'Offer/Scheme created successfully', offer });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Get all offers (Admin)
// @route   GET /api/admin/offers
// @access  Private (Admin only)
exports.getOffersAdmin = async (req, res) => {
  try {
    const offers = await Offer.find({}).sort({ createdAt: -1 });
    return res.status(200).json({ success: true, count: offers.length, offers });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Update an offer
// @route   PUT /api/admin/offers/:id
// @access  Private (Admin only)
exports.updateOffer = async (req, res) => {
  try {
    const offer = await Offer.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });

    if (!offer) {
      return res.status(404).json({ success: false, message: 'Offer not found' });
    }

    return res.status(200).json({ success: true, message: 'Offer updated successfully', offer });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Delete an offer
// @route   DELETE /api/admin/offers/:id
// @access  Private (Admin only)
exports.deleteOffer = async (req, res) => {
  try {
    const offer = await Offer.findByIdAndDelete(req.params.id);

    if (!offer) {
      return res.status(404).json({ success: false, message: 'Offer not found' });
    }

    return res.status(200).json({ success: true, message: 'Offer deleted successfully' });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Get detailed cashback summary reports (scans grouped by product/category)
// @route   GET /api/admin/cashback-summary
// @access  Private (Admin only)
exports.getCashbackSummary = async (req, res) => {
  try {
    const summary = await QRCode.aggregate([
      { $match: { status: 'scanned' } },
      {
        $group: {
          _id: '$productId',
          totalScans: { $sum: 1 },
          totalCashbackPaid: { $sum: '$cashbackAmountCredited' },
        },
      },
      {
        $lookup: {
          from: 'products',
          localField: '_id',
          foreignField: '_id',
          as: 'productDetails',
        },
      },
      { $unwind: '$productDetails' },
      {
        $project: {
          productId: '$_id',
          totalScans: 1,
          totalCashbackPaid: 1,
          name: '$productDetails.name',
          sku: '$productDetails.sku',
          category: '$productDetails.category',
        },
      },
    ]);

    return res.status(200).json({ success: true, summary });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Get all cashback transaction ledgers
// @route   GET /api/admin/cashback-transactions
// @access  Private (Admin only)
exports.getCashbackTransactions = async (req, res) => {
  try {
    const transactions = await Transaction.find({ type: 'credit_cashback' })
      .populate('userId', 'name phone role')
      .sort({ createdAt: -1 });
    return res.status(200).json({ success: true, count: transactions.length, transactions });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Get App Config
// @route   GET /api/admin/app-config
// @access  Private (Admin only)
exports.getAppConfig = async (req, res) => {
  try {
    let config = await AppConfig.findOne();
    if (!config) {
      config = await AppConfig.create({}); // create default if not exists
    }
    return res.status(200).json({ success: true, config });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Update App Config
// @route   PUT /api/admin/app-config
// @access  Private (Admin only)
exports.updateAppConfig = async (req, res) => {
  try {
    const { 
      privacyPolicy, termsAndConditions, aboutUs, contactPhone, 
      contactEmail, rateUsUrl, shareAppText 
    } = req.body;

    let config = await AppConfig.findOne();
    if (!config) {
      config = new AppConfig({});
    }

    if (privacyPolicy !== undefined) config.privacyPolicy = privacyPolicy;
    if (termsAndConditions !== undefined) config.termsAndConditions = termsAndConditions;
    if (aboutUs !== undefined) config.aboutUs = aboutUs;
    if (contactPhone !== undefined) config.contactPhone = contactPhone;
    if (contactEmail !== undefined) config.contactEmail = contactEmail;
    if (rateUsUrl !== undefined) config.rateUsUrl = rateUsUrl;
    if (shareAppText !== undefined) config.shareAppText = shareAppText;

    await config.save();
    return res.status(200).json({ success: true, message: 'App configuration updated successfully', config });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Register a new Admin/Sub-Admin
// @route   POST /api/admin/register
// @access  Private (Admin only)
exports.registerAdmin = async (req, res) => {
  try {
    const { name, phone, email, password, role } = req.body;

    if (!name || !phone || !password) {
      return res.status(400).json({ success: false, message: 'Please provide name, phone, and password' });
    }

    const assignedRole = role === 'sub-admin' ? 'sub-admin' : 'admin';

    const userExists = await User.findOne({ phone });
    if (userExists) {
      return res.status(400).json({ success: false, message: 'Phone number already registered' });
    }

    const user = await User.create({
      name,
      phone,
      email,
      password,
      role: assignedRole,
    });

    return res.status(201).json({
      success: true,
      message: `${assignedRole === 'admin' ? 'Admin' : 'Sub-Admin'} registered successfully`,
      user: {
        id: user._id,
        name: user.name,
        phone: user.phone,
        role: user.role,
      },
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Update basic user details (Admin)
// @route   PUT /api/admin/users/:id
// @access  Private (Admin only)
exports.updateUserDetails = async (req, res) => {
  try {
    const { name, email, phone, firmName } = req.body;
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (name) user.name = name;
    if (email !== undefined) user.email = email;
    if (phone) user.phone = phone;
    if (firmName !== undefined) user.firmName = firmName;

    await user.save();
    return res.status(200).json({ success: true, message: 'User details updated successfully', user });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Update user active status (Admin)
// @route   PUT /api/admin/users/:id/status
// @access  Private (Admin only)
exports.updateUserStatus = async (req, res) => {
  try {
    const { isActive } = req.body;
    
    if (isActive === undefined) {
      return res.status(400).json({ success: false, message: 'isActive field is required' });
    }

    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    user.isActive = isActive;
    await user.save();

    return res.status(200).json({ success: true, message: `User account is now ${isActive ? 'active' : 'inactive'}` });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Delete a user completely
// @route   DELETE /api/admin/users/:id
// @access  Private (Admin only)
exports.deleteUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Delete the associated wallet
    await Wallet.findOneAndDelete({ userId: user._id });

    // Delete the user
    await User.findByIdAndDelete(req.params.id);

    return res.status(200).json({ success: true, message: 'User and wallet deleted successfully' });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Upload KYC documents for a user (Admin)
// @route   PUT /api/admin/users/:id/kyc
// @access  Private (Admin only)
exports.uploadUserKYC = async (req, res) => {
  try {
    const { documentType, aadharNumber, panNumber } = req.body;
    
    if (!documentType || !['aadhar', 'pan'].includes(documentType)) {
      return res.status(400).json({ success: false, message: 'Invalid document type. Must be aadhar or pan.' });
    }

    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (documentType === 'aadhar') {
      if (!req.files || !req.files.aadharFront || !req.files.aadharBack) {
        return res.status(400).json({ success: false, message: 'Both Aadhar Front and Back images are required' });
      }
      user.kycDetails = {
        ...user.kycDetails,
        aadharNumber: aadharNumber || user.kycDetails?.aadharNumber,
        aadharFrontUrl: `/uploads/${req.files.aadharFront[0].filename}`,
        aadharBackUrl: `/uploads/${req.files.aadharBack[0].filename}`
      };
      user.kycStatus.aadhar = 'approved';
    } else if (documentType === 'pan') {
      if (!req.files || !req.files.panCard) {
        return res.status(400).json({ success: false, message: 'PAN card image is required' });
      }
      user.kycDetails = {
        ...user.kycDetails,
        panNumber: panNumber || user.kycDetails?.panNumber,
        panCardUrl: `/uploads/${req.files.panCard[0].filename}`
      };
      user.kycStatus.pan = 'approved';
    }

    user.kycDetails.rejectionReason = '';
    await user.save();

    return res.status(200).json({
      success: true,
      message: `${documentType.toUpperCase()} KYC uploaded and approved successfully`,
      kycStatus: user.kycStatus,
      kycDetails: user.kycDetails,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Bulk Update Products (cashback amounts, isActive status, category)
// @route   PUT /api/admin/products/bulk-update
// @access  Private (Admin only)
exports.bulkUpdateProducts = async (req, res) => {
  try {
    const { productIds, updateData } = req.body;

    if (!productIds || !Array.isArray(productIds) || productIds.length === 0) {
      return res.status(400).json({ success: false, message: 'Please provide an array of product IDs' });
    }

    if (!updateData || typeof updateData !== 'object') {
      return res.status(400).json({ success: false, message: 'Please provide update data fields' });
    }

    const fieldsToUpdate = {};
    if (typeof updateData.isActive === 'boolean') {
      fieldsToUpdate.isActive = updateData.isActive;
    }
    if (updateData.category) {
      fieldsToUpdate.category = updateData.category;
    }
    if (updateData.electricianAmount !== undefined || updateData.retailerAmount !== undefined) {
      if (updateData.electricianAmount !== undefined) {
        fieldsToUpdate['cashbackConfig.electricianAmount'] = Number(updateData.electricianAmount);
      }
      if (updateData.retailerAmount !== undefined) {
        fieldsToUpdate['cashbackConfig.retailerAmount'] = Number(updateData.retailerAmount);
      }
    }

    if (Object.keys(fieldsToUpdate).length === 0) {
      return res.status(400).json({ success: false, message: 'No valid fields provided for bulk update' });
    }

    const result = await Product.updateMany(
      { _id: { $in: productIds } },
      { $set: fieldsToUpdate }
    );

    return res.status(200).json({
      success: true,
      message: `Successfully updated ${result.modifiedCount} products`,
      modifiedCount: result.modifiedCount,
    });
  } catch (error) {
    console.error('Bulk update error:', error);
    return res.status(500).json({ success: false, message: 'Server error during bulk update' });
  }
};

// @desc    Bulk Add / Import Products
// @route   POST /api/admin/products/bulk
// @access  Private (Admin only)
exports.bulkAddProducts = async (req, res) => {
  try {
    const { products } = req.body; // Array of product objects

    if (!products || !Array.isArray(products) || products.length === 0) {
      return res.status(400).json({ success: false, message: 'Please provide an array of products to add' });
    }

    let addedCount = 0;
    let skippedCount = 0;
    const errors = [];

    for (const prodData of products) {
      const { name, sku, barcode, category, description, size, electricianAmount, retailerAmount, isActive } = prodData;

      if (!name || !sku || !barcode || !category) {
        skippedCount++;
        errors.push(`Skipped "${name || 'Unnamed'}": Missing required fields`);
        continue;
      }

      const existing = await Product.findOne({ barcode });
      if (existing) {
        skippedCount++;
        errors.push(`Skipped "${name}": Barcode ${barcode} already exists`);
        continue;
      }

      await Product.create({
        name,
        sku,
        barcode,
        category,
        description: description || '',
        size: size || '',
        cashbackConfig: {
          electricianAmount: Number(electricianAmount) || 0,
          retailerAmount: Number(retailerAmount) || 0,
        },
        isActive: isActive !== undefined ? Boolean(isActive) : true,
      });

      addedCount++;
    }

    return res.status(201).json({
      success: true,
      message: `Added ${addedCount} products successfully. ${skippedCount > 0 ? `Skipped ${skippedCount} items.` : ''}`,
      addedCount,
      skippedCount,
      errors,
    });
  } catch (error) {
    console.error('Bulk add error:', error);
    return res.status(500).json({ success: false, message: 'Server error during bulk creation' });
  }
};

