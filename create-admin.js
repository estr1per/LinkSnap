const { Pool } = require('pg');
const bcrypt = require('bcrypt');
require('dotenv').config();

const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

async function createAdmin() {
    try {
        const username = 'admin';
        const password = 'admin123';
        const email = 'admin@linksnap.local';
        
        const hashedPassword = await bcrypt.hash(password, 10);
        
        // Удаляем старого админа
        await pool.query('DELETE FROM admins WHERE username = $1', [username]);
        
        // Создаем нового
        await pool.query(
            'INSERT INTO admins (username, password, email) VALUES ($1, $2, $3)',
            [username, hashedPassword, email]
        );
        
        console.log('✅ Админ создан!');
        console.log('   Логин: admin');
        console.log('   Пароль: admin123');
        
        await pool.end();
    } catch (error) {
        console.error('❌ Ошибка:', error.message);
    }
}

createAdmin();