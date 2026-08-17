require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');

const app = express();

// Set EJS as templating engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/auth/uploads', express.static(path.join(__dirname, 'auth/uploads'))); // For backwards compatibility with old avatars

const SQLiteStore = require('connect-sqlite3')(session);

// Session config
app.use(session({
    store: new SQLiteStore({
        db: 'sessions.sqlite',
        dir: __dirname
    }),
    secret: 'neuromagic_secret_key', // Replace with a strong secret in production
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false } // Set to true if using HTTPS
}));

// Routes
const authRoutes = require('./routes/authRoutes');
const apiRoutes = require('./routes/apiRoutes');
const billingRoutes = require('./routes/billingRoutes');
const pool = require('./config/db');
const { processSubscriptionEmailNotifications } = require('./utils/subscriptionNotifier');
app.use('/', billingRoutes);
app.use(express.json());

const ACTIVE_SUB_STATUSES = ['active', 'trialing', 'past_due'];
const DAILY_LIMITS = {
    guest: 10,
    free: 40,
    pro: 200,
    plus: null // unlimited
};

// Test Route to verify server is updated
app.get('/test-neuromagic', (req, res) => res.send('NeuroMagic Server is LIVE and Updated!'));

// User Middleware
async function isAuthenticated(req, res, next) {
    if (req.session && req.session.user_id) {
        res.locals.user_id = req.session.user_id;
        res.locals.user_name = req.session.user_name;
        res.locals.user_email = req.session.user_email;
        res.locals.user_avatar = req.session.user_avatar || '/auth/uploads/avatars/default.png';
        res.locals.preferred_lang = req.session.preferred_lang || 'en';
        res.locals.user_role = req.session.user_role || '';
        res.locals.is_guest = false;
        try {
            const sub = await getUserSubscriptionInfo(req.session.user_id);
            res.locals.subscription_plan = sub.plan;
            res.locals.subscription_status = sub.status;
        } catch (_) {
            res.locals.subscription_plan = 'free';
            res.locals.subscription_status = 'inactive';
        }
    } else {
        res.locals.user_id = null;
        res.locals.user_name = 'Guest';
        res.locals.user_email = '';
        res.locals.user_avatar = '/auth/uploads/avatars/default.png';
        res.locals.preferred_lang = 'en';
        res.locals.user_role = '';
        res.locals.is_guest = true;
        res.locals.subscription_plan = 'free';
        res.locals.subscription_status = 'inactive';
    }
    next();
}

async function getUserSubscriptionInfo(userId) {
    const fallback = { plan: 'free', status: 'inactive' };
    if (!userId) return fallback;
    try {
        const [[sub]] = await pool.execute(
            'SELECT plan_code, status FROM subscriptions WHERE user_id = ? LIMIT 1',
            [userId]
        );
        return {
            plan: sub?.plan_code || 'free',
            status: sub?.status || 'inactive'
        };
    } catch (_) {
        return fallback;
    }
}

async function ensureFavoritesTable() {
    await pool.execute(`
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
}

async function ensureProjectMemoryTables() {
    await pool.execute(`
        CREATE TABLE IF NOT EXISTS prompt_projects (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT UNSIGNED NOT NULL,
            name VARCHAR(120) NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_prompt_projects_user (user_id),
            CONSTRAINT fk_prompt_projects_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    await pool.execute(`
        CREATE TABLE IF NOT EXISTS prompt_project_memory (
            id INT AUTO_INCREMENT PRIMARY KEY,
            project_id INT NOT NULL,
            user_id INT UNSIGNED NOT NULL,
            question_text MEDIUMTEXT NOT NULL,
            answer_text MEDIUMTEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_project_memory_project (project_id, created_at),
            INDEX idx_project_memory_user (user_id),
            CONSTRAINT fk_project_memory_project FOREIGN KEY (project_id) REFERENCES prompt_projects(id) ON DELETE CASCADE,
            CONSTRAINT fk_project_memory_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
}

function isPlusPlan(plan, status) {
    return String(plan || '').toLowerCase() === 'plus' && ACTIVE_SUB_STATUSES.includes(String(status || '').toLowerCase());
}

async function getGuestUsageToday(sessionId) {
    if (!sessionId) return 0;
    try {
        const [[usage]] = await pool.execute(
            `SELECT usage_count
             FROM daily_usage
             WHERE guest_session_id = ?
             AND usage_date = CURDATE()
             LIMIT 1`,
            [sessionId]
        );
        return Number(usage?.usage_count || 0);
    } catch (_) {
        return 0;
    }
}

function resolveUsagePolicy(plan, status, isGuest) {
    if (isGuest) {
        return { isLimited: true, dailyLimit: DAILY_LIMITS.guest, planCode: 'guest' };
    }

    const normalizedPlan = String(plan || 'free').toLowerCase();
    const normalizedStatus = String(status || 'inactive').toLowerCase();
    const hasPaidAccess = ACTIVE_SUB_STATUSES.includes(normalizedStatus);

    if (normalizedPlan === 'plus' && hasPaidAccess) {
        return { isLimited: false, dailyLimit: DAILY_LIMITS.plus, planCode: 'plus' };
    }
    if (normalizedPlan === 'pro' && hasPaidAccess) {
        return { isLimited: true, dailyLimit: DAILY_LIMITS.pro, planCode: 'pro' };
    }
    return { isLimited: true, dailyLimit: DAILY_LIMITS.free, planCode: 'free' };
}

async function buildDashboardData(userId, sessionId) {
    const defaults = {
        stats: { creations: 0, favorites: 0, todayCreations: 0, tokensUsed: 0 },
        recent: [],
        usage: { isLimited: true, dailyLimit: DAILY_LIMITS.guest, usedToday: 0, remainingToday: DAILY_LIMITS.guest },
        subscription: { plan: 'guest', status: 'inactive' }
    };
    if (!userId) {
        const usedToday = await getGuestUsageToday(sessionId);
        return {
            ...defaults,
            usage: {
                isLimited: true,
                dailyLimit: DAILY_LIMITS.guest,
                usedToday,
                remainingToday: Math.max(0, DAILY_LIMITS.guest - usedToday)
            }
        };
    }

    try {
        const [[creationRows]] = await pool.execute('SELECT COUNT(*) as count FROM history WHERE user_id = ?', [userId]);
        const [[favoritesRows]] = await pool.execute('SELECT COUNT(*) as count FROM favorites WHERE user_id = ?', [userId]);
        const [[todayRows]] = await pool.execute(
            `SELECT COUNT(*) as count
             FROM history
             WHERE user_id = ?
             AND DATE(created_at) = CURDATE()`,
            [userId]
        );
        const [[monthRows]] = await pool.execute(
            `SELECT COALESCE(SUM(CHAR_LENGTH(original_input) + CHAR_LENGTH(enhanced_result)), 0) AS total
             FROM history
             WHERE user_id = ?
             AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)`,
            [userId]
        );
        const [recentRows] = await pool.execute(
            'SELECT original_input, enhanced_result, created_at FROM history WHERE user_id = ? ORDER BY created_at DESC LIMIT 5',
            [userId]
        );
        const subscription = await getUserSubscriptionInfo(userId);
        const policy = resolveUsagePolicy(subscription.plan, subscription.status, false);
        const usedToday = Number(todayRows?.count || 0);
        const remainingToday = policy.isLimited && Number.isFinite(policy.dailyLimit)
            ? Math.max(0, policy.dailyLimit - usedToday)
            : null;

        return {
            stats: {
                creations: Number(creationRows?.count || 0),
                favorites: Number(favoritesRows?.count || 0),
                todayCreations: usedToday,
                tokensUsed: Number(monthRows?.total || 0)
            },
            recent: Array.isArray(recentRows) ? recentRows : [],
            usage: {
                isLimited: policy.isLimited,
                dailyLimit: policy.dailyLimit,
                usedToday,
                remainingToday
            },
            subscription
        };
    } catch (e) {
        console.error('Dashboard Stats Error:', e);
        return defaults;
    }
}

// User Routes (Priority Registration)
app.get('/user/dashboard', isAuthenticated, async (req, res) => {
    if (res.locals.user_id && !res.locals.user_role) return res.redirect('/user/onboarding');
    const data = await buildDashboardData(req.session.user_id, req.sessionID);
    return res.render('user/dashboard', {
        stats: data.stats,
        recent: data.recent,
        usage: data.usage,
        subscription: data.subscription
    });
});
app.get('/user/Dashboard', isAuthenticated, async (req, res) => {
    if (res.locals.user_id && !res.locals.user_role) return res.redirect('/user/onboarding');
    const data = await buildDashboardData(req.session.user_id, req.sessionID);
    return res.render('user/dashboard', {
        stats: data.stats,
        recent: data.recent,
        usage: data.usage,
        subscription: data.subscription
    });
});

app.get('/user/dashboard-data', isAuthenticated, async (req, res) => {
    const data = await buildDashboardData(req.session.user_id, req.sessionID);
    res.json(data);
});

app.get('/user/onboarding', isAuthenticated, (req, res) => {
    if (!req.session.user_id) return res.redirect('/auth/login');
    res.render('user/Onboarding');
});
app.get('/user/Onboarding', isAuthenticated, (req, res) => {
    if (!req.session.user_id) return res.redirect('/auth/login');
    res.render('user/Onboarding');
});

// REDIRECTS FOR OLD TERMINOLOGY (To ensure user never gets 404)
app.get('/user/EnhancePrompt', (req, res) => res.redirect('/user/enhance-creation'));
app.get('/user/enhance-prompt', (req, res) => res.redirect('/user/enhance-creation'));
app.get('/user/Enhance-Prompt', (req, res) => res.redirect('/user/enhance-creation'));

app.get('/user/enhance-creation', isAuthenticated, (req, res) => {
    console.log("HIT ROUTE: /user/enhance-creation");
    res.render('user/EnhanceCreation');
});
app.get('/user/EnhanceCreation', isAuthenticated, (req, res) => {
    console.log("HIT ROUTE: /user/EnhanceCreation");
    res.render('user/EnhanceCreation');
});

app.get('/user/history-page', isAuthenticated, (req, res) => {
    if (!req.session.user_id) return res.redirect('/auth/login');
    res.render('user/history');
});
app.get('/user/History-Page', isAuthenticated, (req, res) => {
    if (!req.session.user_id) return res.redirect('/auth/login');
    res.render('user/history');
});

app.get('/user/library', isAuthenticated, (req, res) => {
    res.redirect('/user/favorites-page');
});
app.get('/user/Library', isAuthenticated, (req, res) => {
    res.redirect('/user/favorites-page');
});

app.get('/user/profile', isAuthenticated, async (req, res) => {
    let stats = { creations: 0, favorites: 0 };
    if (req.session.user_id) {
        try {
            const [[pRows]] = await pool.execute('SELECT COUNT(*) as count FROM history WHERE user_id = ?', [req.session.user_id]);
            const [[fRows]] = await pool.execute('SELECT COUNT(*) as count FROM favorites WHERE user_id = ?', [req.session.user_id]);
            stats.creations = pRows.count || 0;
            stats.favorites = fRows.count || 0;
        } catch (e) { console.error("Profile Stats Error:", e); }
    }
    res.render('user/Profile', { stats });
});
app.get('/user/Profile', isAuthenticated, async (req, res) => {
    let stats = { creations: 0, favorites: 0 };
    if (req.session.user_id) {
        try {
            const [[pRows]] = await pool.execute('SELECT COUNT(*) as count FROM history WHERE user_id = ?', [req.session.user_id]);
            const [[fRows]] = await pool.execute('SELECT COUNT(*) as count FROM favorites WHERE user_id = ?', [req.session.user_id]);
            stats.creations = pRows.count || 0;
            stats.favorites = fRows.count || 0;
        } catch (e) { console.error("Profile Stats Error:", e); }
    }
    res.render('user/Profile', { stats });
});

// Profile Edit/Update Route
app.post('/user/profile', isAuthenticated, async (req, res) => {
    const { name, email, current_password, new_password } = req.body;
    const userId = req.session.user_id;
    
    if (!userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    try {
        // Update user profile
        const updates = {};
        if (name) updates.name = name;
        if (email) updates.email = email;
        if (new_password) {
            // Hash new password
            const bcrypt = require('bcryptjs');
            const saltRounds = 10;
            updates.password = await bcrypt.hash(new_password, saltRounds);
        }
        
        // Apply updates
        const updateFields = Object.keys(updates).map(field => `${field} = ?`).join(', ');
        const updateValues = Object.values(updates);
        
        await pool.execute(
            `UPDATE users SET ${updateFields} WHERE id = ?`,
            [...updateValues, userId]
        );
        
        res.json({ success: true, message: 'Profile updated successfully' });
    } catch (err) {
        console.error('Profile update error:', err);
        res.status(500).json({ error: 'Failed to update profile' });
    }
});


app.get('/user/help', isAuthenticated, (req, res) => {
    res.render('user/Help');
});
app.get('/user/Help', isAuthenticated, (req, res) => {
    res.render('user/Help');
});

app.get('/user/settings', isAuthenticated, (req, res) => {
    res.render('user/settings');
});
app.get('/user/Settings', isAuthenticated, (req, res) => {
    res.render('user/settings');
});

app.get('/user/plans', isAuthenticated, (req, res) => {
    res.render('user/plans');
});

app.get('/user/favorites-page', isAuthenticated, (req, res) => {
    if (!req.session.user_id) return res.redirect('/auth/login');
    res.render('user/favorites');
});

app.get('/user/templates', isAuthenticated, (req, res) => {
    res.render('user/templates');
});

app.get('/user/folders', isAuthenticated, (req, res) => {
    res.render('user/folders');
});

app.get('/user/generate-prompt', isAuthenticated, (req, res) => {
    res.render('user/generate-prompt');
});

// Other Routes
app.use('/auth', authRoutes);
app.use('/api', apiRoutes);

// Update Preferences
app.post('/user/update-preferences', isAuthenticated, async (req, res) => {
    if (!req.session.user_id) return res.status(401).json({ error: 'Unauthorized' });
    const { preferred_lang, user_role } = req.body;
    try {
        await pool.execute('UPDATE users SET preferred_lang = ?, user_role = ? WHERE id = ?', [preferred_lang || 'en', user_role || 'General', req.session.user_id]);
        req.session.preferred_lang = preferred_lang;
        req.session.user_role = user_role;
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// History API
app.post('/user/history', isAuthenticated, async (req, res) => {
    if (!req.session.user_id) return res.status(401).json({ error: 'Unauthorized' });
    const { original, enhanced, type } = req.body;
    try {
        let planCode = 'free';
        let status = 'inactive';
        try {
            const [[sub]] = await pool.execute(
                'SELECT plan_code, status FROM subscriptions WHERE user_id = ? LIMIT 1',
                [req.session.user_id]
            );
            planCode = sub?.plan_code || 'free';
            status = sub?.status || 'inactive';
        } catch (_) {
            // If subscriptions table does not exist yet, keep free defaults.
        }
        const policy = resolveUsagePolicy(planCode, status, false);
        if (policy.isLimited && Number.isFinite(policy.dailyLimit)) {
            const [[usage]] = await pool.execute(
                `SELECT COUNT(*) as count
                 FROM history
                 WHERE user_id = ?
                 AND DATE(created_at) = CURDATE()`,
                [req.session.user_id]
            );
            if ((usage?.count || 0) >= policy.dailyLimit) {
                return res.status(429).json({ error: `Daily limit reached (${policy.dailyLimit} creations).` });
            }
        }
        await pool.execute('INSERT INTO history (user_id, original_input, enhanced_result, creation_type) VALUES (?, ?, ?, ?)', [req.session.user_id, original, enhanced, type || 'standard']);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

app.get('/user/history', isAuthenticated, async (req, res) => {
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
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// Delete history
app.delete('/user/history/:id', isAuthenticated, async (req, res) => {
    if (!req.session.user_id) return res.status(401).json({ error: 'Unauthorized' });
    try {
        await pool.execute('DELETE FROM history WHERE id = ? AND user_id = ?', [req.params.id, req.session.user_id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

app.delete('/user/history-all', isAuthenticated, async (req, res) => {
    if (!req.session.user_id) return res.status(401).json({ error: 'Unauthorized' });
    try {
        await pool.execute('DELETE FROM history WHERE user_id = ?', [req.session.user_id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// Favorites API
app.post('/user/favorites', isAuthenticated, async (req, res) => {
    if (!req.session.user_id) return res.status(401).json({ error: 'Please sign in to continue.' });
    const { content, title, category } = req.body;
    try {
        await ensureFavoritesTable();
        await pool.execute('INSERT INTO favorites (user_id, content, title, category) VALUES (?, ?, ?, ?)', [req.session.user_id, content, title || 'My Creation', category || 'general']);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

app.get('/user/favorites', isAuthenticated, async (req, res) => {
    if (!req.session.user_id) return res.status(401).json({ error: 'Please sign in to continue.' });
    try {
        await ensureFavoritesTable();
        const [rows] = await pool.execute('SELECT * FROM favorites WHERE user_id = ? ORDER BY created_at DESC', [req.session.user_id]);
        res.json(rows);
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

app.delete('/user/favorites/:id', isAuthenticated, async (req, res) => {
    if (!req.session.user_id) return res.status(401).json({ error: 'Please sign in to continue.' });
    try {
        await ensureFavoritesTable();
        await pool.execute('DELETE FROM favorites WHERE id = ? AND user_id = ?', [req.params.id, req.session.user_id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// Plus-only project memory APIs
app.get('/user/projects', isAuthenticated, async (req, res) => {
    if (!req.session.user_id) return res.status(401).json({ error: 'Unauthorized' });
    try {
        await ensureProjectMemoryTables();
        const sub = await getUserSubscriptionInfo(req.session.user_id);
        if (!isPlusPlan(sub.plan, sub.status)) {
            return res.status(403).json({ error: 'Projects are available for Plus users only.' });
        }
        const [rows] = await pool.execute(
            'SELECT id, name, created_at FROM prompt_projects WHERE user_id = ? ORDER BY updated_at DESC, id DESC',
            [req.session.user_id]
        );
        res.json(rows || []);
    } catch (err) {
        res.status(500).json({ error: 'Failed' });
    }
});

app.post('/user/projects', isAuthenticated, async (req, res) => {
    if (!req.session.user_id) return res.status(401).json({ error: 'Unauthorized' });
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Project name is required.' });
    try {
        await ensureProjectMemoryTables();
        const sub = await getUserSubscriptionInfo(req.session.user_id);
        if (!isPlusPlan(sub.plan, sub.status)) {
            return res.status(403).json({ error: 'Projects are available for Plus users only.' });
        }
        const [result] = await pool.execute(
            'INSERT INTO prompt_projects (user_id, name) VALUES (?, ?)',
            [req.session.user_id, name.slice(0, 120)]
        );
        res.json({ success: true, id: result.insertId, name: name.slice(0, 120) });
    } catch (err) {
        res.status(500).json({ error: 'Failed' });
    }
});

app.get('/user/projects/:id/context', isAuthenticated, async (req, res) => {
    if (!req.session.user_id) return res.status(401).json({ error: 'Unauthorized' });
    const projectId = Number(req.params.id);
    const limit = Math.min(Math.max(Number(req.query.limit || 8), 1), 20);
    if (!Number.isFinite(projectId)) return res.status(400).json({ error: 'Invalid project.' });
    try {
        await ensureProjectMemoryTables();
        const sub = await getUserSubscriptionInfo(req.session.user_id);
        if (!isPlusPlan(sub.plan, sub.status)) {
            return res.status(403).json({ error: 'Projects are available for Plus users only.' });
        }
        const [[project]] = await pool.execute(
            'SELECT id FROM prompt_projects WHERE id = ? AND user_id = ? LIMIT 1',
            [projectId, req.session.user_id]
        );
        if (!project) return res.status(404).json({ error: 'Project not found.' });
        const [rows] = await pool.execute(
            `SELECT question_text, answer_text, created_at
             FROM prompt_project_memory
             WHERE project_id = ? AND user_id = ?
             ORDER BY created_at DESC
             LIMIT ?`,
            [projectId, req.session.user_id, limit]
        );
        res.json((rows || []).reverse());
    } catch (err) {
        res.status(500).json({ error: 'Failed' });
    }
});

app.post('/user/projects/:id/context', isAuthenticated, async (req, res) => {
    if (!req.session.user_id) return res.status(401).json({ error: 'Unauthorized' });
    const projectId = Number(req.params.id);
    const question = String(req.body?.question || '').trim();
    const answer = String(req.body?.answer || '').trim();
    if (!Number.isFinite(projectId)) return res.status(400).json({ error: 'Invalid project.' });
    if (!question || !answer) return res.status(400).json({ error: 'Question and answer are required.' });
    try {
        await ensureProjectMemoryTables();
        const sub = await getUserSubscriptionInfo(req.session.user_id);
        if (!isPlusPlan(sub.plan, sub.status)) {
            return res.status(403).json({ error: 'Projects are available for Plus users only.' });
        }
        const [[project]] = await pool.execute(
            'SELECT id FROM prompt_projects WHERE id = ? AND user_id = ? LIMIT 1',
            [projectId, req.session.user_id]
        );
        if (!project) return res.status(404).json({ error: 'Project not found.' });
        await pool.execute(
            'INSERT INTO prompt_project_memory (project_id, user_id, question_text, answer_text) VALUES (?, ?, ?, ?)',
            [projectId, req.session.user_id, question.slice(0, 20000), answer.slice(0, 50000)]
        );
        await pool.execute('UPDATE prompt_projects SET updated_at = NOW() WHERE id = ? AND user_id = ?', [projectId, req.session.user_id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed' });
    }
});

app.delete('/user/projects/:id', isAuthenticated, async (req, res) => {
    if (!req.session.user_id) return res.status(401).json({ error: 'Unauthorized' });
    const projectId = Number(req.params.id);
    if (!Number.isFinite(projectId)) return res.status(400).json({ error: 'Invalid project.' });
    try {
        await ensureProjectMemoryTables();
        const sub = await getUserSubscriptionInfo(req.session.user_id);
        if (!isPlusPlan(sub.plan, sub.status)) {
            return res.status(403).json({ error: 'Projects are available for Plus users only.' });
        }
        const [[project]] = await pool.execute(
            'SELECT id FROM prompt_projects WHERE id = ? AND user_id = ? LIMIT 1',
            [projectId, req.session.user_id]
        );
        if (!project) return res.status(404).json({ error: 'Project not found.' });
        
        // Delete project and all its memories (cascade delete should handle this)
        await pool.execute('DELETE FROM prompt_projects WHERE id = ? AND user_id = ?', [projectId, req.session.user_id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed' });
    }
});

app.get('/', isAuthenticated, (req, res) => {
    return res.render('index');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    processSubscriptionEmailNotifications().catch((err) => {
        console.error('Initial subscription notification scan failed:', err.message);
    });
});

setInterval(() => {
    processSubscriptionEmailNotifications().catch((err) => {
        console.error('Subscription notification scan failed:', err.message);
    });
}, 60 * 60 * 1000);