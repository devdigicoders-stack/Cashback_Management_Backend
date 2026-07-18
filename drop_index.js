const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config();

mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/Cashback').then(async () => {
  console.log('MongoDB Connected');
  try {
    const db = mongoose.connection.db;
    const collection = db.collection('products');
    await collection.dropIndex('sku_1');
    console.log('Successfully dropped the unique index on sku');
  } catch (error) {
    if (error.codeName === 'IndexNotFound') {
      console.log('Index sku_1 not found, nothing to drop.');
    } else {
      console.error('Error dropping index:', error);
    }
  }
  process.exit();
});
