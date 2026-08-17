const express = require('express');
const router = express.Router();
const pool = require('../config/db');

// Middleware to handle both guests and logged in users
function isAuthenticated(req, res, next) {
    if (req.session && req.session.user_id) {
        res.locals.user_id = req.session.user_id;
        res.locals.user_name = req.session.user_name;
        res.locals.user_email = req.session.user_email;
        res.locals.user_avatar = req.session.user_avatar || '/auth/uploads/avatars/default.png';
        res.locals.preferred_lang = req.session.preferred_lang || 'en';
        res.locals.user_role = req.session.user_role || '';
        res.locals.is_guest = false;
    } else {
        // Fallback for guest mode!
        res.locals.user_id = null;
        res.locals.user_name = 'Guest';
        res.locals.user_email = '';
        res.locals.user_avatar = '';
        res.locals.preferred_lang = 'en';
        res.locals.user_role = '';
        res.locals.is_guest = true;
    }
    return next();
}

router.use(isAuthenticated);

router.get('/dashboard', (req, res) => {
    if (res.locals.user_id && !res.locals.user_role) {
        return res.redirect('/user/onboarding');
    }
    res.render('user/dashboard');
});

router.get('/onboarding', (req, res) => {
    if (!req.session.user_id) return res.redirect('/auth/login');
    res.render('user/onboarding');
});

router.post('/update-preferences', async (req, res) => {
    if (!req.session.user_id) return res.status(401).json({ error: 'Unauthorized' });
    const { preferred_lang, user_role } = req.body;
    try {
        await pool.execute(
            'UPDATE users SET preferred_lang = ?, user_role = ? WHERE id = ?',
            [preferred_lang || 'en', user_role || 'General', req.session.user_id]
        );
        req.session.preferred_lang = preferred_lang;
        req.session.user_role = user_role;
        res.json({ success: true });
    } catch (err) {
        console.error('Update Pref Error:', err);
        res.status(500).json({ error: 'Failed' });
    }
});

router.get('/enhance-creation', (req, res) => {
    res.render('user/enhance-creation');
});

router.get('/history-page', (req, res) => {
    if (!req.session.user_id) return res.redirect('/auth/login');
    res.render('user/history');
});

router.get('/library', (req, res) => {
    res.render('user/library');
});

router.get('/profile', async (req, res) => {
    let stats = { creations: 0, favorites: 0 };
    if (req.session.user_id) {
        try {
            const [[pRows]] = await pool.execute('SELECT COUNT(*) as count FROM history WHERE user_id = ?', [req.session.user_id]);
            const [[fRows]] = await pool.execute('SELECT COUNT(*) as count FROM favorites WHERE user_id = ?', [req.session.user_id]);
            stats.creations = pRows.count;
            stats.favorites = fRows.count;
        } catch (e) { 
            console.error("Profile Stat Error:", e); 
        }
    }
    res.render('user/profile', { stats });
});

router.get('/help', (req, res) => {
    res.render('user/help');
});

router.get('/settings', (req, res) => {
    res.render('user/settings');
});

// --- PERSISTENCE ROUTES ---

// Save to history
router.post('/history', async (req, res) => {
    if (!req.session.user_id) return res.status(401).json({ error: 'Unauthorized' });
    const { original, enhanced, type } = req.body;
    try {
        await pool.execute(
            'INSERT INTO history (user_id, original_input, enhanced_result, creation_type) VALUES (?, ?, ?, ?)',
            [req.session.user_id, original, enhanced, type || 'standard']
        );
        res.json({ success: true });
    } catch (err) {
        console.error('History Error:', err);
        res.status(500).json({ error: 'Failed to save history' });
    }
});

// Get history with search and filter
router.get('/history', async (req, res) => {
    if (!req.session.user_id) return res.status(401).json({ error: 'Unauthorized' });
    
    const { type, search } = req.query;
    let query = 'SELECT * FROM history WHERE user_id = ?';
    let params = [req.session.user_id];

    if (type && type !== 'all') {
        query += ' AND creation_type = ?';
        params.push(type);
    }

    if (search) {
        query += ' AND (original_input LIKE ? OR enhanced_result LIKE ?)';
        params.push(`%${search}%`, `%${search}%`);
    }

    query += ' ORDER BY created_at DESC LIMIT 100';

    try {
        const [rows] = await pool.execute(query, params);
        res.json(rows);
    } catch (err) {
        console.error('Fetch History Error:', err);
        res.status(500).json({ error: 'Failed to fetch history' });
    }
});

// Delete specific history
router.delete('/history/:id', async (req, res) => {
    if (!req.session.user_id) return res.status(401).json({ error: 'Unauthorized' });
    try {
        const [result] = await pool.execute(
            'DELETE FROM history WHERE id = ? AND user_id = ?',
            [req.params.id, req.session.user_id]
        );
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Not found' });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete' });
    }
});

// Delete all history
router.delete('/history-all', async (req, res) => {
    if (!req.session.user_id) return res.status(401).json({ error: 'Unauthorized' });
    try {
        await pool.execute('DELETE FROM history WHERE user_id = ?', [req.session.user_id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to clear history' });
    }
});

// Save to favorites
router.post('/favorites', async (req, res) => {
    if (!req.session.user_id) return res.status(401).json({ error: 'Unauthorized' });
    const { content, title, category } = req.body;
    try {
        await pool.execute(
            'INSERT INTO favorites (user_id, content, title, category) VALUES (?, ?, ?, ?)',
            [req.session.user_id, content, title || 'My Creation', category || 'general']
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to save favorite' });
    }
});

// Get favorites
router.get('/favorites', async (req, res) => {
    if (!req.session.user_id) return res.status(401).json({ error: 'Unauthorized' });
    try {
        const [rows] = await pool.execute(
            'SELECT * FROM favorites WHERE user_id = ? ORDER BY created_at DESC',
            [req.session.user_id]
        );
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch favorites' });
    }
});

module.exports = router;
