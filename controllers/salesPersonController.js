const SalesPerson = require('../models/SalesPerson');
const User = require('../models/User');
const QRCode = require('../models/QRCode');
const Wallet = require('../models/Wallet');
const mongoose = require('mongoose');

// @desc    Create a new Sales Person
// @route   POST /api/admin/sales-persons
// @access  Private (Admin only)
exports.createSalesPerson = async (req, res) => {
  try {
    let { name, code, phone, email, city, area, notes } = req.body;

    if (!name || !code) {
      return res.status(400).json({ success: false, message: 'Please provide Sales Person Name and Code' });
    }

    code = code.trim().toUpperCase();

    // Check if code already exists
    const existing = await SalesPerson.findOne({ code });
    if (existing) {
      return res.status(400).json({ success: false, message: `Sales Code '${code}' is already assigned to another sales person` });
    }

    const salesPerson = await SalesPerson.create({
      name: name.trim(),
      code,
      phone: phone ? phone.trim() : '',
      email: email ? email.trim().toLowerCase() : '',
      city: city ? city.trim() : '',
      area: area ? area.trim() : '',
      notes: notes ? notes.trim() : '',
      isActive: true,
    });

    return res.status(201).json({
      success: true,
      message: 'Sales Person created successfully',
      salesPerson,
    });
  } catch (error) {
    console.error('createSalesPerson error:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Get all Sales Persons with aggregated metrics
// @route   GET /api/admin/sales-persons
// @access  Private (Admin only)
exports.getSalesPersons = async (req, res) => {
  try {
    const { search, isActive } = req.query;
    let filter = {};

    if (isActive !== undefined && isActive !== '') {
      filter.isActive = isActive === 'true';
    }

    if (search) {
      const searchRegex = new RegExp(search.trim(), 'i');
      filter.$or = [
        { name: searchRegex },
        { code: searchRegex },
        { phone: searchRegex },
        { email: searchRegex },
        { city: searchRegex },
        { area: searchRegex },
      ];
    }

    const salesPersons = await SalesPerson.find(filter).sort({ createdAt: -1 }).lean();

    // Aggregate user statistics for each sales person
    const salesPersonIds = salesPersons.map((sp) => sp._id);

    const userStats = await User.aggregate([
      {
        $match: {
          salesPerson: { $in: salesPersonIds },
        },
      },
      {
        $group: {
          _id: '$salesPerson',
          totalUsers: { $sum: 1 },
          electriciansCount: {
            $sum: { $cond: [{ $eq: ['$role', 'electrician'] }, 1, 0] },
          },
          retailersCount: {
            $sum: { $cond: [{ $eq: ['$role', 'retailer'] }, 1, 0] },
          },
          activeUsersCount: {
            $sum: { $cond: [{ $eq: ['$isActive', true] }, 1, 0] },
          },
          kycApprovedCount: {
            $sum: {
              $cond: [
                {
                  $or: [
                    { $eq: ['$kycStatus.aadhar', 'approved'] },
                    { $eq: ['$kycStatus.pan', 'approved'] },
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },
    ]);

    const statsMap = {};
    userStats.forEach((stat) => {
      statsMap[stat._id.toString()] = stat;
    });

    const enrichedSalesPersons = salesPersons.map((sp) => {
      const stat = statsMap[sp._id.toString()] || {
        totalUsers: 0,
        electriciansCount: 0,
        retailersCount: 0,
        activeUsersCount: 0,
        kycApprovedCount: 0,
      };

      return {
        ...sp,
        totalUsers: stat.totalUsers,
        electriciansCount: stat.electriciansCount,
        retailersCount: stat.retailersCount,
        activeUsersCount: stat.activeUsersCount,
        kycApprovedCount: stat.kycApprovedCount,
      };
    });

    // Summary totals across all sales team
    const totalSalesPersons = salesPersons.length;
    const activeSalesPersons = salesPersons.filter((sp) => sp.isActive).length;
    const totalOnboardedUsers = userStats.reduce((acc, curr) => acc + curr.totalUsers, 0);
    const totalElectricians = userStats.reduce((acc, curr) => acc + curr.electriciansCount, 0);
    const totalRetailers = userStats.reduce((acc, curr) => acc + curr.retailersCount, 0);

    return res.status(200).json({
      success: true,
      count: enrichedSalesPersons.length,
      salesPersons: enrichedSalesPersons,
      summary: {
        totalSalesPersons,
        activeSalesPersons,
        totalOnboardedUsers,
        totalElectricians,
        totalRetailers,
      },
    });
  } catch (error) {
    console.error('getSalesPersons error:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Get single Sales Person with summary
// @route   GET /api/admin/sales-persons/:id
// @access  Private (Admin only)
exports.getSalesPersonById = async (req, res) => {
  try {
    const salesPerson = await SalesPerson.findById(req.params.id);
    if (!salesPerson) {
      return res.status(404).json({ success: false, message: 'Sales Person not found' });
    }

    const totalUsers = await User.countDocuments({ salesPerson: salesPerson._id });
    const electriciansCount = await User.countDocuments({ salesPerson: salesPerson._id, role: 'electrician' });
    const retailersCount = await User.countDocuments({ salesPerson: salesPerson._id, role: 'retailer' });
    const activeCount = await User.countDocuments({ salesPerson: salesPerson._id, isActive: true });

    return res.status(200).json({
      success: true,
      salesPerson,
      stats: {
        totalUsers,
        electriciansCount,
        retailersCount,
        activeCount,
      },
    });
  } catch (error) {
    console.error('getSalesPersonById error:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Drill-Down: Get all users onboarded by a specific Sales Person
// @route   GET /api/admin/sales-persons/:id/users
// @access  Private (Admin only)
exports.getSalesPersonUsers = async (req, res) => {
  try {
    const salesPerson = await SalesPerson.findById(req.params.id);
    if (!salesPerson) {
      return res.status(404).json({ success: false, message: 'Sales Person not found' });
    }

    const { role, kycStatus, search, page = 1, limit = 50 } = req.query;
    let query = { salesPerson: salesPerson._id };

    if (role && role !== 'all') {
      query.role = role;
    }

    if (kycStatus && kycStatus !== 'all') {
      query.$or = [
        { 'kycStatus.aadhar': kycStatus },
        { 'kycStatus.pan': kycStatus },
      ];
    }

    if (search) {
      const searchRegex = new RegExp(search.trim(), 'i');
      query.$or = [
        { name: searchRegex },
        { phone: searchRegex },
        { email: searchRegex },
        { firmName: searchRegex },
      ];
    }

    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const skip = (pageNum - 1) * limitNum;

    const total = await User.countDocuments(query);
    const users = await User.find(query)
      .select('-password')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .lean();

    // Fetch wallets and scans count for these users
    const userIds = users.map((u) => u._id);
    const wallets = await Wallet.find({ userId: { $in: userIds } }).lean();
    const walletMap = {};
    wallets.forEach((w) => {
      walletMap[w.userId.toString()] = w.balance;
    });

    const scanCounts = await QRCode.aggregate([
      { $match: { scannedBy: { $in: userIds }, status: 'scanned' } },
      { $group: { _id: '$scannedBy', totalScans: { $sum: 1 }, totalCashback: { $sum: '$cashbackAmountCredited' } } },
    ]);

    const scanMap = {};
    scanCounts.forEach((s) => {
      scanMap[s._id.toString()] = s;
    });

    const enrichedUsers = users.map((u) => ({
      ...u,
      walletBalance: walletMap[u._id.toString()] || 0,
      totalScans: scanMap[u._id.toString()] ? scanMap[u._id.toString()].totalScans : 0,
      totalCashback: scanMap[u._id.toString()] ? scanMap[u._id.toString()].totalCashback : 0,
    }));

    return res.status(200).json({
      success: true,
      salesPerson: {
        id: salesPerson._id,
        name: salesPerson.name,
        code: salesPerson.code,
        phone: salesPerson.phone,
        email: salesPerson.email,
      },
      count: enrichedUsers.length,
      total,
      page: pageNum,
      totalPages: Math.ceil(total / limitNum) || 1,
      users: enrichedUsers,
    });
  } catch (error) {
    console.error('getSalesPersonUsers error:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Update Sales Person Details
// @route   PUT /api/admin/sales-persons/:id
// @access  Private (Admin only)
exports.updateSalesPerson = async (req, res) => {
  try {
    let { name, code, phone, email, city, area, notes, isActive } = req.body;

    const salesPerson = await SalesPerson.findById(req.params.id);
    if (!salesPerson) {
      return res.status(404).json({ success: false, message: 'Sales Person not found' });
    }

    if (code) {
      code = code.trim().toUpperCase();
      if (code !== salesPerson.code) {
        const existing = await SalesPerson.findOne({ code, _id: { $ne: salesPerson._id } });
        if (existing) {
          return res.status(400).json({ success: false, message: `Sales Code '${code}' is already used by another sales person` });
        }
        salesPerson.code = code;
      }
    }

    if (name) salesPerson.name = name.trim();
    if (phone !== undefined) salesPerson.phone = phone.trim();
    if (email !== undefined) salesPerson.email = email.trim().toLowerCase();
    if (city !== undefined) salesPerson.city = city.trim();
    if (area !== undefined) salesPerson.area = area.trim();
    if (notes !== undefined) salesPerson.notes = notes.trim();
    if (isActive !== undefined) salesPerson.isActive = isActive;

    await salesPerson.save();

    return res.status(200).json({
      success: true,
      message: 'Sales Person updated successfully',
      salesPerson,
    });
  } catch (error) {
    console.error('updateSalesPerson error:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Toggle Sales Person Active/Inactive status
// @route   PUT /api/admin/sales-persons/:id/status
// @access  Private (Admin only)
exports.toggleSalesPersonStatus = async (req, res) => {
  try {
    const { isActive } = req.body;
    if (isActive === undefined) {
      return res.status(400).json({ success: false, message: 'isActive boolean is required' });
    }

    const salesPerson = await SalesPerson.findById(req.params.id);
    if (!salesPerson) {
      return res.status(404).json({ success: false, message: 'Sales Person not found' });
    }

    salesPerson.isActive = isActive;
    await salesPerson.save();

    return res.status(200).json({
      success: true,
      message: `Sales Person is now ${isActive ? 'Active' : 'Inactive'}`,
      salesPerson,
    });
  } catch (error) {
    console.error('toggleSalesPersonStatus error:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Delete a Sales Person
// @route   DELETE /api/admin/sales-persons/:id
// @access  Private (Admin only)
exports.deleteSalesPerson = async (req, res) => {
  try {
    const salesPerson = await SalesPerson.findById(req.params.id);
    if (!salesPerson) {
      return res.status(404).json({ success: false, message: 'Sales Person not found' });
    }

    // Optional: Unlink users from this salesperson before deleting
    await User.updateMany({ salesPerson: salesPerson._id }, { $unset: { salesPerson: 1 } });

    await SalesPerson.findByIdAndDelete(req.params.id);

    return res.status(200).json({
      success: true,
      message: 'Sales Person deleted successfully and existing users unlinked',
    });
  } catch (error) {
    console.error('deleteSalesPerson error:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};
