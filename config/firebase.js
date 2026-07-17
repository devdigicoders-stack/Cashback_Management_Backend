const { initializeApp, cert } = require('firebase-admin/app');
const { getMessaging } = require('firebase-admin/messaging');

// Load credentials from environment variables (Required for Production/Render)
let privateKey = process.env.FIREBASE_PRIVATE_KEY;
if (privateKey) {
  // Handle literal newlines and quotes securely
  privateKey = privateKey.replace(/\\n/g, '\n');
  if (privateKey.startsWith('"') && privateKey.endsWith('"')) {
    privateKey = privateKey.slice(1, -1);
  }
}

try {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: privateKey,
    }),
  });
  console.log('Firebase Admin SDK Initialized Successfully.');
} catch (error) {
  console.error('Firebase Admin SDK Initialization Error:', error.message);
}

const sendPushNotification = async (token, title, body, data = {}) => {
  if (!token) return;

  const message = {
    notification: {
      title,
      body,
    },
    data,
    token,
  };

  try {
    const response = await getMessaging().send(message);
    console.log('Successfully sent push notification:', response);
  } catch (error) {
    console.error('Error sending push notification:', error.message);
  }
};

const sendBulkPushNotifications = async (tokens, title, body, data = {}) => {
  if (!tokens || tokens.length === 0) return;

  const message = {
    notification: {
      title,
      body,
    },
    data,
    tokens,
  };

  try {
    const response = await getMessaging().sendEachForMulticast(message);
    console.log(
      `Successfully sent bulk push notifications. Success count: ${response.successCount}, Failure count: ${response.failureCount}`
    );
  } catch (error) {
    console.error('Error sending bulk push notifications:', error.message);
  }
};

module.exports = {
  sendPushNotification,
  sendBulkPushNotifications,
};
