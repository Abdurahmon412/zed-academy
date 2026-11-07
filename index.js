// require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const { Telegraf, Markup } = require('telegraf');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const WEB_APP_URL = process.env.WEB_APP_URL || 'https://zed-academy.onrender.com';

app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));
app.use(express.static(__dirname));

// Neon PostgreSQL Connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// Initialize & Safely Migrate Tables (Preserves Existing Data)
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
        telegram_id VARCHAR(100) DEFAULT NULL,
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
        amount NUMERIC(12, 2) NOT NULL,
        month VARCHAR(50) NOT NULL,
        receipt_image TEXT DEFAULT '',
        status VARCHAR(30) DEFAULT 'pending',
        note TEXT DEFAULT '',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Safe column checks in case older schema exists
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(50) DEFAULT '';`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS group_id INTEGER DEFAULT NULL;`);
    await client.query(`ALTER TABLE groups ADD COLUMN IF NOT EXISTS level VARCHAR(80) DEFAULT 'General English';`);
    await client.query(`ALTER TABLE groups ADD COLUMN IF NOT EXISTS schedule VARCHAR(120) DEFAULT 'Mon-Wed-Fri 14:00';`);
    await client.query(`ALTER TABLE groups ADD COLUMN IF NOT EXISTS monthly_fee NUMERIC(12, 2) DEFAULT 400000;`);

    // Seed Default Accounts only if users table is empty
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

// Root route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ================= AUTH & PROFILE API =================

// Login
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Please enter both username and password.' });
    }
    const result = await pool.query(
      `SELECT u.id, u.full_name, u.username, u.role, u.phone, u.group_id,
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

    res.json({ user: result.rows[0] });
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ error: 'Server error during sign in.' });
  }
});

// Update Own Profile (Admin, Teacher, Student)
app.put('/api/profile', async (req, res) => {
  try {
    const { id, full_name, username, phone, current_password, new_password } = req.body;
    if (!id || !full_name || !username) {
      return res.status(400).json({ error: 'Name and username are required.' });
    }

    // Check existing user
    const userCheck = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
    if (userCheck.rows.length === 0) {
      return res.status(404).json({ error: 'User account not found.' });
    }
    const existingUser = userCheck.rows[0];

    // Check if username is taken by another user
    const usernameCheck = await pool.query(
      'SELECT id FROM users WHERE LOWER(username) = LOWER($1) AND id != $2',
      [username.trim(), id]
    );
    if (usernameCheck.rows.length > 0) {
      return res.status(400).json({ error: 'This username is already taken. Please choose another.' });
    }

    // Determine password to save
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
      `SELECT u.id, u.full_name, u.username, u.role, u.phone, u.group_id,
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

// ================= DASHBOARD & DATA API =================

// Full state fetch for logged-in user
app.get('/api/bootstrap', async (req, res) => {
  try {
    const [usersRes, groupsRes, attendanceRes, homeworksRes, paymentsRes] = await Promise.all([
      pool.query(`
        SELECT u.id, u.full_name, u.username, u.role, u.phone, u.group_id, u.created_at,
               g.name AS group_name
        FROM users u
        LEFT JOIN groups g ON u.group_id = g.id
        ORDER BY u.id ASC
      `),
      pool.query(`
        SELECT g.*, u.full_name AS teacher_name,
               (SELECT COUNT(*) FROM users s WHERE s.group_id = g.id AND s.role = 'student') AS student_count
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

// Create User (Student or Teacher or Admin)
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
        role || 'student',
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
    await pool.query('DELETE FROM users WHERE id = $1', [req.params.id]);
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
        monthly_fee ? Number(monthly_fee) : 400000
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
    await pool.query('UPDATE users SET group_id = NULL WHERE group_id = $1', [req.params.id]);
    await pool.query('DELETE FROM groups WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete group.' });
  }
});

// Save Attendance (Batch or Single)
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
        [rec.student_id, group_id, targetDate, rec.status]
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
      [group_id, teacher_id || null, title.trim(), (description || '').trim(), due_date || '']
    );
    res.json({ homework: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to post homework.' });
  }
});

// Delete Homework
app.delete('/api/homeworks/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM homeworks WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete assignment.' });
  }
});

// Submit Payment Receipt (Student)
app.post('/api/payments', async (req, res) => {
  try {
    const { student_id, amount, month, receipt_image, note } = req.body;
    if (!student_id || !amount || !month) {
      return res.status(400).json({ error: 'Student, amount, and month are required.' });
    }
    const result = await pool.query(
      `INSERT INTO payments (student_id, amount, month, receipt_image, status, note)
       VALUES ($1, $2, $3, $4, 'pending', $5)
       RETURNING *`,
      [student_id, Number(amount), month, receipt_image || '', (note || '').trim()]
    );
    res.json({ payment: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to submit payment.' });
  }
});

// Update Payment Status (Admin Approve / Reject)
app.put('/api/payments/:id', async (req, res) => {
  try {
    const { status } = req.body;
    const result = await pool.query(
      `UPDATE payments SET status = $1 WHERE id = $2 RETURNING *`,
      [status, req.params.id]
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
        `Welcome to ZED Academy, ${firstName}!\n\nTap the button below to open your personal portal, check attendance, view assignments, and manage payments.`,
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
