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
db.pragma('journal_mode = WAL');
db.prepare(`CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  email TEXT NOT NULL,
  password TEXT NOT NULL
)`);
db.prepare(`CREATE TABLE IF NOT EXISTS payment_intents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  amount REAL,
  status TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id)
)`);
db.prepare(`CREATE TABLE IF NOT EXISTS wallets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  balance REAL DEFAULT 0,
  FOREIGN KEY(user_id) REFERENCES users(id)
)`);
module.exports = {
  addUser,
  testConnection,
  // يمكنك إضافة دوال أخرى للتعامل مع Supabase هنا لاحقًا
};
