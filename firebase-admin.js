// ══════════════════════════════════════════════════════════════
// Firebase Admin SDK
// ══════════════════════════════════════════════════════════════
const admin = require('firebase-admin');
const path  = require('path');
const fs    = require('fs');

let db = null;

function initFirebase() {
  if (admin.apps.length > 0) return;

  const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH
    || path.join(__dirname, 'firebase-service-account.json');

  try {
    if (fs.existsSync(serviceAccountPath)) {
      const serviceAccount = require(serviceAccountPath);
      admin.initializeApp({
        credential:              admin.credential.cert(serviceAccount),
        databaseURL:             process.env.FIREBASE_DATABASE_URL,
      });
      console.log('✅ Firebase Admin ulandi (service account)');
    } else {
      // Try Application Default Credentials (for Railway/Render)
      admin.initializeApp({
        credential: admin.credential.applicationDefault(),
      });
      console.log('✅ Firebase Admin ulandi (default credentials)');
    }
  } catch (e) {
    console.error('❌ Firebase Admin ulanmadi:', e.message);
    console.error('💡 firebase-service-account.json faylini yarating!');
    process.exit(1);
  }

  db = admin.firestore();
}

function getDb() {
  if (!db) throw new Error('Firebase hali initsializatsiya qilinmagan');
  return db;
}

module.exports = {
  initFirebase,
  get db() { return db || getDb(); },
  admin,
};
