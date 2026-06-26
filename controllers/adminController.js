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
const crypto = require('crypto');

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

    const users = await User.find(query).select('-password');
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
    const user = await User.findById(req.params.id).select('-password');
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
    const { name, sku, category, description, cashbackConfig } = req.body;

    if (!name || !sku || !category) {
      return res.status(400).json({ success: false, message: 'Please provide name, sku, and category' });
    }

    const productExists = await Product.findOne({ sku });
    if (productExists) {
      return res.status(400).json({ success: false, message: 'Product SKU already exists' });
    }

    const product = await Product.create({
      name,
      sku,
      category,
      description,
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
    const { productId, count } = req.body; // count: number of QR codes to generate

    if (!productId || !count || count <= 0) {
      return res.status(400).json({ success: false, message: 'Please provide productId and a valid count > 0' });
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
        status: 'generated',
        generatedBy: req.user._id,
      });
    }

    const qrcodes = await QRCode.insertMany(generatedCodes);

    return res.status(201).json({
      success: true,
      message: `Successfully generated ${count} QR codes for product ${product.name}`,
      count: qrcodes.length,
      qrcodes: qrcodes.map((qr) => ({ id: qr._id, code: qr.code, status: qr.status })),
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Get QR Codes list with filters
// @route   GET /api/admin/qrcodes
// @access  Private (Admin only)
exports.getQRCodes = async (req, res) => {
  try {
    const { status, productId } = req.query;
    let filter = {};

    if (status) filter.status = status;
    if (productId) filter.productId = productId;

    const qrcodes = await QRCode.find(filter)
      .populate('productId', 'name sku category')
      .populate('scannedBy', 'name phone')
      .sort({ createdAt: -1 });

    return res.status(200).json({ success: true, count: qrcodes.length, qrcodes });
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
    const { status } = req.query;
    let query = {};
    if (status) {
      query.status = status;
    }

    const withdrawals = await Withdrawal.find(query)
      .populate('userId', 'name phone role')
      .sort({ createdAt: -1 });

    return res.status(200).json({ success: true, count: withdrawals.length, withdrawals });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Process Withdrawal Request (Approve/Reject)
// @route   PUT /api/admin/withdrawals/:id/process
// @access  Private (Admin only)
exports.processWithdrawal = async (req, res) => {
  try {
    const { action, adminRemarks } = req.body; // action: 'approve' or 'reject'

    if (!action || !['approve', 'reject'].includes(action)) {
      return res.status(400).json({ success: false, message: 'Invalid action. Must be approve or reject.' });
    }

    const withdrawal = await Withdrawal.findById(req.params.id);
    if (!withdrawal) {
      return res.status(404).json({ success: false, message: 'Withdrawal request not found' });
    }

    if (withdrawal.status !== 'pending') {
      return res.status(400).json({ success: false, message: 'Withdrawal request has already been processed' });
    }

    const wallet = await Wallet.findOne({ userId: withdrawal.userId });
    if (!wallet) {
      return res.status(404).json({ success: false, message: 'Wallet not found for the user' });
    }

    if (action === 'approve') {
      // Validate wallet balance again
      if (wallet.balance < withdrawal.amount) {
        return res.status(400).json({ success: false, message: 'Insufficient wallet balance' });
      }

      // Deduct from wallet
      wallet.balance -= withdrawal.amount;
      await wallet.save();

      // Log transaction
      await Transaction.create({
        walletId: wallet._id,
        userId: withdrawal.userId,
        type: 'debit_withdrawal',
        amount: withdrawal.amount,
        referenceId: withdrawal._id,
        status: 'completed',
        description: `Withdrawal transfer to bank approved`,
      });

      withdrawal.status = 'approved';
    } else {
      withdrawal.status = 'rejected';
    }

    withdrawal.adminRemarks = adminRemarks || `Withdrawal request ${action}d`;
    withdrawal.approvedOrRejectedBy = req.user._id;
    withdrawal.processedAt = Date.now();
    await withdrawal.save();

    // Notify user
    await Notification.create({
      userId: withdrawal.userId,
      title: `Withdrawal Request ${action === 'approve' ? 'Approved' : 'Rejected'}`,
      message: action === 'approve'
        ? `Your request for withdrawal of ₹${withdrawal.amount} has been successfully processed.`
        : `Your request for withdrawal of ₹${withdrawal.amount} was rejected. Reason: ${withdrawal.adminRemarks}`,
      type: 'withdrawal',
    });

    return res.status(200).json({
      success: true,
      message: `Withdrawal request ${action}d successfully`,
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

    const users = await User.find(filter).select('_id');
    const notificationsToInsert = users.map((user) => ({
      userId: user._id,
      title,
      message,
      type: 'general',
    }));

    await Notification.insertMany(notificationsToInsert);

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
