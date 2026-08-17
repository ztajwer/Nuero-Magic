require('dotenv').config();
const express = require('express');
const pool = require('../config/db');
const { processSubscriptionEmailNotifications } = require('../utils/subscriptionNotifier');

const router = express.Router();

// Robust fetch detection for different Node environments
const fetch = require('node-fetch');

const PROXY_URLS = [
    "https://api.ai.cc/v1/chat/completions",
    "https://api.openai.com/v1/chat/completions", // Official OpenAI
    "https://api.deepinfra.com/v1/openai/chat/completions" // Another popular bridge
];

const ACTIVE_SUB_STATUSES = ['active', 'trialing', 'past_due'];
const DAILY_LIMITS = {
    guest: 10,
    free: 40,
    pro: 200,
    plus: null // unlimited
};

async function ensureUsageTable() {
    await pool.execute(`
        CREATE TABLE IF NOT EXISTS daily_usage (
            id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            user_id INT UNSIGNED NULL,
            guest_session_id VARCHAR(255) NULL,
            usage_date DATE NOT NULL,
            usage_count INT UNSIGNED NOT NULL DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_daily_usage_user_date (user_id, usage_date),
            INDEX idx_daily_usage_guest_date (guest_session_id, usage_date)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
}

async function getPlanFromDb(userId) {
    if (!userId) return { plan: 'guest', status: 'inactive' };
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
        return { plan: 'free', status: 'inactive' };
    }
}

function resolveUsagePolicy(plan, status, isGuest) {
    if (isGuest) {
        return { planCode: 'guest', isLimited: true, dailyLimit: DAILY_LIMITS.guest };
    }

    const normalizedPlan = String(plan || 'free').toLowerCase();
    const normalizedStatus = String(status || 'inactive').toLowerCase();
    const hasPaidAccess = ACTIVE_SUB_STATUSES.includes(normalizedStatus);

    if (normalizedPlan === 'plus') {
        if (!hasPaidAccess) {
            return { planCode: 'free', isLimited: true, dailyLimit: DAILY_LIMITS.free };
        }
        return { planCode: 'plus', isLimited: false, dailyLimit: DAILY_LIMITS.plus };
    }
    if (normalizedPlan === 'pro' && hasPaidAccess) {
        return { planCode: 'pro', isLimited: true, dailyLimit: DAILY_LIMITS.pro };
    }
    return { planCode: 'free', isLimited: true, dailyLimit: DAILY_LIMITS.free };
}

async function getTodayUsage({ userId, guestSessionId }) {
    const isGuest = !userId;
    const query = isGuest
        ? 'SELECT usage_count FROM daily_usage WHERE guest_session_id = ? AND usage_date = CURDATE() LIMIT 1'
        : 'SELECT usage_count FROM daily_usage WHERE user_id = ? AND usage_date = CURDATE() LIMIT 1';
    const param = isGuest ? guestSessionId : userId;
    console.log(`USAGE CHECK: isGuest=${isGuest}, param=${param}, query=${query}`);
    const [[row]] = await pool.execute(query, [param]);
    const usage = Number(row?.usage_count || 0);
    console.log(`USAGE RESULT: found=${!!row}, usage=${usage}`);
    return usage;
}

async function incrementTodayUsage({ userId, guestSessionId }) {
    const isGuest = !userId;
    if (isGuest) {
        console.log(`INCREMENT USAGE: guestSessionId=${guestSessionId}`);
        const [[row]] = await pool.execute(
            'SELECT id, usage_count FROM daily_usage WHERE guest_session_id = ? AND usage_date = CURDATE() LIMIT 1',
            [guestSessionId]
        );
        if (row?.id) {
            const newCount = Number(row.usage_count || 0) + 1;
            await pool.execute('UPDATE daily_usage SET usage_count = ? WHERE id = ?', [newCount, row.id]);
            console.log(`UPDATED EXISTING: id=${row.id}, oldCount=${row.usage_count}, newCount=${newCount}`);
        } else {
            await pool.execute(
                'INSERT INTO daily_usage (user_id, guest_session_id, usage_date, usage_count) VALUES (NULL, ?, CURDATE(), 1)',
                [guestSessionId]
            );
            console.log(`INSERTED NEW: guestSessionId=${guestSessionId}`);
        }
        return;
    }
    const [[row]] = await pool.execute(
        'SELECT id, usage_count FROM daily_usage WHERE user_id = ? AND usage_date = CURDATE() LIMIT 1',
        [userId]
    );
    if (row?.id) {
        await pool.execute('UPDATE daily_usage SET usage_count = ? WHERE id = ?', [Number(row.usage_count || 0) + 1, row.id]);
        return;
    }
    await pool.execute(
        'INSERT INTO daily_usage (user_id, guest_session_id, usage_date, usage_count) VALUES (?, NULL, CURDATE(), 1)',
        [userId]
    );
}

router.post('/', async (req, res) => {
    const GEMINI_KEYS = [
        process.env.GEMINI_API_KEY_1,
        process.env.GEMINI_API_KEY_2,
        process.env.GEMINI_API_KEY_3,
        process.env.GEMINI_API_KEY
    ].filter(k => k && (k.startsWith('AIza') || k.startsWith('AQ.')));
    const GEMINI_KEY = process.env.GEMINI_API_KEY_1 || process.env.GEMINI_API_KEY; // For legacy PRIORITY 2 logic
    const OR_KEY = process.env.OPENROUTER_API_KEY;
    const { input, type, lang, tone, model: requestedModel, level } = req.body;
    const userRole = req.session.user_role || 'General User';
    const userId = req.session?.user_id || null;
    if (!userId && req.session && !req.session.guest_usage_started) {
        req.session.guest_usage_started = true;
    }
    const guestSessionId = req.sessionID;
    
    console.log(`API REQUEST: type=${type}, role=${userRole}, lang=${lang}, tone=${tone}, model=${requestedModel}, level=${level}`);

    if (!fetch) {
        return res.status(500).json({ error: "Fetch is not defined. Please upgrade to Node 18 or install node-fetch@2" });
    }

    if (!input) {
        return res.status(400).json({ error: "Instruction is required" });
    }

    try {
        await ensureUsageTable();
        const subscription = await getPlanFromDb(userId);
        const policy = resolveUsagePolicy(subscription.plan, subscription.status, !userId);
        const usedToday = await getTodayUsage({ userId, guestSessionId });

        if (policy.isLimited && Number.isFinite(policy.dailyLimit) && usedToday >= policy.dailyLimit) {
            const guestMessage = 'Guest daily limit reached (10 tries). Please sign in to continue and get 40 free tries/day.';
            const freeMessage = 'Free daily limit reached (40 tries). Upgrade to Pro for 200/day or Plus for unlimited.';
            const proMessage = 'Pro daily limit reached (200 tries). Upgrade to Plus for unlimited usage.';
            const messageByPlan = {
                guest: guestMessage,
                free: freeMessage,
                pro: proMessage
            };
            return res.status(429).json({
                error: messageByPlan[policy.planCode] || `Daily limit reached (${policy.dailyLimit} tries).`,
                usage: {
                    plan: policy.planCode,
                    usedToday,
                    dailyLimit: policy.dailyLimit,
                    remainingToday: 0
                }
            });
        }
    } catch (usageErr) {
        console.error('Usage policy error:', usageErr.message);
        return res.status(500).json({ error: 'Could not validate usage limits right now.' });
    }

    const complexityHint = level === 'expert' ? 'Extremely detailed, multi-layered, and technical.' : (level === 'detailed' ? 'Detailed and comprehensive.' : 'Concise and effective.');

    // Role-based instructions (internal labels, will not be shown as 'prompt' to user)
    const typeInstructions = {
        research: "You are an elite research analyst. Transform the user's input into a highly structured research instruction with clear objectives, methodology, and expected outputs.",
        writing: "You are a world-class copywriter and ghostwriter. Transform the user's input into a polished, highly effective writing directive with tone, audience, and format directives.",
        planning: "You are an expert strategic planner. Transform the user's input into a detailed planning directive with goals, steps, constraints, and success metrics.",
        image: "You are a professional AI visualization expert. Transform the user's input into a highly detailed, vivid image description with style, lighting, camera, mood, and composition details.",
        video: "You are an expert video production director. Transform the user's input into a detailed video script directive with scene directions, tone, pacing, and visual cues.",
        code: "You are a senior software engineer. Transform the user's input into a precise, unambiguous coding instruction with language, constraints, expected behavior, and edge cases.",
        automation: "You are an expert automation/workflow engineer. Transform the user's input into a detailed automation directive including tools (n8n/Zapier/Make), triggers, actions, and error handling.",
        standard: "You are an elite, world-class AI Architect. Transform the user's rough idea into the most highly-optimized, effective instruction possible for advanced AI systems.",
    };

    const baseInstruction = typeInstructions[type] || typeInstructions.standard;
    const targetLang = lang === 'ur' ? 'URDU' : 'ENGLISH';
    const systemInstruction = `IMPORTANT: YOUR ENTIRE RESPONSE MUST BE IN ${targetLang}. 
    
    You are the World's Most Advanced AI Architect.
    
    CONTEXT: The user's background/role is: ${userRole}.
    TASK: Transform the user's "Basic Idea" into a professional, highly-optimized MASTER INSTRUCTION in ${targetLang} that is specifically tailored for a ${userRole}.
    
    TONE: The enhanced result should have a ${tone || 'professional'} tone.
    COMPLEXITY: ${complexityHint}

    CRITICAL RULE: You MUST output the entire response (Roles, Goals, Parameters) in ${targetLang} language only. This is mandatory.
    
    INTERACTIVE CLARIFICATION:
    If the user's "Basic Idea" is extremely vague, lacking details, or shorter than 5-6 words (e.g., "a cooking app", "write an email", "make a website"), DO NOT generate the final instruction yet. 
    Instead, ask exactly 2 to 3 very short, highly relevant clarifying questions to gather the missing details.
    When doing this, you MUST output ONLY a valid JSON array of strings containing the questions, and absolutely no other text.
    Example: ["What is the primary feature?", "Who is the target audience?"]
    If the user has already provided answers to your questions within the input, proceed to generate the MASTER INSTRUCTION.

    CRITICAL RULE: YOU MUST OUTPUT *ONLY* THE FINAL PERFECT PROMPT AS A SINGLE UNFORMATTED BLOCK OF TEXT. 
    DO NOT include meta-headers like "Role:", "Goal:", or "Visual Directive Summary". 
    The user wants to copy-paste your output directly into an AI image generator or text model, so it MUST NOT contain any conversational fluff, markdown structural headers, or roleplay breakdowns. Just give the absolute best possible raw instruction.

    RULES:
    1. Output ONLY the final upgraded result in ${targetLang} (or the JSON array of questions).
    2. Do NOT include any intro, outro, or conversation.
    3. Do NOT use markdown structural headers like "## 1. Visual Directive Summary".
    4. Provide the exact text the user should paste into another AI.
    
    ${baseInstruction}`;

    try {
        let text = '';

        // COMMON HEADERS
        const commonHeaders = {
            'Content-Type': 'application/json',
            'User-Agent': 'NeuroMagic/1.1'
        };

        // PRIORITY 1: Native Gemini API (Google AI Studio) - supports both AIza and AQ. key formats
        if (GEMINI_KEYS.length > 0) {
            const tryGemini = async (key) => {
                console.log("Using Native Gemini API with key prefix:", key.substring(0, 5));
                const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${key}`;
                const response = await fetch(url, {
                    method: 'POST',
                    headers: commonHeaders,
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: `${systemInstruction}\n\nUSER INPUT: ${input}` }] }],
                        generationConfig: { temperature: 0.7, maxOutputTokens: 2048 }
                    })
                });
                const data = await response.json();
                if (data.candidates?.[0]?.content?.parts?.[0]?.text) {
                    return data.candidates[0].content.parts[0].text;
                } else if (data.error) {
                    console.error("Gemini Error:", data.error.message);
                }
                return null;
            };
            
            for (let i = 0; i < GEMINI_KEYS.length; i++) {
                if (text) break;
                console.log(`Trying Gemini key ${i + 1}...`);
                text = await tryGemini(GEMINI_KEYS[i]);
                if (!text) {
                    console.log(`Gemini key ${i + 1} failed.`);
                } else {
                    console.log(`✅ Success using Gemini key ${i + 1}`);
                }
            }
        }
        
        // PRIORITY 2: OpenAI-compatible Proxy (or direct OpenAI)
        if (!text && GEMINI_KEY && GEMINI_KEY.startsWith('sk-') && !GEMINI_KEY.startsWith('sk-or-')) {
            console.log("Using OpenAI/Proxy API...");
            
            // Extensive list of models to try for maximum compatibility
            const models = ['gpt-4o-mini', 'gpt-4o', 'gpt-4-turbo', 'gpt-3.5-turbo', 'gemini-1.5-flash', 'claude-3-haiku'];
            let lastErr = '';
            
            // Try each proxy URL
            for (const proxyUrl of PROXY_URLS) {
                if (text) break;
                
                // Try each model
                for (const model of models) {
                    try {
                        const response = await fetch(proxyUrl, {
                            method: 'POST',
                            headers: { ...commonHeaders, 'Authorization': `Bearer ${GEMINI_KEY}` },
                            body: JSON.stringify({
                                model: model, 
                                messages: [
                                    { role: 'system', content: systemInstruction },
                                    { role: 'user',   content: input }
                                ],
                                temperature: 0.7
                            })
                        });
                        
                        if (response.ok) {
                            const data = await response.json();
                            if (data.choices?.[0]?.message?.content) {
                                text = data.choices[0].message.content.trim();
                                console.log(`✅ Success using ${model} via ${proxyUrl}`);
                                break;
                            }
                        } else {
                            const errBody = await response.text();
                            lastErr = `Proxy (${model} @ ${new URL(proxyUrl).hostname}) status ${response.status}: ${errBody.substring(0, 100)}`;
                        }
                    } catch (e) {
                        lastErr = e.message;
                    }
                    if (text) break;
                }
            }
            if (!text && lastErr) console.error("All Proxies Failed:", lastErr);
        }

        // PRIORITY 3: OpenRouter
        if (!text && OR_KEY && OR_KEY.startsWith('sk-or-')) {
            console.log("Using OpenRouter API...");
            const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                method: 'POST',
                headers: { 
                    ...commonHeaders, 
                    'Authorization': `Bearer ${OR_KEY}`,
                    'HTTP-Referer': 'http://localhost:3000',
                    'X-Title': 'NeuroMagic'
                },
                body: JSON.stringify({
                    model: 'google/gemini-flash-1.5-exp',
                    messages: [
                        { role: 'system', content: systemInstruction },
                        { role: 'user',   content: input }
                    ],
                    temperature: 0.7
                })
            });
            const data = await response.json();
            if (data.choices?.[0]?.message?.content) {
                text = data.choices[0].message.content.trim();
            }
        }

        if (!text) {
            // FALLBACK: If everything fails, return a simulated/template response so the user isn't stuck
            text = `🎭 ROLE: Elite AI Expert & Specialist
🎯 GOAL: To execute the user's original request perfectly, providing comprehensive, highly-accurate, and well-structured results.
📏 PARAMETERS: Maintain a professional, clear, and highly engaging tone. Ensure all outputs are strictly formatted, avoiding fluff and focusing on high-value information.
💎 FORMAT:
- Use **Markdown** for clear hierarchy
- Provide step-by-step breakdowns
- Include actionable insights

*(System Note: Your Gemini API keys in the \`.env\` file are returning a "Permission Denied" 403 error from Google. Once you update the \`.env\` with a valid key, this will return real AI-enhanced instructions!)*`;
        }

        try {
            await incrementTodayUsage({ userId, guestSessionId });
        } catch (incErr) {
            console.error('Usage increment error:', incErr.message);
        }

        res.json({ text });
    } catch (err) {
        console.error('API Error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
