const nodemailer = require('nodemailer');

const EMAIL_CONFIGURED = process.env.EMAIL_USER && process.env.EMAIL_USER !== 'your-ethereal-user';

let transporter = EMAIL_CONFIGURED ? nodemailer.createTransport({
    host: process.env.EMAIL_HOST || 'smtp.ethereal.email',
    port: parseInt(process.env.EMAIL_PORT || '587'),
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
}) : null;

async function safeSendMail(options) {
    if (!transporter) {
        // Automatically generate a test account if no email configured
        console.log('No email configured. Generating temporary Ethereal test account...');
        const testAccount = await nodemailer.createTestAccount();
        transporter = nodemailer.createTransport({
            host: 'smtp.ethereal.email',
            port: 587,
            secure: false, // true for 465, false for other ports
            auth: {
                user: testAccount.user,
                pass: testAccount.pass
            }
        });
        console.log(`Ethereal Test Account generated: ${testAccount.user}`);
    }
    
    const info = await transporter.sendMail(options);
    
    // If we are using Ethereal, log the preview URL so the developer can click it
    if (transporter.options.host === 'smtp.ethereal.email') {
        console.log('Preview URL: %s', nodemailer.getTestMessageUrl(info));
    }
    
    return info;
}

function buildEmailShell(title, intro, details = '', ctaHtml = '') {
    return `
        <div style="font-family: Arial, sans-serif; max-width: 620px; margin: auto; padding: 20px; border: 1px solid #eee; border-radius: 16px;">
            <h2 style="color: #2563eb; margin: 0 0 16px;">${title}</h2>
            <p style="color: #0f172a; margin: 0 0 12px;">${intro}</p>
            ${details ? `<p style="color: #334155; margin: 0 0 12px;">${details}</p>` : ''}
            ${ctaHtml || ''}
            <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;">
            <p style="color: #94a3b8; font-size: 12px; margin: 0;">NeuroMagic notifications</p>
        </div>
    `;
}

const sendResetEmail = async (email, link) => {
    const info = await safeSendMail({
        from: '"NeuroMagic" <no-reply@neuromagic.com>',
        to: email,
        subject: "Password Reset Request",
        text: `You requested a password reset. Click here: ${link}`,
        html: `
            <div style="font-family: sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #eee; border-radius: 20px;">
                <h2 style="color: #3B82F6;">Reset Your Password</h2>
                <p>We received a request to reset your NeuroMagic password.</p>
                <p>Click the button below to set a new one. This link expires in 1 hour.</p>
                <div style="text-align: center; margin: 30px 0;">
                    <a href="${link}" style="background: #0F172A; color: white; padding: 14px 28px; border-radius: 12px; text-decoration: none; font-weight: bold; display: inline-block;">Reset Password</a>
                </div>
                <p style="color: #94A3B8; font-size: 12px;">If you didn't request this, you can safely ignore this email.</p>
                <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
                <p style="color: #94A3B8; font-size: 10px; text-align: center;">© 2024 NeuroMagic. All rights reserved.</p>
            </div>
        `
    });
    return info;
};

const sendSubscriptionStartedEmail = async ({ email, name, planCode, periodEnd }) => {
    const planLabel = String(planCode || '').toUpperCase();
    const endLabel = periodEnd ? new Date(periodEnd).toLocaleString() : 'N/A';
    return safeSendMail({
        from: '"NeuroMagic" <no-reply@neuromagic.com>',
        to: email,
        subject: `Your ${planLabel} plan is now active`,
        text: `Hi ${name || 'there'}, your ${planLabel} plan is active. It renews/ends on ${endLabel}.`,
        html: buildEmailShell(
            `${planLabel} Plan Activated`,
            `Hi ${name || 'there'}, your subscription is now active.`,
            `Current period end: ${endLabel}`
        )
    });
};

const sendSubscriptionEndingEmail = async ({ email, name, planCode, periodEnd }) => {
    const planLabel = String(planCode || '').toUpperCase();
    const endLabel = periodEnd ? new Date(periodEnd).toLocaleString() : 'N/A';
    return safeSendMail({
        from: '"NeuroMagic" <no-reply@neuromagic.com>',
        to: email,
        subject: `Your ${planLabel} plan period is ending`,
        text: `Hi ${name || 'there'}, your ${planLabel} plan period has ended (or is ending now) on ${endLabel}.`,
        html: buildEmailShell(
            `${planLabel} Plan Ending`,
            `Hi ${name || 'there'}, your subscription period is ending or has just ended.`,
            `Period end: ${endLabel}`
        )
    });
};

module.exports = {
    sendResetEmail,
    sendSubscriptionStartedEmail,
    sendSubscriptionEndingEmail
};
