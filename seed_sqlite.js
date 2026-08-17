const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcryptjs');

const dbPath = path.join(__dirname, 'neuromagic.sqlite');
const db = new sqlite3.Database(dbPath);

const executeQuery = (sql, params = []) => {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function(err) {
            if (err) reject(err);
            else resolve(this);
        });
    });
};

const runSetup = async () => {
    console.log('--- Initializing SQLite Tables ---');
    try {
        // Drop existing tables to ensure clean slate
        await executeQuery(`DROP TABLE IF EXISTS subscription_notifications;`);
        await executeQuery(`DROP TABLE IF EXISTS subscriptions;`);
        await executeQuery(`DROP TABLE IF EXISTS daily_usage;`);
        await executeQuery(`DROP TABLE IF EXISTS favorites;`);
        await executeQuery(`DROP TABLE IF EXISTS history;`);
        await executeQuery(`DROP TABLE IF EXISTS prompt_project_memory;`);
        await executeQuery(`DROP TABLE IF EXISTS prompt_projects;`);
        await executeQuery(`DROP TABLE IF EXISTS users;`);

        // Users Table
        await executeQuery(`
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT,
                email TEXT NOT NULL UNIQUE,
                password TEXT NOT NULL,
                avatar TEXT,
                preferred_lang TEXT DEFAULT 'en',
                user_role TEXT,
                reset_token TEXT,
                reset_token_expires DATETIME,
                last_login DATETIME,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log('✅ Users table ready');

        // History Table
        await executeQuery(`
            CREATE TABLE IF NOT EXISTS history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                original_input TEXT NOT NULL,
                enhanced_result TEXT NOT NULL,
                creation_type TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );
        `);
        console.log('✅ History table ready');

        // Favorites Table
        await executeQuery(`
            CREATE TABLE IF NOT EXISTS favorites (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                content TEXT NOT NULL,
                title TEXT,
                category TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );
        `);
        console.log('✅ Favorites table ready');

        // Subscriptions Table
        await executeQuery(`
            CREATE TABLE IF NOT EXISTS subscriptions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL UNIQUE,
                plan_code TEXT NOT NULL DEFAULT 'free',
                status TEXT NOT NULL DEFAULT 'inactive',
                stripe_customer_id TEXT,
                stripe_subscription_id TEXT,
                stripe_price_id TEXT,
                current_period_end DATETIME NULL,
                cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );
        `);
        console.log('✅ Subscriptions table ready');

        // Subscription Notifications Table
        await executeQuery(`
            CREATE TABLE IF NOT EXISTS subscription_notifications (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                subscription_id TEXT NULL,
                notification_type TEXT NOT NULL,
                period_end DATETIME NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );
        `);
        console.log('✅ Subscription notifications table ready');

        // Daily Usage Table
        await executeQuery(`
            CREATE TABLE IF NOT EXISTS daily_usage (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NULL,
                guest_session_id TEXT NULL,
                usage_date DATE NOT NULL,
                usage_count INTEGER NOT NULL DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log('✅ Daily usage table ready');

        // Prompt Projects (Magic Projects)
        await executeQuery(`
            CREATE TABLE IF NOT EXISTS prompt_projects (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );
        `);
        console.log('✅ Prompt projects table ready');

        // Prompt Project Memory
        await executeQuery(`
            CREATE TABLE IF NOT EXISTS prompt_project_memory (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER NOT NULL,
                user_id INTEGER NOT NULL,
                question_text TEXT NOT NULL,
                answer_text TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (project_id) REFERENCES prompt_projects(id) ON DELETE CASCADE,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );
        `);
        console.log('✅ Prompt project memory table ready');

        // --- Seeding Data ---
        console.log('--- Seeding Demo Users ---');
        const hashedPassword = await bcrypt.hash('password123', 10);
        
        // Seed users
        const usersToSeed = [
            { name: 'Free User', email: 'freeuser@gmail.com', role: 'General' },
            { name: 'Pro User', email: 'prouser@gmail.com', role: 'General' },
            { name: 'Pro User Typo', email: 'prouser@gmial.com', role: 'General' },
            { name: 'Plus User', email: 'plususer@gmail.com', role: 'General' }
        ];

        for (const u of usersToSeed) {
            await executeQuery(
                `INSERT INTO users (name, email, password, preferred_lang, user_role) VALUES (?, ?, ?, 'en', ?);`,
                [u.name, u.email, hashedPassword, u.role]
            );
            console.log(`👤 Seeded user: ${u.email}`);
        }

        // Fetch seeded user ids
        const getUser = (email) => {
            return new Promise((resolve, reject) => {
                db.get(`SELECT id FROM users WHERE email = ?`, [email], (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                });
            });
        };

        const freeUser = await getUser('freeuser@gmail.com');
        const proUser = await getUser('prouser@gmail.com');
        const proUserTypo = await getUser('prouser@gmial.com');
        const plusUser = await getUser('plususer@gmail.com');

        // Seed subscriptions
        const nextMonth = new Date();
        nextMonth.setMonth(nextMonth.getMonth() + 1);
        const nextMonthStr = nextMonth.toISOString().slice(0, 19).replace('T', ' ');

        await executeQuery(
            `INSERT INTO subscriptions (user_id, plan_code, status, stripe_subscription_id, current_period_end) VALUES (?, 'free', 'inactive', NULL, NULL);`,
            [freeUser.id]
        );
        await executeQuery(
            `INSERT INTO subscriptions (user_id, plan_code, status, stripe_subscription_id, current_period_end) VALUES (?, 'pro', 'active', ?, ?);`,
            [proUser.id, `local-sub-${proUser.id}`, nextMonthStr]
        );
        await executeQuery(
            `INSERT INTO subscriptions (user_id, plan_code, status, stripe_subscription_id, current_period_end) VALUES (?, 'pro', 'active', ?, ?);`,
            [proUserTypo.id, `local-sub-${proUserTypo.id}`, nextMonthStr]
        );
        await executeQuery(
            `INSERT INTO subscriptions (user_id, plan_code, status, stripe_subscription_id, current_period_end) VALUES (?, 'plus', 'active', ?, ?);`,
            [plusUser.id, `local-sub-${plusUser.id}`, nextMonthStr]
        );

        console.log('✅ Seeded subscriptions for demo users');
        console.log('--- Database Seeding Complete ---');
        db.close();
        process.exit(0);
    } catch (err) {
        console.error('❌ Setup/Seeding Failed:', err);
        db.close();
        process.exit(1);
    }
};

runSetup();
