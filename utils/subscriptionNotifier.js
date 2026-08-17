const pool = require('../config/db');
const {
    sendSubscriptionStartedEmail,
    sendSubscriptionEndingEmail
} = require('./mailer');

const ACTIVE_STATUSES = new Set(['active', 'trialing', 'past_due']);

async function ensureNotificationsTable() {
    await pool.execute(`
        CREATE TABLE IF NOT EXISTS subscription_notifications (
            id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            user_id INT UNSIGNED NOT NULL,
            subscription_id VARCHAR(255) NULL,
            notification_type VARCHAR(50) NOT NULL,
            period_end DATETIME NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uniq_subscription_notice (user_id, subscription_id, notification_type, period_end),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
}

async function wasSent(userId, subscriptionId, notificationType, periodEnd) {
    const [rows] = await pool.execute(
        `SELECT id
         FROM subscription_notifications
         WHERE user_id = ?
           AND COALESCE(subscription_id, '') = COALESCE(?, '')
           AND notification_type = ?
           AND (
                (period_end IS NULL AND ? IS NULL)
                OR period_end = ?
           )
         LIMIT 1`,
        [userId, subscriptionId || null, notificationType, periodEnd || null, periodEnd || null]
    );
    return rows.length > 0;
}

async function markSent(userId, subscriptionId, notificationType, periodEnd) {
    await pool.execute(
        `INSERT IGNORE INTO subscription_notifications
        (user_id, subscription_id, notification_type, period_end)
        VALUES (?, ?, ?, ?)`,
        [userId, subscriptionId || null, notificationType, periodEnd || null]
    );
}

async function getUserBasics(userId) {
    const [rows] = await pool.execute(
        'SELECT name, email FROM users WHERE id = ? LIMIT 1',
        [userId]
    );
    return rows[0] || null;
}

async function sendLifecycleNotifications(sub) {
    const user = await getUserBasics(sub.user_id);
    if (!user?.email) return;

    const periodEndDate = sub.current_period_end ? new Date(sub.current_period_end) : null;
    const status = String(sub.status || '').toLowerCase();
    const isPaidPlan = ['pro', 'plus'].includes(String(sub.plan_code || '').toLowerCase());
    if (!isPaidPlan) return;

    const hasStartEmail = await wasSent(sub.user_id, sub.stripe_subscription_id, 'started', periodEndDate);
    if (ACTIVE_STATUSES.has(status) && !hasStartEmail) {
        try {
            await sendSubscriptionStartedEmail({
                email: user.email,
                name: user.name,
                planCode: sub.plan_code,
                periodEnd: periodEndDate
            });
            await markSent(sub.user_id, sub.stripe_subscription_id, 'started', periodEndDate);
        } catch (err) {
            console.error('Failed to send subscription start email:', err.message);
        }
    }

    if (!periodEndDate) return;
    const now = new Date();
    const hasEnded = now >= periodEndDate || ['canceled', 'cancelled', 'unpaid', 'incomplete_expired'].includes(status);
    if (!hasEnded) return;

    const hasEndingEmail = await wasSent(sub.user_id, sub.stripe_subscription_id, 'ended', periodEndDate);
    if (hasEndingEmail) return;

    try {
        await sendSubscriptionEndingEmail({
            email: user.email,
            name: user.name,
            planCode: sub.plan_code,
            periodEnd: periodEndDate
        });
        await markSent(sub.user_id, sub.stripe_subscription_id, 'ended', periodEndDate);
    } catch (err) {
        console.error('Failed to send subscription ending email:', err.message);
    }
}

async function processSubscriptionEmailNotifications(userId = null) {
    await ensureNotificationsTable();
    const query = userId
        ? `SELECT user_id, plan_code, status, stripe_subscription_id, current_period_end
           FROM subscriptions
           WHERE user_id = ?`
        : `SELECT user_id, plan_code, status, stripe_subscription_id, current_period_end
           FROM subscriptions`;
    const params = userId ? [userId] : [];
    const [subs] = await pool.execute(query, params);
    for (const sub of subs) {
        await sendLifecycleNotifications(sub);
    }
}

module.exports = {
    ensureNotificationsTable,
    processSubscriptionEmailNotifications
};
