const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const {
  register,
  login,
  getMe,
  updateProfile,
  updateBankDetails,
  changePassword,
  submitKYC,
  getNotifications,
  markNotificationRead,
  createServiceRequest,
  getServiceRequests,
  getAppConfig,
} = require('../controllers/authController');

const { protect } = require('../middlewares/authMiddleware');

// Setup multer storage for uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const dir = './uploads';
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({
  storage: storage,
  fileFilter: function (req, file, cb) {
    const filetypes = /jpeg|jpg|png|pdf/;
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = filetypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Images and PDFs only are allowed!'));
    }
  },
  limits: { fileSize: 1024 * 1024 * 5 }, // 5MB limit
});

// Configure multiple fields for KYC upload
const kycUpload = upload.fields([
  { name: 'aadharFront', maxCount: 1 },
  { name: 'aadharBack', maxCount: 1 },
  { name: 'panCard', maxCount: 1 },
]);

// Public routes
router.post('/register', register);
router.post('/login', login);

// Private routes
router.get('/me', protect, getMe);
router.put('/profile', protect, updateProfile);
router.put('/bank-details', protect, updateBankDetails);
router.post('/change-password', protect, changePassword);

// KYC upload route
router.put('/kyc/submit', protect, kycUpload, submitKYC);

// Notifications routes
router.get('/notifications', protect, getNotifications);
router.put('/notifications/:id/read', protect, markNotificationRead);

// Help & Support / Manage Services routes
router.post('/service-requests', protect, createServiceRequest);
router.get('/service-requests', protect, getServiceRequests);

// Website / App content
router.get('/app-config', protect, getAppConfig);

module.exports = router;
