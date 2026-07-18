const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config();

mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/Cashback').then(async () => {
  console.log('MongoDB Connected');
  try {
    const db = mongoose.connection.db;
    const collection = db.collection('products');
    await collection.createIndex({ sku: 1 }, { unique: true });
    console.log('Successfully created the unique index on sku');
  } catch (error) {
    console.error('Error creating index:', error);
  }
  process.exit();
});
