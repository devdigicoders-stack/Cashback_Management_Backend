const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const mongoose = require('mongoose');

// Load environment variables
dotenv.config();

const connectDB = require('./config/db');
const User = require('./models/User');

// Connect to Database
connectDB();

const app = express();

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

// Ensure uploads folder exists and serve it statically
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
app.use('/uploads', express.static(uploadsDir));

// Route Imports
const authRoutes = require('./routes/authRoutes');
const adminRoutes = require('./routes/adminRoutes');
const electricianRoutes = require('./routes/electricianRoutes');
const retailerRoutes = require('./routes/retailerRoutes');

// Mount Routes
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/electrician', electricianRoutes);
app.use('/api/retailer', retailerRoutes);

// Root Route
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Welcome to the Cashback & Loyalty Management System Backend API',
    status: 'Running',
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal Server Error',
  });
});

// Function to drop the old unique SKU index if it exists
const dropSkuIndex = async () => {
  try {
    const coll = mongoose.connection.collection('products');
    const indexes = await coll.indexes();
    const skuIndexExists = indexes.some(index => index.name === 'sku_1');
    if (skuIndexExists) {
      await coll.dropIndex('sku_1');
      console.log('✅ SKU unique index dropped successfully from DB!');
    }
  } catch (error) {
    console.error(`Error dropping SKU index: ${error.message}`);
  }
};

// Seed default Admin User if not exists
const seedAdmin = async () => {
  try {
    const adminExists = await User.findOne({ role: 'admin' });
    if (!adminExists) {
      await User.create({
        name: 'System Admin',
        phone: '1234567890',
        email: 'admin@cashback.com',
        password: 'adminpassword', // Will be hashed by pre-save hook
        role: 'admin',
      });
      console.log('--------------------------------------------------');
      console.log('Default Admin User seeded successfully:');
      console.log('Phone: 1234567890');
      console.log('Password: adminpassword');
      console.log('--------------------------------------------------');
    }
  } catch (error) {
    console.error(`Admin seeding error: ${error.message}`);
  }
};

const PORT = process.env.PORT || 5000;

app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  await dropSkuIndex();
  await seedAdmin();
});
