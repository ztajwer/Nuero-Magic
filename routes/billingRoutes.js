const express = require('express');
const Stripe = require('stripe');
const pool = require('../config/db');
const { processSubscriptionEmailNotifications } = require('../utils/subscriptionNotifier');

const router = express.Router();
const stripeSecret = process.env.STRIPE_SECRET_KEY;
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || '';
const isPlaceholder = !stripeSecret || stripeSecret.trim() === 'YOUR_STRIPE_SECRET_KEY_HERE' || stripeSecret.trim() === '';
const stripe = (!isPlaceholder) ? new Stripe(stripeSecret.trim()) : null;
router.use('/billing', express.json());

const PLAN_CONFIG = {
    pro: { code: 'pro', name: 'Pro', unitAmountCents: 350 },
    plus: { code: 'plus', name: 'Plus', unitAmountCents: 450 }
};

function getBaseUrl() {
    return process.env.APP_BASE_URL || process.env.BASE_URL || 'http://localhost:3000';
}

async function ensureBillingTables() {
    await pool.execute(`
        CREATE TABLE IF NOT EXISTS subscriptions (
            id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            user_id INT UNSIGNED NOT NULL UNIQUE,
            plan_code VARCHAR(50) NOT NULL DEFAULT 'free',
            status VARCHAR(50) NOT NULL DEFAULT 'inactive',
            stripe_customer_id VARCHAR(255),
            stripe_subscription_id VARCHAR(255),
            stripe_price_id VARCHAR(255),
            current_period_end DATETIME NULL,
            cancel_at_period_end TINYINT(1) NOT NULL DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
}

async function upsertSubscriptionRecord(data) {
    await ensureBillingTables();
    await pool.execute(
        `INSERT INTO subscriptions
        (user_id, plan_code, status, stripe_customer_id, stripe_subscription_id, stripe_price_id, current_period_end, cancel_at_period_end)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
        plan_code = VALUES(plan_code),
        status = VALUES(status),
        stripe_customer_id = VALUES(stripe_customer_id),
        stripe_subscription_id = VALUES(stripe_subscription_id),
        stripe_price_id = VALUES(stripe_price_id),
        current_period_end = VALUES(current_period_end),
        cancel_at_period_end = VALUES(cancel_at_period_end)`,
        [
            data.userId,
            data.planCode || 'free',
            data.status || 'inactive',
            data.customerId || null,
            data.subscriptionId || null,
            data.priceId || null,
            data.currentPeriodEnd || null,
            data.cancelAtPeriodEnd ? 1 : 0
        ]
    );
}

async function findUserByCustomerId(customerId) {
    const [rows] = await pool.execute(
        'SELECT user_id FROM subscriptions WHERE stripe_customer_id = ? LIMIT 1',
        [customerId]
    );
    return rows[0]?.user_id || null;
}

router.post('/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    if (!stripe || !webhookSecret) {
        return res.status(500).send('Stripe webhook is not configured');
    }

    const signature = req.headers['stripe-signature'];
    let event;
    try {
        event = stripe.webhooks.constructEvent(req.body, signature, webhookSecret);
    } catch (err) {
        console.error('Stripe webhook signature error:', err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    try {
        if (event.type === 'checkout.session.completed') {
            const session = event.data.object;
            const userId = Number(session.metadata?.userId || 0);
            const planCode = session.metadata?.planCode || 'free';
            const subscriptionId = session.subscription || null;
            const customerId = session.customer || null;

            if (userId && subscriptionId && customerId) {
                const subscription = await stripe.subscriptions.retrieve(subscriptionId);
                const item = subscription.items.data[0];
                const currentPeriodEnd = subscription.current_period_end
                    ? new Date(subscription.current_period_end * 1000)
                    : null;

                await upsertSubscriptionRecord({
                    userId,
                    planCode,
                    status: subscription.status,
                    customerId,
                    subscriptionId,
                    priceId: item?.price?.id || null,
                    currentPeriodEnd,
                    cancelAtPeriodEnd: subscription.cancel_at_period_end
                });
                await processSubscriptionEmailNotifications(userId);
            }
        }

        if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
            const subscription = event.data.object;
            const userId = await findUserByCustomerId(subscription.customer);
            if (userId) {
                const item = subscription.items?.data?.[0];
                const currentPeriodEnd = subscription.current_period_end
                    ? new Date(subscription.current_period_end * 1000)
                    : null;

                await upsertSubscriptionRecord({
                    userId,
                    planCode: subscription.metadata?.planCode || 'free',
                    status: subscription.status,
                    customerId: subscription.customer,
                    subscriptionId: subscription.id,
                    priceId: item?.price?.id || null,
                    currentPeriodEnd,
                    cancelAtPeriodEnd: subscription.cancel_at_period_end
                });
                await processSubscriptionEmailNotifications(userId);
            }
        }

        res.json({ received: true });
    } catch (err) {
        console.error('Stripe webhook handling error:', err);
        res.status(500).send('Webhook processing failed');
    }
});

router.post('/billing/checkout-session', async (req, res) => {
    console.log('[BILLING_DEBUG] checkout-session', { hasUser: Boolean(req.session?.user_id), plan: String(req.body?.plan || ''), path: req.path });
    if (!req.session?.user_id) return res.status(401).json({ error: 'Please sign in to continue.' });

    const testsAllowed = process.env.ALLOW_LOCAL_PLAN_TESTS === 'true' || process.env.NODE_ENV !== 'production';
    if (!stripe && !testsAllowed) return res.status(500).json({ error: 'Stripe secret key missing in .env' });

    const plan = PLAN_CONFIG[String(req.body.plan || '').toLowerCase()];
    if (!plan) return res.status(400).json({ error: 'Invalid plan' });

    try {
        await ensureBillingTables();
        const userId = req.session.user_id;

        if (!stripe && testsAllowed) {
            // MOCK UPGRADE LOGIC - redirect to visual demo checkout
            return res.json({ url: `/checkout/demo?plan=${plan.code}` });
        }

        const userEmail = req.session.user_email;
        const [[existing]] = await pool.execute(
            'SELECT stripe_customer_id FROM subscriptions WHERE user_id = ? LIMIT 1',
            [userId]
        );

        let customerId = existing?.stripe_customer_id || null;
        if (!customerId) {
            const customer = await stripe.customers.create({
                email: userEmail || undefined,
                metadata: { userId: String(userId) }
            });
            customerId = customer.id;
        }

        const baseUrl = getBaseUrl();
        const session = await stripe.checkout.sessions.create({
            mode: 'subscription',
            customer: customerId,
            success_url: `${baseUrl}/user/plans?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${baseUrl}/user/plans?checkout=cancelled`,
            metadata: {
                userId: String(userId),
                planCode: plan.code
            },
            subscription_data: {
                metadata: {
                    userId: String(userId),
                    planCode: plan.code
                }
            },
            line_items: [
                {
                    quantity: 1,
                    price_data: {
                        currency: 'usd',
                        unit_amount: plan.unitAmountCents,
                        recurring: { interval: 'month' },
                        product_data: { name: `NeuroMagic ${plan.name}` }
                    }
                }
            ]
        });

        await upsertSubscriptionRecord({
            userId,
            planCode: plan.code,
            status: 'pending',
            customerId
        });

        res.json({ url: session.url });
    } catch (err) {
        console.error('Checkout session error:', err);
        res.status(500).json({ error: 'Could not create billing portal session' });
    }
});

// GET /checkout/demo
router.get('/checkout/demo', async (req, res) => {
    if (!req.session?.user_id) return res.redirect('/auth/login');
    const planCode = req.query.plan || 'pro';
    const plan = PLAN_CONFIG[planCode.toLowerCase()] || PLAN_CONFIG.pro;
    res.render('user/demo-checkout', { plan });
});

// POST /billing/demo-checkout-complete
router.post('/billing/demo-checkout-complete', async (req, res) => {
    if (!req.session?.user_id) return res.status(401).json({ error: 'Please sign in to continue.' });

    const testsAllowed = process.env.ALLOW_LOCAL_PLAN_TESTS === 'true' || process.env.NODE_ENV !== 'production';
    if (stripe || !testsAllowed) return res.status(403).json({ error: 'Demo checkout is disabled' });

    const planCode = req.body.plan || 'pro';
    const plan = PLAN_CONFIG[planCode.toLowerCase()];
    if (!plan) return res.status(400).json({ error: 'Invalid plan' });

    try {
        await ensureBillingTables();
        const userId = req.session.user_id;
        const periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        await upsertSubscriptionRecord({
            userId,
            planCode: plan.code,
            status: 'active',
            subscriptionId: `mock-sub-${userId}-${Date.now()}`,
            currentPeriodEnd: periodEnd,
            cancelAtPeriodEnd: false
        });
        await processSubscriptionEmailNotifications(userId);
        
        return res.json({ success: true, url: `/user/plans?checkout=success&session_id=mock_session_id` });
    } catch (err) {
        console.error('Demo Checkout Error:', err);
        return res.status(500).json({ error: 'Failed to process demo payment' });
    }
});

router.post('/billing/confirm-session', async (req, res) => {
    if (!req.session?.user_id) return res.status(401).json({ error: 'Please sign in to continue.' });
    
    const testsAllowed = process.env.ALLOW_LOCAL_PLAN_TESTS === 'true' || process.env.NODE_ENV !== 'production';
    if (!stripe && !testsAllowed) return res.status(500).json({ error: 'Stripe not configured' });

    const sessionId = req.body?.sessionId;
    if (!sessionId) return res.status(400).json({ error: 'Missing session ID' });

    try {
        if (sessionId === 'mock_session_id' && testsAllowed) {
            return res.json({ success: true });
        }

        const checkoutSession = await stripe.checkout.sessions.retrieve(sessionId, {
            expand: ['subscription', 'line_items.data.price']
        });
        if (checkoutSession.payment_status !== 'paid' && checkoutSession.status !== 'complete') {
            return res.status(400).json({ error: 'Checkout not complete yet' });
        }

        const subscription = checkoutSession.subscription;
        const metadataPlan = checkoutSession.metadata?.planCode || 'free';
        const item = subscription?.items?.data?.[0];
        const currentPeriodEnd = subscription?.current_period_end
            ? new Date(subscription.current_period_end * 1000)
            : null;

        await upsertSubscriptionRecord({
            userId: req.session.user_id,
            planCode: subscription?.metadata?.planCode || metadataPlan,
            status: subscription?.status || 'active',
            customerId: checkoutSession.customer || null,
            subscriptionId: subscription?.id || null,
            priceId: item?.price?.id || null,
            currentPeriodEnd,
            cancelAtPeriodEnd: subscription?.cancel_at_period_end
        });
        await processSubscriptionEmailNotifications(req.session.user_id);

        res.json({ success: true });
    } catch (err) {
        console.error('Confirm session error:', err);
        res.status(500).json({ error: 'Failed to confirm subscription' });
    }
});

router.post('/billing/customer-portal', async (req, res) => {
    console.log('[BILLING_DEBUG] customer-portal', { hasUser: Boolean(req.session?.user_id), path: req.path });
    if (!req.session?.user_id) return res.status(401).json({ error: 'Please sign in to continue.' });
    if (!stripe) return res.status(500).json({ error: 'Stripe not configured' });

    try {
        const [[sub]] = await pool.execute(
            'SELECT stripe_customer_id FROM subscriptions WHERE user_id = ? LIMIT 1',
            [req.session.user_id]
        );

        if (!sub?.stripe_customer_id) {
            return res.status(400).json({ error: 'No active Stripe customer found' });
        }

        const portal = await stripe.billingPortal.sessions.create({
            customer: sub.stripe_customer_id,
            return_url: `${getBaseUrl()}/user/plans`
        });

        res.json({ url: portal.url });
    } catch (err) {
        console.error('Portal session error:', err);
        res.status(500).json({ error: 'Could not open billing portal' });
    }
});

router.get('/billing/status', async (req, res) => {
    console.log('[BILLING_DEBUG] billing-status', { hasUser: Boolean(req.session?.user_id), path: req.path });
    if (!req.session?.user_id) return res.status(401).json({ error: 'Please sign in to continue.' });
    try {
        await ensureBillingTables();
        const [[sub]] = await pool.execute(
            `SELECT plan_code, status, current_period_end, cancel_at_period_end, stripe_subscription_id, stripe_customer_id, stripe_price_id
            FROM subscriptions WHERE user_id = ? LIMIT 1`,
            [req.session.user_id]
        );

        if (stripe && sub?.stripe_subscription_id) {
            try {
                const liveSub = await stripe.subscriptions.retrieve(sub.stripe_subscription_id);
                const item = liveSub.items?.data?.[0];
                const currentPeriodEnd = liveSub.current_period_end
                    ? new Date(liveSub.current_period_end * 1000)
                    : null;
                await upsertSubscriptionRecord({
                    userId: req.session.user_id,
                    planCode: liveSub.metadata?.planCode || sub.plan_code || 'free',
                    status: liveSub.status,
                    customerId: sub.stripe_customer_id || liveSub.customer || null,
                    subscriptionId: liveSub.id,
                    priceId: item?.price?.id || sub.stripe_price_id || null,
                    currentPeriodEnd,
                    cancelAtPeriodEnd: liveSub.cancel_at_period_end
                });
                await processSubscriptionEmailNotifications(req.session.user_id);
                sub.plan_code = liveSub.metadata?.planCode || sub.plan_code;
                sub.status = liveSub.status;
                sub.current_period_end = currentPeriodEnd;
                sub.cancel_at_period_end = liveSub.cancel_at_period_end ? 1 : 0;
            } catch (syncErr) {
                console.error('Live subscription sync failed:', syncErr.message);
            }
        }

        res.json({
            plan: sub?.plan_code || 'free',
            status: sub?.status || 'inactive',
            currentPeriodEnd: sub?.current_period_end || null,
            cancelAtPeriodEnd: Boolean(sub?.cancel_at_period_end)
        });
    } catch (err) {
        console.error('Billing status error:', err);
        res.status(500).json({ error: 'Could not load billing status' });
    }
});

router.post('/billing/mock-upgrade', async (req, res) => {
    if (!req.session?.user_id) return res.status(401).json({ error: 'Please sign in to continue.' });

    const testsAllowed = process.env.ALLOW_LOCAL_PLAN_TESTS === 'true' || process.env.NODE_ENV !== 'production';
    if (!testsAllowed) {
        return res.status(403).json({ error: 'Local mock upgrades are disabled.' });
    }

    const planCode = String(req.body?.plan || '').toLowerCase();
    if (!['free', 'pro', 'plus'].includes(planCode)) {
        return res.status(400).json({ error: 'Plan must be one of: free, pro, plus' });
    }

    const status = planCode === 'free' ? 'inactive' : 'active';
    const periodEnd = planCode === 'free' ? null : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    try {
        await upsertSubscriptionRecord({
            userId: req.session.user_id,
            planCode,
            status,
            subscriptionId: `local-sub-${req.session.user_id}`,
            currentPeriodEnd: periodEnd,
            cancelAtPeriodEnd: false
        });
        await processSubscriptionEmailNotifications(req.session.user_id);
        res.json({
            success: true,
            plan: planCode,
            status,
            currentPeriodEnd: periodEnd
        });
    } catch (err) {
        console.error('Mock upgrade error:', err);
        res.status(500).json({ error: 'Could not apply mock upgrade' });
    }
});

router.post('/billing/mock-expire', async (req, res) => {
    if (!req.session?.user_id) return res.status(401).json({ error: 'Please sign in to continue.' });

    const testsAllowed = process.env.ALLOW_LOCAL_PLAN_TESTS === 'true' || process.env.NODE_ENV !== 'production';
    if (!testsAllowed) {
        return res.status(403).json({ error: 'Local mock expiry is disabled.' });
    }

    try {
        await ensureBillingTables();
        const endedAt = new Date(Date.now() - 60 * 1000);
        await pool.execute(
            `UPDATE subscriptions
             SET current_period_end = ?, status = 'canceled'
             WHERE user_id = ?`,
            [endedAt, req.session.user_id]
        );
        await processSubscriptionEmailNotifications(req.session.user_id);
        res.json({ success: true, endedAt });
    } catch (err) {
        console.error('Mock expire error:', err);
        res.status(500).json({ error: 'Could not mark subscription as ended' });
    }
});

module.exports = router;
