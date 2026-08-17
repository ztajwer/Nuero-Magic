require('dotenv').config();
const pool = require('../config/db');

async function checkUsers() {
    try {
        const [rows] = await pool.execute('SELECT COUNT(*) as count FROM users');
        console.log('User count:', rows[0].count);
        
        const [users] = await pool.execute('SELECT id, name, email FROM users LIMIT 5');
        console.log('Sample users:', users);
    } catch (err) {
        console.error('Error checking users:', err.message);
    } finally {
        process.exit();
    }
}

checkUsers();
