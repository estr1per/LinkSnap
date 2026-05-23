const dotenv = require('dotenv');
dotenv.config();

const express = require('express');
const { Pool } = require('pg');
const QRCode = require('qrcode');
const path = require('path');
const bcrypt = require('bcrypt');
const session = require('express-session');
const fs = require('fs');
const multer = require('multer');
const sharp = require('sharp');
const archiver = require('archiver');
const mammoth = require('mammoth');
const PDFDocument = require('pdfkit');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const compression = require('compression');
const crypto = require('crypto');

const app = express();
const port = process.env.PORT || 3000;

// ========== НАСТРОЙКА TRUST PROXY ==========
app.set('trust proxy', 1);

// ========== ЛОГИРОВАНИЕ ВСЕХ ЗАПРОСОВ ==========
app.use((req, res, next) => {
    console.log(`📝 ${req.method} ${req.url} - Session userId: ${req.session?.userId || 'none'}, adminId: ${req.session?.adminId || 'none'}`);
    next();
});

// ========== БЕЗОПАСНОСТЬ ==========
app.use(helmet({
    hsts: process.env.NODE_ENV === 'production',
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdn.jsdelivr.net"],
            scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
            scriptSrcAttr: ["'unsafe-inline'"],
            imgSrc: ["'self'", "data:", "https:"],
            fontSrc: ["'self'", "https://fonts.gstatic.com"],
        },
    },
}));
app.use(compression());

// ========== RATE LIMITING ==========
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 1000,
    message: { error: 'Слишком много запросов. Попробуйте позже.' },
    standardHeaders: true,
    legacyHeaders: false,
});

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: { error: 'Слишком много попыток входа. Попробуйте через 15 минут.' },
});

app.use((req, res, next) => {
    if (req.url === '/sw.js') {
        res.setHeader('Content-Type', 'application/javascript');
        res.setHeader('Service-Worker-Allowed', '/');
    }
    next();
});

// Папки данных
const dataDir = path.join(__dirname, 'data');
const uploadDir = path.join(__dirname, 'uploads');

try {
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    console.log('📁 Папки data и uploads готовы');
} catch (error) {
    console.error('❌ Ошибка создания папок:', error.message);
}

// ========== БАЗА ДАННЫХ POSTGRESQL ==========
const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
});

const db = {
    run: (query, params = [], callback) => {
        if (typeof params === 'function') {
            callback = params;
            params = [];
        }
        if (!callback) {
            callback = (err) => {
                if (err) console.error('❌ SQL Error:', err.message);
            };
        }
        
        let pgQuery = query;
        let paramIndex = 1;
        while (pgQuery.includes('?')) {
            pgQuery = pgQuery.replace('?', `$${paramIndex++}`);
        }
        
        pool.query(pgQuery, params)
            .then(res => {
                let lastID = null;
                if (res.rows && res.rows.length > 0) {
                    lastID = res.rows[0].id || res.rows[0].last_id || null;
                }
                const result = { 
                    lastID: lastID, 
                    changes: res.rowCount,
                    rows: res.rows
                };
                callback(null, result);
            })
            .catch(err => {
                console.error('❌ SQL Error:', err.message);
                callback(err);
            });
    },
    
    get: (query, params = [], callback) => {
        if (typeof params === 'function') {
            callback = params;
            params = [];
        }
        if (!callback) {
            callback = (err) => {
                if (err) console.error('❌ SQL Error:', err.message);
            };
        }
        
        let pgQuery = query;
        let paramIndex = 1;
        while (pgQuery.includes('?')) {
            pgQuery = pgQuery.replace('?', `$${paramIndex++}`);
        }
        
        pool.query(pgQuery, params)
            .then(res => callback(null, res.rows[0]))
            .catch(err => {
                console.error('❌ SQL Error:', err.message);
                callback(err);
            });
    },
    
    all: (query, params = [], callback) => {
        if (typeof params === 'function') {
            callback = params;
            params = [];
        }
        if (!callback) {
            callback = (err) => {
                if (err) console.error('❌ SQL Error:', err.message);
            };
        }
        
        let pgQuery = query;
        let paramIndex = 1;
        while (pgQuery.includes('?')) {
            pgQuery = pgQuery.replace('?', `$${paramIndex++}`);
        }
        
        pool.query(pgQuery, params)
            .then(res => callback(null, res.rows))
            .catch(err => {
                console.error('❌ SQL Error:', err.message);
                callback(err);
            });
    },
    
    close: async () => {
        await pool.end();
    }
};

pool.connect((err, client, release) => {
    if (err) {
        console.error('❌ Ошибка подключения к PostgreSQL:', err.message);
    } else {
        console.log('💾 PostgreSQL база данных подключена');
        release();
    }
});

// ========== MULTER ==========
const uploadSingle = multer({ 
    dest: uploadDir, 
    limits: { fileSize: 50 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowed = /jpeg|jpg|png|gif|webp|bmp|tiff|txt|pdf|doc|docx/;
        const ext = allowed.test(path.extname(file.originalname).toLowerCase());
        const mime = allowed.test(file.mimetype);
        if (ext && mime) cb(null, true);
        else cb(new Error('Неподдерживаемый тип файла'));
    }
});

const uploadMultiple = multer({ 
    dest: uploadDir, 
    limits: { fileSize: 50 * 1024 * 1024, files: 10 } 
});

// ========== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ==========
async function cleanupTempFile(filePath) {
    try { 
        if (fs.existsSync(filePath)) await fs.promises.unlink(filePath); 
    } catch(e) {
        if (process.env.NODE_ENV !== 'production') {
            console.error('Ошибка удаления файла:', e.message);
        }
    }
}

async function cleanupTempFiles(filePaths) {
    for (const filePath of filePaths) {
        await cleanupTempFile(filePath);
    }
}

function escapeHtml(text) {
    if (!text) return '';
    return text.replace(/[&<>"]/g, m => ({ 
        '&': '&amp;', 
        '<': '&lt;', 
        '>': '&gt;',
        '"': '&quot;'
    }[m] || m));
}

function generateRandomCode(length) {
    return crypto.randomBytes(Math.ceil(length / 2))
        .toString('hex')
        .slice(0, length);
}

function generateApiKey() {
    return 'ln_' + crypto.randomBytes(32).toString('hex');
}

function checkUserLimits(userId, type, callback) {
    db.get('SELECT plan_type FROM users WHERE id = $1', [userId], (err, user) => {
        if (err) return callback(err);
        const plan = user?.plan_type || 'free';
        let limit = 999999;
        if (type === 'links') limit = plan === 'free' ? 100 : 999999;
        else if (type === 'qrcodes') limit = plan === 'free' ? 50 : 999999;
        
        const table = type === 'links' ? 'links' : 'qrcodes';
        const timeLimit = "created_at >= date_trunc('month', CURRENT_DATE)";
        
        db.get(`SELECT COUNT(*) as count FROM ${table} WHERE user_id = $1 AND ${timeLimit}`, 
            [userId], (err, result) => {
                if (err) return callback(err);
                callback(null, { 
                    allowed: result.count < limit, 
                    current: parseInt(result.count), 
                    limit 
                });
            });
    });
}

// ========== СОЗДАНИЕ ТАБЛИЦ ==========
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
        `CREATE TABLE IF NOT EXISTS session (
            sid VARCHAR PRIMARY KEY,
            sess JSON NOT NULL,
            expire TIMESTAMP(6) NOT NULL
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
        await new Promise((resolve, reject) => {
            db.run(sql, [], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }
    
    console.log('✅ Все таблицы созданы успешно');
};

const createIndexes = async () => {
    const indexes = [
        `CREATE INDEX IF NOT EXISTS idx_links_short_code ON links(short_code)`,
        `CREATE INDEX IF NOT EXISTS idx_links_user_id ON links(user_id)`,
        `CREATE INDEX IF NOT EXISTS idx_clicks_link_id ON link_clicks(link_id)`,
        `CREATE INDEX IF NOT EXISTS idx_links_created_at ON links(created_at DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_qrcodes_user_id ON qrcodes(user_id)`,
        `CREATE INDEX IF NOT EXISTS idx_session_expire ON session(expire)`
    ];
    
    for (const sql of indexes) {
        await new Promise((resolve) => {
            db.run(sql, [], (err) => {
                if (err) console.error('⚠️ Ошибка создания индекса:', err.message);
                else resolve();
            });
        });
    }
    
    console.log('✅ Индексы созданы');
};

// ========== MIDDLEWARE ==========
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static('public', { 
    maxAge: process.env.NODE_ENV === 'production' ? '1d' : 0,
    etag: true,
    lastModified: true 
}));

// CORS настройки - ИСПРАВЛЕНО
app.use((req, res, next) => {
    const origin = req.headers.origin;
    const allowedOrigins = [
        'https://estr1per-linksnap-85ab.twc1.net',
        'https://www.estr1per-linksnap-85ab.twc1.net',
        'http://localhost:3000'
    ];
    
    if (allowedOrigins.includes(origin) || !origin) {
        res.header('Access-Control-Allow-Origin', origin || '*');
        res.header('Access-Control-Allow-Credentials', 'true');
    }
    
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, X-API-Key');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

// ========== НАСТРОЙКА СЕССИЙ - ИСПРАВЛЕНО ==========
app.use(session({
    secret: process.env.SESSION_SECRET || 'linksnap-secret-key-2024-secure',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: false,
        maxAge: 7 * 24 * 60 * 60 * 1000,
        httpOnly: true,
        sameSite: 'lax'
    }
}));

setInterval(async () => {
    try {
        await pool.query(`DELETE FROM session WHERE expire < NOW()`);
    } catch(e) {}
}, 6 * 60 * 60 * 1000);
    
app.use('/api/', apiLimiter);
app.use('/api/login', authLimiter);
app.use('/api/register', authLimiter);

// ========== ПРОВЕРКА АВТОРИЗАЦИИ ==========
function requireAuth(req, res, next) {
    if (req.session.userId) next();
    else res.status(401).json({ error: 'Требуется авторизация' });
}

function requireApiKey(req, res, next) {
    const apiKey = req.headers['x-api-key'] || req.query.apiKey;
    if (!apiKey) return res.status(401).json({ error: 'API ключ обязателен' });
    
    db.get('SELECT id, plan_type FROM users WHERE api_key = $1', [apiKey], (err, user) => {
        if (err || !user) return res.status(403).json({ error: 'Неверный API ключ' });
        req.apiUserId = user.id;
        next();
    });
}

// ========== МАРШРУТЫ СТАТИЧЕСКИХ ФАЙЛОВ ==========
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/register', (req, res) => res.sendFile(path.join(__dirname, 'public', 'register.html')));
app.get('/profile', requireAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'profile.html')));
app.get('/analytics', requireAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'analytics.html')));
app.get('/batch', requireAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'batch.html')));
app.get('/pricing', requireAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'pricing.html')));
app.get('/converter', requireAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'converter.html')));
app.get('/image-editor', requireAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'image-editor.html')));
app.get('/dashboard', requireAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/admin/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin-login.html')));
app.get('/admin/users', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin-users.html')));

// ========== API АУТЕНТИФИКАЦИЯ ==========
app.post('/api/register', async (req, res) => {
    try {
        const { username, email, password } = req.body;
        
        if (!username || !email || !password) {
            return res.status(400).json({ error: 'Все поля обязательны' });
        }
        if (username.length < 3 || username.length > 30) {
            return res.status(400).json({ error: 'Имя пользователя должно быть от 3 до 30 символов' });
        }
        if (password.length < 6) {
            return res.status(400).json({ error: 'Пароль должен быть не менее 6 символов' });
        }
        if (!/^[a-zA-Z0-9_]+$/.test(username)) {
            return res.status(400).json({ error: 'Имя пользователя может содержать только латиницу, цифры и подчеркивание' });
        }
        
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ error: 'Некорректный email адрес' });
        }
        
        // ПРОВЕРКА НА СУЩЕСТВОВАНИЕ
        const existing = await new Promise((resolve) => {
            db.get('SELECT id FROM users WHERE email = $1 OR username = $2', [email, username], (err, result) => {
                resolve(result);
            });
        });
        
        if (existing) {
            return res.status(400).json({ error: 'Пользователь с таким именем или email уже существует' });
        }
        
        const hashedPassword = await bcrypt.hash(password, 10);
        
        db.run('INSERT INTO users (username, email, password) VALUES ($1, $2, $3) RETURNING id',
            [username, email, hashedPassword],
            function(err) {
                if (err) {
                    return res.status(500).json({ error: 'Ошибка сервера' });
                }
                
                req.session.userId = this.lastID;
                req.session.username = username;
                res.json({ 
                    success: true, 
                    message: 'Регистрация успешна',
                    user: { id: this.lastID, username, email } 
                });
            });
    } catch (error) {
        console.error('❌ Ошибка регистрации:', error.message);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        if (!email || !password) {
            return res.status(400).json({ error: 'Email и пароль обязательны' });
        }
        
        db.get('SELECT * FROM users WHERE email = $1', [email], async (err, user) => {
            if (err || !user) {
                return res.status(401).json({ error: 'Неверный email или пароль' });
            }
            
            const isValid = await bcrypt.compare(password, user.password);
            if (!isValid) {
                return res.status(401).json({ error: 'Неверный email или пароль' });
            }
            
            req.session.userId = user.id;
            req.session.username = user.username;
            
            res.json({ 
                success: true, 
                user: { 
                    id: user.id, 
                    username: user.username, 
                    email: user.email, 
                    plan: user.plan_type 
                } 
            });
        });
    } catch (error) {
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

app.post('/api/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).json({ error: 'Ошибка при выходе' });
        }
        res.json({ success: true, message: 'Вы успешно вышли' });
    });
});

app.get('/api/user', (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'Не авторизован' });
    }
    
    db.get('SELECT id, username, email, plan_type, created_at FROM users WHERE id = $1',
        [req.session.userId],
        (err, user) => {
            if (err || !user) {
                return res.status(404).json({ error: 'Пользователь не найден' });
            }
            res.json(user);
        });
});

// ========== API ПОИСК ПО ССЫЛКАМ ==========
app.get('/api/links/search', requireAuth, (req, res) => {
    const { query } = req.query;
    const userId = req.session.userId;
    
    if (query && (query.includes('<') || query.includes('>'))) {
        return res.status(400).json({ error: 'Недопустимые символы в поиске' });
    }
    
    if (!query || query.length < 2) {
        return res.json([]);
    }
    
    db.all(`
        SELECT * FROM links 
        WHERE user_id = $1 
        AND (
            original_url ILIKE '%' || $2 || '%' 
            OR short_code ILIKE '%' || $2 || '%'
            OR title ILIKE '%' || $2 || '%'
            OR tags ILIKE '%' || $2 || '%'
        )
        ORDER BY created_at DESC
        LIMIT 50
    `, [userId, query], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

// ========== API ПАГИНАЦИЯ ССЫЛОК ==========
app.get('/api/links', requireAuth, (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    const userId = req.session.userId;
    
    db.all(`
        SELECT * FROM links 
        WHERE user_id = $1 
        ORDER BY created_at DESC 
        LIMIT $2 OFFSET $3
    `, [userId, limit, offset], (err, links) => {
        if (err) return res.status(500).json({ error: err.message });
        
        db.get('SELECT COUNT(*) as total FROM links WHERE user_id = $1', [userId], (err, count) => {
            res.json({
                data: links || [],
                pagination: {
                    page,
                    limit,
                    total: parseInt(count?.total || 0),
                    pages: Math.ceil((count?.total || 0) / limit)
                }
            });
        });
    });
});

// ========== API ОБЛАКО ТЕГОВ ==========
app.get('/api/tags/cloud', requireAuth, (req, res) => {
    const userId = req.session.userId;
    
    db.all(`
        SELECT t.name, COUNT(*) as count 
        FROM tags t
        JOIN link_tags lt ON t.id = lt.tag_id
        JOIN links l ON lt.link_id = l.id
        WHERE l.user_id = $1
        GROUP BY t.name
        ORDER BY count DESC
        LIMIT 30
    `, [userId], (err, tags) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(tags || []);
    });
});

// ========== API РАСШИРЕННАЯ АНАЛИТИКА ==========
app.get('/api/analytics/trends', requireAuth, (req, res) => {
    const userId = req.session.userId;
    
    db.all(`
        WITH daily_stats AS (
            SELECT 
                DATE_TRUNC('day', created_at) as day,
                COUNT(*) as new_links,
                SUM(COUNT(*)) OVER (ORDER BY DATE_TRUNC('day', created_at)) as cumulative_links
            FROM links 
            WHERE user_id = $1 
            AND created_at > CURRENT_DATE - INTERVAL '30 days'
            GROUP BY day
        )
        SELECT 
            TO_CHAR(day, 'DD.MM') as date,
            new_links,
            cumulative_links,
            ROUND(AVG(new_links) OVER (ORDER BY day ROWS BETWEEN 6 PRECEDING AND CURRENT ROW), 1) as moving_avg_7d
        FROM daily_stats
        ORDER BY day DESC
    `, [userId], (err, stats) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(stats || []);
    });
});

app.get('/api/analytics/dashboard-stats', requireAuth, (req, res) => {
    const userId = req.session.userId;
    
    db.all(`
        SELECT 
            COALESCE(device_type, 'unknown') as device_type, 
            COUNT(*) as count 
        FROM link_clicks 
        WHERE link_id IN (SELECT id FROM links WHERE user_id = $1)
        GROUP BY device_type
        ORDER BY count DESC
    `, [userId], (err, deviceStats) => {
        if (err) deviceStats = [];
        
        db.all(`
            SELECT 
                CASE 
                    WHEN referrer IS NULL OR referrer = '' THEN 'Прямой переход'
                    WHEN referrer ILIKE '%google.%' THEN 'Google'
                    WHEN referrer ILIKE '%yandex.%' THEN 'Яндекс'
                    WHEN referrer ILIKE '%telegram.%' THEN 'Telegram'
                    WHEN referrer ILIKE '%vk.%' OR referrer ILIKE '%vkontakte.%' THEN 'VK'
                    ELSE 'Другие'
                END as source,
                COUNT(*) as count
            FROM link_clicks 
            WHERE link_id IN (SELECT id FROM links WHERE user_id = $1)
            GROUP BY source
            ORDER BY count DESC
            LIMIT 10
        `, [userId], (err, sourceStats) => {
            if (err) sourceStats = [];
            
            res.json({
                success: true,
                devices: deviceStats || [],
                sources: sourceStats || []
            });
        });
    });
});

// ========== API СОКРАЩЕНИЕ ССЫЛОК ==========
app.post('/api/shorten', requireAuth, async (req, res) => {
    try {
        const { originalUrl, customAlias, title, tags } = req.body;
        const userId = req.session.userId;
        
        if (!originalUrl) {
            return res.status(400).json({ error: 'URL обязателен' });
        }
        
        let validatedUrl = originalUrl.trim();
        if (validatedUrl.length > 2000) {
            return res.status(400).json({ error: 'URL слишком длинный (максимум 2000 символов)' });
        }
        
        if (!validatedUrl.startsWith('http')) {
            validatedUrl = 'https://' + validatedUrl;
        }
        
        try {
            new URL(validatedUrl);
        } catch {
            return res.status(400).json({ error: 'Некорректный URL' });
        }
        
        if (customAlias && customAlias.trim() !== '') {
            const user = await pool.query('SELECT plan_type FROM users WHERE id = $1', [userId]);
            if (user.rows[0]?.plan_type === 'free') {
                return res.status(403).json({ error: 'Кастомные алиасы доступны только для тарифов Премиум и Бизнес' });
            }
            
            if (customAlias.length < 3 || customAlias.length > 30) {
                return res.status(400).json({ error: 'Алиас должен быть от 3 до 30 символов' });
            }
            if (!/^[a-zA-Z0-9_-]+$/.test(customAlias)) {
                return res.status(400).json({ error: 'Алиас может содержать только латиницу, цифры, дефис и подчеркивание' });
            }
            
            const reserved = ['api', 'login', 'register', 'dashboard', 'admin', 'profile', 
                            'analytics', 'batch', 'pricing', 'converter', 'image-editor'];
            if (reserved.includes(customAlias.toLowerCase())) {
                return res.status(400).json({ error: 'Этот алиас зарезервирован системой' });
            }
        }
        
        checkUserLimits(req.session.userId, 'links', (err, limits) => {
            if (err) return res.status(500).json({ error: 'Ошибка проверки лимитов' });
            if (!limits.allowed) {
                return res.status(403).json({ 
                    error: `Превышен лимит: ${limits.current}/${limits.limit} ссылок в месяц. Обновите тариф.` 
                });
            }
            
            const shortCode = customAlias || generateRandomCode(6);
            const host = req.get('host') || `localhost:${port}`;
            const protocol = req.protocol || 'https';
            
            db.run(
                'INSERT INTO links (user_id, original_url, short_code, custom_alias, title, tags) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
                [req.session.userId, validatedUrl, shortCode, customAlias || null, title || null, tags || null],
                function(err, result) {
                    if (err) {
                        if (err.message.includes('UNIQUE')) {
                            return res.status(400).json({ error: 'Этот алиас уже занят' });
                        }
                        return res.status(500).json({ error: 'Ошибка сохранения ссылки' });
                    }
                    
                    const linkId = result.lastID;
                    
                    if (tags && linkId) {
                        const tagList = tags.split(',').map(t => t.trim().toLowerCase()).filter(t => t);
                        tagList.forEach(tagName => {
                            db.run('INSERT INTO tags (name) VALUES ($1) ON CONFLICT (name) DO NOTHING',
                                [tagName], (err) => {
                                    if (!err) {
                                        db.get('SELECT id FROM tags WHERE name = $1', [tagName], (err, tag) => {
                                            if (!err && tag) {
                                                db.run('INSERT INTO link_tags (link_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
                                                    [linkId, tag.id]);
                                            }
                                        });
                                    }
                                });
                        });
                    }
                    
                    res.json({ 
                        success: true, 
                        originalUrl: validatedUrl,
                        shortUrl: `${protocol}://${host}/${shortCode}`,
                        shortCode,
                        id: linkId
                    });
                });
        });
    } catch (error) {
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// ========== API QR-КОДЫ ==========
app.get('/api/qrcode', requireAuth, async (req, res) => {
    try {
        const { url } = req.query;
        if (!url) return res.status(400).json({ error: 'URL обязателен' });
        
        checkUserLimits(req.session.userId, 'qrcodes', async (err, limits) => {
            if (err) return res.status(500).json({ error: 'Ошибка проверки лимитов' });
            if (!limits.allowed) {
                return res.status(403).json({ 
                    error: `Превышен лимит: ${limits.current}/${limits.limit} QR-кодов в месяц.` 
                });
            }
            
            let validatedUrl = url;
            if (!validatedUrl.startsWith('http')) validatedUrl = 'https://' + validatedUrl;
            
            const qrImageData = await QRCode.toDataURL(validatedUrl, {
                margin: 1,
                width: 200,
                color: { dark: '#667eea', light: '#ffffff' }
            });
            
            db.run('INSERT INTO qrcodes (user_id, original_url, qr_data) VALUES ($1, $2, $3)',
                [req.session.userId, validatedUrl, qrImageData]);
            
            res.json({ success: true, qrImageData });
        });
    } catch (error) {
        res.status(500).json({ error: 'Ошибка генерации QR-кода' });
    }
});

app.get('/api/qrcodes', requireAuth, (req, res) => {
    db.all('SELECT * FROM qrcodes WHERE user_id = $1 ORDER BY created_at DESC',
        [req.session.userId],
        (err, qrcodes) => {
            if (err) return res.status(500).json({ error: 'Ошибка сервера' });
            res.json(qrcodes || []);
        });
});

app.delete('/api/links', requireAuth, (req, res) => {
    db.run('DELETE FROM links WHERE user_id = $1', [req.session.userId], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, message: `Удалено ${this.changes} ссылок` });
    });
});

app.delete('/api/qrcodes', requireAuth, (req, res) => {
    db.run('DELETE FROM qrcodes WHERE user_id = $1', [req.session.userId], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, message: `Удалено ${this.changes} QR-кодов` });
    });
});

app.get('/api/analytics/summary', requireAuth, (req, res) => {
    const userId = req.session.userId;
    
    db.get(`
        SELECT 
            COUNT(*) as total_links, 
            COALESCE(SUM(clicks), 0) as total_clicks, 
            ROUND(AVG(clicks), 1) as avg_clicks, 
            COALESCE(MAX(clicks), 0) as max_clicks 
        FROM links WHERE user_id = $1
    `, [userId], (err, overallStats) => {
        if (err) return res.status(500).json({ error: err.message });
        
        db.all(`
            SELECT 
                DATE(created_at) as date, 
                COUNT(*) as created_links, 
                COALESCE(SUM(clicks), 0) as total_clicks 
            FROM links 
            WHERE user_id = $1 
            AND created_at >= CURRENT_TIMESTAMP - INTERVAL '30 days' 
            GROUP BY DATE(created_at) 
            ORDER BY date DESC
        `, [userId], (err, weeklyStats) => {
            if (err) return res.status(500).json({ error: err.message });
            
            db.all(`
                SELECT id, original_url, short_code, custom_alias, clicks, created_at 
                FROM links WHERE user_id = $1 
                ORDER BY clicks DESC LIMIT 10
            `, [userId], (err, topLinks) => {
                if (err) return res.status(500).json({ error: err.message });
                
                res.json({
                    success: true,
                    overallStats: overallStats || { total_links: 0, total_clicks: 0, avg_clicks: 0, max_clicks: 0 },
                    weeklyStats: weeklyStats || [],
                    topLinks: topLinks || []
                });
            });
        });
    });
});

app.post('/api/batch/shorten', requireAuth, async (req, res) => {
    try {
        const { urls } = req.body;
        const userId = req.session.userId;
        
        const user = await new Promise((resolve) => {
            db.get('SELECT plan_type FROM users WHERE id = $1', [userId], (err, user) => resolve(user));
        });
        
        if (user?.plan_type !== 'business') {
            return res.status(403).json({ error: 'Массовое создание доступно только для тарифа Бизнес' });
        }
        
        if (!urls || !Array.isArray(urls) || urls.length === 0) {
            return res.status(400).json({ error: 'Список URL обязателен' });
        }
        if (urls.length > 100) {
            return res.status(400).json({ error: 'Максимум 100 URL за раз' });
        }
        
        const limits = await new Promise((resolve) => {
            checkUserLimits(userId, 'links', (err, result) => {
                if (err) resolve({ allowed: false });
                else resolve(result);
            });
        });
        
        if (!limits.allowed) {
            return res.status(403).json({ 
                error: `Превышен лимит: ${limits.current}/${limits.limit} ссылок в месяц.` 
            });
        }
        
        const results = [];
        const errors = [];
        
        for (let i = 0; i < urls.length; i++) {
            const item = urls[i];
            const url = typeof item === 'string' ? item : item.url;
            const customAlias = typeof item === 'object' ? item.customAlias : null;
            
            let validatedUrl = url.trim();
            if (!validatedUrl.startsWith('http')) validatedUrl = 'https://' + validatedUrl;
            
            try {
                new URL(validatedUrl);
            } catch {
                errors.push({ index: i, error: 'Некорректный URL', url: validatedUrl });
                continue;
            }
            
            const shortCode = customAlias || generateRandomCode(6);
            
            await new Promise((resolve) => {
                db.run(
                    'INSERT INTO links (user_id, original_url, short_code, custom_alias) VALUES ($1, $2, $3, $4)',
                    [userId, validatedUrl, shortCode, customAlias || null],
                    function(err) {
                        if (err) {
                            errors.push({ index: i, error: err.message, url: validatedUrl });
                        } else {
                            results.push({
                                index: i,
                                originalUrl: validatedUrl,
                                shortCode,
                                shortUrl: `${req.protocol}://${req.get('host')}/${shortCode}`
                            });
                        }
                        resolve();
                    }
                );
            });
        }
        
        res.json({ 
            success: true, 
            created: results.length,
            failed: errors.length,
            results,
            errors
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/alias/check', requireAuth, (req, res) => {
    const { alias } = req.query;
    
    if (!alias) return res.status(400).json({ error: 'Алиас обязателен' });
    if (alias.length < 3 || alias.length > 30) {
        return res.status(400).json({ error: 'Алиас должен быть от 3 до 30 символов' });
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(alias)) {
        return res.status(400).json({ error: 'Алиас может содержать только латиницу, цифры, дефис и подчеркивание' });
    }
    
    db.get('SELECT id FROM links WHERE short_code = $1 OR custom_alias = $2',
        [alias, alias],
        (err, existing) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ available: !existing, alias });
        });
});

app.get('/api/export/csv', requireAuth, (req, res) => {
    const { type } = req.query;
    const userId = req.session.userId;
    
    if (type === 'links') {
        db.all(`
            SELECT id, original_url, short_code, custom_alias, clicks, created_at 
            FROM links WHERE user_id = $1 ORDER BY created_at DESC
        `, [userId], (err, links) => {
            if (err) return res.status(500).json({ error: err.message });
            
            let csv = '\uFEFFID,Оригинальный URL,Короткий код,Алиас,Клики,Дата создания\n';
            links.forEach(link => {
                csv += `${link.id},"${(link.original_url || '').replace(/"/g, '""')}","${link.short_code}","${link.custom_alias || ''}","${link.clicks || 0}","${link.created_at}"\n`;
            });
            
            res.header('Content-Type', 'text/csv;charset=utf-8');
            res.header('Content-Disposition', 'attachment; filename="linksnap-links.csv"');
            res.send(csv);
        });
    } else if (type === 'qrcodes') {
        db.all(`
            SELECT id, original_url, color, bg_color, size, created_at 
            FROM qrcodes WHERE user_id = $1 ORDER BY created_at DESC
        `, [userId], (err, qrcodes) => {
            if (err) return res.status(500).json({ error: err.message });
            
            let csv = '\uFEFFID,Оригинальный URL,Цвет,Фон,Размер,Дата создания\n';
            qrcodes.forEach(qr => {
                csv += `${qr.id},"${(qr.original_url || '').replace(/"/g, '""')}","${qr.color}","${qr.bg_color}","${qr.size}","${qr.created_at}"\n`;
            });
            
            res.header('Content-Type', 'text/csv;charset=utf-8');
            res.header('Content-Disposition', 'attachment; filename="linksnap-qrcodes.csv"');
            res.send(csv);
        });
    } else {
        res.status(400).json({ error: 'Неверный тип экспорта' });
    }
});

app.get('/api/user/plan', requireAuth, (req, res) => {
    const userId = req.session.userId;
    
    db.get('SELECT plan_type FROM users WHERE id = $1', [userId], (err, user) => {
        if (err) return res.status(500).json({ error: err.message });
        
        db.get(`
            SELECT COUNT(*) as count FROM links 
            WHERE user_id = $1 AND created_at >= date_trunc('month', CURRENT_DATE)
        `, [userId], (err, linksCount) => {
            if (err) return res.status(500).json({ error: err.message });
            
            db.get(`
                SELECT COUNT(*) as count FROM qrcodes 
                WHERE user_id = $1 AND created_at >= date_trunc('month', CURRENT_DATE)
            `, [userId], (err, qrCount) => {
                if (err) return res.status(500).json({ error: err.message });
                
                const plan = user?.plan_type || 'free';
                res.json({ 
                    success: true, 
                    plan,
                    limits: {
                        maxLinks: plan === 'free' ? 100 : 999999,
                        maxQR: plan === 'free' ? 50 : 999999,
                        currentLinks: parseInt(linksCount?.count || 0),
                        currentQR: parseInt(qrCount?.count || 0),
                        customAlias: plan !== 'free',
                        analytics: plan !== 'free',
                        api: plan === 'business'
                    }
                });
            });
        });
    });
});

app.post('/api/user/upgrade-plan', requireAuth, (req, res) => {
    const userId = req.session.userId;
    const { planId } = req.body;
    
    if (!['free', 'premium', 'business'].includes(planId)) {
        return res.status(400).json({ error: 'Неверный план' });
    }
    
    db.run('UPDATE users SET plan_type = $1 WHERE id = $2', [planId, userId], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        
        db.run(`
            INSERT INTO subscriptions (user_id, plan_type, status, start_date, end_date) 
            VALUES ($1, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + INTERVAL '1 month')
        `, [userId, planId, 'active']);
        
        const planNames = { free: 'Бесплатный', premium: 'Премиум', business: 'Бизнес' };
        res.json({ 
            success: true, 
            message: `План изменен на ${planNames[planId]}` 
        });
    });
});

app.post('/api/user/generate-api-key', requireAuth, (req, res) => {
    const userId = req.session.userId;
    
    db.get('SELECT plan_type FROM users WHERE id = $1', [userId], (err, user) => {
        if (err) return res.status(500).json({ error: err.message });
        if (user?.plan_type !== 'business') {
            return res.status(403).json({ error: 'API доступен только для Бизнес тарифа' });
        }
        
        const apiKey = generateApiKey();
        db.run('UPDATE users SET api_key = $1 WHERE id = $2', [apiKey, userId], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, apiKey, message: 'API ключ сгенерирован' });
        });
    });
});

app.post('/api/v1/shorten', requireApiKey, (req, res) => {
    const { url, customAlias } = req.body;
    
    if (!url) return res.status(400).json({ error: 'URL обязателен' });
    
    let validatedUrl = url.trim();
    if (!validatedUrl.startsWith('http')) validatedUrl = 'https://' + validatedUrl;
    
    try {
        new URL(validatedUrl);
    } catch {
        return res.status(400).json({ error: 'Некорректный URL' });
    }
    
    checkUserLimits(req.apiUserId, 'links', (err, limits) => {
        if (err) return res.status(500).json({ error: 'Ошибка проверки лимитов' });
        if (!limits.allowed) {
            return res.status(403).json({ error: `Превышен лимит: ${limits.current}/${limits.limit} ссылок в месяц` });
        }
        
        const shortCode = customAlias || generateRandomCode(6);
        
        db.run(
            'INSERT INTO links (user_id, original_url, short_code, custom_alias) VALUES ($1, $2, $3, $4)',
            [req.apiUserId, validatedUrl, shortCode, customAlias || null],
            function(err) {
                if (err) {
                    if (err.message.includes('UNIQUE')) {
                        return res.status(400).json({ error: 'Алиас уже занят' });
                    }
                    return res.status(500).json({ error: 'Ошибка создания ссылки' });
                }
                
                db.run(
                    'INSERT INTO api_calls (user_id, endpoint, method, status_code, ip_address) VALUES ($1, $2, $3, $4, $5)',
                    [req.apiUserId, '/api/v1/shorten', 'POST', 200, req.ip]
                );
                
                res.json({
                    success: true,
                    originalUrl: validatedUrl,
                    shortUrl: `${req.protocol}://${req.get('host')}/${shortCode}`,
                    shortCode
                });
            });
    });
});

// ========== ЧАТ ПОДДЕРЖКИ ==========
app.get('/api/support/chat', requireAuth, (req, res) => {
    const userId = req.session.userId;
    
    db.get('SELECT * FROM support_chats WHERE user_id = $1', [userId], (err, chat) => {
        if (err) {
            return res.status(500).json({ error: 'Ошибка сервера' });
        }
        
        if (chat) {
            res.json({ success: true, chat, exists: true });
        } else {
            db.run(
                'INSERT INTO support_chats (user_id) VALUES ($1) RETURNING id',
                [userId],
                function(err, result) {
                    if (err) {
                        return res.status(500).json({ error: 'Ошибка создания чата' });
                    }
                    
                    db.get('SELECT * FROM support_chats WHERE id = $1', [result.lastID], (err, newChat) => {
                        res.json({ success: true, chat: newChat, exists: false });
                    });
                }
            );
        }
    });
});
            
app.get('/api/support/chat/:chatId/messages', requireAuth, (req, res) => {
    const { chatId } = req.params;
    const userId = req.session.userId;
    const since = req.query.since;
    
    db.get('SELECT * FROM support_chats WHERE id = $1 AND user_id = $2', 
        [chatId, userId],
        (err, chat) => {
            if (err || !chat) {
                return res.status(404).json({ error: 'Чат не найден' });
            }
            
            let query = 'SELECT * FROM support_chat_messages WHERE chat_id = $1';
            const params = [chatId];
            
            if (since) {
                query += ' AND created_at > $2';
                params.push(since);
            }
            
            query += ' ORDER BY created_at ASC';
            
            db.all(query, params, (err, messages) => {
                if (err) {
                    return res.status(500).json({ error: 'Ошибка получения сообщений' });
                }
                
                db.run('UPDATE support_chat_messages SET is_read = 1 WHERE chat_id = $1 AND sender_type = \'admin\'', [chatId]);
                
                res.json({ 
                    success: true, 
                    messages: messages || [],
                    isClosed: chat.is_closed === 1
                });
            });
        }
    );
});

app.post('/api/support/chat/:chatId/message', requireAuth, (req, res) => {
    const { chatId } = req.params;
    const { message } = req.body;
    const userId = req.session.userId;
    
    if (!message || message.trim().length === 0) {
        return res.status(400).json({ error: 'Сообщение не может быть пустым' });
    }
    
    db.get('SELECT id, is_closed FROM support_chats WHERE id = $1 AND user_id = $2', 
        [chatId, userId],
        (err, chat) => {
            if (err || !chat) {
                return res.status(404).json({ error: 'Чат не найден' });
            }
            
            if (chat.is_closed === 1) {
                return res.status(400).json({ error: 'Чат закрыт' });
            }
            
            db.run(
                'INSERT INTO support_chat_messages (chat_id, sender_type, message) VALUES ($1, $2, $3)',
                [chatId, 'user', message],
                function(err) {
                    if (err) {
                        return res.status(500).json({ error: 'Ошибка отправки сообщения' });
                    }
                    
                    db.run('UPDATE support_chats SET updated_at = CURRENT_TIMESTAMP WHERE id = $1', [chatId]);
                    
                    res.json({ success: true, messageId: this.lastID });
                }
            );
        }
    );
});



// ========== АДМИН ПАНЕЛЬ ==========

// Вход в админку - проверяем пароль из БД
app.post('/api/admin/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        if (!username || !password) {
            return res.status(400).json({ error: 'Логин и пароль обязательны' });
        }
        
        // Проверяем в базе данных
        db.get('SELECT * FROM admins WHERE username = $1', [username], async (err, admin) => {
            if (err || !admin) {
                return res.status(401).json({ error: 'Неверный логин или пароль' });
            }
            
            const isValid = await bcrypt.compare(password, admin.password);
            if (!isValid) {
                return res.status(401).json({ error: 'Неверный логин или пароль' });
            }
            
            // Сохраняем админ сессию
            req.session.adminId = admin.id;
            req.session.adminUsername = admin.username;
            
            res.json({ 
                success: true, 
                admin: { id: admin.id, username: admin.username, email: admin.email } 
            });
        });
    } catch (error) {
        console.error('Ошибка админ входа:', error.message);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Выход из админки
app.post('/api/admin/logout', (req, res) => {
    req.session.adminId = null;
    req.session.adminUsername = null;
    res.json({ success: true, message: 'Выход выполнен' });
});

// Проверка авторизации админа
app.get('/api/admin/me', (req, res) => {
    if (req.session.adminId) {
        db.get('SELECT id, username, email FROM admins WHERE id = $1', [req.session.adminId], (err, admin) => {
            if (err || !admin) {
                req.session.adminId = null;
                return res.status(401).json({ error: 'Не авторизован' });
            }
            res.json({ success: true, admin });
        });
    } else {
        res.status(401).json({ error: 'Не авторизован' });
    }
});

function requireAdminAuth(req, res, next) {
    if (req.session.adminId) {
        next();
    } else {
        res.status(401).json({ error: 'Требуется авторизация администратора' });
    }
}

app.get('/api/admin/chats', requireAdminAuth, (req, res) => {
    const { status } = req.query;
    let query = `
        SELECT 
            c.*,
            u.username as user_name,
            u.email as user_email,
            (SELECT COUNT(*) FROM support_chat_messages WHERE chat_id = c.id AND sender_type = 'user' AND is_read = 0) as unread_count,
            (SELECT message FROM support_chat_messages WHERE chat_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message
        FROM support_chats c
        LEFT JOIN users u ON c.user_id = u.id
    `;
    const params = [];
    if (status === 'active') query += ' WHERE c.is_closed = 0';
    else if (status === 'closed') query += ' WHERE c.is_closed = 1';
    query += ' ORDER BY c.updated_at DESC';
    
    db.all(query, params, (err, chats) => {
        if (err) return res.status(500).json({ error: 'Ошибка получения чатов' });
        res.json({ success: true, chats: chats || [] });
    });
});

app.get('/api/admin/chat/:chatId', requireAdminAuth, (req, res) => {
    const { chatId } = req.params;
    
    db.get('SELECT * FROM support_chats WHERE id = $1', [chatId], (err, chat) => {
        if (err || !chat) return res.status(404).json({ error: 'Чат не найден' });
        
        db.get('SELECT username, email FROM users WHERE id = $1', [chat.user_id], (err, user) => {
            if (err) user = null;
            
            db.all('SELECT * FROM support_chat_messages WHERE chat_id = $1 ORDER BY created_at ASC', [chatId], (err, messages) => {
                if (err) return res.status(500).json({ error: 'Ошибка получения сообщений' });
                db.run('UPDATE support_chat_messages SET is_read = 1 WHERE chat_id = $1 AND sender_type = \'user\'', [chatId]);
                res.json({ success: true, chat, user: user || { username: 'Неизвестно', email: '' }, messages: messages || [] });
            });
        });
    });
});

app.post('/api/admin/chat/:chatId/message', requireAdminAuth, (req, res) => {
    const { chatId } = req.params;
    const { message } = req.body;
    
    if (!message || message.trim().length === 0) {
        return res.status(400).json({ error: 'Сообщение не может быть пустым' });
    }
    
    db.get('SELECT id, is_closed FROM support_chats WHERE id = $1', [chatId], (err, chat) => {
        if (err || !chat) return res.status(404).json({ error: 'Чат не найден' });
        if (chat.is_closed === 1) return res.status(400).json({ error: 'Чат закрыт' });
        
        db.run('INSERT INTO support_chat_messages (chat_id, sender_type, message) VALUES ($1, $2, $3)', [chatId, 'admin', message], function(err) {
            if (err) return res.status(500).json({ error: 'Ошибка отправки сообщения' });
            db.run('UPDATE support_chats SET updated_at = CURRENT_TIMESTAMP, is_closed = 0 WHERE id = $1', [chatId]);
            res.json({ success: true, messageId: this.lastID });
        });
    });
});

app.patch('/api/admin/chat/:chatId/status', requireAdminAuth, (req, res) => {
    const { chatId } = req.params;
    const { isClosed } = req.body;
    
    db.run('UPDATE support_chats SET is_closed = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [isClosed ? 1 : 0, chatId], function(err) {
        if (err) return res.status(500).json({ error: 'Ошибка обновления статуса' });
        res.json({ success: true, message: 'Статус обновлён' });
    });
});

app.get('/api/admin/stats', requireAdminAuth, (req, res) => {
    db.all(`SELECT SUM(CASE WHEN is_closed = 0 THEN 1 ELSE 0 END) as active, SUM(CASE WHEN is_closed = 1 THEN 1 ELSE 0 END) as closed, COUNT(*) as total FROM support_chats`, [], (err, stats) => {
        if (err) return res.status(500).json({ error: 'Ошибка получения статистики' });
        db.get('SELECT COUNT(*) as unread FROM support_chat_messages WHERE is_read = 0 AND sender_type = \'user\'', [], (err, unreadResult) => {
            res.json({ success: true, stats: {
                active: parseInt(stats?.[0]?.active || 0),
                closed: parseInt(stats?.[0]?.closed || 0),
                total: parseInt(stats?.[0]?.total || 0),
                unread: parseInt(unreadResult?.unread || 0)
            }});
        });
    });
});

app.get('/api/admin/users', requireAdminAuth, (req, res) => {
    const { plan } = req.query;
    let query = `SELECT id, username, email, plan_type, created_at, (SELECT COUNT(*) FROM links WHERE user_id = users.id) as total_links, (SELECT COUNT(*) FROM qrcodes WHERE user_id = users.id) as total_qrcodes FROM users`;
    const params = [];
    if (plan && ['free', 'premium', 'business'].includes(plan)) {
        query += ' WHERE plan_type = $1';
        params.push(plan);
    }
    query += ' ORDER BY created_at DESC';
    
    db.all(query, params, (err, users) => {
        if (err) return res.status(500).json({ error: 'Ошибка получения пользователей' });
        res.json({ success: true, users: users || [] });
    });
});

app.patch('/api/admin/users/:userId/plan', requireAdminAuth, (req, res) => {
    const { userId } = req.params;
    const { planType } = req.body;
    
    if (!['free', 'premium', 'business'].includes(planType)) {
        return res.status(400).json({ error: 'Неверный тарифный план' });
    }
    
    db.run('UPDATE users SET plan_type = $1 WHERE id = $2', [planType, userId], function(err) {
        if (err) return res.status(500).json({ error: 'Ошибка обновления тарифа' });
        if (this.changes === 0) return res.status(404).json({ error: 'Пользователь не найден' });
        db.run('INSERT INTO subscriptions (user_id, plan_type, status, amount, start_date) VALUES ($1, $2, \'admin_changed\', 0, CURRENT_TIMESTAMP)', [userId, planType]);
        res.json({ success: true, message: `Тариф пользователя изменён на ${planType}`, newPlan: planType });
    });
});

// ========== КОНВЕРТЕР ФАЙЛОВ ==========


// ========== РЕДАКТОР ИЗОБРАЖЕНИЙ ==========
app.post('/api/image/edit', requireAuth, uploadSingle.single('image'), async (req, res) => {
    try {
        const {
            width, height, brightness = 100, contrast = 100, saturate = 100,
            hue = 0, sepia = 0, invert = 0, rotate = 0, flip = 'none',
            blur = 0, sharpen = 0, format = 'jpeg', quality = 90
        } = req.body;

        if (!req.file) return res.status(400).json({ error: 'Изображение не загружено' });
        
        const inputPath = req.file.path;
        const ext = format === 'jpeg' ? 'jpg' : format;
        const outputFilename = `${Date.now()}_edited.${ext}`;
        const outputPath = path.join(uploadDir, outputFilename);
        
        let pipeline = sharp(inputPath);

        const rotateAngle = parseInt(rotate) || 0;
        if (rotateAngle !== 0) pipeline = pipeline.rotate(rotateAngle);

        if (flip === 'horizontal' || flip === 'both') pipeline = pipeline.flop();
        if (flip === 'vertical' || flip === 'both') pipeline = pipeline.flip();
        
        const brightnessVal = parseFloat(brightness) || 100;
        if (brightnessVal !== 100) pipeline = pipeline.modulate({ brightness: brightnessVal / 100 });

        const contrastVal = parseFloat(contrast) || 100;
        if (contrastVal !== 100) pipeline = pipeline.modulate({ contrast: contrastVal / 100 });

        const saturateVal = parseFloat(saturate) || 100;
        if (saturateVal !== 100) pipeline = pipeline.modulate({ saturation: saturateVal / 100 });

        const hueVal = parseFloat(hue) || 0;
        if (hueVal !== 0) pipeline = pipeline.modulate({ hue: hueVal });

        const sepiaVal = parseFloat(sepia) || 0;
        if (sepiaVal > 0) {
            pipeline = pipeline.modulate({ saturation: 0.2 });
            pipeline = pipeline.tint({ r: 112, g: 66, b: 20, alpha: sepiaVal / 100 });
        }

        const invertVal = parseFloat(invert) || 0;
        if (invertVal > 0) pipeline = pipeline.negate();

        const blurVal = parseFloat(blur) || 0;
        if (blurVal > 0) pipeline = pipeline.blur(blurVal);

        const sharpenVal = parseFloat(sharpen) || 0;
        if (sharpenVal > 0) pipeline = pipeline.sharpen({ sigma: 1.5, m1: sharpenVal, m2: sharpenVal / 2 });

        const resizeWidth = parseInt(width) || null;
        const resizeHeight = parseInt(height) || null;
        if (resizeWidth || resizeHeight) {
            const options = {};
            if (resizeWidth) options.width = resizeWidth;
            if (resizeHeight) options.height = resizeHeight;
            if (!resizeWidth || !resizeHeight) options.fit = 'inside';
            pipeline = pipeline.resize(options);
        }

        const qualityVal = parseInt(quality) || 90;
        switch (format.toLowerCase()) {
            case 'jpeg': case 'jpg': pipeline = pipeline.jpeg({ quality: qualityVal, progressive: true }); break;
            case 'png': pipeline = pipeline.png({ compressionLevel: Math.floor((100 - qualityVal) / 10) }); break;
            case 'webp': pipeline = pipeline.webp({ quality: qualityVal }); break;
            case 'avif': pipeline = pipeline.avif({ quality: qualityVal }); break;
            case 'bmp': pipeline = pipeline.bmp(); break;
            case 'gif': pipeline = pipeline.gif(); break;
            case 'tiff': pipeline = pipeline.tiff({ quality: qualityVal }); break;
        }

        await pipeline.toFile(outputPath);
        res.download(outputPath, outputFilename, async (err) => {
            await cleanupTempFile(inputPath);
            await cleanupTempFile(outputPath);
        });
    } catch (error) {
        console.error('Ошибка редактирования:', error.message);
        if (req.file) await cleanupTempFile(req.file.path);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/image/resize', requireAuth, uploadSingle.single('image'), async (req, res) => {
    try {
        const { width, height, maintainAspectRatio = 'true' } = req.body;
        if (!req.file) return res.status(400).json({ error: 'Изображение не загружено' });
        
        const inputPath = req.file.path;
        const outputFilename = `${Date.now()}_resized${path.extname(req.file.originalname)}`;
        const outputPath = path.join(uploadDir, outputFilename);
        
        let options = {};
        if (width && height) {
            options = maintainAspectRatio === 'true' 
                ? { width: parseInt(width), height: parseInt(height), fit: 'inside' }
                : { width: parseInt(width), height: parseInt(height) };
        } else if (width) options = { width: parseInt(width) };
        else if (height) options = { height: parseInt(height) };
        else throw new Error('Укажите хотя бы ширину или высоту');
        
        await sharp(inputPath).resize(options).toFile(outputPath);
        res.download(outputPath, `resized_${req.file.originalname}`, async (err) => {
            await cleanupTempFile(inputPath);
            await cleanupTempFile(outputPath);
        });
    } catch (error) {
        if (req.file) await cleanupTempFile(req.file.path);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/image/format', requireAuth, uploadSingle.single('image'), async (req, res) => {
    try {
        const { targetFormat } = req.body;
        if (!req.file) return res.status(400).json({ error: 'Изображение не загружено' });
        if (!targetFormat) return res.status(400).json({ error: 'Не указан целевой формат' });
        
        const inputPath = req.file.path;
        const outputFilename = `${Date.now()}_converted.${targetFormat}`;
        const outputPath = path.join(uploadDir, outputFilename);
        
        await sharp(inputPath).toFormat(targetFormat).toFile(outputPath);
        res.download(outputPath, `converted.${targetFormat}`, async (err) => {
            await cleanupTempFile(inputPath);
            await cleanupTempFile(outputPath);
        });
    } catch (error) {
        if (req.file) await cleanupTempFile(req.file.path);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/image/rotate', requireAuth, uploadSingle.single('image'), async (req, res) => {
    try {
        const { degrees } = req.body;
        if (!req.file) return res.status(400).json({ error: 'Изображение не загружено' });
        
        const angle = parseInt(degrees) || 0;
        const inputPath = req.file.path;
        const outputFilename = `${Date.now()}_rotated${path.extname(req.file.originalname)}`;
        const outputPath = path.join(uploadDir, outputFilename);
        
        await sharp(inputPath).rotate(angle).toFile(outputPath);
        res.download(outputPath, `rotated_${req.file.originalname}`, async (err) => {
            await cleanupTempFile(inputPath);
            await cleanupTempFile(outputPath);
        });
    } catch (error) {
        if (req.file) await cleanupTempFile(req.file.path);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/image/filter', requireAuth, uploadSingle.single('image'), async (req, res) => {
    try {
        const { filter } = req.body;
        if (!req.file) return res.status(400).json({ error: 'Изображение не загружено' });
        
        const inputPath = req.file.path;
        const outputFilename = `${Date.now()}_filtered${path.extname(req.file.originalname)}`;
        const outputPath = path.join(uploadDir, outputFilename);
        
        let transformer = sharp(inputPath);
        switch (filter) {
            case 'grayscale': transformer = transformer.grayscale(); break;
            case 'blur': transformer = transformer.blur(5); break;
            case 'sharpen': transformer = transformer.sharpen(); break;
            default: throw new Error('Неизвестный фильтр');
        }
        
        await transformer.toFile(outputPath);
        res.download(outputPath, `filtered_${req.file.originalname}`, async (err) => {
            await cleanupTempFile(inputPath);
            await cleanupTempFile(outputPath);
        });
    } catch (error) {
        if (req.file) await cleanupTempFile(req.file.path);
        res.status(500).json({ error: error.message });
    }
});
// ========== РАБОЧИЙ КОНВЕРТЕР ФАЙЛОВ ==========


// Поддерживаемые форматы
const imageFormats = ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'tiff', 'avif'];
const documentFormats = ['pdf', 'docx', 'txt', 'md', 'html'];

// Конвертация ИЗОБРАЖЕНИЙ (работает через sharp)
app.post('/api/convert/images', requireAuth, uploadMultiple.array('files', 10), async (req, res) => {
    let tempFiles = [];
    
    try {
        const { targetFormat, quality = 90, width, height } = req.body;
        const files = req.files;
        
        if (!files || files.length === 0) {
            return res.status(400).json({ error: 'Файлы не загружены' });
        }
        if (!targetFormat || !imageFormats.includes(targetFormat)) {
            return res.status(400).json({ error: 'Неподдерживаемый формат изображения' });
        }
        
        const results = [];
        const errors = [];
        
        for (const file of files) {
            const inputPath = file.path;
            tempFiles.push(inputPath);
            
            const baseName = file.originalname.replace(/\.[^/.]+$/, '');
            const outputFilename = `${baseName}.${targetFormat === 'jpeg' ? 'jpg' : targetFormat}`;
            const outputPath = path.join(uploadDir, outputFilename);
            tempFiles.push(outputPath);
            
            try {
                let pipeline = sharp(inputPath);
                
                // Изменение размера если указано
                if (width || height) {
                    const options = {};
                    if (width) options.width = parseInt(width);
                    if (height) options.height = parseInt(height);
                    pipeline = pipeline.resize(options);
                }
                
                // Качество
                const qualityVal = parseInt(quality);
                switch (targetFormat) {
                    case 'jpg': case 'jpeg':
                        pipeline = pipeline.jpeg({ quality: qualityVal, progressive: true });
                        break;
                    case 'png':
                        pipeline = pipeline.png({ compressionLevel: Math.floor((100 - qualityVal) / 10) });
                        break;
                    case 'webp':
                        pipeline = pipeline.webp({ quality: qualityVal });
                        break;
                    case 'avif':
                        pipeline = pipeline.avif({ quality: qualityVal });
                        break;
                    case 'bmp': pipeline = pipeline.bmp(); break;
                    case 'tiff': pipeline = pipeline.tiff(); break;
                }
                
                await pipeline.toFile(outputPath);
                results.push({ original: file.originalname, converted: outputFilename, success: true, size: (await fs.promises.stat(outputPath)).size });
            } catch (err) {
                errors.push({ original: file.originalname, error: err.message });
                await cleanupTempFile(outputPath);
            }
        }
        
        if (results.length === 0) {
            await cleanupTempFiles(tempFiles);
            return res.status(400).json({ error: 'Не удалось сконвертировать ни один файл', details: errors });
        }
        
        if (results.length === 1 && errors.length === 0) {
            const filePath = path.join(uploadDir, results[0].converted);
            res.download(filePath, results[0].converted, async () => {
                await cleanupTempFiles(tempFiles);
            });
            return;
        }
        
        const zipName = `converted_images_${Date.now()}.zip`;
        const zipPath = path.join(uploadDir, zipName);
        tempFiles.push(zipPath);
        
        const output = fs.createWriteStream(zipPath);
        const archive = archiver('zip', { zlib: { level: 9 } });
        archive.pipe(output);
        
        for (const result of results) {
            const filePath = path.join(uploadDir, result.converted);
            if (fs.existsSync(filePath)) {
                archive.file(filePath, { name: result.converted });
            }
        }
        
        await archive.finalize();
        await new Promise((resolve) => output.on('close', resolve));
        
        res.download(zipPath, zipName, async () => {
            await cleanupTempFiles(tempFiles);
        });
        
    } catch (error) {
        console.error('Ошибка конвертации изображений:', error);
        await cleanupTempFiles(tempFiles);
        res.status(500).json({ error: error.message });
    }
});

// Конвертация ДОКУМЕНТОВ (работает через mammoth, pdfkit)
app.post('/api/convert/documents', requireAuth, uploadMultiple.array('files', 10), async (req, res) => {
    let tempFiles = [];
    
    try {
        const { targetFormat } = req.body;
        const files = req.files;
        
        if (!files || files.length === 0) {
            return res.status(400).json({ error: 'Файлы не загружены' });
        }
        if (!targetFormat || !documentFormats.includes(targetFormat)) {
            return res.status(400).json({ error: 'Неподдерживаемый формат документа' });
        }
        
        const results = [];
        const errors = [];
        
        for (const file of files) {
            const inputPath = file.path;
            tempFiles.push(inputPath);
            
            const baseName = file.originalname.replace(/\.[^/.]+$/, '');
            const outputFilename = `${baseName}.${targetFormat}`;
            const outputPath = path.join(uploadDir, outputFilename);
            tempFiles.push(outputPath);
            
            try {
                const ext = path.extname(file.originalname).toLowerCase();
                const mimeType = file.mimetype;
                
                if (targetFormat === 'pdf') {
                    // Конвертация в PDF
                    let text = '';
                    
                    if (ext === '.txt' || mimeType === 'text/plain') {
                        text = await fs.promises.readFile(inputPath, 'utf8');
                    } else if (ext === '.docx' || mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
                        const buffer = await fs.promises.readFile(inputPath);
                        const result = await mammoth.extractRawText({ buffer });
                        text = result.value;
                    } else if (ext === '.md' || mimeType === 'text/markdown') {
                        text = await fs.promises.readFile(inputPath, 'utf8');
                    } else if (ext === '.html' || mimeType === 'text/html') {
                        text = await fs.promises.readFile(inputPath, 'utf8');
                        text = text.replace(/<[^>]*>/g, '');
                    } else {
                        throw new Error(`Конвертация из ${ext} в PDF не поддерживается`);
                    }
                    
                    const pdfDoc = new PDFDocument({ margin: 50 });
                    const writeStream = fs.createWriteStream(outputPath);
                    pdfDoc.pipe(writeStream);
                    pdfDoc.fontSize(12).text(text, { align: 'left', lineGap: 5 });
                    pdfDoc.end();
                    
                    await new Promise((resolve) => writeStream.on('finish', resolve));
                    results.push({ original: file.originalname, converted: outputFilename, success: true });
                    
                } else if (targetFormat === 'docx') {
                    // Конвертация в DOCX
                    let text = '';
                    
                    if (ext === '.txt' || mimeType === 'text/plain') {
                        text = await fs.promises.readFile(inputPath, 'utf8');
                    } else if (ext === '.md' || mimeType === 'text/markdown') {
                        text = await fs.promises.readFile(inputPath, 'utf8');
                    } else if (ext === '.html' || mimeType === 'text/html') {
                        text = await fs.promises.readFile(inputPath, 'utf8');
                        text = text.replace(/<[^>]*>/g, '');
                    } else if (ext === '.pdf' || mimeType === 'application/pdf') {
                        throw new Error('PDF в DOCX не поддерживается (требуется внешний сервис)');
                    } else {
                        throw new Error(`Конвертация из ${ext} в DOCX не поддерживается`);
                    }
                    
                    const { Document, Packer, Paragraph, TextRun } = require('docx');
                    const lines = text.split('\n');
                    const paragraphs = lines.map(line => {
                        return new Paragraph({
                            children: [new TextRun({ text: line || ' ', size: 24 })],
                            spacing: { after: 200 }
                        });
                    });
                    
                    const doc = new Document({ sections: [{ children: paragraphs }] });
                    const buffer = await Packer.toBuffer(doc);
                    await fs.promises.writeFile(outputPath, buffer);
                    results.push({ original: file.originalname, converted: outputFilename, success: true });
                    
                } else if (targetFormat === 'txt') {
                    // Конвертация в TXT
                    let text = '';
                    
                    if (ext === '.docx' || mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
                        const buffer = await fs.promises.readFile(inputPath);
                        const result = await mammoth.extractRawText({ buffer });
                        text = result.value;
                    } else if (ext === '.md' || mimeType === 'text/markdown') {
                        text = await fs.promises.readFile(inputPath, 'utf8');
                    } else if (ext === '.html' || mimeType === 'text/html') {
                        text = await fs.promises.readFile(inputPath, 'utf8');
                        text = text.replace(/<[^>]*>/g, '');
                    } else if (ext === '.pdf') {
                        throw new Error('PDF в TXT не поддерживается');
                    } else {
                        text = await fs.promises.readFile(inputPath, 'utf8');
                    }
                    
                    await fs.promises.writeFile(outputPath, text, 'utf8');
                    results.push({ original: file.originalname, converted: outputFilename, success: true });
                }
                
            } catch (err) {
                errors.push({ original: file.originalname, error: err.message });
                await cleanupTempFile(outputPath);
            }
        }
        
        if (results.length === 0) {
            await cleanupTempFiles(tempFiles);
            return res.status(400).json({ error: 'Не удалось сконвертировать ни один файл', details: errors });
        }
        
        if (results.length === 1 && errors.length === 0) {
            const filePath = path.join(uploadDir, results[0].converted);
            res.download(filePath, results[0].converted, async () => {
                await cleanupTempFiles(tempFiles);
            });
            return;
        }
        
        const zipName = `converted_docs_${Date.now()}.zip`;
        const zipPath = path.join(uploadDir, zipName);
        tempFiles.push(zipPath);
        
        const output = fs.createWriteStream(zipPath);
        const archive = archiver('zip', { zlib: { level: 9 } });
        archive.pipe(output);
        
        for (const result of results) {
            const filePath = path.join(uploadDir, result.converted);
            if (fs.existsSync(filePath)) {
                archive.file(filePath, { name: result.converted });
            }
        }
        
        await archive.finalize();
        await new Promise((resolve) => output.on('close', resolve));
        
        res.download(zipPath, zipName, async () => {
            await cleanupTempFiles(tempFiles);
        });
        
    } catch (error) {
        console.error('Ошибка конвертации документов:', error);
        await cleanupTempFiles(tempFiles);
        res.status(500).json({ error: error.message });
    }
});


// ========== РЕДИРЕКТ ==========
app.get('/:shortCode', (req, res) => {
    const { shortCode } = req.params;
    const excluded = ['api', 'login', 'register', 'profile', 'analytics', 'batch', 
                     'pricing', 'converter', 'image-editor', 'dashboard', 'favicon.ico',
                     'admin', 'style.css', 'dark-theme.css', 'chat-widget.js', 'chat-widget.css'];
    
    if (excluded.includes(shortCode) || shortCode.includes('.')) {
        return res.status(404).send('Страница не найдена');
    }
    
    db.get('SELECT id, original_url FROM links WHERE short_code = $1 AND is_active = 1', [shortCode], (err, link) => {
        if (err || !link) return res.redirect('/?error=link_not_found');
        
        const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
        const userAgent = req.headers['user-agent'] || '';
        let deviceType = 'desktop';
        if (/mobile/i.test(userAgent)) deviceType = 'mobile';
        else if (/tablet/i.test(userAgent)) deviceType = 'tablet';
        else if (/bot|crawler|spider/i.test(userAgent)) deviceType = 'bot';
        const referrer = req.headers['referer'] || req.headers['referrer'] || '';
        
        db.run('INSERT INTO link_clicks (link_id, ip_address, user_agent, referrer, device_type) VALUES ($1, $2, $3, $4, $5)', [link.id, ip, userAgent.substring(0, 500), referrer.substring(0, 500), deviceType]);
        db.run('UPDATE links SET clicks = clicks + 1, last_clicked = CURRENT_TIMESTAMP WHERE id = $1', [link.id]);
        res.redirect(link.original_url);
    });
});

app.use('/api/*', (req, res) => {
    res.status(404).json({ error: 'API endpoint не найден' });
});

// ========== ЗАПУСК СЕРВЕРА ==========
createTables()
    .then(() => createIndexes())
    .then(async () => {
        // Создаем админа если нет
        await new Promise((resolve) => {
            db.get('SELECT COUNT(*) as count FROM admins', [], (err, result) => {
                if (!err && result && parseInt(result.count) === 0) {
                    console.log('⚠️ Админ не найден, создаем дефолтного...');
                    bcrypt.hash('admin123', 10, (err, hash) => {
                        if (!err) {
                            db.run('INSERT INTO admins (username, password, email) VALUES ($1, $2, $3)', ['admin', hash, 'admin@linksnap.local'], () => {
                                console.log('✅ Админ создан (логин: admin, пароль: admin123)');
                                resolve();
                            });
                        } else {
                            resolve();
                        }
                    });
                } else {
                    resolve();
                }
            });
        });
        
        const server = app.listen(port, '0.0.0.0', () => {
            console.log(`\n🚀 Сервер LinkSnap запущен: http://localhost:${port}`);
            console.log(`🌐 Домен: https://estr1per-linksnap-85ab.twc1.net`);
            console.log(`🔒 Режим: ${process.env.NODE_ENV || 'development'}`);
            console.log(`💾 База данных: PostgreSQL\n`);
        });
        
        process.on('SIGINT', () => {
            console.log('\n👋 Завершение работы...');
            server.close(() => {
                db.close().then(() => {
                    console.log('✅ Сервер остановлен');
                    process.exit(0);
                });
            });
        });
    })
    .catch(error => {
        console.error('❌ Ошибка запуска:', error);
        process.exit(1);
    });