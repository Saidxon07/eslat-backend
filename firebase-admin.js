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
    let serviceAccount;
    
    // Yechim 1: Koyeb yoki Render uchun JSON string orqali (Environment Variable)
    if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
      serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    } 
    // Yechim 2: Fayl orqali (Lokal kompyuter uchun)
    else if (fs.existsSync(serviceAccountPath)) {
      serviceAccount = require(serviceAccountPath);
    }

    if (serviceAccount) {
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
