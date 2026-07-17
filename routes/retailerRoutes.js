const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middlewares/authMiddleware');

const {
  getDashboard,
  updateShopDetails,
  getOffersAndSchemes,
  requestWithdrawal,
  getTransactions,
  scanQRCode,
} = require('../controllers/retailerController');

// All retailer routes are protected and restricted to retailers
router.use(protect);
router.use(authorize('retailer'));

router.get('/dashboard', getDashboard);
router.put('/shop-details', updateShopDetails);
router.get('/offers', getOffersAndSchemes);
router.post('/withdraw', requestWithdrawal);
router.get('/transactions', getTransactions);
router.post('/scan-qr', scanQRCode);

module.exports = router;
