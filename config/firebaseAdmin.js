// Load environment variables
require('dotenv').config({
    path: process.env.NODE_ENV === 'production' ? '.env.production' : '.env.development'
  });
  
  // Import using the correct CommonJS syntax for firebase-admin
  const admin = require("firebase-admin");
  
  // Prevent re-initialising on hot reloads (e.g. nodemon) using getApps()
  if (admin.apps.length === 0) {
    const appCredential = process.env.GOOGLE_APPLICATION_CREDENTIALS
        ? // File-based credential (recommended for local dev)
          admin.credential.applicationDefault()
        : // Env-var credential (recommended for production / CI)
          admin.credential.cert({
            projectId:   process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            // The private key comes in as a single env-var string with literal \n
            privateKey:  (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
          });
   
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