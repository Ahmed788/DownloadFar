// دالة لاختبار الاتصال بـ Supabase
async function testConnection() {
  const { data, error } = await supabase.from('users').select('*').limit(1);
  if (error) {
    console.error('فشل الاتصال أو المفاتيح غير صحيحة:', error.message);
  } else {
    console.log('الاتصال ناجح والمفاتيح فعالة.');
  }
}

// لاختبار الاتصال، أزل التعليق عن السطر التالي:
// testConnection();
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// دالة لإضافة مستخدم جديد
async function addUser(username, email, password) {
  const { data, error } = await supabase
    .from('users')
    .insert([{ username, email, password }]);
  if (error) {
    console.error('خطأ في الإضافة:', error);
  } else {
    console.log('تمت الإضافة:', data);
  }
}

// مثال للاستخدام
// addUser('testuser', 'test@example.com', '123456');
const path = require('path');
const db = new Database(path.join(__dirname, 'app.db'));

db.pragma('journal_mode = WAL');

db.prepare(`CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT,
  is_subscribed INTEGER DEFAULT 0,
  last_free_image_date TEXT
)`).run();

db.prepare(`CREATE TABLE IF NOT EXISTS payment_intents (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  quality TEXT NOT NULL,
  amount REAL NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
)`).run();

db.prepare(`CREATE TABLE IF NOT EXISTS wallets (
  user_id TEXT PRIMARY KEY,
  address TEXT
)`).run();

const getUserStmt = db.prepare('SELECT id, email, is_subscribed AS is_subscribed, last_free_image_date FROM users WHERE id = ?');
const insertUserStmt = db.prepare('INSERT OR IGNORE INTO users (id, email, is_subscribed, last_free_image_date) VALUES (?, ?, ?, ?)');
const setSubStmt = db.prepare('UPDATE users SET is_subscribed = 1 WHERE id = ?');
const setLastFreeStmt = db.prepare('UPDATE users SET last_free_image_date = ? WHERE id = ?');

insertUserStmt.run('test-user', 'test@example.com', 0, null);

module.exports = {
  getUser: (id) => getUserStmt.get(id),
  ensureUser: (id) => insertUserStmt.run(id, null, 0, null),
  setSubscription: (id, val) => setSubStmt.run(id),
  setLastFreeDate: (id, date) => setLastFreeStmt.run(date, id),
  createPaymentIntent: (intent) => db.prepare('INSERT INTO payment_intents (id, user_id, type, quality, amount, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(intent.id, intent.user_id, intent.type, intent.quality, intent.amount, intent.status, intent.created_at),
  getPaymentIntent: (id) => db.prepare('SELECT * FROM payment_intents WHERE id = ?').get(id),
  markIntentPaid: (id) => db.prepare('UPDATE payment_intents SET status = "paid" WHERE id = ?').run(id),
  hasPaidFor: (userId, type, quality) => !!db.prepare('SELECT 1 FROM payment_intents WHERE user_id = ? AND type = ? AND quality = ? AND status = "paid" ORDER BY created_at DESC LIMIT 1').get(userId, type, quality),
  setWalletAddress: (userId, address) => db.prepare('INSERT INTO wallets (user_id, address) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET address=excluded.address').run(userId, address),
  getWalletAddress: (userId) => {
    const row = db.prepare('SELECT address FROM wallets WHERE user_id = ?').get(userId);
    return row ? row.address : null;
  }
};
