require('dotenv').config();
const path = require('path');
const express = require('express');
const { Pool } = require('pg');
const { Telegraf, Markup } = require('telegraf');

const app = express();
const PORT = process.env.PORT || 3000;

// Chek rasmlarini Base64 formatda qabul qilish uchun limitni 15MB qilamiz
app.use(express.json({ limit: '15mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

const bot = new Telegraf(process.env.BOT_TOKEN);

// Yordamchi: Sozlamalarni olish
async function getSettings() {
  const res = await pool.query('SELECT * FROM settings');
  const settings = {};
  res.rows.forEach(r => { settings[r.key] = r.value; });
  return settings;
}

// ==========================================================
// 1. AVTORIZATSIYA VA RO'YXATDAN O'TISH
// ==========================================================

app.post('/api/login', async (req, res) => {
  try {
    const { username, password, telegramId } = req.body;
    const result = await pool.query(
      'SELECT * FROM users WHERE LOWER(username) = LOWER($1) AND password = $2',
      [username.trim(), password.trim()]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ success: false, message: "Login yoki parol noto'g'ri!" });
    }

    const user = result.rows[0];

    if (telegramId && user.telegram_id !== Number(telegramId)) {
      await pool.query('UPDATE users SET telegram_id = NULL WHERE telegram_id = $1', [telegramId]);
      await pool.query('UPDATE users SET telegram_id = $1 WHERE id = $2', [telegramId, user.id]);
      user.telegram_id = telegramId;
    }

    delete user.password;
    res.json({ success: true, user });
  } catch (err) {
    console.error("Login xato:", err);
    res.status(500).json({ success: false, message: "Server xatoligi" });
  }
});

app.post('/api/register', async (req, res) => {
  try {
    const { fullName, phone, username, password, groupId, telegramId } = req.body;

    const check = await pool.query('SELECT id FROM users WHERE LOWER(username) = LOWER($1)', [username.trim()]);
    if (check.rows.length > 0) {
      return res.status(400).json({ success: false, message: "Bu login band, boshqa tanlang!" });
    }

    if (telegramId) {
      await pool.query('UPDATE users SET telegram_id = NULL WHERE telegram_id = $1', [telegramId]);
    }

    const insertRes = await pool.query(
      `INSERT INTO users (full_name, phone, username, password, role, group_id, telegram_id)
       VALUES ($1, $2, $3, $4, 'student', $5, $6) RETURNING *`,
      [fullName.trim(), phone.trim(), username.trim(), password.trim(), Number(groupId) || 1, telegramId || null]
    );

    const user = insertRes.rows[0];
    delete user.password;
    res.json({ success: true, user });
  } catch (err) {
    console.error("Register xato:", err);
    res.status(500).json({ success: false, message: "Ro'yxatdan o'tishda xatolik!" });
  }
});

app.get('/api/public/groups', async (req, res) => {
  try {
    const groups = await pool.query('SELECT id, name, level, days, time, price FROM groups ORDER BY id ASC');
    res.json(groups.rows);
  } catch (err) {
    res.status(500).json([]);
  }
});

// ==========================================================
// 2. DASHBOARD MA'LUMOTLARI (HAR BIR ROL UCHUN ALOHIDA)
// ==========================================================

app.get('/api/dashboard/:userId', async (req, res) => {
  try {
    const userId = Number(req.params.userId);
    const userRes = await pool.query('SELECT id, username, full_name, phone, role, group_id FROM users WHERE id = $1', [userId]);

    if (userRes.rows.length === 0) {
      return res.status(404).json({ error: "Foydalanuvchi topilmadi" });
    }

    const user = userRes.rows[0];
    const settings = await getSettings();

    // --- 1. O'QUVCHI KABINETI ---
    if (user.role === 'student') {
      const groupRes = await pool.query(
        `SELECT g.*, u.full_name AS teacher_name, u.phone AS teacher_phone
         FROM groups g 
         LEFT JOIN users u ON g.teacher_id = u.id 
         WHERE g.id = $1`,
        [user.group_id]
      );

      const attRes = await pool.query('SELECT * FROM attendance WHERE student_id = $1 ORDER BY id DESC', [user.id]);
      const hwRes = await pool.query('SELECT * FROM homeworks WHERE group_id = $1 ORDER BY id DESC', [user.group_id]);
      const payRes = await pool.query('SELECT * FROM payments WHERE student_id = $1 ORDER BY id DESC', [user.id]);

      const totalLessons = attRes.rowCount;
      const presentCount = attRes.rows.filter(a => a.status === 'present').length;
      const attendanceRate = totalLessons > 0 ? Math.round((presentCount / totalLessons) * 100) : 100;

      return res.json({
        user,
        settings,
        group: groupRes.rows[0] || null,
        attendance: attRes.rows,
        attendanceRate,
        homeworks: hwRes.rows,
        payments: payRes.rows
      });
    }

    // --- 2. O'QITUVCHI KABINETI (Faqat o'zining guruhlari va o'quvchilari) ---
    if (user.role === 'teacher') {
      const groupsRes = await pool.query('SELECT * FROM groups WHERE teacher_id = $1 ORDER BY id ASC', [user.id]);
      const myGroups = groupsRes.rows;
      const groupIds = myGroups.map(g => g.id);

      let students = [];
      let homeworks = [];
      let attendanceHistory = [];

      if (groupIds.length > 0) {
        const stRes = await pool.query(
          "SELECT id, full_name, phone, group_id FROM users WHERE role = 'student' AND group_id = ANY($1::int[]) ORDER BY full_name ASC",
          [groupIds]
        );
        students = stRes.rows;

        const hwRes = await pool.query(
          `SELECT h.*, g.name AS group_name 
           FROM homeworks h 
           JOIN groups g ON h.group_id = g.id 
           WHERE h.group_id = ANY($1::int[])
           ORDER BY h.id DESC`,
          [groupIds]
        );
        homeworks = hwRes.rows;

        const attRes = await pool.query(
          `SELECT a.*, u.full_name AS student_name, g.name AS group_name
           FROM attendance a
           JOIN users u ON a.student_id = u.id
           JOIN groups g ON a.group_id = g.id
           WHERE a.group_id = ANY($1::int[])
           ORDER BY a.id DESC LIMIT 30`,
          [groupIds]
        );
        attendanceHistory = attRes.rows;
      }

      return res.json({
        user,
        groups: myGroups,
        students,
        homeworks,
        attendanceHistory
      });
    }

    // --- 3. ADMIN KABINETI (To'liq boshqaruv va Statistika) ---
    if (user.role === 'admin') {
      const usersRes = await pool.query('SELECT id, username, password, full_name, phone, role, group_id FROM users ORDER BY id DESC');
      const groupsRes = await pool.query(
        `SELECT g.*, u.full_name AS teacher_name 
         FROM groups g 
         LEFT JOIN users u ON g.teacher_id = u.id 
         ORDER BY g.id ASC`
      );
      const payRes = await pool.query(
        `SELECT p.*, u.full_name AS student_name, u.phone AS student_phone, g.name AS group_name
         FROM payments p 
         JOIN users u ON p.student_id = u.id 
         LEFT JOIN groups g ON u.group_id = g.id
         ORDER BY p.id DESC`
      );
      const attRes = await pool.query('SELECT * FROM attendance ORDER BY id DESC');

      const students = usersRes.rows.filter(u => u.role === 'student');
      const teachers = usersRes.rows.filter(u => u.role === 'teacher');

      const approvedPayments = payRes.rows.filter(p => p.status === 'approved');
      const pendingPayments = payRes.rows.filter(p => p.status === 'pending');
      const totalCollected = approvedPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
      const totalPending = pendingPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0);

      const totalAtt = attRes.rowCount;
      const presentAtt = attRes.rows.filter(a => a.status === 'present').length;
      const overallAttRate = totalAtt > 0 ? Math.round((presentAtt / totalAtt) * 100) : 100;

      // Har bir guruh bo'yicha hisobot
      const groupReports = groupsRes.rows.map(g => {
        const gStudents = students.filter(s => s.group_id === g.id);
        const gAtt = attRes.rows.filter(a => a.group_id === g.id);
        const gPresent = gAtt.filter(a => a.status === 'present').length;
        const gRate = gAtt.length > 0 ? Math.round((gPresent / gAtt.length) * 100) : 100;
        const gPaid = approvedPayments
          .filter(p => gStudents.some(st => st.id === p.student_id))
          .reduce((sum, p) => sum + Number(p.amount || 0), 0);

        return {
          id: g.id,
          name: g.name,
          level: g.level,
          teacher: g.teacher_name || 'Tayinlanmagan',
          days: g.days,
          time: g.time,
          studentCount: gStudents.length,
          attendanceRate: gRate,
          collectedAmount: gPaid,
          expectedAmount: gStudents.length * (g.price || 450000)
        };
      });

      return res.json({
        user,
        settings,
        stats: {
          totalStudents: students.length,
          totalTeachers: teachers.length,
          totalGroups: groupsRes.rowCount,
          totalCollected,
          totalPending,
          pendingCount: pendingPayments.length,
          overallAttRate
        },
        users: usersRes.rows,
        students,
        teachers,
        groups: groupsRes.rows,
        payments: payRes.rows,
        groupReports
      });
    }
  } catch (err) {
    console.error("Dashboard xato:", err);
    res.status(500).json({ error: "Server xatoligi" });
  }
});

// ==========================================================
// 3. O'QUVCHI AMALLARI (ONLAYN TO'LOV CHEKINI YUBORISH)
// ==========================================================

app.post('/api/student/payment', async (req, res) => {
  try {
    const { studentId, month, amount, receiptImage } = req.body;
    const today = new Date().toLocaleDateString('ru-RU');

    await pool.query(
      `INSERT INTO payments (student_id, month, amount, date, receipt_image, status)
       VALUES ($1, $2, $3, $4, $5, 'pending')`,
      [Number(studentId), month, Number(amount), today, receiptImage]
    );

    // Adminlarga Telegram orqali xabar berish
    const stRes = await pool.query('SELECT full_name FROM users WHERE id = $1', [Number(studentId)]);
    const studentName = stRes.rows[0]?.full_name || "O'quvchi";
    const admins = await pool.query("SELECT telegram_id FROM users WHERE role = 'admin' AND telegram_id IS NOT NULL");

    for (const adm of admins.rows) {
      bot.telegram.sendMessage(
        adm.telegram_id,
        `🔔 *Yangi To'lov Cheki Kelib Tushdi!*\n\n👤 O'quvchi: *${studentName}*\n📅 Oy: *${month}*\n💰 Summa: *${Number(amount).toLocaleString()} so'm*\n\nAdmin kabinetiga kirib chekni ko'rishingiz va tasdiqlashingiz mumkin.`,
        { parse_mode: 'Markdown' }
      ).catch(() => {});
    }

    res.json({ success: true });
  } catch (err) {
    console.error("Student payment xato:", err);
    res.status(500).json({ success: false });
  }
});

// ==========================================================
// 4. O'QITUVCHI AMALLARI
// ==========================================================

app.post('/api/teacher/attendance', async (req, res) => {
  try {
    const { groupId, date, topic, records } = req.body;

    for (const rec of records) {
      await pool.query(
        'INSERT INTO attendance (student_id, group_id, date, topic, status) VALUES ($1, $2, $3, $4, $5)',
        [rec.studentId, groupId, date, topic, rec.status]
      );

      if (rec.status === 'absent') {
        const stRes = await pool.query('SELECT full_name, telegram_id FROM users WHERE id = $1', [rec.studentId]);
        const st = stRes.rows[0];
        if (st && st.telegram_id) {
          bot.telegram.sendMessage(
            st.telegram_id,
            `⚠️ *ZED Academy — Davomat Ogohlantirishi*\n\nHurmatli *${st.full_name}*, siz bugun (${date}) bo'lib o'tgan *"${topic}"* darsiga qatnashmadingiz.`,
            { parse_mode: 'Markdown' }
          ).catch(() => {});
        }
      }
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

app.post('/api/teacher/homework', async (req, res) => {
  try {
    const { groupId, title, deadline } = req.body;
    await pool.query(
      'INSERT INTO homeworks (group_id, title, deadline) VALUES ($1, $2, $3)',
      [groupId, title, deadline]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

// ==========================================================
// 5. ADMIN AMALLARI (FOYDALANUVCHILAR, GURUHLAR, TO'LOVLAR, KARTA)
// ==========================================================

// A) Foydalanuvchi qo'shish (Student, Teacher, Admin)
app.post('/api/admin/users', async (req, res) => {
  try {
    const { fullName, phone, username, password, role, groupId } = req.body;
    const check = await pool.query('SELECT id FROM users WHERE LOWER(username) = LOWER($1)', [username.trim()]);
    if (check.rows.length > 0) {
      return res.status(400).json({ success: false, message: "Bu login (username) band!" });
    }

    await pool.query(
      'INSERT INTO users (full_name, phone, username, password, role, group_id) VALUES ($1, $2, $3, $4, $5, $6)',
      [fullName.trim(), phone.trim(), username.trim(), password.trim(), role, role === 'student' ? (Number(groupId) || null) : null]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: "Xatolik yuz berdi" });
  }
});

// B) Foydalanuvchini tahrirlash
app.put('/api/admin/users/:id', async (req, res) => {
  try {
    const userId = Number(req.params.id);
    const { fullName, phone, username, password, role, groupId } = req.body;

    const check = await pool.query('SELECT id FROM users WHERE LOWER(username) = LOWER($1) AND id != $2', [username.trim(), userId]);
    if (check.rows.length > 0) {
      return res.status(400).json({ success: false, message: "Bu login boshqa foydalanuvchida band!" });
    }

    await pool.query(
      `UPDATE users 
       SET full_name = $1, phone = $2, username = $3, password = $4, role = $5, group_id = $6
       WHERE id = $7`,
      [fullName.trim(), phone.trim(), username.trim(), password.trim(), role, role === 'student' ? (Number(groupId) || null) : null, userId]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("User update xato:", err);
    res.status(500).json({ success: false, message: "Tahrirlashda xatolik" });
  }
});

// C) Foydalanuvchini o'chirish
app.delete('/api/admin/users/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM users WHERE id = $1', [Number(req.params.id)]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

// D) Yangi guruh qo'shish
app.post('/api/admin/groups', async (req, res) => {
  try {
    const { name, level, teacherId, days, time, room, price } = req.body;
    await pool.query(
      'INSERT INTO groups (name, level, teacher_id, days, time, room, price) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [name.trim(), level.trim(), Number(teacherId) || null, days.trim(), time.trim(), room.trim(), Number(price) || 450000]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

// E) Guruhni tahrirlash
app.put('/api/admin/groups/:id', async (req, res) => {
  try {
    const groupId = Number(req.params.id);
    const { name, level, teacherId, days, time, room, price } = req.body;
    await pool.query(
      `UPDATE groups 
       SET name = $1, level = $2, teacher_id = $3, days = $4, time = $5, room = $6, price = $7
       WHERE id = $8`,
      [name.trim(), level.trim(), Number(teacherId) || null, days.trim(), time.trim(), room.trim(), Number(price) || 450000, groupId]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

// F) Guruhni o'chirish
app.delete('/api/admin/groups/:id', async (req, res) => {
  try {
    const groupId = Number(req.params.id);
    await pool.query('UPDATE users SET group_id = NULL WHERE group_id = $1', [groupId]);
    await pool.query('DELETE FROM groups WHERE id = $1', [groupId]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

// G) Admin karta ma'lumotlarini yangilash
app.post('/api/admin/settings/card', async (req, res) => {
  try {
    const { cardNumber, cardHolder, cardBank } = req.body;
    await pool.query("INSERT INTO settings (key, value) VALUES ('card_number', $1) ON CONFLICT (key) DO UPDATE SET value = $1", [cardNumber.trim()]);
    await pool.query("INSERT INTO settings (key, value) VALUES ('card_holder', $1) ON CONFLICT (key) DO UPDATE SET value = $1", [cardHolder.trim()]);
    await pool.query("INSERT INTO settings (key, value) VALUES ('card_bank', $1) ON CONFLICT (key) DO UPDATE SET value = $1", [cardBank.trim()]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

// H) To'lov chekini Tasdiqlash yoki Rad etish
app.put('/api/admin/payments/:id', async (req, res) => {
  try {
    const paymentId = Number(req.params.id);
    const { status } = req.body; // 'approved' yoki 'rejected'

    await pool.query('UPDATE payments SET status = $1 WHERE id = $2', [status, paymentId]);

    const payRes = await pool.query(
      `SELECT p.*, u.full_name, u.telegram_id 
       FROM payments p 
       JOIN users u ON p.student_id = u.id 
       WHERE p.id = $1`,
      [paymentId]
    );
    const p = payRes.rows[0];

    if (p && p.telegram_id) {
      if (status === 'approved') {
        bot.telegram.sendMessage(
          p.telegram_id,
          `✅ *ZED Academy — To'lovingiz Tasdiqlandi!*\n\n👤 O'quvchi: *${p.full_name}*\n📅 Oy: *${p.month}*\n💳 Summa: *${Number(p.amount).toLocaleString()} so'm*\n📆 Sana: ${p.date}\n\nRahmat!`,
          { parse_mode: 'Markdown' }
        ).catch(() => {});
      } else if (status === 'rejected') {
        bot.telegram.sendMessage(
          p.telegram_id,
          `❌ *ZED Academy — To'lov Cheki Rad Etildi*\n\nHurmatli *${p.full_name}*, yuborgan to'lov chekingiz (${p.month}) tasdiqlanmadi. Iltimos, qayta tekshirib yuboring yoki ma'muriyatga murojaat qiling.`,
          { parse_mode: 'Markdown' }
        ).catch(() => {});
      }
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

// I) Admin tomonidan naqd/to'g'ridan-to'g'ri to'lov kiritish
app.post('/api/admin/payments', async (req, res) => {
  try {
    const { studentId, month, amount } = req.body;
    const today = new Date().toLocaleDateString('ru-RU');

    await pool.query(
      `INSERT INTO payments (student_id, month, amount, date, status)
       VALUES ($1, $2, $3, $4, 'approved')`,
      [Number(studentId), month, Number(amount), today]
    );

    const stRes = await pool.query('SELECT full_name, telegram_id FROM users WHERE id = $1', [Number(studentId)]);
    const st = stRes.rows[0];
    if (st && st.telegram_id) {
      bot.telegram.sendMessage(
        st.telegram_id,
        `✅ *ZED Academy — To'lov Qabul Qilindi*\n\n👤 O'quvchi: *${st.full_name}*\n📅 Oy: *${month}*\n💳 Summa: *${Number(amount).toLocaleString()} so'm*`,
        { parse_mode: 'Markdown' }
      ).catch(() => {});
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

// index.js faylining eng pastki qismi:
const WEB_APP_URL = process.env.WEB_APP_URL || 'https://zed-academy.onrender.com';

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🌐 Server ishga tushdi: port ${PORT}`);
  startBot(WEB_APP_URL);
});

function startBot(webAppUrl) {
  bot.start((ctx) => {
    const firstName = ctx.from.first_name || 'Foydalanuvchi';
    ctx.reply(
      `Assalomu alaykum, *${firstName}*! 👋\n\n*ZED Academy* o'quv markazining rasmiy boshqaruv platformasiga xush kelibsiz.\nKabinetingizga kirish uchun quyidagi tugmani bosing:`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.webApp("🎓 ZED Academy Kabineti", webAppUrl)]
        ])
      }
    );
  });

  bot.launch().then(() => {
    console.log('🤖 Bot 24/7 bulutda ishga tushdi!');
  });

  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}
