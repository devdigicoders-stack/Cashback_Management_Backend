const mongoose = require('mongoose');
const dotenv = require('dotenv');
const User = require('./models/User');

dotenv.config();

const createNewAdmin = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    
    const newAdmin = await User.create({
      name: 'Super Admin 2',
      phone: '0987654321',
      email: 'admin2@cashback.com',
      password: 'adminpassword',
      role: 'admin',
    });
    console.log('--------------------------------------------------');
    console.log('New Admin Created Successfully!');
    console.log(`Name: ${newAdmin.name}`);
    console.log(`Phone (Login ID): ${newAdmin.phone}`);
    console.log(`Password: adminpassword`);
    console.log(`Role: ${newAdmin.role}`);
    console.log('--------------------------------------------------');
    process.exit(0);
  } catch (error) {
    if (error.code === 11000) {
      console.error('\nError: Is phone number se admin pehle hi ban chuka hai.');
    } else {
      console.error('\nError creating admin:', error.message);
    }
    process.exit(1);
  }
};

createNewAdmin();
