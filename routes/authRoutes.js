const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const pool = require('../config/db');
const { sendResetEmail } = require('../utils/mailer');

// Multer config for avatar uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadDir = path.join(__dirname, '../public/uploads/avatars/');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        cb(null, 'avatar-' + uniqueSuffix + ext);
    }
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) cb(null, true);
        else cb(new Error('Only images are allowed'));
    }
});

// GET /auth/login
router.get('/login', (req, res) => {
    if (req.session.user_id) return res.redirect('/user/dashboard');
    res.render('auth/login', { errors: [], email: '' });
});

// POST /auth/login
router.post('/login', async (req, res) => {
    const { email, password } = req.body;
    let errors = [];

    if (!email || !password) {
        errors.push('Please provide both email and password.');
        return res.render('auth/login', { errors, email });
    }

    try {
        const [rows] = await pool.execute('SELECT * FROM users WHERE email = ?', [email.trim()]);
        const user = rows[0];

        if (!user || !(await bcrypt.compare(password, user.password))) {
            errors.push('Invalid credentials. Please try again.');
            return res.render('auth/login', { errors, email });
        }

        // Login success
        req.session.user_id = user.id;
        req.session.user_name = user.name;
        req.session.user_email = user.email;
        req.session.user_avatar = user.avatar; 
        req.session.preferred_lang = user.preferred_lang || 'en';
        req.session.user_role = user.user_role;

        if (!user.user_role) {
            return res.redirect('/user/onboarding');
        }

        return res.redirect('/user/dashboard');
    } catch (err) {
        console.error('Login Error:', err);
        errors.push('An internal error occurred. Please try again later.');
        res.render('auth/login', { errors, email });
    }
});

// GET /auth/register
router.get('/register', (req, res) => {
    if (req.session.user_id) return res.redirect('/user/dashboard');
    res.render('auth/register', { errors: [], name: '', email: '' });
});

// POST /auth/register
router.post('/register', upload.single('avatar'), async (req, res) => {
    const { name, email, password } = req.body;
    let errors = [];

    if (!name || name.length < 2) errors.push('Name must be at least 2 characters.');
    if (!email || !email.includes('@')) errors.push('Please enter a valid email.');
    if (!password || password.length < 8) errors.push('Password must be at least 8 characters.');

    if (errors.length > 0) {
        return res.render('auth/register', { errors, name, email });
    }

    try {
        const [existing] = await pool.execute('SELECT id FROM users WHERE email = ?', [email.trim()]);
        if (existing.length > 0) {
            errors.push('This email is already registered.');
            return res.render('auth/register', { errors, name, email });
        }

        const hashedPassword = await bcrypt.hash(password, 12);
        const avatarPath = req.file ? '/uploads/avatars/' + req.file.filename : null;

        const [result] = await pool.execute(
            'INSERT INTO users (name, email, password, avatar, created_at) VALUES (?, ?, ?, ?, NOW())',
            [name.trim(), email.trim(), hashedPassword, avatarPath]
        );

        // Auto login after registration
        req.session.user_id = result.insertId;
        req.session.user_name = name.trim();
        req.session.user_email = email.trim();
        req.session.user_avatar = avatarPath;
        req.session.preferred_lang = 'en'; // Default
        req.session.user_role = null; // Forces onboarding

        res.redirect('/user/onboarding');
    } catch (err) {
        console.error('Registration Error:', err);
        if (err.code === 'ECONNREFUSED') {
            errors.push('Database server is offline. Please start MySQL in XAMPP.');
        } else {
            errors.push('Could not create account. Please try again.');
        }
        res.render('auth/register', { errors, name, email });
    }
});

// GET /auth/forgot-password
router.get('/forgot-password', (req, res) => {
    res.render('auth/forgot-password', { error: null, success: null, email: '' });
});

// POST /auth/forgot-password
router.post('/forgot-password', async (req, res) => {
    const { email } = req.body;
    if (!email) return res.render('auth/forgot-password', { error: 'Please enter your email.', success: null, email });

    try {
        const [users] = await pool.execute('SELECT id FROM users WHERE email = ?', [email.trim()]);
        if (users.length === 0) {
            // Security: don't reveal if user exists
            return res.render('auth/forgot-password', { error: null, success: 'If that email exists, a reset link has been sent.', email: '' });
        }

        const token = crypto.randomBytes(32).toString('hex');
        const expires = new Date(Date.now() + 3600000); // 1 hour

        await pool.execute('UPDATE users SET reset_token = ?, reset_token_expires = ? WHERE email = ?', [token, expires, email.trim()]);

        const resetLink = `${process.env.BASE_URL || 'http://localhost:3000'}/auth/reset-password?token=${token}`;
        
        try {
            await sendResetEmail(email.trim(), resetLink);
            res.render('auth/forgot-password', { 
                error: null, 
                success: 'Check your email inbox. A reset link has been sent!', 
                email: '' 
            });
        } catch (mailErr) {
            console.error('Mail Error:', mailErr);
            // Fallback for local testing if mail fails
            res.render('auth/forgot-password', { 
                error: null, 
                success: `Check Console/Test Mode: Reset link generated. <a href="${resetLink}" style="color:#2563eb; font-weight:bold;">Click here to reset (Dev Link)</a>`,
                email: '' 
            });
        }
    } catch (err) {
        console.error('Forgot Password Error:', err);
        res.render('auth/forgot-password', { error: 'Something went wrong. Try again.', success: null, email });
    }
});

// GET /auth/reset-password
router.get('/reset-password', async (req, res) => {
    const { token } = req.query;
    if (!token) return res.redirect('/auth/login');

    try {
        const [users] = await pool.execute('SELECT * FROM users WHERE reset_token = ? AND reset_token_expires > NOW()', [token]);
        if (users.length === 0) {
            return res.render('auth/reset-password', { error: 'The link is invalid or has expired.', success: null, token, user: null });
        }
        res.render('auth/reset-password', { error: null, success: null, token, user: users[0] });
    } catch (err) {
        res.redirect('/auth/login');
    }
});

// POST /auth/reset-password
router.post('/reset-password', async (req, res) => {
    const { token } = req.query;
    const { password, confirm } = req.body;

    if (!token) return res.redirect('/auth/login');
    if (password !== confirm) return res.render('auth/reset-password', { error: 'Passwords do not match.', success: null, token, user: {id:1} });
    if (password.length < 8) return res.render('auth/reset-password', { error: 'Password must be 8+ characters.', success: null, token, user: {id:1} });

    try {
        const [users] = await pool.execute('SELECT id FROM users WHERE reset_token = ? AND reset_token_expires > NOW()', [token]);
        if (users.length === 0) return res.render('auth/reset-password', { error: 'Invalid or expired token.', success: null, token, user: null });

        const hashedPassword = await bcrypt.hash(password, 12);
        await pool.execute('UPDATE users SET password = ?, reset_token = NULL, reset_token_expires = NULL WHERE id = ?', [hashedPassword, users[0].id]);

        res.render('auth/reset-password', { error: null, success: 'Success! Your password is reset. You can now login.', token: null, user: null });
    } catch (err) {
        res.render('auth/reset-password', { error: 'Error resetting password.', success: null, token, user: {id:1} });
    }
});

// GET /auth/logout
router.get('/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/auth/login'));
});

module.exports = router;
