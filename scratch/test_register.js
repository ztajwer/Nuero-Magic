require('dotenv').config();
const pool = require('../config/db');
const bcrypt = require('bcrypt');

async function testRegister() {
    try {
        const name = 'Test User';
        const email = 'test' + Date.now() + '@example.com';
        const password = 'Password123';
        const hashedPassword = await bcrypt.hash(password, 12);
        
        console.log('Attempting to register:', email);
        
        const [result] = await pool.execute(
            'INSERT INTO users (name, email, password, avatar, created_at) VALUES (?, ?, ?, ?, NOW())',
            [name, email, hashedPassword, null]
        );
        
        console.log('Registration success! ID:', result.insertId);
        
        // Clean up
        await pool.execute('DELETE FROM users WHERE id = ?', [result.insertId]);
        console.log('Test user deleted.');
        
    } catch (err) {
        console.error('Registration failed with error:');
        console.error('Message:', err.message);
        console.error('Code:', err.code);
        console.error('Stack:', err.stack);
    } finally {
        process.exit();
    }
}

testRegister();
