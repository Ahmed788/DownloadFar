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
module.exports = {
  addUser,
  testConnection,
  // يمكنك إضافة دوال أخرى للتعامل مع Supabase هنا لاحقًا
};
