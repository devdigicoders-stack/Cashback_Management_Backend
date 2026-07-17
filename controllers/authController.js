const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Wallet = require('../models/Wallet');
const Notification = require('../models/Notification');
const ServiceRequest = require('../models/ServiceRequest');
const AppConfig = require('../models/AppConfig');

// Generate JWT Token
const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: '30d',
  });
};

// @desc    Register a new user (Electrician / Retailer)
// @route   POST /api/auth/register
// @access  Public
exports.register = async (req, res) => {
  try {
    let { name, phone, email, password, role, shopDetails, firmName } = req.body;

    if (!name || !phone || !password) {
      return res.status(400).json({ success: false, message: 'Please provide name, phone, and password' });
    }

    // Since formData sends values as strings, we parse shopDetails if it's a string
    if (typeof shopDetails === 'string') {
      try {
        shopDetails = JSON.parse(shopDetails);
      } catch (e) {
        console.error('Failed to parse shopDetails:', e);
      }
    }

    // Verify role is not admin/sub-admin on public registration
    if (role && ['admin', 'sub-admin'].includes(role)) {
      return res.status(400).json({ success: false, message: 'Admin accounts cannot be registered publicly' });
    }

    const userExists = await User.findOne({ phone });
    if (userExists) {
      return res.status(400).json({ success: false, message: 'Phone number already registered' });
    }

    // Handle optional profile image
    let profileImageUrl = '';
    if (req.file) {
      profileImageUrl = `/uploads/${req.file.filename}`;
    }

    // Create user
    const user = await User.create({
      name,
      phone,
      email,
      firmName,
      password,
      role: role || 'electrician',
      profileImage: profileImageUrl,
      shopDetails: role === 'retailer' ? shopDetails : undefined,
    });

    // Create a wallet for the user (except admins)
    await Wallet.create({
      userId: user._id,
      balance: 0,
    });

    return res.status(201).json({
      success: true,
      token: generateToken(user._id),
      user: {
        id: user._id,
        name: user.name,
        phone: user.phone,
        role: user.role,
        kycStatus: user.kycStatus,
      },
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Log in User (Admin, Sub-Admin, Retailer, Electrician)
// @route   POST /api/auth/login
// @access  Public
exports.login = async (req, res) => {
  try {
    const { phone, password } = req.body;

    if (!phone || !password) {
      return res.status(400).json({ success: false, message: 'Please provide phone number and password' });
    }

    const user = await User.findOne({ phone });
    if (!user || !(await user.matchPassword(password))) {
      return res.status(401).json({ success: false, message: 'Invalid phone number or password' });
    }

    if (!user.isActive) {
      return res.status(403).json({ success: false, message: 'Your account is deactivated' });
    }

    return res.status(200).json({
      success: true,
      token: generateToken(user._id),
      user: {
        id: user._id,
        name: user.name,
        phone: user.phone,
        role: user.role,
        kycStatus: user.kycStatus,
      },
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Get Current Logged-In User Profile
// @route   GET /api/auth/me
// @access  Private
exports.getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    const wallet = await Wallet.findOne({ userId: req.user.id });

    return res.status(200).json({
      success: true,
      user,
      walletBalance: wallet ? wallet.balance : 0,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Update Profile Details
// @route   PUT /api/auth/profile
// @access  Private
exports.updateProfile = async (req, res) => {
  try {
    let { name, email, shopDetails, firmName } = req.body;
    const user = await User.findById(req.user.id);

    // Parse shopDetails if sent as string (multipart/form-data)
    if (typeof shopDetails === 'string') {
      try {
        shopDetails = JSON.parse(shopDetails);
      } catch (e) {
        console.error('Failed to parse shopDetails:', e);
      }
    }

    if (name) user.name = name;
    if (email) user.email = email;
    if (firmName) user.firmName = firmName;
    if (shopDetails && user.role === 'retailer') {
      user.shopDetails = { ...user.shopDetails, ...shopDetails };
    }

    if (req.file) {
      user.profileImage = `/uploads/${req.file.filename}`;
    }

    await user.save();

    return res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      user,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Update Bank Account Details
// @route   PUT /api/auth/bank-details
// @access  Private
exports.updateBankDetails = async (req, res) => {
  try {
    const { accountHolderName, accountNumber, ifscCode, bankName } = req.body;

    if (!accountHolderName || !accountNumber || !ifscCode || !bankName) {
      return res.status(400).json({ success: false, message: 'Please provide all bank details fields' });
    }

    const user = await User.findById(req.user.id);
    user.bankDetails = {
      accountHolderName,
      accountNumber,
      ifscCode,
      bankName,
    };

    await user.save();

    return res.status(200).json({
      success: true,
      message: 'Bank details updated successfully',
      bankDetails: user.bankDetails,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Change Password
// @route   POST /api/auth/change-password
// @access  Private
exports.changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, message: 'Please provide current and new password' });
    }

    const user = await User.findById(req.user.id);
    if (!(await user.matchPassword(currentPassword))) {
      return res.status(400).json({ success: false, message: 'Current password is incorrect' });
    }

    user.password = newPassword;
    await user.save();

    return res.status(200).json({ success: true, message: 'Password changed successfully' });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Submit KYC Details & Images
// @route   PUT /api/auth/kyc/submit
// @access  Private
exports.submitKYC = async (req, res) => {
  try {
    const { aadharNumber, panNumber } = req.body;
    const user = await User.findById(req.user.id);

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Structure files uploaded
    let aadharFrontUrl = user.kycDetails?.aadharFrontUrl;
    let aadharBackUrl = user.kycDetails?.aadharBackUrl;
    let panCardUrl = user.kycDetails?.panCardUrl;

    if (req.files) {
      if (req.files.aadharFront) {
        aadharFrontUrl = `/uploads/${req.files.aadharFront[0].filename}`;
      }
      if (req.files.aadharBack) {
        aadharBackUrl = `/uploads/${req.files.aadharBack[0].filename}`;
      }
      if (req.files.panCard) {
        panCardUrl = `/uploads/${req.files.panCard[0].filename}`;
      }
    }

    // Set numbers and URLs
    user.kycDetails = {
      ...user.kycDetails,
      aadharNumber: aadharNumber || user.kycDetails?.aadharNumber,
      panNumber: panNumber || user.kycDetails?.panNumber,
      aadharFrontUrl,
      aadharBackUrl,
      panCardUrl,
      rejectionReason: '', // Reset rejection reason on new submission
    };

    // Update submission statuses
    if (aadharNumber || aadharFrontUrl || aadharBackUrl) {
      user.kycStatus.aadhar = 'submitted';
    }
    if (panNumber || panCardUrl) {
      user.kycStatus.pan = 'submitted';
    }

    await user.save();

    return res.status(200).json({
      success: true,
      message: 'KYC documents submitted successfully for verification',
      kycStatus: user.kycStatus,
      kycDetails: user.kycDetails,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Get current user notifications
// @route   GET /api/auth/notifications
// @access  Private
exports.getNotifications = async (req, res) => {
  try {
    const notifications = await Notification.find({ userId: req.user.id }).sort({ createdAt: -1 });
    return res.status(200).json({ success: true, count: notifications.length, notifications });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Mark a notification as read
// @route   PUT /api/auth/notifications/:id/read
// @access  Private
exports.markNotificationRead = async (req, res) => {
  try {
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, userId: req.user.id },
      { isRead: true },
      { new: true }
    );

    if (!notification) {
      return res.status(404).json({ success: false, message: 'Notification not found' });
    }

    return res.status(200).json({ success: true, notification });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Submit a support ticket / service request (Help & Support / Manage Services)
// @route   POST /api/auth/service-requests
// @access  Private
exports.createServiceRequest = async (req, res) => {
  try {
    const { title, description } = req.body;
    if (!title || !description) {
      return res.status(400).json({ success: false, message: 'Please provide title and description' });
    }

    const request = await ServiceRequest.create({
      userId: req.user.id,
      title,
      description,
    });

    return res.status(201).json({ success: true, message: 'Support ticket/service request created successfully', request });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Get user support tickets / service requests
// @route   GET /api/auth/service-requests
// @access  Private
exports.getServiceRequests = async (req, res) => {
  try {
    const requests = await ServiceRequest.find({ userId: req.user.id }).sort({ createdAt: -1 });
    return res.status(200).json({ success: true, count: requests.length, requests });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Get dynamic app configurations (FAQ, support contacts, terms, rate us, share links)
// @route   GET /api/auth/app-config
// @access  Private/Public
exports.getAppConfig = async (req, res) => {
  try {
    let config = await AppConfig.findOne({});
    if (!config) {
      // Seed default AppConfig if none exists
      config = await AppConfig.create({});
    }
    return res.status(200).json({ success: true, config });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

