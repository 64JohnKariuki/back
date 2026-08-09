// Load environment variables
require('dotenv').config({
    path: process.env.NODE_ENV === 'production' ? '.env.production' : '.env.development'
  });
  
  // Import using the correct CommonJS syntax for firebase-admin
  const admin = require("firebase-admin");
  
  // Prevent re-initialising on hot reloads (e.g. nodemon) using getApps()
  if (admin.apps.length === 0) {
    let appCredential;

    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      // Parses the entire JSON string cleanly on Vercel (No newline issues!)
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      appCredential = admin.credential.cert(serviceAccount);
    } else {
      // Fallback to standard file-based credentials for local development
      appCredential = admin.credential.applicationDefault();
    }

    admin.initializeApp({ credential: appCredential });
  }
   
  /**
   * Verifies a Firebase ID token sent from the frontend.
   *
   * @param {string} idToken  — the raw Firebase ID token
   * @returns {Promise<import("firebase-admin/auth").DecodedIdToken>} decoded token payload
   * @throws if the token is invalid or expired
   */
  const verifyFirebaseToken = async (idToken) => {
    if (!idToken) throw new Error("No Firebase ID token provided");
    // checkRevoked: true revokes sessions when the user is disabled or deleted
    return admin.auth().verifyIdToken(idToken, /* checkRevoked */ true);
  };
   
  module.exports = { verifyFirebaseToken };
