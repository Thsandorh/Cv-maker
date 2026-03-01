require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const { rateLimit } = require('express-rate-limit');
const {
    saveCvRecord,
    getCvRecord,
    listCvVersions,
    markCvPaidCascade,
    setCheckoutSessionId,
    findCvIdByCheckoutSessionId,
    purgeExpiredCvRecords,
    isStripeEventProcessed,
    markStripeEventProcessed,
    trackAnalyticsEvent,
    getAnalyticsSummary,
    createTrackedDownloadToken,
    getTrackedDownloadToken,
    registerTrackedDownloadAccess,
    purgeExpiredDownloadTokens,
    resolveRootCvId
} = require('./db');

const app = express();
const port = process.env.PORT || 3000;
app.set('trust proxy', 1);

// Middleware
const jsonParser = express.json();
app.use((req, res, next) => {
    if (req.path === '/api/payments/stripe/webhook') {
        return next();
    }
    return jsonParser(req, res, next);
});

app.use((err, req, res, next) => {
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
        return res.status(400).json({ error: 'Invalid JSON body.' });
    }
    next(err);
});

// Serve static files with explicit MIME types
app.use(express.static(path.join(__dirname, 'public'), {
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.css')) {
            res.setHeader('Content-Type', 'text/css');
        } else if (filePath.endsWith('.js')) {
            res.setHeader('Content-Type', 'application/javascript');
        }
    }
}));

// Error handler for Multer
app.use((err, req, res, next) => {
    if (err.name === 'MulterError') {
        return res.status(400).send('Upload Error: ' + err.message);
    }
    next(err);
});

// Multer setup for image uploads (in-memory storage)
const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: { fileSize: 4 * 1024 * 1024 } // 4MB limit for Vercel payloads
});

const { GoogleGenerativeAI } = require("@google/generative-ai");

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const stripePublishableKey = process.env.STRIPE_PUBLISHABLE_KEY;
const stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
const stripe = stripeSecretKey ? require('stripe')(stripeSecretKey) : null;
const recaptchaSiteKey = process.env.RECAPTCHA_SITE_KEY || '';
const recaptchaSecretKey = process.env.RECAPTCHA_SECRET_KEY || '';

const CV_TTL_MS = Number(process.env.CV_TTL_MS || 24 * 60 * 60 * 1000);
const CV_PRICE_CENTS = Number(process.env.CV_PRICE_CENTS || 1990);
const CV_CURRENCY = String(process.env.CV_CURRENCY || 'huf').toLowerCase();
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000);
const RATE_LIMIT_GENERATE_MAX = Number(process.env.RATE_LIMIT_GENERATE_MAX || 10);
const RATE_LIMIT_CHECKOUT_MAX = Number(process.env.RATE_LIMIT_CHECKOUT_MAX || 5);
const RATE_LIMIT_VERIFY_MAX = Number(process.env.RATE_LIMIT_VERIFY_MAX || 20);
const RATE_LIMIT_EXTENDED_MAX = Number(process.env.RATE_LIMIT_EXTENDED_MAX || 20);
const DOWNLOAD_TOKEN_TTL_MS = Number(process.env.DOWNLOAD_TOKEN_TTL_MS || 7 * 24 * 60 * 60 * 1000);
const ADMIN_PANEL_TOKEN = process.env.ADMIN_PANEL_TOKEN || '';
const ADMIN_SESSION_SECRET = process.env.ADMIN_SESSION_SECRET || ADMIN_PANEL_TOKEN || 'change-me';
const ADMIN_SESSION_TTL_MS = Number(process.env.ADMIN_SESSION_TTL_MS || 12 * 60 * 60 * 1000);

function createLimiter(max, message) {
    return rateLimit({
        windowMs: RATE_LIMIT_WINDOW_MS,
        max,
        standardHeaders: true,
        legacyHeaders: false,
        message: { error: message }
    });
}

const generateCvLimiter = createLimiter(RATE_LIMIT_GENERATE_MAX, 'Too many CV generations. Please try again later.');
const checkoutLimiter = createLimiter(RATE_LIMIT_CHECKOUT_MAX, 'Too many payment attempts. Please try again later.');
const verifyLimiter = createLimiter(RATE_LIMIT_VERIFY_MAX, 'Too many verification attempts. Please try again later.');
const extendedLimiter = createLimiter(RATE_LIMIT_EXTENDED_MAX, 'Too many requests. Please try again later.');

setInterval(async () => {
    try {
        await purgeExpiredCvRecords(CV_TTL_MS);
        await purgeExpiredDownloadTokens();
    } catch (error) {
        console.error('Failed to run purge tasks:', error);
    }
}, 5 * 60 * 1000).unref();

function getStripeMinimumAmount(currency) {
    if (currency === 'huf') return 175;
    return 50;
}

function getCurrencyUnitMultiplier(currency) {
    // Stripe may treat HUF as 2-decimal in current API/account context.
    if (currency === 'huf') return 100;
    return 1;
}

function getCheckoutUnitAmount() {
    const normalized = Number.isFinite(CV_PRICE_CENTS) ? Math.round(CV_PRICE_CENTS) : 0;
    const multiplier = getCurrencyUnitMultiplier(CV_CURRENCY);
    const configuredUnits = CV_CURRENCY === 'huf' ? normalized * multiplier : normalized;
    const minimumUnits = getStripeMinimumAmount(CV_CURRENCY) * multiplier;
    return Math.max(configuredUnits, minimumUnits);
}

function getDisplayAmount() {
    const normalized = Number.isFinite(CV_PRICE_CENTS) ? Math.round(CV_PRICE_CENTS) : 0;
    return Math.max(normalized, getStripeMinimumAmount(CV_CURRENCY));
}

function isRecaptchaEnabled() {
    if (process.env.NODE_ENV === 'test') return false;
    return Boolean(recaptchaSiteKey && recaptchaSecretKey);
}

async function verifyRecaptchaToken(token, remoteIp) {
    if (!isRecaptchaEnabled()) {
        return { ok: true, skipped: true };
    }

    if (!token) {
        return { ok: false, reason: 'missing-token' };
    }

    const body = new URLSearchParams({
        secret: recaptchaSecretKey,
        response: token
    });
    if (remoteIp) {
        body.set('remoteip', remoteIp);
    }

    const response = await fetch('https://www.google.com/recaptcha/api/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body
    });

    if (!response.ok) {
        return { ok: false, reason: 'verify-request-failed', status: response.status };
    }

    const payload = await response.json();
    if (!payload.success) {
        return {
            ok: false,
            reason: 'verify-failed',
            details: payload['error-codes'] || []
        };
    }

    return { ok: true, payload };
}

function getGeminiModel() {
    if (!process.env.GEMINI_API_KEY) {
        throw new Error('GEMINI_API_KEY is not configured in environment variables.');
    }
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    return genAI.getGenerativeModel({ model: process.env.GEMINI_MODEL || 'gemini-flash-latest' });
}

function getAppBaseUrl(req) {
    return process.env.APP_BASE_URL || `${req.protocol}://${req.get('host')}`;
}

function timingSafeEqualString(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    const aBuffer = Buffer.from(a);
    const bBuffer = Buffer.from(b);
    if (aBuffer.length !== bBuffer.length) return false;
    return crypto.timingSafeEqual(aBuffer, bBuffer);
}

function parseCookieHeader(cookieHeader) {
    if (!cookieHeader) return {};
    return String(cookieHeader)
        .split(';')
        .map((chunk) => chunk.trim())
        .filter(Boolean)
        .reduce((acc, chunk) => {
            const separator = chunk.indexOf('=');
            if (separator < 0) return acc;
            const key = decodeURIComponent(chunk.slice(0, separator).trim());
            const value = decodeURIComponent(chunk.slice(separator + 1).trim());
            acc[key] = value;
            return acc;
        }, {});
}

function signAdminSession(payload) {
    const payloadBase64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const signature = crypto
        .createHmac('sha256', ADMIN_SESSION_SECRET)
        .update(payloadBase64)
        .digest('base64url');
    return `${payloadBase64}.${signature}`;
}

function verifyAdminSession(token) {
    if (!token || typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [payloadBase64, signature] = parts;
    const expected = crypto
        .createHmac('sha256', ADMIN_SESSION_SECRET)
        .update(payloadBase64)
        .digest('base64url');

    if (!timingSafeEqualString(signature, expected)) return null;

    try {
        const parsed = JSON.parse(Buffer.from(payloadBase64, 'base64url').toString('utf8'));
        if (!parsed || !Number.isFinite(parsed.exp) || Date.now() > parsed.exp) {
            return null;
        }
        return parsed;
    } catch {
        return null;
    }
}

function buildAdminSessionCookieValue(sessionValue, req) {
    const maxAgeSeconds = Math.floor(ADMIN_SESSION_TTL_MS / 1000);
    const proto = String(req.get('x-forwarded-proto') || req.protocol || '').toLowerCase();
    const secure = proto === 'https';
    const parts = [
        `admin_session=${encodeURIComponent(sessionValue)}`,
        'Path=/',
        `Max-Age=${maxAgeSeconds}`,
        'HttpOnly',
        'SameSite=Strict'
    ];
    if (secure) {
        parts.push('Secure');
    }
    return parts.join('; ');
}

function buildAdminLogoutCookie(req) {
    const proto = String(req.get('x-forwarded-proto') || req.protocol || '').toLowerCase();
    const secure = proto === 'https';
    const parts = [
        'admin_session=',
        'Path=/',
        'Max-Age=0',
        'HttpOnly',
        'SameSite=Strict'
    ];
    if (secure) {
        parts.push('Secure');
    }
    return parts.join('; ');
}

function getAdminIdentity(req) {
    if (!ADMIN_PANEL_TOKEN) return null;

    const authHeader = req.get('authorization') || '';
    const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
    if (bearerMatch && timingSafeEqualString(bearerMatch[1], ADMIN_PANEL_TOKEN)) {
        return { method: 'bearer' };
    }

    const cookies = parseCookieHeader(req.headers.cookie || '');
    const session = verifyAdminSession(cookies.admin_session || '');
    if (session) {
        return { method: 'cookie', issuedAt: session.iat, expiresAt: session.exp };
    }

    return null;
}

function requireAdminAuth(req, res, next) {
    const identity = getAdminIdentity(req);
    if (!identity) {
        return res.status(401).json({ error: 'Admin authentication required.' });
    }
    req.admin = identity;
    return next();
}

function normalizeLanguage(input) {
    const value = String(input || 'hu').toLowerCase();
    if (value.startsWith('en')) return 'en';
    if (value.startsWith('de')) return 'de';
    return 'hu';
}

function htmlToPlainText(html) {
    if (!html) return '';
    return String(html)
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, '\'')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/\s+/g, ' ')
        .trim();
}

function extractKeywords(text, limit = 20) {
    if (!text) return [];

    const stopWords = new Set([
        'hogy', 'vagy', 'mert', 'volt', 'lesz', 'egy', 'az', 'a', 'Ă©s', 'is', 'de', 'ha', 'mint', 'nem',
        'with', 'from', 'this', 'that', 'your', 'you', 'for', 'and', 'the', 'are', 'was', 'were', 'have',
        'will', 'job', 'role', 'position', 'work', 'skills', 'experience', 'about'
    ]);

    const tokens = String(text)
        .toLowerCase()
        .replace(/[^a-zA-Z0-9\u00c0-\u017f\s-]/g, ' ')
        .split(/\s+/)
        .map((word) => word.trim())
        .filter((word) => word.length >= 3 && !stopWords.has(word));

    const frequencies = new Map();
    for (const token of tokens) {
        frequencies.set(token, (frequencies.get(token) || 0) + 1);
    }

    return Array.from(frequencies.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit)
        .map(([word]) => word);
}

function computeAtsReport(cvHtml, jobDescription) {
    const cvText = htmlToPlainText(cvHtml);
    const cvTextLower = cvText.toLowerCase();
    const words = cvText.split(/\s+/).filter(Boolean);
    const wordCount = words.length;

    const jdKeywords = extractKeywords(jobDescription || '', 15);
    const matchedKeywords = jdKeywords.filter((keyword) => cvTextLower.includes(keyword.toLowerCase()));
    const keywordScore = jdKeywords.length > 0
        ? Math.round((matchedKeywords.length / jdKeywords.length) * 100)
        : 70;

    const hasEmail = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(cvText);
    const hasPhone = /(?:\+?\d[\d\s\-()]{7,}\d)/.test(cvText);
    const hasExperience = /tapasztalat|experience|professional/i.test(cvText);
    const hasEducation = /tanulm|education|degree|egyetem|iskola/i.test(cvText);
    const hasSkills = /k[Ă©e]szs[Ă©e]g|skills?|technolog/i.test(cvText);
    const hasSummary = /bemutatkoz|profil|about|summary/i.test(cvText);
    const hasDates = /(19|20)\d{2}/.test(cvText);

    const structureChecklist = [
        hasEmail,
        hasPhone,
        hasExperience,
        hasEducation,
        hasSkills,
        hasSummary,
        hasDates
    ];
    const structureScore = Math.round((structureChecklist.filter(Boolean).length / structureChecklist.length) * 100);

    const sentenceSplit = cvText
        .split(/[.!?]+/)
        .map((sentence) => sentence.trim())
        .filter(Boolean);
    const avgSentenceLength = sentenceSplit.length > 0
        ? sentenceSplit.reduce((sum, sentence) => sum + sentence.split(/\s+/).filter(Boolean).length, 0) / sentenceSplit.length
        : 0;

    let readabilityScore = 100;
    if (avgSentenceLength > 24) readabilityScore -= Math.min(35, Math.round((avgSentenceLength - 24) * 2));
    if (avgSentenceLength > 0 && avgSentenceLength < 8) readabilityScore -= 15;
    if (wordCount < 180) readabilityScore -= 20;
    if (wordCount > 900) readabilityScore -= 25;
    readabilityScore = Math.max(20, Math.min(100, readabilityScore));

    const overallScore = Math.round((keywordScore * 0.4) + (structureScore * 0.35) + (readabilityScore * 0.25));

    const tips = [];
    if (jdKeywords.length > 0 && matchedKeywords.length < jdKeywords.length) {
        const missing = jdKeywords.filter((keyword) => !matchedKeywords.includes(keyword)).slice(0, 6);
        tips.push(`Adj hozza legalabb 3-5 hianyzĂł kulcsszot: ${missing.join(', ')}.`);
    }
    if (!hasExperience || !hasSkills || !hasEducation) {
        tips.push('Hasznalj egyertelmu szekciocimeket: Szakmai Tapasztalat, Tanulmanyok, Keszsegek.');
    }
    if (!hasEmail || !hasPhone) {
        tips.push('A fejlĂ©cben mindig szerepeljen email cim es telefonszam.');
    }
    if (avgSentenceLength > 24) {
        tips.push('Roviditsd a mondatokat, torekedj 12-20 szavas bullet pontokra.');
    }
    if (wordCount < 180) {
        tips.push('A CV jelenleg tul rovid; bovitsd merheto eredmenyekkel es konkret technologiakkal.');
    }
    if (tips.length === 0) {
        tips.push('A CV ATS-szempontbol stabil. Finomhangolashoz hasznalj tobb pozicio-specifikus kulcsszot.');
    }

    return {
        overallScore,
        breakdown: {
            keywordScore,
            structureScore,
            readabilityScore
        },
        metrics: {
            wordCount,
            avgSentenceLength: Number(avgSentenceLength.toFixed(1)),
            matchedKeywordCount: matchedKeywords.length,
            totalKeywordCount: jdKeywords.length
        },
        matchedKeywords,
        missingKeywords: jdKeywords.filter((keyword) => !matchedKeywords.includes(keyword)),
        tips
    };
}

async function getEffectiveAccess(record) {
    if (!record) {
        return { paid: false, rootCvId: null };
    }

    const rootCvId = resolveRootCvId(record);
    if (record.paid) {
        return { paid: true, rootCvId };
    }

    if (!rootCvId || rootCvId === record.id) {
        return { paid: false, rootCvId };
    }

    const rootRecord = await getCvRecord(rootCvId, CV_TTL_MS);
    return { paid: Boolean(rootRecord?.paid), rootCvId };
}

async function generateWithRetries(model, parts, retries = 3) {
    let remaining = retries;
    while (remaining > 0) {
        try {
            return await model.generateContent(parts);
        } catch (error) {
            const isRetryable = error?.status === 429 || error?.status === 503;
            remaining -= 1;
            if (!isRetryable || remaining <= 0) {
                throw error;
            }
            await new Promise((resolve) => setTimeout(resolve, 2500));
        }
    }
    throw new Error('AI generation failed.');
}

function addPreviewWatermark(html) {
    const overlayStyles = `
<style id="cv-preview-watermark-style">
    #cv-preview-watermark-overlay {
        position: fixed;
        inset: 0;
        pointer-events: none;
        z-index: 2147483647;
        background: repeating-linear-gradient(
            -30deg,
            rgba(220, 38, 38, 0.14) 0,
            rgba(220, 38, 38, 0.14) 90px,
            rgba(255, 255, 255, 0) 90px,
            rgba(255, 255, 255, 0) 180px
        );
        display: flex;
        align-items: center;
        justify-content: center;
    }
    #cv-preview-watermark-overlay .cv-preview-watermark-label {
        font-family: Arial, sans-serif;
        font-weight: 800;
        font-size: 40px;
        color: rgba(127, 29, 29, 0.25);
        letter-spacing: 0.1em;
        text-transform: uppercase;
        transform: rotate(-24deg);
        border: 4px solid rgba(127, 29, 29, 0.25);
        padding: 16px 28px;
        background: rgba(255, 255, 255, 0.45);
    }
</style>`;

    const overlayMarkup = `
<div id="cv-preview-watermark-overlay" aria-hidden="true">
    <div class="cv-preview-watermark-label">Preview / Payment Required</div>
</div>`;

    const withBodyOverlay = /<\/body>/i.test(html)
        ? html.replace(/<\/body>/i, `${overlayStyles}${overlayMarkup}</body>`)
        : `${html}${overlayStyles}${overlayMarkup}`;

    return withBodyOverlay;
}

app.post('/api/generate-cv', generateCvLimiter, upload.single('profilePicture'), async (req, res) => {
    try {
        const recaptchaToken = req.body?.recaptchaToken;
        const recaptcha = await verifyRecaptchaToken(recaptchaToken, req.ip);
        if (!recaptcha.ok) {
            return res.status(400).json({ error: 'reCAPTCHA verification failed.' });
        }

        if (!req.body || !req.body.userData) {
            return res.status(400).send('Error: Missing userData in request body.');
        }

        const { userData, theme } = req.body;
        let parsedUserData;
        try {
            parsedUserData = JSON.parse(userData);
        } catch (e) {
            return res.status(400).send('Error: Invalid JSON in userData.');
        }

        const model = getGeminiModel();

        let themeInstruction = "";
        switch(theme) {
            case 'minimalist':
                themeInstruction = `DESIGN SYSTEM: 'Minimalist'
                - Visual Style: 'Swiss Design' aesthetic. Ultra-clean, high whitespace, no clutter.
                - Typography: Sans-serif (Inter, Roboto, or Helvetica). Light to Regular weights.
                - Layout: Single column or simple 30/70 split.
                - Color Palette: Monochrome (Black text, White background, Light Grey borders).
                - Mood: Sophisticated, efficient, clarity-focused.`;
                break;
            case 'creative':
                themeInstruction = `DESIGN SYSTEM: 'Creative'
                - Visual Style: 'Modern Editorial'. Bold, expressive, and unique.
                - Typography: Mix of Serif (Playfair Display) for headers and Sans-serif (Lato) for body.
                - Layout: Asymmetric or Grid-based. Use of colored blocks or subtle background shapes.
                - Color Palette: High contrast. Use #5E17EB (Electric Blue) or #FFDE59 (Yellow) as accents against dark text.
                - Mood: Innovative, bold, personality-driven.`;
                break;
            case 'classic':
                themeInstruction = `DESIGN SYSTEM: 'Classic'
                - Visual Style: 'Ivy League / Corporate'. Traditional and authoritative.
                - Typography: Serif (Merriweather, Garamond, or Times New Roman).
                - Layout: Single column, centered headers, horizontal dividers.
                - Color Palette: Navy Blue, Charcoal Grey, or Black text. White background.
                - Mood: Reliable, experienced, executive.`;
                break;
            default: // modern
                themeInstruction = `DESIGN SYSTEM: 'Modern'
                - Visual Style: 'Tech / Startup'. Clean, grid-based, flat design.
                - Typography: Sans-serif (Open Sans, Montserrat). Bold headers.
                - Layout: Two-column (Sidebar for contact/skills, Main for exp).
                - Color Palette: Slate Grey, nice Blue accents, dark text.
                - Mood: Professional, current, adaptable.`;
        }

        let inputProcessingInstruction = "";
        if (parsedUserData.mode === 'bulk') {
            inputProcessingInstruction = `INPUT DATA (UNSTRUCTURED):
            The user provided raw text. You must function as an NLP extractor:
            1. Parse the text below to identify Contact Info, Experience, Education, and Skills.
            2. Infer missing structure (e.g., if a date is "2020-2022", identify it as duration).
            3. IGNORE irrelevant conversational text.
            RAW DATA:
            ${parsedUserData.bulkData}

            KNOWN PERSONAL DETAILS: ${JSON.stringify({
                fullName: parsedUserData.fullName,
                email: parsedUserData.email,
                phone: parsedUserData.phone,
                location: parsedUserData.location
            })}`;
        } else {
            inputProcessingInstruction = `INPUT DATA (STRUCTURED):
            Use the JSON data provided below. Map fields directly to CV sections.
            DATA: ${JSON.stringify(parsedUserData)}`;
        }

        let prompt = `ROLE: You are an elite Career Strategist and Expert Frontend Architect. Your goal is to create a high-impact, ATS-optimized HTML CV that gets the user hired.

        TASK: Generate a single, self-contained HTML5 file for a CV based on the User Data and Design System provided.

        ${inputProcessingInstruction}

        ${themeInstruction}

        CRITICAL REQUIREMENTS (35-POINT QUALITY CHECK):
        1. LANGUAGE: Output MUST be in HUNGARIAN (Magyar). Translate Section Headers:
           - "Experience" -> "Szakmai Tapasztalat"
           - "Education" -> "Tanulmďż˝nyok"
           - "Skills" -> "Kďż˝szsďż˝gek"
           - "Contact" -> "Kapcsolat"
           - "About Me" -> "Rďż˝lam" or "Bemutatkozďż˝s"

        2. CONTENT REFINEMENT (The "STAR" Method):
           - Do NOT just copy the input descriptions.
           - REWRITE work experiences to be achievement-oriented.
           - Use the formula: "Action Verb + Task + Result" (e.g., "Nďż˝velte az eladďż˝sokat 20%-kal...").
           - Use professional Hungarian action verbs (e.g., "Koordinďż˝lta", "Fejlesztette", "Vezette").
           - If the input is sparse, expand it professionally without hallucinating specific lies.

        3. DESIGN & TECH SPECS:
           - OUTPUT: Raw HTML only. Start with <!DOCTYPE html>. NO Markdown.
           - STYLING: Use embedded CSS (<style>). You may use a CDN for Tailwind CSS (<script src="https://cdn.tailwindcss.com"></script>) to make styling easier and modern.
           - LAYOUT: Must be responsive but optimized for A4 PRINT.
           - FONTS: Use Google Fonts via CDN (import them in <head>). Match the Design System.
           - ICONS: Use FontAwesome or SVG icons for Contact info (Phone, Email, Location).

        4. SINGLE PAGE CONSTRAINT:
           - THIS IS CRITICAL: The CV MUST fit on EXACTLY ONE (1) A4 PAGE, no overflow, no second page.
           - Hard rule: If content would exceed one page, you MUST aggressively compress layout/content density while preserving readability and professional quality.
           - Mandatory tactics (use as needed):
             * Prefer compact 2-column layout.
             * Reduce font sizes safely (body down to 9pt if needed, headings proportionally).
             * Tighten line-height, margins, paddings, and section gaps.
             * Shorten bullet points to concise, high-impact statements.
             * Prioritize strongest/relevant items and omit low-value verbosity.
           - You MUST avoid any design that spills to page 2.
           - CSS requirement for output: @media print { @page { size: A4; margin: 0; } html, body { width: 210mm; height: 297mm; margin: 0; overflow: hidden; -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
           - Screen requirement: keep the same A4 aspect ratio baseline (210mm x 297mm) so preview and print match.

        5. PROFILE PICTURE LOGIC:
           - If a profile picture is provided, place it according to the design theme (e.g., circle in sidebar).
           - IMG SRC: You MUST use exactly: src="{{PROFILE_PICTURE_DATA_URI}}"
           - STYLE: object-fit: cover; border-radius: 50% (or theme appropriate); aspect-ratio: 1/1.

        6. ANTI-HALLUCINATION:
           - Do not invent degrees or companies.
           - Do not add "Lorem Ipsum".
           - If a section (like Education) is empty in the input, OMIT that section entirely.

        GENERATE THE HTML NOW.`;

        let dataUri = "";
        const parts = [];

        if (req.file) {
            const base64Data = req.file.buffer.toString("base64");
            dataUri = `data:${req.file.mimetype};base64,${base64Data}`;

            parts.push({
                inlineData: {
                    data: base64Data,
                    mimeType: req.file.mimetype
                }
            });
            prompt += `\n\nCRITICAL: A profile picture is provided. You MUST include an <img> tag for it. The src attribute of this <img> tag MUST be EXACTLY the text "{{PROFILE_PICTURE_DATA_URI}}" (including the curly braces). Do not use any other placeholder URL. Ensure the image has appropriate styling (e.g., width, height, object-fit, border-radius).`;
        }

        parts.unshift({ text: prompt });

        const result = await generateWithRetries(model, parts, 3);

        const response = await result.response;
        let html = response.text();

        // Clean up markdown code blocks if Gemini returns them
        html = html.replace(/```html/g, "").replace(/```/g, "").trim();

        // Replace placeholder with actual data URI if present
        if (dataUri) {
            // Standard placeholder
            html = html.replace(/\{\{PROFILE_PICTURE_DATA_URI\}\}/g, dataUri);

            // Fallback: Replace common placeholders that Gemini might use instead of the requested placeholder
            html = html.replace(/https?:\/\/via\.placeholder\.com\/[^\s"'>]+/g, dataUri);
            html = html.replace(/https?:\/\/placehold\.co\/[^\s"'>]+/g, dataUri);
            html = html.replace(/https?:\/\/picsum\.photos\/[^\s"'>]+/g, dataUri);

            // Even broader fallback: if we still see a likely profile image tag with a dummy src
            // but didn't find the specific placeholder, let's try to find any img tag and if there's only one, replace its src.
            // Or better: look for tags like src="profile.jpg", src="avatar.png", etc.
            html = html.replace(/src="[^"]*(?:profile|avatar|user|portrait)[^"]*"/gi, `src="${dataUri}"`);
        }

        const cvId = await saveCvRecord({
            fullHtml: html,
            language: 'hu',
            theme: theme || 'modern',
            sourceData: parsedUserData,
            variantLabel: 'Alap CV',
            paid: false
        });
        const paymentEnabled = Boolean(stripe && stripePublishableKey);
        const previewHtml = paymentEnabled ? addPreviewWatermark(html) : html;
        await trackAnalyticsEvent('cv_generated', {
            cvId,
            metadata: {
                mode: parsedUserData?.mode || 'structured',
                theme: theme || 'modern'
            }
        });

        res.json({
            cvId,
            previewHtml,
            locked: paymentEnabled,
            price: {
                amount: getDisplayAmount(),
                currency: CV_CURRENCY
            }
        });
    } catch (error) {
        console.error('Error generating CV:', error);
        const status = error.name === 'MulterError' ? 400 : 500;
        res.status(status).send('Error generating CV: ' + error.message);
    }
});

app.post('/api/payments/stripe/create-checkout-session', checkoutLimiter, async (req, res) => {
    try {
        if (!stripe || !stripePublishableKey) {
            return res.status(503).json({ error: 'Stripe payment is not configured on the server.' });
        }

        const { cvId } = req.body || {};
        const record = await getCvRecord(cvId, CV_TTL_MS);
        if (!record) {
            return res.status(404).json({ error: 'CV not found or expired. Please generate it again.' });
        }

        const access = await getEffectiveAccess(record);
        if (access.paid) {
            return res.json({ alreadyPaid: true, cvId });
        }

        const appBaseUrl = getAppBaseUrl(req);
        const successUrl = `${appBaseUrl}/?payment=success&session_id={CHECKOUT_SESSION_ID}`;
        const cancelUrl = `${appBaseUrl}/?payment=cancelled&cvId=${encodeURIComponent(cvId)}`;

        const checkoutAmount = getCheckoutUnitAmount();

        const session = await stripe.checkout.sessions.create({
            mode: 'payment',
            payment_method_types: ['card'],
            success_url: successUrl,
            cancel_url: cancelUrl,
            line_items: [{
                quantity: 1,
                price_data: {
                    currency: CV_CURRENCY,
                    unit_amount: checkoutAmount,
                    product_data: {
                        name: 'CV feloldas es letoltes',
                        description: 'Teljes, vizjel nelkuli oneletrajz'
                    }
                }
            }],
            metadata: {
                cvId
            }
        });

        await setCheckoutSessionId(cvId, session.id);
        await trackAnalyticsEvent('payment_checkout_started', {
            cvId,
            metadata: {
                sessionId: session.id,
                amount: checkoutAmount,
                currency: CV_CURRENCY
            }
        });

        res.json({
            sessionId: session.id,
            publishableKey: stripePublishableKey
        });
    } catch (error) {
        console.error('Stripe checkout creation failed:', error);
        res.status(500).json({ error: 'Failed to create Stripe checkout session.' });
    }
});

app.post('/api/payments/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    try {
        if (!stripe || !stripeWebhookSecret) {
            return res.status(503).send('Stripe webhook is not configured on the server.');
        }

        const signature = req.headers['stripe-signature'];
        if (!signature) {
            return res.status(400).send('Missing stripe-signature header.');
        }

        let event;
        try {
            event = stripe.webhooks.constructEvent(req.body, signature, stripeWebhookSecret);
        } catch (error) {
            console.error('Invalid Stripe webhook signature:', error.message);
            return res.status(400).send(`Webhook signature error: ${error.message}`);
        }

        if (await isStripeEventProcessed(event.id)) {
            return res.json({ received: true, duplicate: true });
        }

        if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
            const session = event.data.object;
            let cvId = session?.metadata?.cvId || null;

            if (!cvId && session?.id) {
                cvId = await findCvIdByCheckoutSessionId(session.id);
            }

            if (cvId) {
                const updated = await markCvPaidCascade(cvId);
                const cvRecord = await getCvRecord(cvId, CV_TTL_MS);
                const rootCvId = resolveRootCvId(cvRecord) || cvId;
                if (updated > 0) {
                    await trackAnalyticsEvent('payment_success', {
                        cvId: rootCvId,
                        eventKey: `payment_success:${rootCvId}`,
                        metadata: {
                            source: 'webhook',
                            sessionId: session?.id || null
                        }
                    });
                }
            }
        }

        await markStripeEventProcessed(event.id);
        res.json({ received: true });
    } catch (error) {
        console.error('Stripe webhook processing failed:', error);
        res.status(500).send('Webhook processing failed.');
    }
});

app.get('/api/payments/stripe/verify', verifyLimiter, async (req, res) => {
    try {
        if (!stripe) {
            return res.status(503).json({ error: 'Stripe payment is not configured on the server.' });
        }

        const sessionId = req.query.session_id;
        if (!sessionId) {
            return res.status(400).json({ error: 'Missing session_id query parameter.' });
        }

        const session = await stripe.checkout.sessions.retrieve(sessionId);
        const paid = session.payment_status === 'paid';
        const cvIdFromMetadata = session.metadata?.cvId || null;
        const cvId = cvIdFromMetadata || await findCvIdByCheckoutSessionId(session.id);

        if (paid && cvId) {
            const updated = await markCvPaidCascade(cvId);
            const cvRecord = await getCvRecord(cvId, CV_TTL_MS);
            const rootCvId = resolveRootCvId(cvRecord) || cvId;
            if (updated > 0) {
                await trackAnalyticsEvent('payment_success', {
                    cvId: rootCvId,
                    eventKey: `payment_success:${rootCvId}`,
                    metadata: {
                        source: 'verify',
                        sessionId
                    }
                });
            }
        }

        res.json({ paid, cvId });
    } catch (error) {
        console.error('Stripe verification failed:', error);
        res.status(500).json({ error: 'Failed to verify payment status.' });
    }
});

app.get('/api/public-config', (req, res) => {
    res.json({
        recaptchaSiteKey: recaptchaSiteKey || null,
        recaptchaEnabled: Boolean(recaptchaSiteKey),
        paymentEnabled: Boolean(stripe && stripePublishableKey),
        supportedExportLanguages: ['hu', 'en', 'de']
    });
});

app.use('/api/admin', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
});

app.post('/api/admin/login', extendedLimiter, (req, res) => {
    try {
        if (!ADMIN_PANEL_TOKEN) {
            return res.status(503).json({ error: 'Admin panel is not configured on the server.' });
        }

        const token = String(req.body?.token || '');
        if (!timingSafeEqualString(token, ADMIN_PANEL_TOKEN)) {
            return res.status(401).json({ error: 'Invalid admin token.' });
        }

        const now = Date.now();
        const session = signAdminSession({
            iat: now,
            exp: now + ADMIN_SESSION_TTL_MS
        });
        res.setHeader('Set-Cookie', buildAdminSessionCookieValue(session, req));
        return res.json({ ok: true });
    } catch (error) {
        console.error('Admin login failed:', error);
        return res.status(500).json({ error: 'Admin login failed.' });
    }
});

app.post('/api/admin/logout', (req, res) => {
    res.setHeader('Set-Cookie', buildAdminLogoutCookie(req));
    res.json({ ok: true });
});

app.get('/api/admin/me', requireAdminAuth, (req, res) => {
    res.json({ authenticated: true, method: req.admin?.method || 'unknown' });
});

app.get('/api/cv/:cvId/preview', async (req, res) => {
    try {
        const { cvId } = req.params;
        const record = await getCvRecord(cvId, CV_TTL_MS);

        if (!record) {
            return res.status(404).json({ error: 'CV not found or expired. Please generate it again.' });
        }

        const access = await getEffectiveAccess(record);
        if (access.paid) {
            return res.json({
                cvId,
                locked: false,
                previewHtml: record.fullHtml
            });
        }

        return res.json({
            cvId,
            locked: true,
            previewHtml: addPreviewWatermark(record.fullHtml)
        });
    } catch (error) {
        console.error('Failed to fetch preview CV:', error);
        res.status(500).json({ error: 'Failed to fetch preview CV.' });
    }
});

app.get('/api/cv/:cvId/full', async (req, res) => {
    try {
        const { cvId } = req.params;
        const record = await getCvRecord(cvId, CV_TTL_MS);

        if (!record) {
            return res.status(404).send('CV not found or expired. Please generate it again.');
        }

        const access = await getEffectiveAccess(record);
        if (!access.paid) {
            return res.status(402).send('Payment required before downloading full CV.');
        }

        await trackAnalyticsEvent('cv_downloaded', {
            cvId: access.rootCvId || cvId,
            metadata: { source: 'direct-full-endpoint' }
        });
        res.type('html').send(record.fullHtml);
    } catch (error) {
        console.error('Failed to fetch full CV:', error);
        res.status(500).send('Failed to fetch full CV.');
    }
});

app.post('/api/cv/:cvId/download-event', extendedLimiter, async (req, res) => {
    try {
        const { cvId } = req.params;
        const record = await getCvRecord(cvId, CV_TTL_MS);
        if (!record) {
            return res.status(404).json({ error: 'CV not found or expired. Please generate it again.' });
        }

        const access = await getEffectiveAccess(record);
        if (!access.paid) {
            return res.status(402).json({ error: 'Payment required before download tracking.' });
        }

        await trackAnalyticsEvent('cv_downloaded', {
            cvId: access.rootCvId || cvId,
            metadata: { source: 'browser-print' }
        });
        res.json({ ok: true });
    } catch (error) {
        console.error('Download event tracking failed:', error);
        res.status(500).json({ error: 'Failed to track download event.' });
    }
});

app.get('/api/cv/:cvId/versions', extendedLimiter, async (req, res) => {
    try {
        const { cvId } = req.params;
        const currentRecord = await getCvRecord(cvId, CV_TTL_MS);
        if (!currentRecord) {
            return res.status(404).json({ error: 'CV not found or expired. Please generate it again.' });
        }

        const rootCvId = resolveRootCvId(currentRecord) || cvId;
        const rootRecord = rootCvId === currentRecord.id
            ? currentRecord
            : await getCvRecord(rootCvId, CV_TTL_MS);
        const groupPaid = Boolean(currentRecord.paid || rootRecord?.paid);
        const versions = await listCvVersions(cvId, CV_TTL_MS);

        res.json({
            rootCvId,
            paid: groupPaid,
            versions: versions.map((version) => ({
                cvId: version.id,
                createdAt: version.createdAt,
                language: version.language || 'hu',
                variantLabel: version.variantLabel || 'CV valtozat',
                locked: !(version.paid || groupPaid)
            }))
        });
    } catch (error) {
        console.error('Failed to list CV versions:', error);
        res.status(500).json({ error: 'Failed to list CV versions.' });
    }
});

app.post('/api/cv/:cvId/analyze-ats', extendedLimiter, async (req, res) => {
    try {
        const { cvId } = req.params;
        const record = await getCvRecord(cvId, CV_TTL_MS);
        if (!record) {
            return res.status(404).json({ error: 'CV not found or expired. Please generate it again.' });
        }

        const jobDescription = String(req.body?.jobDescription || '');
        const report = computeAtsReport(record.fullHtml, jobDescription);
        res.json(report);
    } catch (error) {
        console.error('ATS analysis failed:', error);
        res.status(500).json({ error: 'Failed to analyze ATS score.' });
    }
});

app.post('/api/cv/:cvId/export-language', extendedLimiter, async (req, res) => {
    try {
        const { cvId } = req.params;
        const record = await getCvRecord(cvId, CV_TTL_MS);
        if (!record) {
            return res.status(404).json({ error: 'CV not found or expired. Please generate it again.' });
        }

        const targetLanguage = normalizeLanguage(req.body?.language);
        const tone = String(req.body?.tone || 'professional');
        const region = String(req.body?.region || '');
        const languageLabel = targetLanguage === 'en'
            ? 'English'
            : targetLanguage === 'de'
                ? 'German'
                : 'Hungarian';

        const model = getGeminiModel();
        const prompt = `
You are a professional CV localization editor.
Task: translate and fine-tune ONLY the visible textual content of the provided HTML CV.

Rules:
1. Keep the HTML structure, CSS classes, ids, script tags, styles and layout exactly as-is.
2. Translate only user-facing text to ${languageLabel}.
3. Apply tone: ${tone}.
4. Regional preference: ${region || 'default'}.
5. Keep the CV truthful. Do not invent new companies, dates, or achievements.
6. Output raw HTML only. No markdown and no explanations.

HTML INPUT:
${record.fullHtml}
        `.trim();

        const result = await generateWithRetries(model, [{ text: prompt }], 3);
        const response = await result.response;
        let translatedHtml = response.text();
        translatedHtml = translatedHtml.replace(/```html/gi, '').replace(/```/g, '').trim();

        const access = await getEffectiveAccess(record);
        const rootCvId = access.rootCvId || record.id;
        const variantLabel = `Nyelvi export (${targetLanguage.toUpperCase()})`;
        const newCvId = await saveCvRecord({
            fullHtml: translatedHtml,
            baseCvId: rootCvId,
            language: targetLanguage,
            theme: record.theme || null,
            sourceData: record.sourceData || null,
            variantLabel,
            paid: access.paid
        });

        await trackAnalyticsEvent('cv_variant_created', {
            cvId: rootCvId,
            metadata: { type: 'language_export', targetLanguage, newCvId }
        });

        res.json({
            cvId: newCvId,
            locked: !access.paid,
            previewHtml: access.paid ? translatedHtml : addPreviewWatermark(translatedHtml),
            language: targetLanguage,
            variantLabel
        });
    } catch (error) {
        console.error('Language export failed:', error);
        res.status(500).json({ error: 'Failed to export CV language.' });
    }
});

app.post('/api/cv/:cvId/create-version', extendedLimiter, async (req, res) => {
    try {
        const { cvId } = req.params;
        const record = await getCvRecord(cvId, CV_TTL_MS);
        if (!record) {
            return res.status(404).json({ error: 'CV not found or expired. Please generate it again.' });
        }

        const jobTitle = String(req.body?.jobTitle || '').trim();
        const jobDescription = String(req.body?.jobDescription || '').trim();
        const focusAreas = String(req.body?.focusAreas || '').trim();
        const targetLanguage = normalizeLanguage(req.body?.language || record.language || 'hu');

        if (!jobTitle && !jobDescription) {
            return res.status(400).json({ error: 'Provide jobTitle or jobDescription for targeted version.' });
        }

        const model = getGeminiModel();
        const prompt = `
You are a senior CV editor.
Create a role-targeted version from the given HTML CV.

Target role title: ${jobTitle || 'N/A'}
Job description:
${jobDescription || 'N/A'}

Focus areas:
${focusAreas || 'N/A'}

Target language code: ${targetLanguage}

Rules:
1. Keep the same HTML/CSS structure quality and single-page style.
2. Rewrite wording to match the target role and keywords.
3. Keep content factual, do not invent employers or degrees.
4. Keep ATS-friendly section titles and concise bullet points.
5. Output raw HTML only.

HTML INPUT:
${record.fullHtml}
        `.trim();

        const result = await generateWithRetries(model, [{ text: prompt }], 3);
        const response = await result.response;
        let targetedHtml = response.text();
        targetedHtml = targetedHtml.replace(/```html/gi, '').replace(/```/g, '').trim();

        const access = await getEffectiveAccess(record);
        const rootCvId = access.rootCvId || record.id;
        const variantLabel = jobTitle
            ? `Pozicio: ${jobTitle.slice(0, 80)}`
            : 'Pozicio-specifikus CV';

        const newCvId = await saveCvRecord({
            fullHtml: targetedHtml,
            baseCvId: rootCvId,
            language: targetLanguage,
            theme: record.theme || null,
            sourceData: record.sourceData || null,
            variantLabel,
            paid: access.paid
        });

        await trackAnalyticsEvent('cv_variant_created', {
            cvId: rootCvId,
            metadata: {
                type: 'position_version',
                targetLanguage,
                jobTitle: jobTitle || null,
                newCvId
            }
        });

        res.json({
            cvId: newCvId,
            locked: !access.paid,
            previewHtml: access.paid ? targetedHtml : addPreviewWatermark(targetedHtml),
            variantLabel,
            language: targetLanguage
        });
    } catch (error) {
        console.error('Position-specific CV creation failed:', error);
        res.status(500).json({ error: 'Failed to create targeted CV version.' });
    }
});

app.post('/api/cv/:cvId/cover-letter', extendedLimiter, async (req, res) => {
    try {
        const { cvId } = req.params;
        const record = await getCvRecord(cvId, CV_TTL_MS);
        if (!record) {
            return res.status(404).json({ error: 'CV not found or expired. Please generate it again.' });
        }

        const jobTitle = String(req.body?.jobTitle || '').trim();
        const companyName = String(req.body?.companyName || '').trim();
        const jobDescription = String(req.body?.jobDescription || '').trim();
        const language = normalizeLanguage(req.body?.language || record.language || 'hu');
        const tone = String(req.body?.tone || 'professional').trim();

        const model = getGeminiModel();
        const prompt = `
You are an expert career writer.
Create a personalized cover letter from this CV content and job description.

Job title: ${jobTitle || 'N/A'}
Company name: ${companyName || 'N/A'}
Tone: ${tone}
Language code: ${language}
Job description:
${jobDescription || 'N/A'}

CV TEXT:
${htmlToPlainText(record.fullHtml).slice(0, 12000)}

Return strict JSON only with this shape:
{
  "subject": "string",
  "body": "string with paragraphs separated by \\n\\n"
}
Do not return markdown.
        `.trim();

        const result = await generateWithRetries(model, [{ text: prompt }], 3);
        const response = await result.response;
        let output = response.text().trim();
        output = output.replace(/```json/gi, '').replace(/```/g, '').trim();

        let parsed = null;
        try {
            parsed = JSON.parse(output);
        } catch {
            parsed = {
                subject: `Jelentkezes - ${jobTitle || 'Pozicio'}`,
                body: output
            };
        }

        await trackAnalyticsEvent('cover_letter_generated', {
            cvId: resolveRootCvId(record) || cvId,
            metadata: {
                language,
                tone
            }
        });

        res.json({
            subject: parsed.subject || `Jelentkezes - ${jobTitle || 'Pozicio'}`,
            body: parsed.body || ''
        });
    } catch (error) {
        console.error('Cover letter generation failed:', error);
        res.status(500).json({ error: 'Failed to generate cover letter.' });
    }
});

app.post('/api/cv/:cvId/tracked-download-link', requireAdminAuth, extendedLimiter, async (req, res) => {
    try {
        const { cvId } = req.params;
        const record = await getCvRecord(cvId, CV_TTL_MS);
        if (!record) {
            return res.status(404).json({ error: 'CV not found or expired. Please generate it again.' });
        }

        const access = await getEffectiveAccess(record);
        if (!access.paid) {
            return res.status(402).json({ error: 'Payment required before creating tracked download link.' });
        }

        const rootCvId = access.rootCvId || cvId;
        const tokenRecord = await createTrackedDownloadToken(cvId, DOWNLOAD_TOKEN_TTL_MS);
        const appBaseUrl = getAppBaseUrl(req);
        const url = `${appBaseUrl}/api/cv/download/${tokenRecord.token}`;

        await trackAnalyticsEvent('download_link_created', {
            cvId: rootCvId,
            metadata: {
                token: tokenRecord.token,
                expiresAt: tokenRecord.expiresAt
            }
        });

        res.json({
            url,
            token: tokenRecord.token,
            expiresAt: tokenRecord.expiresAt
        });
    } catch (error) {
        console.error('Tracked link creation failed:', error);
        res.status(500).json({ error: 'Failed to create tracked download link.' });
    }
});

app.get('/api/cv/download/:token', async (req, res) => {
    try {
        const { token } = req.params;
        const tokenRecord = await getTrackedDownloadToken(token);
        if (!tokenRecord) {
            return res.status(404).send('Download link not found or expired.');
        }

        const record = await getCvRecord(tokenRecord.cvId, CV_TTL_MS);
        if (!record) {
            return res.status(404).send('CV not found or expired.');
        }

        const access = await getEffectiveAccess(record);
        if (!access.paid) {
            return res.status(402).send('Payment required before downloading full CV.');
        }

        const clickData = await registerTrackedDownloadAccess(token);
        await trackAnalyticsEvent('cv_downloaded', {
            cvId: access.rootCvId || record.id,
            metadata: {
                source: 'tracked-link',
                token,
                clickCount: clickData?.clicks || 1
            }
        });

        res.setHeader('Content-Disposition', `attachment; filename="cv-${record.id}.html"`);
        res.type('html').send(record.fullHtml);
    } catch (error) {
        console.error('Tracked download failed:', error);
        res.status(500).send('Failed to process tracked download.');
    }
});

app.get('/api/analytics/summary', requireAdminAuth, extendedLimiter, async (req, res) => {
    try {
        const from = Number.parseInt(req.query.from, 10);
        const to = Number.parseInt(req.query.to, 10);
        const fromTs = Number.isFinite(from) ? from : 0;
        const toTs = Number.isFinite(to) ? to : Date.now();
        const summary = await getAnalyticsSummary(fromTs, toTs);

        res.json({
            from: fromTs,
            to: toTs,
            summary
        });
    } catch (error) {
        console.error('Analytics summary failed:', error);
        res.status(500).json({ error: 'Failed to fetch analytics summary.' });
    }
});

app.get('/api/admin/analytics/summary', requireAdminAuth, extendedLimiter, async (req, res) => {
    try {
        const from = Number.parseInt(req.query.from, 10);
        const to = Number.parseInt(req.query.to, 10);
        const fromTs = Number.isFinite(from) ? from : 0;
        const toTs = Number.isFinite(to) ? to : Date.now();
        const summary = await getAnalyticsSummary(fromTs, toTs);
        res.json({ from: fromTs, to: toTs, summary });
    } catch (error) {
        console.error('Admin analytics summary failed:', error);
        res.status(500).json({ error: 'Failed to fetch analytics summary.' });
    }
});

app.get('/api/admin/stripe/logs', requireAdminAuth, extendedLimiter, async (req, res) => {
    try {
        if (!stripe) {
            return res.status(503).json({ error: 'Stripe payment is not configured on the server.' });
        }

        const kind = String(req.query.kind || 'events').toLowerCase();
        const limitRaw = Number.parseInt(req.query.limit, 10);
        const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(100, limitRaw)) : 25;

        if (kind === 'sessions') {
            const sessions = await stripe.checkout.sessions.list({ limit });
            const rows = (sessions.data || []).map((item) => ({
                id: item.id,
                created: item.created,
                status: item.status,
                payment_status: item.payment_status,
                currency: item.currency,
                amount_total: item.amount_total,
                customer_email: item.customer_details?.email || null,
                cvId: item.metadata?.cvId || null
            }));
            return res.json({ kind, count: rows.length, items: rows });
        }

        const events = await stripe.events.list({ limit });
        const rows = (events.data || []).map((item) => ({
            id: item.id,
            created: item.created,
            type: item.type,
            livemode: item.livemode,
            request_id: item.request?.id || null,
            api_version: item.api_version || null
        }));
        return res.json({ kind: 'events', count: rows.length, items: rows });
    } catch (error) {
        console.error('Failed to fetch Stripe logs:', error);
        res.status(500).json({ error: 'Failed to fetch Stripe logs.' });
    }
});

app.post('/api/admin/cv/tracked-download-link', requireAdminAuth, extendedLimiter, async (req, res) => {
    try {
        const cvId = String(req.body?.cvId || '').trim();
        if (!cvId) {
            return res.status(400).json({ error: 'Missing cvId.' });
        }

        const record = await getCvRecord(cvId, CV_TTL_MS);
        if (!record) {
            return res.status(404).json({ error: 'CV not found or expired. Please generate it again.' });
        }

        const access = await getEffectiveAccess(record);
        if (!access.paid) {
            return res.status(402).json({ error: 'Payment required before creating tracked download link.' });
        }

        const rootCvId = access.rootCvId || cvId;
        const tokenRecord = await createTrackedDownloadToken(cvId, DOWNLOAD_TOKEN_TTL_MS);
        const appBaseUrl = getAppBaseUrl(req);
        const url = `${appBaseUrl}/api/cv/download/${tokenRecord.token}`;

        await trackAnalyticsEvent('download_link_created', {
            cvId: rootCvId,
            metadata: {
                token: tokenRecord.token,
                expiresAt: tokenRecord.expiresAt,
                source: 'admin-panel'
            }
        });

        res.json({
            url,
            token: tokenRecord.token,
            expiresAt: tokenRecord.expiresAt
        });
    } catch (error) {
        console.error('Admin tracked link creation failed:', error);
        res.status(500).json({ error: 'Failed to create tracked download link.' });
    }
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Export for Vercel
module.exports = app;

// Only listen if not running as a module (local dev)
if (require.main === module) {
    app.listen(port, () => {
        console.log(`Server running at http://localhost:${port}`);
    });
}
