const admin = require('firebase-admin');

const serviceAccount = require('./firebase-service-account.json');

try {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
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

  // ggdsdv

  try {
    const response = await admin.messaging().send(message);
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
    const response = await admin.messaging().sendMulticast(message);
    console.log(
      `Successfully sent bulk push notifications. Success count: ${response.successCount}, Failure count: ${response.failureCount}`
    );
  } catch (error) {
    console.error('Error sending bulk push notifications:', error.message);
  }
};

module.exports = {
  admin,
  sendPushNotification,
  sendBulkPushNotifications,
};
