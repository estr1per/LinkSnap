const { Pool } = require('pg');

const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
});

const createTables = async () => {
    const tables = [
        `CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            username TEXT UNIQUE NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            plan_type TEXT DEFAULT 'free',
            api_key TEXT UNIQUE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS links (
            id SERIAL PRIMARY KEY,
            user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
            original_url TEXT NOT NULL,
            short_code TEXT UNIQUE NOT NULL,
            custom_alias TEXT,
            title TEXT,
            tags TEXT,
            clicks INTEGER DEFAULT 0,
            last_clicked TIMESTAMP,
            is_active INTEGER DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS qrcodes (
            id SERIAL PRIMARY KEY,
            user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
            original_url TEXT NOT NULL,
            qr_data TEXT NOT NULL,
            color TEXT DEFAULT '#667eea',
            bg_color TEXT DEFAULT '#ffffff',
            size INTEGER DEFAULT 200,
            margin INTEGER DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS link_clicks (
            id SERIAL PRIMARY KEY,
            link_id INTEGER REFERENCES links(id) ON DELETE CASCADE,
            click_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            ip_address TEXT,
            user_agent TEXT,
            referrer TEXT,
            device_type TEXT,
            country TEXT,
            city TEXT
        )`,
        `CREATE TABLE IF NOT EXISTS subscriptions (
            id SERIAL PRIMARY KEY,
            user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
            plan_type TEXT NOT NULL,
            status TEXT NOT NULL,
            amount REAL,
            currency TEXT DEFAULT 'RUB',
            start_date TIMESTAMP,
            end_date TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS api_calls (
            id SERIAL PRIMARY KEY,
            user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
            endpoint TEXT NOT NULL,
            method TEXT NOT NULL,
            status_code INTEGER,
            ip_address TEXT,
            called_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS tags (
            id SERIAL PRIMARY KEY,
            name TEXT UNIQUE NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS link_tags (
            link_id INTEGER REFERENCES links(id) ON DELETE CASCADE,
            tag_id INTEGER REFERENCES tags(id) ON DELETE CASCADE,
            PRIMARY KEY (link_id, tag_id)
        )`,
        `CREATE TABLE IF NOT EXISTS support_chats (
            id SERIAL PRIMARY KEY,
            user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
            is_closed INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id)
        )`,
        `CREATE TABLE IF NOT EXISTS support_chat_messages (
            id SERIAL PRIMARY KEY,
            chat_id INTEGER REFERENCES support_chats(id) ON DELETE CASCADE,
            sender_type TEXT NOT NULL,
            message TEXT NOT NULL,
            is_read INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS admins (
            id SERIAL PRIMARY KEY,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            email TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`
    ];
    
    for (const sql of tables) {
        try {
            await pool.query(sql);
            console.log('✅ Таблица создана/существует');
        } catch (err) {
            console.error('❌ Ошибка:', err.message);
        }
    }
    
    console.log('✅ Все таблицы готовы!');
    await pool.end();
};

createTables().catch(console.error);