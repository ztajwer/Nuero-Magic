const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '../neuromagic.sqlite');
const db = new sqlite3.Database(dbPath);

// Enable WAL mode for better concurrency and foreign keys
db.serialize(() => {
    db.run("PRAGMA foreign_keys = ON;");
    db.run("PRAGMA journal_mode = WAL;");
});

function translateSQL(sql) {
    let newSql = sql;

    // 1. Remove MySQL table creation properties
    newSql = newSql.replace(/ENGINE\s*=\s*\w+/gi, '');
    newSql = newSql.replace(/DEFAULT\s+CHARSET\s*=\s*[\w_]+/gi, '');
    newSql = newSql.replace(/COLLATE\s*=?\s*[\w_]+/gi, '');
    newSql = newSql.replace(/CHARACTER\s+SET\s+\w+/gi, '');
    newSql = newSql.replace(/ROW_FORMAT\s*=\s*\w+/gi, '');

    // 2. ON UPDATE CURRENT_TIMESTAMP/NOW() - MUST run early, before other transforms
    newSql = newSql.replace(/\s+ON\s+UPDATE\s+CURRENT_TIMESTAMP\s*\(\s*\)/gi, '');
    newSql = newSql.replace(/\s+ON\s+UPDATE\s+CURRENT_TIMESTAMP/gi, '');
    newSql = newSql.replace(/\s+ON\s+UPDATE\s+datetime\([^)]*\)/gi, '');
    newSql = newSql.replace(/\s+ON\s+UPDATE\s+NOW\(\)/gi, '');

    // 3. Convert AUTO_INCREMENT types to SQLite INTEGER PRIMARY KEY AUTOINCREMENT
    newSql = newSql.replace(/\bINT\s+UNSIGNED\s+AUTO_INCREMENT\s+PRIMARY\s+KEY\b/gi, 'INTEGER PRIMARY KEY AUTOINCREMENT');
    newSql = newSql.replace(/\bINT\s+AUTO_INCREMENT\s+PRIMARY\s+KEY\b/gi, 'INTEGER PRIMARY KEY AUTOINCREMENT');
    newSql = newSql.replace(/\bINTEGER\s+UNSIGNED\s+AUTO_INCREMENT\s+PRIMARY\s+KEY\b/gi, 'INTEGER PRIMARY KEY AUTOINCREMENT');
    newSql = newSql.replace(/\bINT\s+UNSIGNED\s+NOT\s+NULL\s+AUTO_INCREMENT\s+PRIMARY\s+KEY\b/gi, 'INTEGER PRIMARY KEY AUTOINCREMENT');
    newSql = newSql.replace(/\bINT\s+NOT\s+NULL\s+AUTO_INCREMENT\s+PRIMARY\s+KEY\b/gi, 'INTEGER PRIMARY KEY AUTOINCREMENT');
    // Remaining AUTO_INCREMENT that are not yet handled (in case the above patterns missed)
    newSql = newSql.replace(/\bAUTO_INCREMENT\b/gi, '');

    // 4. MySQL date functions -> SQLite date functions
    newSql = newSql.replace(/\bCURDATE\(\)/gi, "date('now', 'localtime')");
    newSql = newSql.replace(/\bNOW\(\)/gi, "datetime('now', 'localtime')");
    newSql = newSql.replace(/\bCURRENT_TIMESTAMP\(\)/gi, "datetime('now', 'localtime')");

    // 5. Date math
    newSql = newSql.replace(/DATE_SUB\(\s*NOW\(\)\s*,\s*INTERVAL\s+(\d+)\s+DAY\s*\)/gi, "datetime('now', 'localtime', '-$1 day')");
    newSql = newSql.replace(/DATE_SUB\(\s*datetime\('now',\s*'localtime'\)\s*,\s*INTERVAL\s+(\d+)\s+DAY\s*\)/gi, "datetime('now', 'localtime', '-$1 day')");
    newSql = newSql.replace(/DATE_ADD\(\s*NOW\(\)\s*,\s*INTERVAL\s+(\d+)\s+MONTH\s*\)/gi, "datetime('now', 'localtime', '+$1 month')");
    newSql = newSql.replace(/DATE_ADD\(\s*NOW\(\)\s*,\s*INTERVAL\s+(\d+)\s+DAY\s*\)/gi, "datetime('now', 'localtime', '+$1 day')");

    // 6. ON DUPLICATE KEY UPDATE -> ON CONFLICT
    if (newSql.toLowerCase().includes('on duplicate key update')) {
        if (newSql.toLowerCase().includes('subscriptions')) {
            newSql = newSql.replace(/ON\s+DUPLICATE\s+KEY\s+UPDATE[\s\S]+$/i, `
                ON CONFLICT(user_id) DO UPDATE SET
                plan_code = excluded.plan_code,
                status = excluded.status,
                stripe_customer_id = excluded.stripe_customer_id,
                stripe_subscription_id = excluded.stripe_subscription_id,
                stripe_price_id = excluded.stripe_price_id,
                current_period_end = excluded.current_period_end,
                cancel_at_period_end = excluded.cancel_at_period_end
            `);
        } else if (newSql.toLowerCase().includes('users')) {
            newSql = newSql.replace(/ON\s+DUPLICATE\s+KEY\s+UPDATE[\s\S]+$/i, `
                ON CONFLICT(email) DO UPDATE SET
                name = excluded.name,
                password = excluded.password,
                preferred_lang = excluded.preferred_lang,
                user_role = excluded.user_role
            `);
        } else {
            // Generic fallback: strip ON DUPLICATE KEY UPDATE clause
            newSql = newSql.replace(/ON\s+DUPLICATE\s+KEY\s+UPDATE[\s\S]+$/i, '');
        }
    }

    // 7. INSERT IGNORE -> INSERT OR IGNORE
    newSql = newSql.replace(/\bINSERT\s+IGNORE\b/gi, 'INSERT OR IGNORE');

    // 8. REPLACE INTO -> INSERT OR REPLACE INTO
    newSql = newSql.replace(/\bREPLACE\s+INTO\b/gi, 'INSERT OR REPLACE INTO');

    // 9. Data type conversions
    newSql = newSql.replace(/\bTINYINT(?:\s*\(\d+\))?\b/gi, 'INTEGER');
    newSql = newSql.replace(/\bSMALLINT(?:\s*\(\d+\))?\b/gi, 'INTEGER');
    newSql = newSql.replace(/\bMEDIUMINT(?:\s*\(\d+\))?\b/gi, 'INTEGER');
    newSql = newSql.replace(/\bBIGINT(?:\s*\(\d+\))?\b/gi, 'INTEGER');
    newSql = newSql.replace(/\bINT\s+UNSIGNED\b/gi, 'INTEGER');
    newSql = newSql.replace(/\bINT\s*\(\d+\)/gi, 'INTEGER');
    newSql = newSql.replace(/\bVARCHAR\s*\(\d+\)/gi, 'TEXT');
    newSql = newSql.replace(/\b(LONGTEXT|MEDIUMTEXT|TINYTEXT)\b/gi, 'TEXT');
    newSql = newSql.replace(/\bDOUBLE\b/gi, 'REAL');
    newSql = newSql.replace(/\bFLOAT\b/gi, 'REAL');
    newSql = newSql.replace(/\bDECIMAL\s*\([^)]+\)/gi, 'REAL');

    // DATETIME/TIMESTAMP -> TEXT (for CREATE TABLE only)
    if (newSql.toLowerCase().includes('create table')) {
        newSql = newSql.replace(/\bDATETIME\b/gi, 'TEXT');
        newSql = newSql.replace(/\bTIMESTAMP\b/gi, 'TEXT');
        newSql = newSql.replace(/\bDATE\b/gi, 'TEXT');
    }

    // 10. Handle MySQL specific index/key definitions inside CREATE TABLE
    if (newSql.toLowerCase().includes('create table')) {
        newSql = newSql.replace(/,\s*(?:UNIQUE\s+)?INDEX\s+[\w_]+\s*\([^)]+\)/gi, '');
        newSql = newSql.replace(/,\s*UNIQUE\s+KEY\s+[\w_]+\s*\([^)]+\)/gi, '');
        newSql = newSql.replace(/,\s*KEY\s+[\w_]+\s*\([^)]+\)/gi, '');
        newSql = newSql.replace(/,\s*PRIMARY\s+KEY\s*\([^)]+\)/gi, '');
        // Remove CONSTRAINT FOREIGN KEY (sqlite supports FK but not all forms)
        newSql = newSql.replace(/,\s*CONSTRAINT\s+[\w_]+\s+FOREIGN\s+KEY\s*\([^)]+\)\s*REFERENCES\s+[\w_]+\s*\([^)]+\)(?:\s+ON\s+DELETE\s+\w+)?(?:\s+ON\s+UPDATE\s+\w+)?/gi, '');
        // Keep simple FOREIGN KEY without CONSTRAINT name
        newSql = newSql.replace(/,\s*FOREIGN\s+KEY\s*\([^)]+\)\s*REFERENCES\s+[\w_]+\s*\([^)]+\)(?:\s+ON\s+DELETE\s+CASCADE)?(?:\s+ON\s+UPDATE\s+\w+)?/gi, '');
    }

    // 11. COALESCE with proper SQLite fallback (already supported, nothing to do)
    // 12. CHAR_LENGTH -> LENGTH (SQLite uses LENGTH)
    newSql = newSql.replace(/\bCHAR_LENGTH\b/gi, 'LENGTH');
    newSql = newSql.replace(/\bCHARACTER_LENGTH\b/gi, 'LENGTH');

    // 13. IFNULL -> COALESCE (both work in SQLite but normalize)
    newSql = newSql.replace(/\bIFNULL\s*\(/gi, 'COALESCE(');

    return newSql;
}

const pool = {
    async execute(sql, params = []) {
        return this.query(sql, params);
    },

    query(sql, params = []) {
        const translated = translateSQL(sql);

        return new Promise((resolve, reject) => {
            const lowerSql = translated.trim().toLowerCase();

            if (lowerSql.startsWith('select') || lowerSql.startsWith('pragma') || lowerSql.startsWith('show') || lowerSql.startsWith('with')) {
                db.all(translated, params, (err, rows) => {
                    if (err) {
                        console.error('[SQLITE_ERROR] Query failed:', err.message, '\nSQL:', translated.substring(0, 200));
                        reject(err);
                    } else {
                        resolve([rows, null]);
                    }
                });
            } else {
                db.run(translated, params, function(err) {
                    if (err) {
                        console.error('[SQLITE_ERROR] Run failed:', err.message, '\nSQL:', translated.substring(0, 200));
                        reject(err);
                    } else {
                        resolve([{
                            insertId: this.lastID,
                            affectedRows: this.changes
                        }, null]);
                    }
                });
            }
        });
    }
};

module.exports = pool;
