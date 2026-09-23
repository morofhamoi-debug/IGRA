const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

pool.query('SELECT 1')
  .then(() => console.log('BD connected'))
  .catch(e => console.error('BD error:', e.message));

// ================= USERS =================

app.post('/api/register', async (req, res) => {
  const { phone, firstName, lastName, username } = req.body;
  let p = (phone||'').replace(/\D/g, '');
  if (p[0] === '8') p = '7' + p.slice(1);
  const e164 = '+' + p;
  try {
    const exists = await pool.query('SELECT * FROM users WHERE phone=$1', [e164]);
    if (exists.rows.length) return res.json({ ok: true, user: exists.rows[0] });

    const result = await pool.query(
      `INSERT INTO users (phone, first_name, last_name, username)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [e164, firstName, lastName || null, username || null]
    );
    const user = result.rows[0];

    // автосоздание "Избранное"
    const chatRes = await pool.query(
      `INSERT INTO chats (type, title, owner_id) VALUES ('saved', 'Saved', $1) RETURNING id`,
      [user.id]
    );
    await pool.query(
      `INSERT INTO chat_members (chat_id, user_id) VALUES ($1, $2)`,
      [chatRes.rows[0].id, user.id]
    );

    res.json({ ok: true, user });
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'username_taken' });
    console.error(e);
    res.status(500).json({ error: 'db_error' });
  }
});

app.post('/api/find-by-phone', async (req, res) => {
  const { phone } = req.body;
  let p = (phone||'').replace(/\D/g, '');
  if (p[0] === '8') p = '7' + p.slice(1);
  const e164 = '+' + p;
  try {
    const result = await pool.query(
      `SELECT id, phone, username, first_name, last_name, avatar, last_seen
       FROM users WHERE phone = $1`, [e164]
    );
    if (!result.rows.length) return res.json({ found: false });
    res.json({ found: true, user: result.rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'db_error' });
  }
});

app.get('/api/check-username/:username', async (req, res) => {
  try {
    const r = await pool.query('SELECT id FROM users WHERE username=$1', [req.params.username]);
    res.json({ taken: r.rows.length > 0 });
  } catch (e) {
    res.status(500).json({ error: 'db_error' });
  }
});

// ================= CHATS =================

// Список чатов пользователя
app.get('/api/chats/:userId', async (req, res) => {
  const uid = req.params.userId;
  try {
    const chats = await pool.query(
      `SELECT c.*,
              (SELECT json_agg(json_build_object(
                'id', u.id, 'phone', u.phone, 'username', u.username,
                'first_name', u.first_name, 'last_name', u.last_name,
                'avatar', u.avatar, 'last_seen', u.last_seen
              )) FROM chat_members cm2 JOIN users u ON u.id = cm2.user_id
              WHERE cm2.chat_id = c.id) AS members
       FROM chats c
       JOIN chat_members cm ON cm.chat_id = c.id
       WHERE cm.user_id = $1
       ORDER BY c.created_at DESC`,
      [uid]
    );
    res.json({ ok: true, chats: chats.rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'db_error' });
  }
});

// Создать чат (personal / group / channel)
app.post('/api/chats', async (req, res) => {
  const { type, ownerId, members, title, description, isPublic } = req.body;
  try {
    // для personal — проверяем существующий
    if (type === 'personal') {
      const existing = await pool.query(
        `SELECT c.id FROM chats c
         JOIN chat_members cm1 ON cm1.chat_id = c.id AND cm1.user_id = $1
         JOIN chat_members cm2 ON cm2.chat_id = c.id AND cm2.user_id = $2
         WHERE c.type = 'personal'
         LIMIT 1`,
        [members[0], members[1]]
      );
      if (existing.rows.length) {
        const c = await loadChat(existing.rows[0].id);
        return res.json({ ok: true, chat: c, existed: true });
      }
    }

    const chatRes = await pool.query(
      `INSERT INTO chats (type, title, description, owner_id, is_public)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [type || 'personal', title || null, description || null, ownerId, !!isPublic]
    );
    const chatId = chatRes.rows[0].id;

    for (const m of members) {
      await pool.query(
        `INSERT INTO chat_members (chat_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [chatId, m]
      );
    }

    const c = await loadChat(chatId);
    res.json({ ok: true, chat: c });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'db_error' });
  }
});

async function loadChat(chatId) {
  const r = await pool.query(
    `SELECT c.*,
            (SELECT json_agg(json_build_object(
              'id', u.id, 'phone', u.phone, 'username', u.username,
              'first_name', u.first_name, 'last_name', u.last_name,
              'avatar', u.avatar, 'last_seen', u.last_seen
            )) FROM chat_members cm JOIN users u ON u.id = cm.user_id
            WHERE cm.chat_id = c.id) AS members
     FROM chats c WHERE c.id = $1`,
    [chatId]
  );
  return r.rows[0];
}

// ================= MESSAGES =================

// Все сообщения чата
app.get('/api/messages/:chatId', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, chat_id, sender_id, text, reply_to, edited, deleted, created_at
       FROM messages WHERE chat_id = $1 ORDER BY created_at ASC LIMIT 500`,
      [req.params.chatId]
    );
    res.json({ ok: true, messages: r.rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'db_error' });
  }
});

// Отправить сообщение
app.post('/api/messages', async (req, res) => {
  const { chatId, senderId, text, replyTo } = req.body;
  try {
    const r = await pool.query(
      `INSERT INTO messages (chat_id, sender_id, text, reply_to)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [chatId, senderId, text || '', replyTo || null]
    );
    res.json({ ok: true, message: r.rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'db_error' });
  }
});

// Новые сообщения после определённого id (для polling)
app.get('/api/updates/:userId', async (req, res) => {
  const sinceId = parseInt(req.query.since || '0', 10) || 0;
  try {
    const r = await pool.query(
      `SELECT m.id, m.chat_id, m.sender_id, m.text, m.created_at
       FROM messages m
       JOIN chat_members cm ON cm.chat_id = m.chat_id AND cm.user_id = $1
       WHERE m.id > $2 AND m.deleted = FALSE
       ORDER BY m.id ASC
       LIMIT 100`,
      [req.params.userId, sinceId]
    );
    res.json({ ok: true, messages: r.rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'db_error' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Server started on port ' + PORT));
