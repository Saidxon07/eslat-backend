// ══════════════════════════════════════════════════════════════
// ESLAT Backend — Main Server
// ══════════════════════════════════════════════════════════════
require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const { initBot, sendReminder } = require('./telegram-bot');
const { startScheduler }        = require('./reminder-scheduler');
const firebaseAdmin             = require('./firebase-admin');

const app  = express();
const PORT = process.env.PORT || 3001;
const getDb = () => firebaseAdmin.db;

// ── MIDDLEWARE ───────────────────────────────────────────────
app.use(cors({
  origin: [
    process.env.FRONTEND_URL || 'http://localhost:5500',
    'http://127.0.0.1:5500',
    'http://localhost:5173',
    'http://localhost:3000',
    'https://eslatai2.web.app',
    'https://eslatai2.firebaseapp.com',
  ],
  credentials: true,
}));
app.use(express.json());

// ── INIT ────────────────────────────────────────────────────
firebaseAdmin.initFirebase();
const bot = initBot();
startScheduler(bot);

// ── ROUTES ──────────────────────────────────────────────────

/** Health check */
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    time: new Date().toISOString(),
    service: 'Eslat Backend',
    version: '1.0.0',
    uptime: process.uptime(),
  });
});

/** Check if user linked Telegram */
app.get('/api/check-link', async (req, res) => {
  const { uid } = req.query;
  if (!uid) return res.status(400).json({ error: 'uid required' });

  try {
    const userDoc = await getDb().collection('users').doc(uid).get();
    if (!userDoc.exists) return res.json({ linked: false });

    const data = userDoc.data();
    if (data.telegramLinked && data.telegramChatId) {
      return res.json({ linked: true, chatId: data.telegramChatId });
    }
    return res.json({ linked: false });
  } catch (e) {
    console.error('check-link error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

/** Unlink Telegram */
app.post('/api/unlink-tg', async (req, res) => {
  const { uid } = req.body;
  if (!uid) return res.status(400).json({ error: 'uid required' });

  try {
    const userDoc = await getDb().collection('users').doc(uid).get();
    if (userDoc.exists) {
      const data = userDoc.data();
      if (data.telegramChatId && bot) {
        try {
          bot.sendMessage(data.telegramChatId, "❌ Sizning Telegram hisobingiz Eslat saytidan muvaffaqiyatli uzildi. Agar adashib bosgan bo'lsangiz, sayt orqali qayta ulanishingiz mumkin.");
        } catch (msgErr) {
          console.warn('Telegram xabar yuborishda xato:', msgErr.message);
        }
      }
    }
    await getDb().collection('users').doc(uid).update({ telegramLinked: false, telegramChatId: null });
    res.json({ success: true });
  } catch (e) {
    console.error('unlink-tg error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

/** Manual reminder send (for testing) */
app.post('/api/send-test', async (req, res) => {
  const { uid, message } = req.body;

  if (!uid || !message) return res.status(400).json({ error: 'uid and message required' });

  try {
    const userDoc = await getDb().collection('users').doc(uid).get();
    if (!userDoc.exists || !userDoc.data().telegramChatId) {
      return res.status(404).json({ error: 'User not linked to Telegram' });
    }

    const chatId = userDoc.data().telegramChatId;
    await sendReminder(bot, chatId, message, null, 'test');
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** Get all active reminders (for debugging) */
app.get('/api/reminders', async (req, res) => {
  try {
    const usersSnap = await getDb().collection('users').where('telegramLinked', '==', true).get();
    const reminders = [];

    for (const userDoc of usersSnap.docs) {
      const uid      = userDoc.id;
      const userData = userDoc.data();
      const medsSnap = await getDb().collection('users').doc(uid).collection('medicines')
        .where('active', '==', true)
        .where('notifyTelegram', '==', true)
        .get();

      medsSnap.docs.forEach(m => {
        reminders.push({
          uid,
          name: userData.name,
          medicine: m.data().name,
          times: m.data().times,
          days: m.data().days,
        });
      });
    }

    res.json({ count: reminders.length, reminders });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── START ────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 Eslat Backend ishga tushdi!`);
  console.log(`📡 Server: http://localhost:${PORT}`);
  console.log(`🤖 Telegram bot ulandi`);
  console.log(`⏰ Reminder scheduler ishlamoqda\n`);
});
