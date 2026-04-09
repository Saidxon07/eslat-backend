const admin = require('./firebase-admin');
console.log('Test start');
admin.initFirebase();
console.log('Init done. DB:', admin.db ? 'Yes' : 'No');
admin.db.collection('users').limit(1).get()
  .then(s => {
    console.log('✅ OK. Docs:', s.size);
    process.exit(0);
  })
  .catch(e => {
    console.error('❌ Error:', e);
    process.exit(1);
  });
