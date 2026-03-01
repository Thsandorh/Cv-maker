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
                checkout_session_id TEXT
            );
        `);

        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_cvs_created_at ON cvs(created_at);
        `);

        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_cvs_checkout_session_id ON cvs(checkout_session_id);
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS stripe_events (
                event_id TEXT PRIMARY KEY,
                created_at BIGINT NOT NULL
            );
        `);
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
        checkoutSessionId: row.checkout_session_id
    };
}

async function saveCvRecord(fullHtml) {
    const cvId = crypto.randomUUID();
    const now = Date.now();

    if (usePostgres) {
        await ensurePgInitialized();
        await pool.query(
            `INSERT INTO cvs (id, full_html, created_at, paid, paid_at, checkout_session_id)
             VALUES ($1, $2, $3, FALSE, NULL, NULL)`,
            [cvId, fullHtml, now]
        );
        return cvId;
    }

    memCvStore.set(cvId, {
        id: cvId,
        fullHtml,
        createdAt: now,
        paid: false,
        paidAt: null,
        checkoutSessionId: null
    });
    return cvId;
}

async function getCvRecord(cvId, ttlMs) {
    if (!cvId) return null;

    if (usePostgres) {
        await ensurePgInitialized();
        const result = await pool.query(
            `SELECT id, full_html, created_at, paid, paid_at, checkout_session_id
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
        const result = await pool.query(
            `DELETE FROM cvs WHERE created_at < $1`,
            [cutoff]
        );
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

module.exports = {
    saveCvRecord,
    getCvRecord,
    markCvPaid,
    setCheckoutSessionId,
    findCvIdByCheckoutSessionId,
    purgeExpiredCvRecords,
    isStripeEventProcessed,
    markStripeEventProcessed
};

