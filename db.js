const crypto = require('crypto');

const databaseUrl = process.env.DATABASE_URL || '';
const usePostgres = Boolean(databaseUrl);

let pool = null;
let pgInitPromise = null;

if (usePostgres) {
    const { Pool } = require('pg');
    const ssl = process.env.PG_SSL === 'false' ? false : { rejectUnauthorized: false };
    pool = new Pool({
        connectionString: databaseUrl,
        ssl
    });
}

const memCvStore = new Map();
const memStripeEvents = new Set();
const memAnalyticsEvents = [];
const memAnalyticsUniqueKeys = new Set();
const memDownloadTokens = new Map();

function safeJsonParse(value, fallback = null) {
    if (!value || typeof value !== 'string') return fallback;
    try {
        return JSON.parse(value);
    } catch {
        return fallback;
    }
}

function normalizeSaveInput(input) {
    if (typeof input === 'string') {
        return {
            fullHtml: input,
            baseCvId: null,
            language: 'hu',
            theme: null,
            sourceData: null,
            variantLabel: null,
            paid: false,
            paidAt: null
        };
    }

    const normalized = {
        fullHtml: input?.fullHtml,
        baseCvId: input?.baseCvId || null,
        language: input?.language || 'hu',
        theme: input?.theme || null,
        sourceData: input?.sourceData ?? null,
        variantLabel: input?.variantLabel || null,
        paid: Boolean(input?.paid),
        paidAt: input?.paidAt || null
    };

    if (!normalized.fullHtml || typeof normalized.fullHtml !== 'string') {
        throw new Error('saveCvRecord requires fullHtml.');
    }

    return normalized;
}

async function ensurePgInitialized() {
    if (!usePostgres) return;
    if (pgInitPromise) {
        await pgInitPromise;
        return;
    }

    pgInitPromise = (async () => {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS cvs (
                id TEXT PRIMARY KEY,
                full_html TEXT NOT NULL,
                created_at BIGINT NOT NULL,
                paid BOOLEAN NOT NULL DEFAULT FALSE,
                paid_at BIGINT,
                checkout_session_id TEXT,
                base_cv_id TEXT,
                language TEXT,
                theme TEXT,
                source_data_json TEXT,
                variant_label TEXT
            );
        `);

        await pool.query(`ALTER TABLE cvs ADD COLUMN IF NOT EXISTS checkout_session_id TEXT;`);
        await pool.query(`ALTER TABLE cvs ADD COLUMN IF NOT EXISTS base_cv_id TEXT;`);
        await pool.query(`ALTER TABLE cvs ADD COLUMN IF NOT EXISTS language TEXT;`);
        await pool.query(`ALTER TABLE cvs ADD COLUMN IF NOT EXISTS theme TEXT;`);
        await pool.query(`ALTER TABLE cvs ADD COLUMN IF NOT EXISTS source_data_json TEXT;`);
        await pool.query(`ALTER TABLE cvs ADD COLUMN IF NOT EXISTS variant_label TEXT;`);

        await pool.query(`CREATE INDEX IF NOT EXISTS idx_cvs_created_at ON cvs(created_at);`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_cvs_checkout_session_id ON cvs(checkout_session_id);`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_cvs_base_cv_id ON cvs(base_cv_id);`);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS stripe_events (
                event_id TEXT PRIMARY KEY,
                created_at BIGINT NOT NULL
            );
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS analytics_events (
                id BIGSERIAL PRIMARY KEY,
                event_type TEXT NOT NULL,
                cv_id TEXT,
                event_key TEXT,
                metadata_json TEXT,
                created_at BIGINT NOT NULL
            );
        `);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_analytics_event_type_created ON analytics_events(event_type, created_at);`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_analytics_cv_id ON analytics_events(cv_id);`);
        await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_analytics_event_key_unique ON analytics_events(event_key);`);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS download_tokens (
                token TEXT PRIMARY KEY,
                cv_id TEXT NOT NULL,
                created_at BIGINT NOT NULL,
                expires_at BIGINT NOT NULL,
                clicks INTEGER NOT NULL DEFAULT 0,
                last_access_at BIGINT
            );
        `);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_download_tokens_cv_id ON download_tokens(cv_id);`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_download_tokens_expires_at ON download_tokens(expires_at);`);
    })();

    await pgInitPromise;
}

function mapPgCvRecord(row) {
    if (!row) return null;
    return {
        id: row.id,
        fullHtml: row.full_html,
        createdAt: Number(row.created_at),
        paid: Boolean(row.paid),
        paidAt: row.paid_at ? Number(row.paid_at) : null,
        checkoutSessionId: row.checkout_session_id || null,
        baseCvId: row.base_cv_id || null,
        language: row.language || 'hu',
        theme: row.theme || null,
        sourceData: safeJsonParse(row.source_data_json, null),
        variantLabel: row.variant_label || null
    };
}

async function saveCvRecord(input) {
    const normalized = normalizeSaveInput(input);
    const cvId = crypto.randomUUID();
    const now = Date.now();
    const paidAt = normalized.paid ? (normalized.paidAt || now) : null;
    const sourceDataJson = normalized.sourceData ? JSON.stringify(normalized.sourceData) : null;

    if (usePostgres) {
        await ensurePgInitialized();
        await pool.query(
            `INSERT INTO cvs (
                id,
                full_html,
                created_at,
                paid,
                paid_at,
                checkout_session_id,
                base_cv_id,
                language,
                theme,
                source_data_json,
                variant_label
            )
            VALUES ($1, $2, $3, $4, $5, NULL, $6, $7, $8, $9, $10)`,
            [
                cvId,
                normalized.fullHtml,
                now,
                normalized.paid,
                paidAt,
                normalized.baseCvId,
                normalized.language,
                normalized.theme,
                sourceDataJson,
                normalized.variantLabel
            ]
        );
        return cvId;
    }

    memCvStore.set(cvId, {
        id: cvId,
        fullHtml: normalized.fullHtml,
        createdAt: now,
        paid: normalized.paid,
        paidAt,
        checkoutSessionId: null,
        baseCvId: normalized.baseCvId,
        language: normalized.language,
        theme: normalized.theme,
        sourceData: normalized.sourceData,
        variantLabel: normalized.variantLabel
    });

    return cvId;
}

async function getCvRecord(cvId, ttlMs) {
    if (!cvId) return null;

    if (usePostgres) {
        await ensurePgInitialized();
        const result = await pool.query(
            `SELECT id, full_html, created_at, paid, paid_at, checkout_session_id, base_cv_id, language, theme, source_data_json, variant_label
             FROM cvs
             WHERE id = $1
             LIMIT 1`,
            [cvId]
        );

        const record = mapPgCvRecord(result.rows[0]);
        if (!record) return null;

        if (Number.isFinite(ttlMs) && Date.now() - record.createdAt > ttlMs) {
            await pool.query(`DELETE FROM cvs WHERE id = $1`, [cvId]);
            return null;
        }

        return record;
    }

    const record = memCvStore.get(cvId);
    if (!record) return null;

    if (Number.isFinite(ttlMs) && Date.now() - record.createdAt > ttlMs) {
        memCvStore.delete(cvId);
        return null;
    }

    return { ...record };
}

function resolveRootCvId(record) {
    if (!record) return null;
    return record.baseCvId || record.id;
}

async function listCvVersions(cvId, ttlMs) {
    if (!cvId) return [];
    const record = await getCvRecord(cvId, ttlMs);
    if (!record) return [];

    const rootCvId = resolveRootCvId(record);

    if (usePostgres) {
        await ensurePgInitialized();
        const result = await pool.query(
            `SELECT id, full_html, created_at, paid, paid_at, checkout_session_id, base_cv_id, language, theme, source_data_json, variant_label
             FROM cvs
             WHERE id = $1 OR base_cv_id = $1
             ORDER BY created_at DESC`,
            [rootCvId]
        );

        const rows = result.rows
            .map(mapPgCvRecord)
            .filter(Boolean)
            .filter((item) => !Number.isFinite(ttlMs) || Date.now() - item.createdAt <= ttlMs);

        return rows.map((item) => ({ ...item, rootCvId }));
    }

    const rows = [];
    for (const item of memCvStore.values()) {
        if (item.id === rootCvId || item.baseCvId === rootCvId) {
            if (!Number.isFinite(ttlMs) || Date.now() - item.createdAt <= ttlMs) {
                rows.push({ ...item, rootCvId });
            }
        }
    }
    rows.sort((a, b) => b.createdAt - a.createdAt);
    return rows;
}

async function markCvPaid(cvId) {
    if (!cvId) return false;
    const now = Date.now();

    if (usePostgres) {
        await ensurePgInitialized();
        const result = await pool.query(
            `UPDATE cvs
             SET paid = TRUE, paid_at = $1
             WHERE id = $2`,
            [now, cvId]
        );
        return result.rowCount > 0;
    }

    const existing = memCvStore.get(cvId);
    if (!existing) return false;
    existing.paid = true;
    existing.paidAt = now;
    return true;
}

async function markCvPaidCascade(cvId) {
    if (!cvId) return 0;
    const record = await getCvRecord(cvId, Number.POSITIVE_INFINITY);
    if (!record) return 0;

    const rootCvId = resolveRootCvId(record);
    const now = Date.now();

    if (usePostgres) {
        await ensurePgInitialized();
        const result = await pool.query(
            `UPDATE cvs
             SET paid = TRUE, paid_at = $2
             WHERE id = $1 OR base_cv_id = $1`,
            [rootCvId, now]
        );
        return result.rowCount || 0;
    }

    let updated = 0;
    for (const item of memCvStore.values()) {
        if (item.id === rootCvId || item.baseCvId === rootCvId) {
            item.paid = true;
            item.paidAt = now;
            updated++;
        }
    }
    return updated;
}

async function setCheckoutSessionId(cvId, sessionId) {
    if (!cvId || !sessionId) return false;

    if (usePostgres) {
        await ensurePgInitialized();
        const result = await pool.query(
            `UPDATE cvs
             SET checkout_session_id = $1
             WHERE id = $2`,
            [sessionId, cvId]
        );
        return result.rowCount > 0;
    }

    const existing = memCvStore.get(cvId);
    if (!existing) return false;
    existing.checkoutSessionId = sessionId;
    return true;
}

async function findCvIdByCheckoutSessionId(sessionId) {
    if (!sessionId) return null;

    if (usePostgres) {
        await ensurePgInitialized();
        const result = await pool.query(
            `SELECT id
             FROM cvs
             WHERE checkout_session_id = $1
             LIMIT 1`,
            [sessionId]
        );
        return result.rows[0]?.id || null;
    }

    for (const [cvId, record] of memCvStore.entries()) {
        if (record.checkoutSessionId === sessionId) return cvId;
    }
    return null;
}

async function purgeExpiredCvRecords(ttlMs) {
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) return 0;
    const cutoff = Date.now() - ttlMs;

    if (usePostgres) {
        await ensurePgInitialized();
        const result = await pool.query(`DELETE FROM cvs WHERE created_at < $1`, [cutoff]);
        return result.rowCount || 0;
    }

    let removed = 0;
    for (const [cvId, record] of memCvStore.entries()) {
        if (record.createdAt < cutoff) {
            memCvStore.delete(cvId);
            removed++;
        }
    }
    return removed;
}

async function isStripeEventProcessed(eventId) {
    if (!eventId) return false;

    if (usePostgres) {
        await ensurePgInitialized();
        const result = await pool.query(
            `SELECT 1
             FROM stripe_events
             WHERE event_id = $1
             LIMIT 1`,
            [eventId]
        );
        return result.rowCount > 0;
    }

    return memStripeEvents.has(eventId);
}

async function markStripeEventProcessed(eventId) {
    if (!eventId) return false;
    const now = Date.now();

    if (usePostgres) {
        await ensurePgInitialized();
        const result = await pool.query(
            `INSERT INTO stripe_events (event_id, created_at)
             VALUES ($1, $2)
             ON CONFLICT (event_id) DO NOTHING`,
            [eventId, now]
        );
        return result.rowCount > 0;
    }

    const had = memStripeEvents.has(eventId);
    memStripeEvents.add(eventId);
    return !had;
}

async function trackAnalyticsEvent(eventType, options = {}) {
    if (!eventType) return false;

    const cvId = options.cvId || null;
    const eventKey = options.eventKey || null;
    const metadata = options.metadata ?? null;
    const createdAt = Number.isFinite(options.createdAt) ? options.createdAt : Date.now();

    if (usePostgres) {
        await ensurePgInitialized();
        const result = await pool.query(
            `INSERT INTO analytics_events (event_type, cv_id, event_key, metadata_json, created_at)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT DO NOTHING`,
            [eventType, cvId, eventKey, metadata ? JSON.stringify(metadata) : null, createdAt]
        );
        return result.rowCount > 0;
    }

    if (eventKey && memAnalyticsUniqueKeys.has(eventKey)) {
        return false;
    }

    if (eventKey) memAnalyticsUniqueKeys.add(eventKey);
    memAnalyticsEvents.push({
        eventType,
        cvId,
        eventKey,
        metadata,
        createdAt
    });
    return true;
}

async function getAnalyticsSummary(fromTs = 0, toTs = Date.now()) {
    const rangeStart = Number.isFinite(fromTs) ? fromTs : 0;
    const rangeEnd = Number.isFinite(toTs) ? toTs : Date.now();

    if (usePostgres) {
        await ensurePgInitialized();
        const result = await pool.query(
            `SELECT
                COUNT(*) FILTER (WHERE event_type = 'cv_generated') AS generated_count,
                COUNT(*) FILTER (WHERE event_type = 'payment_checkout_started') AS checkout_started_count,
                COUNT(*) FILTER (WHERE event_type = 'payment_success') AS payment_success_count,
                COUNT(*) FILTER (WHERE event_type = 'cv_downloaded') AS download_count
             FROM analytics_events
             WHERE created_at >= $1 AND created_at <= $2`,
            [rangeStart, rangeEnd]
        );

        const row = result.rows[0] || {};
        const generated = Number(row.generated_count || 0);
        const checkoutStarted = Number(row.checkout_started_count || 0);
        const paymentSuccess = Number(row.payment_success_count || 0);
        const downloads = Number(row.download_count || 0);
        const conversionRate = generated > 0
            ? Math.round((paymentSuccess / generated) * 10000) / 100
            : 0;

        return {
            generated,
            checkoutStarted,
            paymentSuccess,
            downloads,
            conversionRate
        };
    }

    const inRange = memAnalyticsEvents.filter(
        (event) => event.createdAt >= rangeStart && event.createdAt <= rangeEnd
    );
    const generated = inRange.filter((e) => e.eventType === 'cv_generated').length;
    const checkoutStarted = inRange.filter((e) => e.eventType === 'payment_checkout_started').length;
    const paymentSuccess = inRange.filter((e) => e.eventType === 'payment_success').length;
    const downloads = inRange.filter((e) => e.eventType === 'cv_downloaded').length;
    const conversionRate = generated > 0
        ? Math.round((paymentSuccess / generated) * 10000) / 100
        : 0;

    return {
        generated,
        checkoutStarted,
        paymentSuccess,
        downloads,
        conversionRate
    };
}

async function createTrackedDownloadToken(cvId, ttlMs) {
    if (!cvId) return null;
    const createdAt = Date.now();
    const validTtlMs = Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : (7 * 24 * 60 * 60 * 1000);
    const expiresAt = createdAt + validTtlMs;
    const token = crypto.randomBytes(24).toString('hex');

    if (usePostgres) {
        await ensurePgInitialized();
        await pool.query(
            `INSERT INTO download_tokens (token, cv_id, created_at, expires_at, clicks, last_access_at)
             VALUES ($1, $2, $3, $4, 0, NULL)`,
            [token, cvId, createdAt, expiresAt]
        );
        return {
            token,
            cvId,
            createdAt,
            expiresAt,
            clicks: 0,
            lastAccessAt: null
        };
    }

    const record = {
        token,
        cvId,
        createdAt,
        expiresAt,
        clicks: 0,
        lastAccessAt: null
    };
    memDownloadTokens.set(token, record);
    return { ...record };
}

async function getTrackedDownloadToken(token) {
    if (!token) return null;

    if (usePostgres) {
        await ensurePgInitialized();
        const result = await pool.query(
            `SELECT token, cv_id, created_at, expires_at, clicks, last_access_at
             FROM download_tokens
             WHERE token = $1
             LIMIT 1`,
            [token]
        );
        const row = result.rows[0];
        if (!row) return null;

        const record = {
            token: row.token,
            cvId: row.cv_id,
            createdAt: Number(row.created_at),
            expiresAt: Number(row.expires_at),
            clicks: Number(row.clicks || 0),
            lastAccessAt: row.last_access_at ? Number(row.last_access_at) : null
        };

        if (Date.now() > record.expiresAt) {
            await pool.query(`DELETE FROM download_tokens WHERE token = $1`, [token]);
            return null;
        }

        return record;
    }

    const record = memDownloadTokens.get(token);
    if (!record) return null;
    if (Date.now() > record.expiresAt) {
        memDownloadTokens.delete(token);
        return null;
    }
    return { ...record };
}

async function registerTrackedDownloadAccess(token) {
    if (!token) return null;
    const now = Date.now();

    if (usePostgres) {
        await ensurePgInitialized();
        const result = await pool.query(
            `UPDATE download_tokens
             SET clicks = clicks + 1,
                 last_access_at = $2
             WHERE token = $1
             RETURNING token, cv_id, created_at, expires_at, clicks, last_access_at`,
            [token, now]
        );
        const row = result.rows[0];
        if (!row) return null;
        return {
            token: row.token,
            cvId: row.cv_id,
            createdAt: Number(row.created_at),
            expiresAt: Number(row.expires_at),
            clicks: Number(row.clicks || 0),
            lastAccessAt: row.last_access_at ? Number(row.last_access_at) : null
        };
    }

    const existing = memDownloadTokens.get(token);
    if (!existing) return null;
    existing.clicks += 1;
    existing.lastAccessAt = now;
    return { ...existing };
}

async function purgeExpiredDownloadTokens() {
    const now = Date.now();

    if (usePostgres) {
        await ensurePgInitialized();
        const result = await pool.query(
            `DELETE FROM download_tokens WHERE expires_at < $1`,
            [now]
        );
        return result.rowCount || 0;
    }

    let removed = 0;
    for (const [token, record] of memDownloadTokens.entries()) {
        if (record.expiresAt < now) {
            memDownloadTokens.delete(token);
            removed += 1;
        }
    }
    return removed;
}

module.exports = {
    saveCvRecord,
    getCvRecord,
    listCvVersions,
    markCvPaid,
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
};
