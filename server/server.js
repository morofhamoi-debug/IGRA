const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

pool.query('SELECT 1')
  .then(() => console.log('BD connected'))
  .catch(e => console.error('BD error:', e.message));

// REGISTER
app.post('/api/register', async (req, res) => {
  const { phone, firstName, lastName, username } = req.body;

  let p = phone.replace(/\D/g, '');
  if (p[0] === '8') p = '7' + p.slice(1);
  const e164 = '+' + p;

  try {
    const exists = await pool.query('SELECT * FROM users WHERE phone=$1', [e164]);
    if (exists.rows.length) {
      return res.json({ ok: true, user: exists.rows[0] });
    }

    const result = await pool.query(
      `INSERT INTO users (phone, first_name, last_name, username)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [e164, firstName, lastName || null, username || null]
    );
    res.json({ ok: true, user: result.rows[0] });
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'username_taken' });
    console.error(e);
    res.status(500).json({ error: 'db_error' });
  }
});

// FIND BY PHONE
app.post('/api/find-by-phone', async (req, res) => {
  const { phone } = req.body;

  let p = phone.replace(/\D/g, '');
  if (p[0] === '8') p = '7' + p.slice(1);
  const e164 = '+' + p;

  try {
    const result = await pool.query(
      `SELECT id, phone, username, first_name, last_name, avatar, last_seen
       FROM users WHERE phone = $1`,
      [e164]
    );

    if (!result.rows.length) return res.json({ found: false });

    res.json({ found: true, user: result.rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'db_error' });
  }
});

// CHECK USERNAME
app.get('/api/check-username/:username', async (req, res) => {
  try {
    const r = await pool.query('SELECT id FROM users WHERE username=$1', [req.params.username]);
    res.json({ taken: r.rows.length > 0 });
  } catch (e) {
    res.status(500).json({ error: 'db_error' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Server started on port ' + PORT));
