// ══════════════════════════════════════════════════════════════
// Reminder Scheduler — node-cron
// ══════════════════════════════════════════════════════════════
const cron         = require('node-cron');
const firebaseAdmin = require('./firebase-admin');
const getDb = () => firebaseAdmin.db;
const { sendReminder, buildReminderMessage } = require('./telegram-bot');

// Day of week mapping:
// JS: 0=Sun, 1=Mon ... 6=Sat
// Our app: 0=Mon, 1=Tue ... 6=Sun
function appDowToJsDow(appDow) {
  // appDow: 0=Mon→1, 1=Tue→2, ... 5=Sat→6, 6=Sun→0
  return appDow === 6 ? 0 : appDow + 1;
}

function getTodayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function getCurrentTime() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

function getTodayJsDow() {
  return new Date().getDay(); // 0=Sun...6=Sat
}

// Run every minute
function startScheduler(bot) {
  if (!bot) {
    console.warn('⚠️ Bot yo\'q, scheduler ishlamaydi');
    return;
  }

  cron.schedule('* * * * *', async () => {
    const currentTime = getCurrentTime();
    const todayStr    = getTodayStr();
    const todayJsDow  = getTodayJsDow();

    console.log(`[${new Date().toLocaleTimeString()}] Scheduler tekshirmoqda... Vaqt: ${currentTime}`);

    try {
      // Get all linked users
      const usersSnap = await getDb().collection('users')
        .where('telegramLinked', '==', true)
        .get();

      for (const userDoc of usersSnap.docs) {
        const uid      = userDoc.id;
        const userData = userDoc.data();
        const chatId   = userData.telegramChatId;

        if (!chatId) continue;

        // ── Medicine reminders ─────────────────────────────
        if (userData.medNotify !== false) {
          await checkMedicines(bot, uid, chatId, userData, currentTime, todayStr, todayJsDow);
        }

        // ── Meal reminders ─────────────────────────────────
        if (userData.mealNotify !== false) {
          await checkMeals(bot, uid, chatId, userData, currentTime, todayStr);
        }

        // ── Routine reminders ──────────────────────────────
        if (userData.routineNotify !== false) {
          await checkRoutines(bot, uid, chatId, userData, currentTime, todayStr, todayJsDow);
        }
      }
    } catch (e) {
      console.error('Scheduler xatosi:', e.message);
    }
  });

  // Daily reset at midnight (00:01)
  cron.schedule('1 0 * * *', async () => {
    console.log('🔄 Kunlik reset...');
    await dailyReset();
  });

  console.log('✅ Reminder scheduler ishga tushdi (har daqiqada tekshiradi)');
}

// ── MEDICINE CHECK ────────────────────────────────────────────
async function checkMedicines(bot, uid, chatId, userData, currentTime, todayStr, todayJsDow) {
  try {
    const medsSnap = await getDb().collection('users').doc(uid)
      .collection('medicines')
      .where('active', '==', true)
      .where('notifyTelegram', '==', true)
      .get();

    for (const medDoc of medsSnap.docs) {
      const med = medDoc.data();
      const medId = medDoc.id;

      // Check day
      if (med.days && med.days.length > 0) {
        const jsDows = med.days.map(appDowToJsDow);
        if (!jsDows.includes(todayJsDow)) continue;
      }

      // Check times
      if (!med.times || !med.times.includes(currentTime)) continue;

      // Already taken today?
      if (med.takenToday) continue;

      // Send reminder
      const message = buildReminderMessage('medicine', med.name, med);
      console.log(`💊 Dori eslatmasi: ${med.name} → ${chatId}`);

      await sendReminder(
        bot,
        chatId,
        message,
        { type: 'medicine', docId: medId, uid },
        'medicine',
        0
      );
    }
  } catch (e) {
    console.error('checkMedicines xato:', e.message);
  }
}

// ── MEAL CHECK ────────────────────────────────────────────────
async function checkMeals(bot, uid, chatId, userData, currentTime, todayStr) {
  try {
    const mealsSnap = await getDb().collection('users').doc(uid)
      .collection('meals')
      .where('date', '==', todayStr)
      .where('notifyTelegram', '==', true)
      .get();

    for (const mealDoc of mealsSnap.docs) {
      const meal   = mealDoc.data();
      const mealId = mealDoc.id;

      if (!meal.remindTime || meal.remindTime !== currentTime) continue;
      if (meal.confirmed) continue;

      const message = buildReminderMessage('meal', meal.name, meal);
      console.log(`🍽️ Ovqat eslatmasi: ${meal.name} → ${chatId}`);

      await sendReminder(
        bot, chatId, message,
        { type: 'meal', docId: mealId, uid }, 'meal', 0
      );
    }
  } catch (e) {
    console.error('checkMeals xato:', e.message);
  }
}

// ── ROUTINE CHECK ─────────────────────────────────────────────
async function checkRoutines(bot, uid, chatId, userData, currentTime, todayStr, todayJsDow) {
  try {
    const routSnap = await getDb().collection('users').doc(uid)
      .collection('routines')
      .where('notifyTelegram', '==', true)
      .get();

    for (const routDoc of routSnap.docs) {
      const rout   = routDoc.data();
      const routId = routDoc.id;

      // Check day
      if (rout.days && rout.days.length > 0) {
        const jsDows = rout.days.map(appDowToJsDow);
        if (!jsDows.includes(todayJsDow)) continue;
      }

      if (!rout.time || rout.time !== currentTime) continue;
      if (rout.doneDate === todayStr) continue;

      const message = buildReminderMessage('routine', rout.name, rout);
      console.log(`✅ Odat eslatmasi: ${rout.name} → ${chatId}`);

      await sendReminder(
        bot, chatId, message,
        { type: 'routine', docId: routId, uid }, 'routine', 0
      );
    }
  } catch (e) {
    console.error('checkRoutines xato:', e.message);
  }
}

// ── DAILY RESET ───────────────────────────────────────────────
async function dailyReset() {
  try {
    const usersSnap = await getDb().collection('users').get();
    const batch = getDb().batch();

    for (const userDoc of usersSnap.docs) {
      const uid      = userDoc.id;
      const medsSnap = await getDb().collection('users').doc(uid).collection('medicines').get();

      medsSnap.docs.forEach(medDoc => {
        batch.update(medDoc.ref, { takenToday: false });
      });
    }

    await batch.commit();
    console.log('✅ Kunlik reset completed');
  } catch (e) {
    console.error('dailyReset xato:', e.message);
  }
}

module.exports = { startScheduler };
