const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middlewares/authMiddleware');

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
} = require('../controllers/adminController');

const {
  getMe,
  updateProfile,
  changePassword,
} = require('../controllers/authController');

// All admin routes are protected and restricted to admin/sub-admin roles
router.use(protect);
router.use(authorize('admin', 'sub-admin'));

// Admin Registration
router.post('/register', registerAdmin);

// Stats & Dashboard
router.get('/dashboard', getDashboardStats);

// Admin Profile & Password Management
router.get('/profile', getMe);
router.put('/profile', updateProfile);
router.post('/change-password', changePassword);

// Users Management
router.get('/users', getUsers);
router.get('/users/:id', getUserById);
router.put('/users/:id/kyc-process', processKYC);

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
