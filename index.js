// require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const { Telegraf, Markup } = require('telegraf');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const WEB_APP_URL = process.env.WEB_APP_URL || 'https://zed-academy.onrender.com';

app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));
app.use(express.static(__dirname));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// Auto-ensure new columns/tables exist even if SQL wasn't re-run manually
async function ensureGamificationSchema() {
  try {
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS zed_coins INTEGER NOT NULL DEFAULT 0;`);
    await pool.query(`ALTER TABLE attendance ADD COLUMN IF NOT EXISTS homework_done BOOLEAN NOT NULL DEFAULT FALSE;`);
    await pool.query(`ALTER TABLE attendance ADD COLUMN IF NOT EXISTS coins_awarded INTEGER NOT NULL DEFAULT 0;`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS daily_quizzes (
        id SERIAL PRIMARY KEY,
        question TEXT NOT NULL,
        option_a VARCHAR(255) NOT NULL,
        option_b VARCHAR(255) NOT NULL,
        option_c VARCHAR(255) NOT NULL,
        correct_option CHAR(1) NOT NULL DEFAULT 'A',
        reward_coins INTEGER NOT NULL DEFAULT 10,
        quiz_date DATE NOT NULL DEFAULT CURRENT_DATE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS quiz_submissions (
        id SERIAL PRIMARY KEY,
        quiz_id INTEGER NOT NULL REFERENCES daily_quizzes(id) ON DELETE CASCADE,
        student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        selected_option CHAR(1) NOT NULL,
        is_correct BOOLEAN NOT NULL DEFAULT FALSE,
        coins_earned INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(quiz_id, student_id)
      );
    `);
  } catch (err) {
    console.error('Schema check warning:', err.message);
  }
}
ensureGamificationSchema();

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ================= PUBLIC GROUPS FOR SIGNUP =================
app.get('/api/public/groups', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id, name, level, schedule, monthly_fee FROM groups ORDER BY id ASC');
    res.json({ groups: rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load groups.' });
  }
});

// ================= AUTH & SELF-REGISTRATION =================
app.post('/api/register', async (req, res) => {
  try {
    const { full_name, username, password, phone, group_id, telegram_id } = req.body;

    if (!full_name || !username || !password) {
      return res.status(400).json({ error: 'Full name, username, and password are required.' });
    }
    if (!telegram_id) {
      return res.status(400).json({ error: 'Please open the app inside Telegram to verify your Telegram ID.' });
    }

    const cleanTgId = String(telegram_id).trim();

    const tgCheck = await pool.query('SELECT id, username FROM users WHERE telegram_id = $1 LIMIT 1', [cleanTgId]);
    if (tgCheck.rows.length > 0) {
      return res.status(400).json({
        error: `This Telegram account is already registered (@${tgCheck.rows[0].username}). Only 1 account is allowed.`
      });
    }

    const userCheck = await pool.query('SELECT id FROM users WHERE LOWER(username) = LOWER($1) LIMIT 1', [username.trim()]);
    if (userCheck.rows.length > 0) {
      return res.status(400).json({ error: 'Username is already taken. Please choose another.' });
    }

    const insertRes = await pool.query(
      `INSERT INTO users (full_name, username, password, role, phone, group_id, telegram_id, zed_coins)
       VALUES ($1, $2, $3, 'student', $4, $5, $6, 0)
       RETURNING id`,
      [
        full_name.trim(),
        username.trim(),
        password.trim(),
        (phone || '').trim(),
        group_id ? parseInt(group_id, 10) : null,
        cleanTgId
      ]
    );

    const newUser = await pool.query(
      `SELECT u.id, u.full_name, u.username, LOWER(u.role) AS role, u.phone, u.group_id, u.telegram_id, u.zed_coins,
              g.name AS group_name, g.level AS group_level, g.schedule AS group_schedule, g.monthly_fee
       FROM users u
       LEFT JOIN groups g ON u.group_id = g.id
       WHERE u.id = $1`,
      [insertRes.rows[0].id]
    );

    res.json({ user: newUser.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password, telegram_id } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Please enter username and password.' });
    }

    const result = await pool.query(
      `SELECT u.id, u.full_name, u.username, LOWER(u.role) AS role, u.phone, u.group_id, u.telegram_id, u.zed_coins,
              g.name AS group_name, g.level AS group_level, g.schedule AS group_schedule, g.monthly_fee
       FROM users u
       LEFT JOIN groups g ON u.group_id = g.id
       WHERE LOWER(u.username) = LOWER($1) AND u.password = $2
       LIMIT 1`,
      [username.trim(), password.trim()]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    const user = result.rows[0];
    if (telegram_id && !user.telegram_id && user.role === 'student') {
      const cleanTgId = String(telegram_id).trim();
      await pool.query('UPDATE users SET telegram_id = $1 WHERE id = $2', [cleanTgId, user.id]).catch(() => {});
      user.telegram_id = cleanTgId;
    }

    res.json({ user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update Own Profile
app.put('/api/profile', async (req, res) => {
  try {
    const { id, full_name, username, phone, current_password, new_password } = req.body;
    const userRes = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
    if (userRes.rows.length === 0) return res.status(404).json({ error: 'Account not found.' });

    const existing = userRes.rows[0];
    const dupCheck = await pool.query('SELECT id FROM users WHERE LOWER(username) = LOWER($1) AND id != $2', [username.trim(), id]);
    if (dupCheck.rows.length > 0) {
      return res.status(400).json({ error: 'Username is already taken by another user.' });
    }

    let finalPass = existing.password;
    if (new_password && new_password.trim() !== '') {
      if (current_password && current_password !== existing.password) {
        return res.status(400).json({ error: 'Current password is incorrect.' });
      }
      finalPass = new_password.trim();
    }

    await pool.query(
      'UPDATE users SET full_name = $1, username = $2, phone = $3, password = $4 WHERE id = $5',
      [full_name.trim(), username.trim(), (phone || '').trim(), finalPass, id]
    );

    const updated = await pool.query(
      `SELECT u.id, u.full_name, u.username, LOWER(u.role) AS role, u.phone, u.group_id, u.telegram_id, u.zed_coins,
              g.name AS group_name, g.level AS group_level, g.schedule AS group_schedule, g.monthly_fee
       FROM users u LEFT JOIN groups g ON u.group_id = g.id WHERE u.id = $1`,
      [id]
    );
    res.json({ user: updated.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ================= BOOTSTRAP ALL DATA =================
app.get('/api/bootstrap', async (req, res) => {
  try {
    const [uRes, gRes, aRes, hRes, pRes, qRes, qsRes] = await Promise.all([
      pool.query(`
        SELECT u.id, u.full_name, u.username, LOWER(u.role) AS role, u.phone, u.group_id, u.telegram_id, u.zed_coins,
               g.name AS group_name
        FROM users u
        LEFT JOIN groups g ON u.group_id = g.id
        ORDER BY u.id DESC
      `),
      pool.query(`
        SELECT g.*, u.full_name AS teacher_name,
               (SELECT COUNT(*) FROM users s WHERE s.group_id = g.id AND LOWER(s.role) = 'student') AS student_count
        FROM groups g
        LEFT JOIN users u ON g.teacher_id = u.id
        ORDER BY g.id ASC
      `),
      pool.query(`
        SELECT a.*, u.full_name AS student_name, g.name AS group_name
        FROM attendance a
        LEFT JOIN users u ON a.student_id = u.id
        LEFT JOIN groups g ON a.group_id = g.id
        ORDER BY a.date DESC, a.id DESC
        LIMIT 500
      `),
      pool.query(`
        SELECT h.*, g.name AS group_name, u.full_name AS teacher_name
        FROM homeworks h
        LEFT JOIN groups g ON h.group_id = g.id
        LEFT JOIN users u ON h.teacher_id = u.id
        ORDER BY h.id DESC
      `),
      pool.query(`
        SELECT p.id, p.student_id, p.amount, p.month, p.status, p.receipt_image, p.created_at,
               u.full_name AS student_name, g.name AS group_name
        FROM payments p
        LEFT JOIN users u ON p.student_id = u.id
        LEFT JOIN groups g ON u.group_id = g.id
        ORDER BY p.id DESC
      `),
      pool.query(`
        SELECT q.*,
               (SELECT COUNT(*) FROM quiz_submissions qs WHERE qs.quiz_id = q.id) AS total_answers,
               (SELECT COUNT(*) FROM quiz_submissions qs WHERE qs.quiz_id = q.id AND qs.is_correct = TRUE) AS correct_answers
        FROM daily_quizzes q
        ORDER BY q.id DESC
        LIMIT 30
      `),
      pool.query(`
        SELECT * FROM quiz_submissions ORDER BY id DESC
      `)
    ]);

    res.json({
      users: uRes.rows,
      groups: gRes.rows,
      attendance: aRes.rows,
      homeworks: hRes.rows,
      payments: pRes.rows,
      quizzes: qRes.rows,
      quiz_submissions: qsRes.rows
    });
  } catch (err) {
    console.error('Bootstrap error:', err.message);
    res.status(500).json({ error: 'Database error: ' + err.message });
  }
});

// ================= GROUPS CRUD =================
app.post('/api/groups', async (req, res) => {
  try {
    const { name, level, teacher_id, schedule, monthly_fee } = req.body;
    if (!name) return res.status(400).json({ error: 'Group name is required.' });
    const result = await pool.query(
      `INSERT INTO groups (name, level, teacher_id, schedule, monthly_fee)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [
        name.trim(),
        (level || 'General English').trim(),
        teacher_id ? parseInt(teacher_id, 10) : null,
        (schedule || 'Mon-Wed-Fri • 15:00').trim(),
        parseFloat(monthly_fee) || 450000
      ]
    );
    res.json({ group: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/groups/:id', async (req, res) => {
  try {
    const groupId = parseInt(req.params.id, 10);
    const { name, level, teacher_id, schedule, monthly_fee } = req.body;
    if (!name) return res.status(400).json({ error: 'Group name is required.' });

    const result = await pool.query(
      `UPDATE groups
       SET name = $1, level = $2, teacher_id = $3, schedule = $4, monthly_fee = $5
       WHERE id = $6 RETURNING *`,
      [
        name.trim(),
        (level || 'General English').trim(),
        teacher_id ? parseInt(teacher_id, 10) : null,
        (schedule || '').trim(),
        parseFloat(monthly_fee) || 450000,
        groupId
      ]
    );
    res.json({ group: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/groups/:id', async (req, res) => {
  try {
    const gid = parseInt(req.params.id, 10);
    await pool.query('UPDATE users SET group_id = NULL WHERE group_id = $1', [gid]);
    await pool.query('DELETE FROM groups WHERE id = $1', [gid]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ================= USERS / STUDENTS CRUD =================
app.post('/api/users', async (req, res) => {
  try {
    const { full_name, username, password, role, phone, group_id } = req.body;
    if (!full_name || !username || !password) {
      return res.status(400).json({ error: 'Full name, username, and password are required.' });
    }
    const result = await pool.query(
      `INSERT INTO users (full_name, username, password, role, phone, group_id, zed_coins)
       VALUES ($1, $2, $3, $4, $5, $6, 0) RETURNING *`,
      [
        full_name.trim(),
        username.trim(),
        password.trim(),
        (role || 'student').toLowerCase(),
        (phone || '').trim(),
        group_id ? parseInt(group_id, 10) : null
      ]
    );
    res.json({ user: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Username already exists.' });
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/users/:id', async (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    const { full_name, username, phone, group_id, password, zed_coins } = req.body;

    const existing = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
    if (existing.rows.length === 0) return res.status(404).json({ error: 'User not found.' });

    const finalPass = password && password.trim() !== '' ? password.trim() : existing.rows[0].password;
    const finalCoins = zed_coins !== undefined && zed_coins !== '' ? parseInt(zed_coins, 10) : existing.rows[0].zed_coins;

    const result = await pool.query(
      `UPDATE users
       SET full_name = $1, username = $2, phone = $3, group_id = $4, password = $5, zed_coins = $6
       WHERE id = $7 RETURNING *`,
      [
        full_name.trim(),
        username.trim(),
        (phone || '').trim(),
        group_id ? parseInt(group_id, 10) : null,
        finalPass,
        finalCoins,
        userId
      ]
    );
    res.json({ user: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/users/:id', async (req, res) => {
  try {
    const uid = parseInt(req.params.id, 10);
    await pool.query('DELETE FROM users WHERE id = $1', [uid]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ================= ATTENDANCE + HOMEWORK CHECK + ZED COINS =================
app.post('/api/attendance', async (req, res) => {
  const client = await pool.connect();
  try {
    const { group_id, date, records } = req.body;
    if (!group_id || !Array.isArray(records)) {
      return res.status(400).json({ error: 'Invalid attendance data.' });
    }
    const targetGroupId = parseInt(group_id, 10);
    const targetDate = date || new Date().toISOString().split('T')[0];

    await client.query('BEGIN');

    for (const rec of records) {
      const studentId = parseInt(rec.student_id, 10);
      const status = rec.status || 'present';
      const hwDone = Boolean(rec.homework_done);
      const newCoins = hwDone ? Math.max(0, parseInt(rec.coins_awarded, 10) || 0) : 0;

      // Check if attendance was already marked for this student on this date to prevent duplicate coins
      const prevRes = await client.query(
        `SELECT coins_awarded FROM attendance WHERE student_id = $1 AND group_id = $2 AND date = $3`,
        [studentId, targetGroupId, targetDate]
      );
      const prevCoins = prevRes.rows.length > 0 ? (parseInt(prevRes.rows[0].coins_awarded, 10) || 0) : 0;
      const coinDiff = newCoins - prevCoins;

      await client.query(
        `INSERT INTO attendance (student_id, group_id, date, status, homework_done, coins_awarded)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (student_id, group_id, date)
         DO UPDATE SET
           status = EXCLUDED.status,
           homework_done = EXCLUDED.homework_done,
           coins_awarded = EXCLUDED.coins_awarded`,
        [studentId, targetGroupId, targetDate, status, hwDone, newCoins]
      );

      if (coinDiff !== 0) {
        await client.query(
          `UPDATE users SET zed_coins = GREATEST(0, COALESCE(zed_coins, 0) + $1) WHERE id = $2`,
          [coinDiff, studentId]
        );
      }
    }

    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Attendance & Coin error:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ================= DAILY QUIZ (ADMIN CREATE & STUDENT SUBMIT) =================
app.post('/api/quizzes', async (req, res) => {
  try {
    const { question, option_a, option_b, option_c, correct_option, reward_coins } = req.body;
    if (!question || !option_a || !option_b || !option_c) {
      return res.status(400).json({ error: 'Question and all 3 options (A, B, C) are required.' });
    }
    const cleanCorrect = String(correct_option || 'A').toUpperCase().trim();
    const coins = parseInt(reward_coins, 10) || 10;

    const result = await pool.query(
      `INSERT INTO daily_quizzes (question, option_a, option_b, option_c, correct_option, reward_coins)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [question.trim(), option_a.trim(), option_b.trim(), option_c.trim(), cleanCorrect, coins]
    );
    res.json({ quiz: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/quizzes/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM daily_quizzes WHERE id = $1', [parseInt(req.params.id, 10)]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/quizzes/:id/answer', async (req, res) => {
  const client = await pool.connect();
  try {
    const quizId = parseInt(req.params.id, 10);
    const { student_id, selected_option } = req.body;
    const studentId = parseInt(student_id, 10);
    const chosen = String(selected_option || '').toUpperCase().trim();

    if (!studentId || !['A', 'B', 'C'].includes(chosen)) {
      return res.status(400).json({ error: 'Please select a valid option (A, B, or C).' });
    }

    await client.query('BEGIN');

    // Check if student already answered this quiz
    const existing = await client.query(
      'SELECT id FROM quiz_submissions WHERE quiz_id = $1 AND student_id = $2',
      [quizId, studentId]
    );
    if (existing.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'You have already answered this quiz!' });
    }

    const quizRes = await client.query('SELECT * FROM daily_quizzes WHERE id = $1', [quizId]);
    if (quizRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Quiz not found.' });
    }

    const quiz = quizRes.rows[0];
    const isCorrect = chosen === String(quiz.correct_option).toUpperCase().trim();
    const earnedCoins = isCorrect ? (parseInt(quiz.reward_coins, 10) || 10) : 0;

    await client.query(
      `INSERT INTO quiz_submissions (quiz_id, student_id, selected_option, is_correct, coins_earned)
       VALUES ($1, $2, $3, $4, $5)`,
      [quizId, studentId, chosen, isCorrect, earnedCoins]
    );

    if (earnedCoins > 0) {
      await client.query(
        `UPDATE users SET zed_coins = COALESCE(zed_coins, 0) + $1 WHERE id = $2`,
        [earnedCoins, studentId]
      );
    }

    const userRes = await client.query('SELECT zed_coins FROM users WHERE id = $1', [studentId]);

    await client.query('COMMIT');
    res.json({
      is_correct: isCorrect,
      correct_option: quiz.correct_option,
      coins_earned: earnedCoins,
      total_coins: userRes.rows[0]?.zed_coins || 0
    });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ================= HOMEWORKS & PAYMENTS =================
app.post('/api/homeworks', async (req, res) => {
  try {
    const { group_id, teacher_id, title, description, due_date } = req.body;
    const result = await pool.query(
      `INSERT INTO homeworks (group_id, teacher_id, title, description, due_date)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [parseInt(group_id, 10), teacher_id ? parseInt(teacher_id, 10) : null, title.trim(), (description || '').trim(), due_date || '']
    );
    res.json({ homework: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/homeworks/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM homeworks WHERE id = $1', [parseInt(req.params.id, 10)]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/payments', async (req, res) => {
  try {
    const { student_id, amount, month, receipt_image } = req.body;
    const cleanAmount = parseFloat(String(amount).replace(/[^0-9.]/g, '')) || 0;
    if (!student_id || cleanAmount <= 0) {
      return res.status(400).json({ error: 'Valid student and amount are required.' });
    }
    const result = await pool.query(
      `INSERT INTO payments (student_id, amount, month, receipt_image, status)
       VALUES ($1, $2, $3, $4, 'pending')
       RETURNING id, student_id, amount, month, status, created_at`,
      [parseInt(student_id, 10), cleanAmount, (month || 'Current Month').trim(), receipt_image || '']
    );
    res.json({ success: true, payment: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/payments/:id', async (req, res) => {
  try {
    const { status } = req.body;
    await pool.query('UPDATE payments SET status = $1 WHERE id = $2', [status, parseInt(req.params.id, 10)]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function startBot(webAppUrl) {
  const token = process.env.BOT_TOKEN;
  if (!token) return;
  try {
    const bot = new Telegraf(token);
    bot.start((ctx) => {
      const firstName = ctx.from?.first_name || 'Student';
      ctx.reply(
        `Welcome to ZED Academy, ${firstName}!\n\nTap below to open your learning portal, earn ZED Coins, and check your classes:`,
        Markup.inlineKeyboard([[Markup.button.webApp('Open ZED Academy Portal', webAppUrl)]])
      );
    });
    bot.launch().catch(() => {});
  } catch (_) {}
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  startBot(WEB_APP_URL);
});
