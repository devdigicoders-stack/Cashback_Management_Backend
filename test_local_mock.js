require('dotenv').config();
const { generateAadharOTP, verifyAadharOTP } = require('./controllers/authController');

// Mock User Model
const mockUser = {
  _id: '507f1f77bcf86cd799439011',
  name: 'Test Electrician',
  phone: '9999999999',
  kycStatus: {
    aadhar: 'pending',
    pan: 'pending'
  },
  kycDetails: {},
  save: async function() {
    console.log('  [Mock DB] User saved:', JSON.stringify(this, null, 2));
    return this;
  }
};

// Override User.findById in controller context
// Since authController imports User model, we mock it globally
const User = require('./models/User');
User.findById = async function(id) {
  console.log(`  [Mock DB] User.findById called for ID: ${id}`);
  return mockUser;
};

async function runTest() {
  console.log('🚀 Running Aadhaar verification test with Mock DB (No real MongoDB needed)...');

  console.log(`Initial User Status: Aadhar = ${mockUser.kycStatus.aadhar}`);

  // Mock Request & Response objects for generate OTP
  const reqGen = {
    user: { id: mockUser._id },
    body: { aadharNumber: '556936197436' } // User's Aadhaar number
  };
  
  let resGenData = null;
  const resGen = {
    status: function(code) {
      return {
        json: function(data) {
          resGenData = { code, data };
          return data;
        }
      }
    }
  };

  console.log('\n--- 1. Calling generateAadharOTP ---');
  await generateAadharOTP(reqGen, resGen);
  console.log('Result Status:', resGenData.code);
  console.log('Result Data:', JSON.stringify(resGenData.data, null, 2));

  if (!resGenData.data.success) {
    throw new Error('Generate OTP failed');
  }

  const clientId = resGenData.data.clientId;

  // Mock Request & Response objects for verify OTP
  const reqVer = {
    user: { id: mockUser._id },
    body: {
      clientId: clientId,
      otp: '123456' // OTP for testing
    }
  };

  let resVerData = null;
  const resVer = {
    status: function(code) {
      return {
        json: function(data) {
          resVerData = { code, data };
          return data;
        }
      }
    }
  };

  console.log('\n--- 2. Calling verifyAadharOTP with OTP 123456 ---');
  await verifyAadharOTP(reqVer, resVer);
  console.log('Result Status:', resVerData.code);
  console.log('Result Data:', JSON.stringify(resVerData.data, null, 2));

  console.log(`\nUpdated User Status: Aadhar = ${mockUser.kycStatus.aadhar}`);
  console.log('Aadhar Details:', JSON.stringify(mockUser.kycDetails, null, 2));

  console.log('\n✅ Test Completed Successfully!');
}

runTest().catch(err => {
  console.error('Test failed:', err);
});
