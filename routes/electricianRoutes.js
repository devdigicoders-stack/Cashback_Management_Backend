const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middlewares/authMiddleware');

const {
  getDashboard,
  scanQRCode,
  requestWithdrawal,
  getScanHistory,
  getTransactions,
} = require('../controllers/electricianController');

// All electrician routes are protected and restricted to electricians
router.use(protect);
router.use(authorize('electrician'));

router.get('/dashboard', getDashboard);
router.post('/scan-qr', scanQRCode);
router.post('/withdraw', requestWithdrawal);
router.get('/scans', getScanHistory);
router.get('/transactions', getTransactions);

module.exports = router;
