require('dotenv').config();
const mongoose = require('mongoose');

// It will use the MONGO_URI from your live server's .env file
const DB_URI = process.env.MONGO_URI;

if (!DB_URI) {
  console.error("Error: MONGO_URI is not defined in .env file");
  process.exit(1);
}

mongoose.connect(DB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(async () => {
    console.log("Connected to the Database.");
    try {
      const coll = mongoose.connection.collection('products');
      
      // Checking if index exists before dropping
      const indexes = await coll.indexes();
      const skuIndexExists = indexes.some(index => index.name === 'sku_1');

      if (skuIndexExists) {
        await coll.dropIndex('sku_1');
        console.log('✅ Success: SKU unique index dropped successfully from Production DB!');
      } else {
        console.log('ℹ️ Info: SKU index already dropped or does not exist.');
      }
    } catch(e) {
      console.error('❌ Error dropping index:', e.message);
    } finally {
      mongoose.disconnect();
      process.exit(0);
    }
  })
  .catch(err => {
    console.error('❌ Database Connection error:', err.message);
    process.exit(1);
  });
