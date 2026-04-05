// ══════════════════════════════════════════════════════════════
// Telegram Bot Logic
// ══════════════════════════════════════════════════════════════
const TelegramBot   = require('node-telegram-bot-api');
const firebaseAdmin = require('./firebase-admin'); // lazy accessor
const getDb = () => firebaseAdmin.db;              // called after initFirebase()

let botInstance = null;

// Active retry timers: { key: { timerId, count } }
const retryTimers = {};

function initBot() {
  if (!process.env.TELEGRAM_BOT_TOKEN) {
    console.error('❌ TELEGRAM_BOT_TOKEN .env faylda yo\'q!');
    return null;
  }

  const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
  botInstance = bot;

  // ── KEYBOARDS ─────────────────────────────────────────────
  const mainKeyboard = {
    reply_markup: {
      keyboard: [
        [{ text: '💊 Bugungi Dorilarim' }, { text: '🍽️ Bugungi Ovqat' }],
        [{ text: '✅ Odatlarim' }, { text: '📝 Eslatmalar (Notepad)' }],
        [{ text: '🌐 Saytga o\'tish' }]
      ],
      resize_keyboard: true,
    }
  };

  // ── /start command ─────────────────────────────────────────
  bot.onText(/\/start(?:\s+(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const uid    = match?.[1]; // deep link parameter (user UID)
    const from   = msg.from;

    if (uid) {
      // Link the user
      try {
        await getDb().collection('users').doc(uid).set({
          telegramLinked: true,
          telegramChatId: chatId.toString(),
          telegramUsername: from.username || null,
          telegramName: `${from.first_name || ''} ${from.last_name || ''}`.trim(),
        }, { merge: true });

        bot.sendMessage(chatId, `
🎉 *Ulandi!*

Assalomu alaykum, ${from.first_name}! Siz Eslat ilovasining eslatma botiga muvaffaqiyatli ulangiz!

💊 Dori vaqti kelganda xabar olasiz
🍽️ Ovqatlanish eslatmalari
✅ Kunlik odatlar eslatmasi

Hozir dori va menyularingizni ko'rish uchun pastdagi tugmalardan foydalaning vizual menyulardan.
        `, { parse_mode: 'Markdown', ...mainKeyboard });
      } catch (e) {
        console.error('Telegram link error:', e);
        bot.sendMessage(chatId, '❌ Bog\'lashda xatolik. Qaytadan urinib ko\'ring.');
      }
    } else {
      // Just /start without UID
      bot.sendMessage(chatId, `
👋 *Eslat Bot*ga xush kelibsiz!

Bu bot sizga sog'liq eslatmalarini yuboradi.

Botni Eslat ilovasiga ulash uchun:
1. [Eslat ilova](${process.env.FRONTEND_URL || 'http://localhost:5500'}) ga boring
2. *Sozlamalar* sahifasiga o'ting
3. *Telegram-ni ulash* tugmasini bosing
      `, { parse_mode: 'Markdown', ...mainKeyboard });
    }
  });

  // ── Text Commands & Menus ──────────────────────────────────
  bot.on('message', async (msg) => {
    if (!msg.text) return;
    if (msg.text === '/start' || msg.text.startsWith('/start ') || msg.text === '/help') return;

    const chatId = msg.chat.id;
    const uid    = await getUidByChatId(chatId);

    if (!uid) {
      if (['💊 Bugungi Dorilarim', '🍽️ Bugungi Ovqat', '✅ Odatlarim', '📝 Eslatmalar (Notepad)'].includes(msg.text)) {
        return bot.sendMessage(chatId, "⚠️ Iltimos, oldin ilova orqali hisobingizni ulang (/start).");
      }
      return;
    }

    if (msg.text === '💊 Bugungi Dorilarim') {
      const snap = await getDb().collection('users').doc(uid).collection('medicines')
        .where('active', '==', true).get();
      if (snap.empty) return bot.sendMessage(chatId, "Bugun uchun dori belgilanmagan.", mainKeyboard);
      
      let text = '💊 *Bugungi dorilaringiz:*\n\n';
      snap.docs.forEach(d => {
        const data = d.data();
        text += `${data.takenToday ? '✅' : '⏳'} *${data.name}* — ${data.times.join(', ')}\n${data.note ? `_${data.note}_\n` : ''}`;
      });
      bot.sendMessage(chatId, text, { parse_mode: 'Markdown', ...mainKeyboard });

    } else if (msg.text === '🍽️ Bugungi Ovqat') {
      const todayStr = getTodayStr();
      const snap = await getDb().collection('users').doc(uid).collection('meals')
        .where('date', '==', todayStr).get();
      if (snap.empty) return bot.sendMessage(chatId, "Bugun uchun maxsus ovqat belgilanmagan.", mainKeyboard);

      let text = '🍽️ *Bugungi ovqatlanish jadvali:*\n\n';
      snap.docs.forEach(d => {
        const data = d.data();
        text += `${data.confirmed ? '✅' : '⏳'} *${data.name}* — ${data.time} ${data.calories ? `(${data.calories} kcal)` : ''}\n`;
      });
      bot.sendMessage(chatId, text, { parse_mode: 'Markdown', ...mainKeyboard });

    } else if (msg.text === '✅ Odatlarim') {
      const snap = await getDb().collection('users').doc(uid).collection('routines').get();
      if (snap.empty) return bot.sendMessage(chatId, "Hali hech qanday odat qo'shilmagan.", mainKeyboard);

      let text = '✅ *Sizning odatlaringiz:*\n\n';
      const today = getTodayStr();
      snap.docs.forEach(d => {
        const data = d.data();
        const isDone = data.doneDate === today;
        text += `${isDone ? '🔥' : '⏳'} *${data.name}* (Olov: ${data.streak || 0})\n`;
      });
      bot.sendMessage(chatId, text, { parse_mode: 'Markdown', ...mainKeyboard });

    } else if (msg.text === '📝 Eslatmalar (Notepad)') {
      const snap = await getDb().collection('users').doc(uid).collection('notes')
        .orderBy('createdAt', 'desc').limit(5).get();
      
      let text = '📝 *Oxirgi eslatmalaringiz (Notepad):*\n\n';
      if (snap.empty) {
        text += "_Xotirangiz toza. Hali hech qanday qayd yozilmagan._\n";
      } else {
        snap.docs.forEach(d => {
          const data = d.data();
          text += `🔹 ${data.text}\n`;
        });
      }
      text += '\n💡 _Yangi eslatma qoldirish uchun shunchaki menga matn yozib yuboring!_';
      bot.sendMessage(chatId, text, { parse_mode: 'Markdown', ...mainKeyboard });

    } else if (msg.text === '🌐 Saytga o\'tish') {
      bot.sendMessage(chatId, `Dasturni ochish: ${process.env.FRONTEND_URL || 'http://localhost:5500'}`, mainKeyboard);
    } else {
      // Save generic text as a new Note
      try {
        await getDb().collection('users').doc(uid).collection('notes').add({
          text: msg.text,
          createdAt: new Date().toISOString()
        });
        bot.sendMessage(chatId, '✅ Qayd (Notepadga) muvaffaqiyatli saqlandi!', mainKeyboard);
      } catch (e) {
        bot.sendMessage(chatId, '❌ Eslatmani saqlashda xatolik yuz berdi.');
      }
    }
  });

  // ── Callback query handler ─────────────────────────────────
  bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const data   = query.data;
    const msgId  = query.message.message_id;

    bot.answerCallbackQuery(query.id);

    // Format: action:type:docId:uid
    // e.g. "taken:medicine:abc123:useruid"
    const parts = data.split(':');
    const action = parts[0];
    const type   = parts[1];
    const docId  = parts[2];
    const uid    = parts[3];

    if (action === 'taken') {
      await handleTaken(bot, chatId, msgId, type, docId, uid);
    } else if (action === 'later') {
      await handleLater(bot, chatId, msgId, type, docId, uid);
    } else if (action === 'skip') {
      await handleSkip(bot, chatId, msgId, type, docId, uid);
    }
  });

  // ── /help ──────────────────────────────────────────────────
  bot.onText(/\/help/, (msg) => {
    bot.sendMessage(msg.chat.id, `
📖 *Eslat Bot Yordam*

*Buyruqlar:*
/start — Botni boshlash
/status — Bugungi eslatmalar holati
/help — Yordam

*Tugmalar:*
✅ *Ichdim/Bajarildi* — Tasdiqlash
⏰ *Keyinroq* — 30 daqiqadan keyin eslatma
❌ *O'tkazib yuborish* — Eslatmani o'chirib tashlash
    `, { parse_mode: 'Markdown' });
  });

  console.log('✅ Telegram bot ishga tushdi');
  return bot;
}

// ── TAKEN handler ────────────────────────────────────────────
async function handleTaken(bot, chatId, msgId, type, docId, uid) {
  const today = getTodayStr();

  try {
    // Cancel retry timer if any
    cancelRetry(`${type}:${docId}`);

    let emoji = '✅';
    let text  = '';

    if (type === 'medicine') {
      await getDb().collection('users').doc(uid).collection('medicines').doc(docId).update({
        takenToday: true,
        takenAt:    new Date().toISOString(),
        dosesTaken: require('firebase-admin').firestore.FieldValue.increment(1),
      });
      await logHistory(uid, type, docId, 'taken');
      text = '💊 *Dori qabul qilindi!*\n\nJuda yaxshi! Sog\'ligingizni saqlang 💪';
      emoji = '💊';
    } else if (type === 'meal') {
      await getDb().collection('users').doc(uid).collection('meals').doc(docId).update({
        confirmed: true, confirmedAt: new Date().toISOString(),
      });
      text = '🍽️ *Ovqat belgilandi!*\n\nSog\'lom ovqatlanish davom eting!';
      emoji = '🍽️';
    } else if (type === 'routine') {
      await getDb().collection('users').doc(uid).collection('routines').doc(docId).update({
        doneDate: today,
        streak: require('firebase-admin').firestore.FieldValue.increment(1),
      });
      text = '✅ *Odat bajarildi!*\n\nZo\'r! Streak davom etyapti 🔥';
      emoji = '✅';
    }

    // Edit the original message
    bot.editMessageText(`${emoji} ${text}`, {
      chat_id: chatId,
      message_id: msgId,
      parse_mode: 'Markdown',
    }).catch(() => bot.sendMessage(chatId, `${emoji} ${text}`, { parse_mode: 'Markdown' }));

  } catch (e) {
    console.error('handleTaken error:', e);
    bot.sendMessage(chatId, '❌ Xatolik yuz berdi. Ilova orqali belgilang.');
  }
}

// ── LATER handler ────────────────────────────────────────────
async function handleLater(bot, chatId, msgId, type, docId, uid) {
  bot.editMessageText('⏰ Tushunarli! 30 daqiqadan keyin eslataman.', {
    chat_id: chatId, message_id: msgId,
  }).catch(() => {});

  setTimeout(async () => {
    const snap = await getDb().collection('users').doc(uid).collection(getCollection(type)).doc(docId).get();
    if (!snap.exists) return;
    const item = snap.data();
    const name = item.name || 'Eslatma';

    const laterMsg = buildReminderMessage(type, name, item, '⏰ Eslatma (kechiktirilgan)');
    await sendReminder(bot, chatId.toString(), laterMsg, { type, docId, uid }, type, 1);
  }, 30 * 60 * 1000); // 30 min
}

// ── SKIP handler ─────────────────────────────────────────────
async function handleSkip(bot, chatId, msgId, type, docId, uid) {
  cancelRetry(`${type}:${docId}`);
  bot.editMessageText('❌ O\'tkazib yuborildi.', {
    chat_id: chatId, message_id: msgId,
  }).catch(() => {});
  await logHistory(uid, type, docId, 'skipped');
}

// ── SEND REMINDER ─────────────────────────────────────────────
async function sendReminder(bot, chatId, message, context, type, retryCount = 0) {
  if (!bot || !chatId) return;

  const keyboard = context ? {
    inline_keyboard: [[
      { text: '✅ Bajarildi', callback_data: `taken:${type}:${context.docId}:${context.uid}` },
      { text: '⏰ 30 daqiqada', callback_data: `later:${type}:${context.docId}:${context.uid}` },
      { text: '❌ O\'tkazish', callback_data: `skip:${type}:${context.docId}:${context.uid}` },
    ]],
  } : undefined;

  try {
    const sentMsg = await bot.sendMessage(chatId, message, {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });

    // Setup retry logic (max 5 retries, every 5 minutes)
    if (context && retryCount < 5) {
      const key = `${type}:${context.docId}`;
      cancelRetry(key);

      const timer = setTimeout(async () => {
        // Check if already done
        const snap = await getDb().collection('users').doc(context.uid)
          .collection(getCollection(type)).doc(context.docId).get();
        if (!snap.exists) return;
        const data = snap.data();
        const today = getTodayStr();

        const isDone = (type === 'medicine' && data.takenToday) ||
                       (type === 'routine'  && data.doneDate === today) ||
                       (type === 'meal'     && data.confirmed);

        if (!isDone) {
          const retryNum = retryCount + 1;
          const retryMsg = `⚠️ *Eslatma #${retryNum + 1}*\n\n${message.replace('⏰ Eslatma vaqti!', '⚠️ Hali bajarilmadi!')}`;
          await sendReminder(bot, chatId, retryMsg, context, type, retryNum);
        }
      }, 5 * 60 * 1000); // 5 minutes

      retryTimers[key] = { timerId: timer, count: retryCount };
    } else if (context && retryCount >= 5) {
      // Final warning
      bot.sendMessage(chatId, `⚠️ *Ogohlantirish*\n\n${getItemName(context)} uchun eslatma ${retryCount + 1} marta yuborildi, lekin javob kelmadi.\n\n_Iltimos, ilovani tekshiring._`, {
        parse_mode: 'Markdown',
      });
    }

    return sentMsg;
  } catch (e) {
    console.error('sendReminder error:', e.message);
  }
}

// ── HELPERS ──────────────────────────────────────────────────
function cancelRetry(key) {
  if (retryTimers[key]) {
    clearTimeout(retryTimers[key].timerId);
    delete retryTimers[key];
  }
}

function getCollection(type) {
  const map = { medicine: 'medicines', meal: 'meals', routine: 'routines' };
  return map[type] || type + 's';
}

function getTodayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function buildReminderMessage(type, name, item, header = '⏰ Eslatma vaqti!') {
  if (type === 'medicine') {
    return `💊 *${header}*\n\n*${name}* ${item.dose || ''} ichish vaqti keldi!\n${item.note ? `📝 _${item.note}_` : ''}`;
  } else if (type === 'meal') {
    return `🍽️ *${header}*\n\n*${name}* yeyish vaqti!${item.calories ? `\n🔥 ${item.calories} kcal` : ''}`;
  } else if (type === 'routine') {
    return `✅ *${header}*\n\n*${name}* — bugungi odat vaqti!`;
  }
  return `⏰ *${header}*\n\n*${name}*`;
}

async function logHistory(uid, type, docId, action) {
  try {
    await getDb().collection('users').doc(uid).collection('history').add({
      type, docId, action,
      timestamp: new Date().toISOString(),
      date: getTodayStr(),
    });
  } catch (e) { /* silent */ }
}

function getItemName(context) {
  return context.name || context.docId;
}

async function getUidByChatId(chatId) {
  try {
    const snap = await getDb().collection('users').where('telegramChatId', '==', chatId.toString()).limit(1).get();
    if (snap.empty) return null;
    return snap.docs[0].id;
  } catch (e) {
    return null;
  }
}

module.exports = { initBot, sendReminder, buildReminderMessage };
