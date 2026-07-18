const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config();

mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/Cashback').then(async () => {
  console.log('MongoDB Connected');
  try {
    const Product = require('./models/Product');
    const duplicates = await Product.aggregate([
      { $group: { _id: "$sku", count: { $sum: 1 }, docs: { $push: "$_id" } } },
      { $match: { count: { $gt: 1 } } }
    ]);
    
    console.log(`Found ${duplicates.length} duplicate SKU groups`);
    
    for (const group of duplicates) {
      // Keep the first one, update the rest
      const docsToUpdate = group.docs.slice(1);
      let counter = 1;
      for (const id of docsToUpdate) {
        await Product.findByIdAndUpdate(id, { $set: { sku: `${group._id}-DUP-${counter}` } });
        counter++;
      }
    }
    
    console.log('Duplicates resolved. Now creating index...');
    const db = mongoose.connection.db;
    const collection = db.collection('products');
    await collection.createIndex({ sku: 1 }, { unique: true });
    console.log('Successfully created the unique index on sku');
  } catch (error) {
    console.error('Error:', error);
  }
  process.exit();
});
