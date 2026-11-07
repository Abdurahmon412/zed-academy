// require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const { Telegraf, Markup } = require('telegraf');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const WEB_APP_URL = process.env.WEB_APP_URL || 'https://zed-academy.onrender.com';

// Handle large base64 receipt screenshots smoothly
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));
app.use(express.static(__dirname));

// Neon PostgreSQL Connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// Initialize & Safely Migrate Tables
async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        full_name VARCHAR(150) NOT NULL,
        username VARCHAR(100) UNIQUE NOT NULL,
        password VARCHAR(150) NOT NULL,
        role VARCHAR(30) NOT NULL DEFAULT 'student',
        phone VARCHAR(50) DEFAULT '',
        group_id INTEGER DEFAULT NULL,
        telegram_id VARCHAR(100) UNIQUE DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS groups (
        id SERIAL PRIMARY KEY,
        name VARCHAR(120) NOT NULL,
        level VARCHAR(80) DEFAULT 'General English',
        teacher_id INTEGER DEFAULT NULL,
        schedule VARCHAR(120) DEFAULT 'Mon-Wed-Fri 14:00',
        monthly_fee NUMERIC(12, 2) DEFAULT 400000,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS attendance (
        id SERIAL PRIMARY KEY,
        student_id INTEGER NOT NULL,
        group_id INTEGER NOT NULL,
        date DATE NOT NULL DEFAULT CURRENT_DATE,
        status VARCHAR(30) NOT NULL DEFAULT 'present',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(student_id, group_id, date)
      );

      CREATE TABLE IF NOT EXISTS homeworks (
        id SERIAL PRIMARY KEY,
        group_id INTEGER NOT NULL,
        teacher_id INTEGER,
        title VARCHAR(200) NOT NULL,
        description TEXT DEFAULT '',
        due_date VARCHAR(60) DEFAULT '',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS payments (
        id SERIAL PRIMARY KEY,
        student_id INTEGER NOT NULL,
        amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
        month VARCHAR(50) NOT NULL,
        receipt_image TEXT DEFAULT '',
        status VARCHAR(30) DEFAULT 'pending',
        note TEXT DEFAULT '',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Ensure all critical columns and types
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(50) DEFAULT '';`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS group_id INTEGER DEFAULT NULL;`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_id VARCHAR(100) DEFAULT NULL;`);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_telegram_id_unique ON users (telegram_id) WHERE telegram_id IS NOT NULL;`);
    await client.query(`ALTER TABLE groups ADD COLUMN IF NOT EXISTS level VARCHAR(80) DEFAULT 'General English';`);
    await client.query(`ALTER TABLE groups ADD COLUMN IF NOT EXISTS schedule VARCHAR(120) DEFAULT 'Mon-Wed-Fri 14:00';`);
    await client.query(`ALTER TABLE groups ADD COLUMN IF NOT EXISTS monthly_fee NUMERIC(12, 2) DEFAULT 400000;`);
    await client.query(`ALTER TABLE payments ALTER COLUMN amount TYPE NUMERIC(14, 2);`);
    await client.query(`ALTER TABLE payments ALTER COLUMN receipt_image TYPE TEXT;`);

    // Seed default admin and teacher if completely empty
    const { rows } = await client.query('SELECT COUNT(*) AS count FROM users');
    if (parseInt(rows[0].count, 10) === 0) {
      await client.query(`
        INSERT INTO users (full_name, username, password, role, phone)
        VALUES
          ('Abdurahmon (Director)', 'admin', 'admin123', 'admin', '+998 90 123 45 67'),
          ('Mr. Javohir', 'javohir', 'teacher123', 'teacher', '+998 90 234 56 78'),
          ('Ms. Malika', 'malika', 'teacher123', 'teacher', '+998 90 345 67 89')
        ON CONFLICT (username) DO NOTHING;
      `);

      const teacherRes = await client.query(`SELECT id FROM users WHERE username = 'javohir' LIMIT 1`);
      const teacherId = teacherRes.rows[0]?.id || null;

      const groupRes = await client.query(
        `INSERT INTO groups (name, level, teacher_id, schedule, monthly_fee)
         VALUES ('IELTS Intensive A1', 'IELTS 6.5+', $1, 'Mon-Wed-Fri • 15:00', 450000)
         RETURNING id`,
        [teacherId]
      );
      const groupId = groupRes.rows[0]?.id || null;

      await client.query(
        `INSERT INTO users (full_name, username, password, role, phone, group_id)
         VALUES ('Ali Valiyev', 'student', 'student123', 'student', '+998 99 111 22 33', $1)
         ON CONFLICT (username) DO NOTHING`,
        [groupId]
      );
    }
    console.log('Database initialized successfully');
  } catch (err) {
    console.error('Database initialization error:', err.message);
  } finally {
    client.release();
  }
}

initDB();

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Public groups list for registration dropdown
app.get('/api/public/groups', async (req, res) => {
  try {
    const result = await pool.query(`SELECT id, name, level, schedule, monthly_fee FROM groups ORDER BY id ASC`);
    res.json({ groups: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load groups.' });
  }
});

// ================= AUTH, REGISTRATION & PROFILE =================

// Student Self-Registration (1 Account per Telegram ID)
app.post('/api/register', async (req, res) => {
  try {
    const { full_name, username, password, phone, group_id, telegram_id } = req.body;

    if (!full_name || !username || !password) {
      return res.status(400).json({ error: 'Full name, username, and password are required.' });
    }

    if (!telegram_id) {
      return res.status(400).json({
        error: 'Registration requires opening the portal inside Telegram to verify your Telegram ID.'
      });
    }

    const cleanTgId = String(telegram_id).trim();

    // 1. Check if Telegram ID already registered
    const tgCheck = await pool.query(
      'SELECT id, username FROM users WHERE telegram_id = $1 LIMIT 1',
      [cleanTgId]
    );
    if (tgCheck.rows.length > 0) {
      return res.status(400).json({
        error: `An account (@${tgCheck.rows[0].username}) is already registered with this Telegram profile.`
      });
    }

    // 2. Check username availability
    const userCheck = await pool.query(
      'SELECT id FROM users WHERE LOWER(username) = LOWER($1) LIMIT 1',
      [username.trim()]
    );
    if (userCheck.rows.length > 0) {
      return res.status(400).json({ error: 'This username is already taken. Please choose another.' });
    }

    // 3. Create student
    const parsedGroupId = group_id ? parseInt(group_id, 10) : null;
    const insertRes = await pool.query(
      `INSERT INTO users (full_name, username, password, role, phone, group_id, telegram_id)
       VALUES ($1, $2, $3, 'student', $4, $5, $6)
       RETURNING id`,
      [
        full_name.trim(),
        username.trim(),
        password.trim(),
        (phone || '').trim(),
        parsedGroupId,
        cleanTgId
      ]
    );

    const newUserId = insertRes.rows[0].id;
    const fullUser = await pool.query(
      `SELECT u.id, u.full_name, u.username, u.role, u.phone, u.group_id, u.telegram_id,
              g.name AS group_name, g.level AS group_level, g.schedule AS group_schedule, g.monthly_fee
       FROM users u
       LEFT JOIN groups g ON u.group_id = g.id
       WHERE u.id = $1`,
      [newUserId]
    );

    res.json({
      message: 'Account registered successfully!',
      user: fullUser.rows[0]
    });
  } catch (err) {
    console.error('Registration error:', err.message);
    if (err.code === '23505') {
      return res.status(400).json({
        error: 'This Telegram account or username is already registered.'
      });
    }
    res.status(500).json({ error: 'Server error during registration.' });
  }
});

// Login
app.post('/api/login', async (req, res) => {
  try {
    const { username, password, telegram_id } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Please enter both username and password.' });
    }

    const result = await pool.query(
      `SELECT u.id, u.full_name, u.username, u.role, u.phone, u.group_id, u.telegram_id,
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

    // Auto-link Telegram ID if not set yet
    if (telegram_id && !user.telegram_id && user.role === 'student') {
      const cleanTgId = String(telegram_id).trim();
      const existingOwner = await pool.query('SELECT id FROM users WHERE telegram_id = $1 LIMIT 1', [cleanTgId]);
      if (existingOwner.rows.length === 0) {
        await pool.query('UPDATE users SET telegram_id = $1 WHERE id = $2', [cleanTgId, user.id]);
        user.telegram_id = cleanTgId;
      }
    }

    res.json({ user });
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ error: 'Server error during sign in.' });
  }
});

// Edit Profile
app.put('/api/profile', async (req, res) => {
  try {
    const { id, full_name, username, phone, current_password, new_password } = req.body;
    if (!id || !full_name || !username) {
      return res.status(400).json({ error: 'Name and username are required.' });
    }

    const userCheck = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
    if (userCheck.rows.length === 0) {
      return res.status(404).json({ error: 'User account not found.' });
    }
    const existingUser = userCheck.rows[0];

    const usernameCheck = await pool.query(
      'SELECT id FROM users WHERE LOWER(username) = LOWER($1) AND id != $2',
      [username.trim(), id]
    );
    if (usernameCheck.rows.length > 0) {
      return res.status(400).json({ error: 'This username is already taken. Please choose another.' });
    }

    let updatedPassword = existingUser.password;
    if (new_password && new_password.trim() !== '') {
      if (current_password && current_password !== existingUser.password) {
        return res.status(400).json({ error: 'Current password is incorrect.' });
      }
      updatedPassword = new_password.trim();
    }

    await pool.query(
      `UPDATE users
       SET full_name = $1, username = $2, phone = $3, password = $4
       WHERE id = $5`,
      [full_name.trim(), username.trim(), (phone || '').trim(), updatedPassword, id]
    );

    const updated = await pool.query(
      `SELECT u.id, u.full_name, u.username, u.role, u.phone, u.group_id, u.telegram_id,
              g.name AS group_name, g.level AS group_level, g.schedule AS group_schedule, g.monthly_fee
       FROM users u
       LEFT JOIN groups g ON u.group_id = g.id
       WHERE u.id = $1`,
      [id]
    );

    res.json({ message: 'Profile updated successfully!', user: updated.rows[0] });
  } catch (err) {
    console.error('Profile update error:', err.message);
    res.status(500).json({ error: 'Failed to update profile.' });
  }
});

// ================= DASHBOARD & REALTIME DATA API =================

app.get('/api/bootstrap', async (req, res) => {
  try {
    const [usersRes, groupsRes, attendanceRes, homeworksRes, paymentsRes] = await Promise.all([
      pool.query(`
        SELECT u.id, u.full_name, u.username, LOWER(u.role) as role, u.phone, u.group_id, u.telegram_id, u.created_at,
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
        SELECT p.*, u.full_name AS student_name, g.name AS group_name
        FROM payments p
        LEFT JOIN users u ON p.student_id = u.id
        LEFT JOIN groups g ON u.group_id = g.id
        ORDER BY p.id DESC
      `)
    ]);

    res.json({
      users: usersRes.rows,
      groups: groupsRes.rows,
      attendance: attendanceRes.rows,
      homeworks: homeworksRes.rows,
      payments: paymentsRes.rows
    });
  } catch (err) {
    console.error('Bootstrap error:', err.message);
    res.status(500).json({ error: 'Failed to load data.' });
  }
});

// Create User manually by Admin
app.post('/api/users', async (req, res) => {
  try {
    const { full_name, username, password, role, phone, group_id } = req.body;
    if (!full_name || !username || !password) {
      return res.status(400).json({ error: 'Full name, username, and password are required.' });
    }
    const result = await pool.query(
      `INSERT INTO users (full_name, username, password, role, phone, group_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, full_name, username, role, phone, group_id`,
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
    if (err.code === '23505') {
      return res.status(400).json({ error: 'Username already exists.' });
    }
    res.status(500).json({ error: 'Failed to create user.' });
  }
});

// Delete User
app.delete('/api/users/:id', async (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    await pool.query('DELETE FROM payments WHERE student_id = $1', [userId]);
    await pool.query('DELETE FROM attendance WHERE student_id = $1', [userId]);
    await pool.query('DELETE FROM users WHERE id = $1', [userId]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete user.' });
  }
});

// Create Group
app.post('/api/groups', async (req, res) => {
  try {
    const { name, level, teacher_id, schedule, monthly_fee } = req.body;
    if (!name) return res.status(400).json({ error: 'Group name is required.' });
    const result = await pool.query(
      `INSERT INTO groups (name, level, teacher_id, schedule, monthly_fee)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [
        name.trim(),
        level || 'General English',
        teacher_id ? parseInt(teacher_id, 10) : null,
        schedule || 'Mon-Wed-Fri 14:00',
        monthly_fee ? parseFloat(monthly_fee) : 400000
      ]
    );
    res.json({ group: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create group.' });
  }
});

// Delete Group
app.delete('/api/groups/:id', async (req, res) => {
  try {
    const gid = parseInt(req.params.id, 10);
    await pool.query('UPDATE users SET group_id = NULL WHERE group_id = $1', [gid]);
    await pool.query('DELETE FROM groups WHERE id = $1', [gid]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete group.' });
  }
});

// Save Attendance
app.post('/api/attendance', async (req, res) => {
  const client = await pool.connect();
  try {
    const { group_id, date, records } = req.body;
    if (!group_id || !Array.isArray(records)) {
      return res.status(400).json({ error: 'Invalid attendance payload.' });
    }
    const targetDate = date || new Date().toISOString().split('T')[0];

    await client.query('BEGIN');
    for (const rec of records) {
      await client.query(
        `INSERT INTO attendance (student_id, group_id, date, status)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (student_id, group_id, date)
         DO UPDATE SET status = EXCLUDED.status`,
        [parseInt(rec.student_id, 10), parseInt(group_id, 10), targetDate, rec.status]
      );
    }
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Attendance error:', err.message);
    res.status(500).json({ error: 'Failed to save attendance.' });
  } finally {
    client.release();
  }
});

// Create Homework
app.post('/api/homeworks', async (req, res) => {
  try {
    const { group_id, teacher_id, title, description, due_date } = req.body;
    if (!group_id || !title) {
      return res.status(400).json({ error: 'Group and title are required.' });
    }
    const result = await pool.query(
      `INSERT INTO homeworks (group_id, teacher_id, title, description, due_date)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [parseInt(group_id, 10), teacher_id ? parseInt(teacher_id, 10) : null, title.trim(), (description || '').trim(), due_date || '']
    );
    res.json({ homework: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to post homework.' });
  }
});

// Delete Homework
app.delete('/api/homeworks/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM homeworks WHERE id = $1', [parseInt(req.params.id, 10)]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete assignment.' });
  }
});

// Submit Payment Receipt (ROBUST FIX)
app.post('/api/payments', async (req, res) => {
  try {
    const { student_id, amount, month, receipt_image, note } = req.body;
    
    if (!student_id) {
      return res.status(400).json({ error: 'Student ID is missing. Please sign in again.' });
    }
    
    const parsedAmount = parseFloat(String(amount).replace(/[^0-9.]/g, ''));
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({ error: 'Please enter a valid payment amount.' });
    }

    if (!month) {
      return res.status(400).json({ error: 'Payment month is required.' });
    }

    const result = await pool.query(
      `INSERT INTO payments (student_id, amount, month, receipt_image, status, note)
       VALUES ($1, $2, $3, $4, 'pending', $5)
       RETURNING id, student_id, amount, month, status, created_at`,
      [
        parseInt(student_id, 10),
        parsedAmount,
        month.trim(),
        receipt_image || '',
        (note || '').trim()
      ]
    );

    res.json({ success: true, payment: result.rows[0] });
  } catch (err) {
    console.error('Payment submission DB error:', err);
    res.status(500).json({ error: 'Failed to record payment in database: ' + err.message });
  }
});

// Update Payment Status
app.put('/api/payments/:id', async (req, res) => {
  try {
    const { status } = req.body;
    const result = await pool.query(
      `UPDATE payments SET status = $1 WHERE id = $2 RETURNING *`,
      [status, parseInt(req.params.id, 10)]
    );
    res.json({ payment: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update payment status.' });
  }
});

// ================= TELEGRAM BOT =================
function startBot(webAppUrl) {
  const token = process.env.BOT_TOKEN;
  if (!token) {
    console.log('BOT_TOKEN not provided, skipping Telegram bot launch.');
    return;
  }
  try {
    const bot = new Telegraf(token);

    bot.start((ctx) => {
      const firstName = ctx.from?.first_name || 'Student';
      ctx.reply(
        `Welcome to ZED Academy, ${firstName}!\n\nTap the button below to open your personal portal, register or sign in, check attendance, view assignments, and manage payments.`,
        Markup.inlineKeyboard([
          [Markup.button.webApp('Open ZED Academy Portal', webAppUrl)]
        ])
      );
    });

    bot.launch()
      .then(() => console.log('Telegram Bot started successfully'))
      .catch((err) => console.error('Telegram Bot launch warning:', err.message));

    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));
  } catch (err) {
    console.error('Bot setup error:', err.message);
  }
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  startBot(WEB_APP_URL);
});
