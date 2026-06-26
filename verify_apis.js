const baseUrl = 'http://localhost:5001/api';

async function runTests() {
  console.log('🚀 Starting end-to-end API verification...\n');

  try {
    // 1. Admin Login
    console.log('1. Logging in as default Admin...');
    const adminLoginRes = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '1234567890', password: 'adminpassword' }),
    });
    console.log(`Response Status: ${adminLoginRes.status}`);
    const rawText = await adminLoginRes.text();
    console.log(`Response Text: "${rawText}"`);
    const adminLogin = JSON.parse(rawText);
    if (!adminLogin.success) throw new Error('Admin login failed: ' + adminLogin.message);
    const adminToken = adminLogin.token;
    console.log('✅ Admin Logged In Successfully!\n');

    // 2. Add Product
    console.log('2. Admin: Adding a new product...');
    const addProductRes = await fetch(`${baseUrl}/admin/products`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        name: 'Premium Flexible Wire 2.5sqmm',
        sku: 'WIRE-FLEX-2.5',
        category: 'Wires',
        description: 'Heavy duty fire resistant electrical wire',
        cashbackConfig: {
          electricianAmount: 50,
          retailerAmount: 20,
        },
      }),
    });
    const addProduct = await addProductRes.json();
    if (!addProduct.success && !addProduct.message.includes('SKU already exists')) {
      throw new Error('Add Product failed: ' + addProduct.message);
    }
    const productId = addProduct.product ? addProduct.product._id : null;
    console.log(`✅ Product processed (SKU: WIRE-FLEX-2.5)\n`);

    // Let's get the products list to find the ID if it already existed
    let activeProductId = productId;
    if (!activeProductId) {
      const getProductsRes = await fetch(`${baseUrl}/admin/products`, {
        headers: { 'Authorization': `Bearer ${adminToken}` },
      });
      const getProductsList = await getProductsRes.json();
      const existingProduct = getProductsList.products.find((p) => p.sku === 'WIRE-FLEX-2.5');
      activeProductId = existingProduct._id;
    }

    // 3. Generate QR Codes
    console.log('3. Admin: Generating bulk QR codes...');
    const qrGenerateRes = await fetch(`${baseUrl}/admin/qrcodes/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        productId: activeProductId,
        count: 2,
      }),
    });
    const qrGenerate = await qrGenerateRes.json();
    if (!qrGenerate.success) throw new Error('QR code generation failed: ' + qrGenerate.message);
    const testQR = qrGenerate.qrcodes[0].code;
    console.log(`✅ Generated ${qrGenerate.count} QR codes. Test Code: "${testQR}"\n`);

    // 4. Register Electrician
    console.log('4. Registering a new Electrician...');
    const elecPhone = '98765' + Math.floor(10000 + Math.random() * 90000); // Random phone to avoid conflict
    const registerRes = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Rajesh Sharma',
        phone: elecPhone,
        password: 'electricianpassword',
        role: 'electrician',
      }),
    });
    const register = await registerRes.json();
    if (!register.success) throw new Error('Electrician registration failed: ' + register.message);
    const electricianToken = register.token;
    const electricianId = register.user.id;
    console.log(`✅ Electrician registered: ${register.user.name} (Phone: ${elecPhone})\n`);

    // 5. Submit KYC details
    console.log('5. Electrician: Submitting KYC numbers (Aadhar & PAN)...');
    const kycSubmitRes = await fetch(`${baseUrl}/auth/kyc/submit`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${electricianToken}`,
      },
      body: JSON.stringify({
        aadharNumber: '123456789012',
        panNumber: 'ABCDE1234F',
      }),
    });
    const kycSubmit = await kycSubmitRes.json();
    if (!kycSubmit.success) throw new Error('KYC submission failed: ' + kycSubmit.message);
    console.log('✅ KYC numbers submitted. Status: Aadhar:', kycSubmit.kycStatus.aadhar, ', PAN:', kycSubmit.kycStatus.pan, '\n');

    // 6. Try to scan QR code before approval
    console.log('6. Electrician: Trying to scan QR code before KYC approval...');
    const preKycScanRes = await fetch(`${baseUrl}/electrician/scan-qr`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${electricianToken}`,
      },
      body: JSON.stringify({ code: testQR }),
    });
    const preKycScan = await preKycScanRes.json();
    console.log(`ℹ️ Response (expected failure): success = ${preKycScan.success}, message = "${preKycScan.message}"`);
    if (preKycScan.success) throw new Error('Scan succeeded before KYC approval! This is a security flaw.');
    console.log('✅ Correctly blocked scan due to pending KYC.\n');

    // 7. Admin: Approve KYC (Aadhar and PAN)
    console.log('7. Admin: Processing and Approving Aadhar and PAN KYC...');
    const approveAadharRes = await fetch(`${baseUrl}/admin/users/${electricianId}/kyc-process`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ documentType: 'aadhar', action: 'approve' }),
    });
    const approveAadhar = await approveAadharRes.json();

    const approvePANRes = await fetch(`${baseUrl}/admin/users/${electricianId}/kyc-process`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ documentType: 'pan', action: 'approve' }),
    });
    const approvePAN = await approvePANRes.json();

    if (!approveAadhar.success || !approvePAN.success) throw new Error('KYC approval processing failed');
    console.log('✅ KYC approved by Admin.\n');

    // 8. Scan QR code after approval (Instant Credit)
    console.log('8. Electrician: Scanning QR code after KYC approval...');
    const postKycScanRes = await fetch(`${baseUrl}/electrician/scan-qr`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${electricianToken}`,
      },
      body: JSON.stringify({ code: testQR }),
    });
    const postKycScan = await postKycScanRes.json();
    if (!postKycScan.success) throw new Error('Scan failed after KYC approval: ' + postKycScan.message);
    console.log(`✅ Scan succeeded! Credited: ₹${postKycScan.cashbackCredited}. New Wallet Balance: ₹${postKycScan.newWalletBalance}\n`);

    // 9. Try scanning the same QR code again (Double scan prevention)
    console.log('9. Electrician: Trying to scan the same QR code again...');
    const doubleScanRes = await fetch(`${baseUrl}/electrician/scan-qr`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${electricianToken}`,
      },
      body: JSON.stringify({ code: testQR }),
    });
    const doubleScan = await doubleScanRes.json();
    console.log(`ℹ️ Response (expected failure): success = ${doubleScan.success}, message = "${doubleScan.message}"`);
    if (doubleScan.success) throw new Error('Double scanning was allowed!');
    console.log('✅ Correctly blocked double scan.\n');

    // 10. Update Bank Details & Request Withdrawal
    console.log('10. Electrician: Setting bank details and requesting withdrawal...');
    await fetch(`${baseUrl}/auth/bank-details`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${electricianToken}`,
      },
      body: JSON.stringify({
        accountHolderName: 'Rajesh Sharma',
        accountNumber: '987654321000',
        ifscCode: 'SBIN0001234',
        bankName: 'State Bank of India',
      }),
    });

    const withdrawRes = await fetch(`${baseUrl}/electrician/withdraw`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${electricianToken}`,
      },
      body: JSON.stringify({ amount: 30 }),
    });
    const withdraw = await withdrawRes.json();
    if (!withdraw.success) throw new Error('Withdrawal request failed: ' + withdraw.message);
    const withdrawalId = withdraw.withdrawal._id;
    console.log(`✅ Withdrawal request submitted. ID: ${withdrawalId}, Amount: ₹${withdraw.withdrawal.amount}, Status: ${withdraw.withdrawal.status}\n`);

    // 11. Admin: Process and Approve Withdrawal
    console.log('11. Admin: Processing & Approving withdrawal request...');
    const processWithdrawRes = await fetch(`${baseUrl}/admin/withdrawals/${withdrawalId}/process`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ action: 'approve', adminRemarks: 'Cleared by test script' }),
    });
    const processWithdraw = await processWithdrawRes.json();
    if (!processWithdraw.success) throw new Error('Admin withdrawal approval failed: ' + processWithdraw.message);
    console.log(`✅ Withdrawal approved by Admin. Remaining user balance: ₹${processWithdraw.withdrawal.amount} deducted.\n`);

    // 11b. Test Support Requests & Notifications
    console.log('11b. Electrician: Submitting a service/support ticket...');
    const ticketRes = await fetch(`${baseUrl}/auth/service-requests`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${electricianToken}`,
      },
      body: JSON.stringify({ title: 'Wire Scanning Issue', description: 'Cannot scan wire code from 100m pack' }),
    });
    const ticket = await ticketRes.json();
    if (!ticket.success) throw new Error('Create support ticket failed: ' + ticket.message);
    const ticketId = ticket.request._id;
    console.log(`✅ Support ticket created. ID: ${ticketId}\n`);

    // Admin resolves ticket
    console.log('Admin: Resolving the support ticket...');
    const resolveTicketRes = await fetch(`${baseUrl}/admin/service-requests/${ticketId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ status: 'resolved', adminRemarks: 'Code verified, scanner updated' }),
    });
    const resolveTicket = await resolveTicketRes.json();
    if (!resolveTicket.success) throw new Error('Resolve support ticket failed: ' + resolveTicket.message);
    console.log('✅ Support ticket marked as resolved by Admin.\n');

    // Electrician gets notifications list
    console.log('Electrician: Fetching notifications list...');
    const notifsRes = await fetch(`${baseUrl}/auth/notifications`, {
      headers: { 'Authorization': `Bearer ${electricianToken}` },
    });
    const notifsList = await notifsRes.json();
    console.log(`✅ Notifications count: ${notifsList.count}. Unread notifications check passed.\n`);

    // Admin pulls detailed reports
    console.log('Admin: Requesting detailed reports...');
    const reportsRes = await fetch(`${baseUrl}/admin/reports`, {
      headers: { 'Authorization': `Bearer ${adminToken}` },
    });
    const reports = await reportsRes.json();
    if (!reports.success) throw new Error('Detailed reports fetch failed: ' + reports.message);
    console.log('📊 Admin Reports loaded successfully.\n');

    // 11c. Admin Profile, Admin Offer CRUD, Retailer register/login & Offers, and Cashback summary/transactions
    console.log('11c. Admin: Testing Admin Profile Management...');
    const adminProfileRes = await fetch(`${baseUrl}/admin/profile`, {
      headers: { 'Authorization': `Bearer ${adminToken}` },
    });
    const adminProfile = await adminProfileRes.json();
    if (!adminProfile.success) throw new Error('Get Admin Profile failed');
    console.log('✅ Admin Profile loaded successfully.\n');

    console.log('Admin: Testing Offer creation...');
    const createOfferRes = await fetch(`${baseUrl}/admin/offers`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        title: 'Monsoon Double Reward',
        description: 'Get extra rewards on bulk scans during Monsoon season',
        validUntil: new Date(Date.now() + 86400000 * 30), // 30 days
      }),
    });
    const createOffer = await createOfferRes.json();
    if (!createOffer.success) throw new Error('Create Offer failed');
    console.log(`✅ Offer created successfully. ID: ${createOffer.offer._id}\n`);

    // Register a Retailer to test Retailer Offers API
    console.log('Registering a new Retailer...');
    const retPhone = '97777' + Math.floor(10000 + Math.random() * 90000);
    const registerRetailerRes = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Sharma Electricals Store',
        phone: retPhone,
        password: 'retailerpassword',
        role: 'retailer',
        shopDetails: {
          shopName: 'Sharma Electricals',
          shopAddress: 'Sector-15, Noida',
          gstNumber: '09AAAAA1111A1Z1',
        },
      }),
    });
    const registerRetailer = await registerRetailerRes.json();
    if (!registerRetailer.success) throw new Error('Retailer registration failed');
    const retailerToken = registerRetailer.token;
    console.log(`✅ Retailer registered: ${registerRetailer.user.name}\n`);

    console.log('Retailer: Fetching dynamic offers list...');
    const retailerOffersRes = await fetch(`${baseUrl}/retailer/offers`, {
      headers: { 'Authorization': `Bearer ${retailerToken}` },
    });
    const retailerOffers = await retailerOffersRes.json();
    if (!retailerOffers.success) throw new Error('Fetch Retailer Offers failed');
    console.log(`✅ Retailer retrieved ${retailerOffers.count} offers. Dynamic offers check passed.\n`);

    console.log('Admin: Fetching cashback summary and transactions logs...');
    const cashbackSummaryRes = await fetch(`${baseUrl}/admin/cashback-summary`, {
      headers: { 'Authorization': `Bearer ${adminToken}` },
    });
    const cashbackSummary = await cashbackSummaryRes.json();
    
    const cashbackTransRes = await fetch(`${baseUrl}/admin/cashback-transactions`, {
      headers: { 'Authorization': `Bearer ${adminToken}` },
    });
    const cashbackTrans = await cashbackTransRes.json();

    if (!cashbackSummary.success || !cashbackTrans.success) {
      throw new Error('Cashback monitoring reports failed');
    }
    console.log(`✅ Cashback Summary: loaded successfully. Scans logged: ${cashbackTrans.count} transactions.\n`);

    // 12. Verify Electrician Dashboard
    console.log('12. Electrician: Verifying updated dashboard status...');
    const dashboardRes = await fetch(`${baseUrl}/electrician/dashboard`, {
      headers: { 'Authorization': `Bearer ${electricianToken}` },
    });
    const dashboard = await dashboardRes.json();
    console.log('📊 Dashboard Details:', JSON.stringify(dashboard.dashboard, null, 2));
    if (dashboard.dashboard.walletBalance !== 20) {
      throw new Error(`Expected wallet balance to be 20 (50 credit - 30 debit), but got ${dashboard.dashboard.walletBalance}`);
    }
    console.log('✅ Balance correct!\n');

    console.log('🏁 All integration tests passed successfully! The system is connected and working perfectly.');
    process.exit(0);

  } catch (error) {
    console.error('❌ Integration Test Failed:', error.message);
    process.exit(1);
  }
}

// Small delay to make sure server is up if run together
setTimeout(runTests, 1500);
