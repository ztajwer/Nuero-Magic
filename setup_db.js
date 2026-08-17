const pool = require('./config/db');

const setup = async () => {
    try {
        console.log('--- Database Setup Started ---');
        
        // Users Table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(255),
                email VARCHAR(255) NOT NULL UNIQUE,
                password VARCHAR(255) NOT NULL,
                avatar VARCHAR(255),
                preferred_lang VARCHAR(10) DEFAULT 'en',
                user_role VARCHAR(50),
                reset_token VARCHAR(255),
                reset_token_expires DATETIME,
                last_login DATETIME,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);
        console.log('✅ Table "users" is ready');

        // History Table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS history (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT UNSIGNED NOT NULL,
                original_input TEXT NOT NULL,
                enhanced_result TEXT NOT NULL,
                creation_type VARCHAR(50),
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);
        console.log('✅ Table "history" is ready');

        // Favorites Table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS favorites (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT UNSIGNED NOT NULL,
                content TEXT NOT NULL,
                title VARCHAR(255),
                category VARCHAR(50),
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);
        console.log('✅ Table "favorites" is ready');

        const [rows] = await pool.query('SELECT COUNT(*) as count FROM users');
        console.log(`📊 Current user count: ${rows[0].count}`);

        console.log('--- Setup Complete ---');
        process.exit(0);
    } catch (err) {
        console.error('❌ Setup Failed:', err);
        process.exit(1);
    }
};

setup();
