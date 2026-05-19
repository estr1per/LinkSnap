// Скрипт для создания админа по умолчанию
// Запускается один раз при старте сервера
const dotenv = require('dotenv');
dotenv.config();

const { Pool } = require('pg');
const bcrypt = require('bcrypt');

const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'linksnap',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'root',
});

async function createDefaultAdmin() {
    try {
        // Проверяем, есть ли уже админы
        const result = await pool.query('SELECT COUNT(*) as count FROM admins');
        const count = parseInt(result.rows[0].count);
        
        if (count > 0) {
            console.log('✅ Админы уже существуют (найдено:', count, ')');
            await pool.end();
            return;
        }
        
        // Создаём админа по умолчанию
        const username = 'admin';
        const password = 'admin123'; // Пароль по умолчанию
        const email = 'admin@linksnap.local';
        
        const hashedPassword = await bcrypt.hash(password, 10);
        
        await pool.query(
            'INSERT INTO admins (username, password, email) VALUES ($1, $2, $3)',
            [username, hashedPassword, email]
        );
        
        console.log('\n🛡️ АДМИН СОЗДАН:');
        console.log('   Логин: admin');
        console.log('   Пароль: admin123');
        console.log('   ⚠️  Измените пароль после первого входа!\n');
        
        await pool.end();
    } catch (error) {
        console.error('❌ Ошибка создания админа:', error.message);
        await pool.end();
        process.exit(1);
    }
}

createDefaultAdmin();
