const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { protect, authorize } = require('../middlewares/authMiddleware');

// Setup multer storage for uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const dir = 'uploads/';
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

const kycUpload = upload.fields([
  { name: 'aadharFront', maxCount: 1 },
  { name: 'aadharBack', maxCount: 1 },
  { name: 'panCard', maxCount: 1 },
]);
const {
  getDashboardStats,
  getUsers,
  getUserById,
  processKYC,
  addProduct,
  getProducts,
  updateProduct,
  deleteProduct,
  generateQRCodes,
  getQRCodes,
  getWithdrawals,
  processWithdrawal,
  getAppConfig,
  updateAppConfig,
  getServiceRequestsAdmin,
  updateServiceRequestAdmin,
  sendBulkNotification,
  getNotificationsHistoryAdmin,
  deleteBulkNotification,
  getReportsAdmin,
  addOffer,
  getOffersAdmin,
  updateOffer,
  deleteOffer,
  getCashbackSummary,
  getCashbackTransactions,
  registerAdmin,
  updateUserDetails,
  updateUserStatus,
  deleteUser,
  uploadUserKYC,
} = require('../controllers/adminController');

const {
  getMe,
  updateProfile,
  changePassword,
} = require('../controllers/authController');

// Admin Registration (Public route - No token required)
router.post('/register', registerAdmin);

// All admin routes are protected and restricted to admin/sub-admin roles
router.use(protect);
router.use(authorize('admin', 'sub-admin'));

// Stats & Dashboard
router.get('/dashboard', getDashboardStats);

// Admin Profile & Password Management
router.get('/profile', getMe);
router.put('/profile', updateProfile);
router.post('/change-password', changePassword);

// Users Management
router.get('/users', getUsers);
router.get('/users/:id', getUserById);
router.put('/users/:id', updateUserDetails);
router.delete('/users/:id', deleteUser);
router.put('/users/:id/status', updateUserStatus);
router.put('/users/:id/kyc-process', processKYC);
router.put('/users/:id/kyc', kycUpload, uploadUserKYC);

// Products Management
router.post('/products', addProduct);
router.get('/products', getProducts);
router.put('/products/:id', updateProduct);
router.delete('/products/:id', deleteProduct);

// QR Code Management
router.post('/qrcodes/generate', generateQRCodes);
router.get('/qrcodes', getQRCodes);

// Withdrawal Request Processing
router.get('/withdrawals', getWithdrawals);
router.put('/withdrawals/:id/process', processWithdrawal);

// Website Content / App config Management
router.get('/app-config', getAppConfig);
router.put('/app-config', updateAppConfig);

// Service Request / Help tickets Management
router.get('/service-requests', getServiceRequestsAdmin);
router.put('/service-requests/:id', updateServiceRequestAdmin);

// Notifications Management
router.post('/notifications/bulk', sendBulkNotification);
router.get('/notifications', getNotificationsHistoryAdmin);
router.delete('/notifications/bulk', deleteBulkNotification);

// Reports Management
router.get('/reports', getReportsAdmin);

// Offers & Schemes CRUD Management
router.post('/offers', addOffer);
router.get('/offers', getOffersAdmin);
router.put('/offers/:id', updateOffer);
router.delete('/offers/:id', deleteOffer);

// Detailed Cashback Monitoring
router.get('/cashback-summary', getCashbackSummary);
router.get('/cashback-transactions', getCashbackTransactions);

module.exports = router;
