const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'cv.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS cvs (
    id TEXT PRIMARY KEY,
    full_html TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    paid INTEGER NOT NULL DEFAULT 0,
    paid_at INTEGER,
    checkout_session_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_cvs_created_at ON cvs(created_at);
CREATE INDEX IF NOT EXISTS idx_cvs_checkout_session_id ON cvs(checkout_session_id);

CREATE TABLE IF NOT EXISTS stripe_events (
    event_id TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL
);
`);

const insertCvStmt = db.prepare(`
    INSERT INTO cvs (id, full_html, created_at, paid, paid_at, checkout_session_id)
    VALUES (?, ?, ?, 0, NULL, NULL)
`);

const selectCvStmt = db.prepare(`
    SELECT id, full_html, created_at, paid, paid_at, checkout_session_id
    FROM cvs
    WHERE id = ?
`);

const deleteCvStmt = db.prepare(`DELETE FROM cvs WHERE id = ?`);

const markPaidStmt = db.prepare(`
    UPDATE cvs
    SET paid = 1, paid_at = ?
    WHERE id = ?
`);

const setCheckoutSessionStmt = db.prepare(`
    UPDATE cvs
    SET checkout_session_id = ?
    WHERE id = ?
`);

const findByCheckoutSessionStmt = db.prepare(`
    SELECT id FROM cvs WHERE checkout_session_id = ? LIMIT 1
`);

const purgeExpiredStmt = db.prepare(`
    DELETE FROM cvs
    WHERE created_at < ?
`);

const isEventProcessedStmt = db.prepare(`
    SELECT 1 FROM stripe_events WHERE event_id = ? LIMIT 1
`);

const insertEventStmt = db.prepare(`
    INSERT OR IGNORE INTO stripe_events (event_id, created_at)
    VALUES (?, ?)
`);

function mapCvRecord(row) {
    if (!row) return null;
    return {
        id: row.id,
        fullHtml: row.full_html,
        createdAt: row.created_at,
        paid: Boolean(row.paid),
        paidAt: row.paid_at,
        checkoutSessionId: row.checkout_session_id
    };
}

function saveCvRecord(fullHtml) {
    const cvId = crypto.randomUUID();
    const now = Date.now();
    insertCvStmt.run(cvId, fullHtml, now);
    return cvId;
}

function getCvRecord(cvId, ttlMs) {
    if (!cvId) return null;
    const record = mapCvRecord(selectCvStmt.get(cvId));
    if (!record) return null;

    if (Number.isFinite(ttlMs) && Date.now() - record.createdAt > ttlMs) {
        deleteCvStmt.run(cvId);
        return null;
    }

    return record;
}

function markCvPaid(cvId) {
    if (!cvId) return false;
    const now = Date.now();
    const result = markPaidStmt.run(now, cvId);
    return result.changes > 0;
}

function setCheckoutSessionId(cvId, sessionId) {
    if (!cvId || !sessionId) return false;
    const result = setCheckoutSessionStmt.run(sessionId, cvId);
    return result.changes > 0;
}

function findCvIdByCheckoutSessionId(sessionId) {
    if (!sessionId) return null;
    const row = findByCheckoutSessionStmt.get(sessionId);
    return row ? row.id : null;
}

function purgeExpiredCvRecords(ttlMs) {
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) return 0;
    const cutoff = Date.now() - ttlMs;
    const result = purgeExpiredStmt.run(cutoff);
    return result.changes;
}

function isStripeEventProcessed(eventId) {
    if (!eventId) return false;
    return Boolean(isEventProcessedStmt.get(eventId));
}

function markStripeEventProcessed(eventId) {
    if (!eventId) return false;
    const result = insertEventStmt.run(eventId, Date.now());
    return result.changes > 0;
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

