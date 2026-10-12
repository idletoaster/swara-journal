const express = require('express');
const cors = require('cors');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = process.env.PORT || 3001;
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || 'admin@example.com').split(',').map(e => e.trim().toLowerCase());

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const db = new sqlite3.Database(path.join(__dirname, 'journal.db'), (err) => {
    if (err) console.error("Database connection error:", err.message);
    else console.log("Connected to SQLite database journal.db");
});

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS entries (
        id TEXT PRIMARY KEY,
        user_email TEXT NOT NULL,
        activity_time INTEGER NOT NULL,
        recorded_at INTEGER NOT NULL,
        category TEXT NOT NULL,
        engine TEXT NOT NULL,
        location_json TEXT NOT NULL,
        user_input_json TEXT NOT NULL,
        calculated_blueprint_json TEXT NOT NULL,
        divergence_json TEXT NOT NULL,
        outcome TEXT NOT NULL,
        notes TEXT
    )`);

    db.run(`CREATE INDEX IF NOT EXISTS idx_user_time ON entries (user_email, activity_time DESC)`);

    db.run(`CREATE TABLE IF NOT EXISTS custom_categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_email TEXT NOT NULL,
        category_name TEXT NOT NULL,
        UNIQUE(user_email, category_name)
    )`);
});

const getUserEmail = (req) => {
    const cfEmail = req.headers['cf-access-authenticated-user-email'];
    return (cfEmail ? cfEmail.trim().toLowerCase() : (process.env.DEV_USER_EMAIL || 'local-user@example.com'));
};

app.get('/api/user-info', (req, res) => {
    const email = getUserEmail(req);
    res.json({ email, isAdmin: ADMIN_EMAILS.includes(email) });
});

app.get('/api/categories', (req, res) => {
    const email = getUserEmail(req);
    db.all(`SELECT category_name FROM custom_categories WHERE user_email = ? ORDER BY category_name ASC`, [email], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        if (rows.length === 0) {
            const defaults = ["General", "Lottery", "Negotiation", "Travel"];
            const stmt = db.prepare(`INSERT OR IGNORE INTO custom_categories (user_email, category_name) VALUES (?, ?)`);
            db.serialize(() => {
                db.run("BEGIN TRANSACTION");
                defaults.forEach(c => stmt.run([email, c]));
                db.run("COMMIT", () => res.json(defaults));
            });
        } else {
            res.json(rows.map(r => r.category_name));
        }
    });
});

app.post('/api/categories', (req, res) => {
    const email = getUserEmail(req);
    const { category } = req.body;
    if (!category || !category.trim()) return res.status(400).json({ error: "Invalid category" });
    
    db.run(`INSERT OR IGNORE INTO custom_categories (user_email, category_name) VALUES (?, ?)`, [email, category.trim()], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ status: "success", category: category.trim() });
    });
});

app.delete('/api/categories/:name', (req, res) => {
    const email = getUserEmail(req);
    db.run(`DELETE FROM custom_categories WHERE user_email = ? AND category_name = ?`, [email, req.params.name], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ status: "success", deleted: this.changes });
    });
});

app.post('/api/entries', (req, res) => {
    const email = getUserEmail(req);
    const entries = Array.isArray(req.body) ? req.body : [req.body];
    
    const stmt = db.prepare(`INSERT OR REPLACE INTO entries (
        id, user_email, activity_time, recorded_at, category, engine,
        location_json, user_input_json, calculated_blueprint_json,
        divergence_json, outcome, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

    db.serialize(() => {
        db.run("BEGIN TRANSACTION");
        for (const item of entries) {
            stmt.run([
                item.id,
                email,
                item.activity_time,
                item.recorded_at || Date.now(),
                item.category || "General",
                item.engine || "swarodaya",
                JSON.stringify(item.location || {}),
                JSON.stringify(item.user_input || {}),
                JSON.stringify(item.calculated_blueprint || {}),
                JSON.stringify(item.divergence || {}),
                item.outcome || "pending",
                item.notes || ""
            ]);
        }
        db.run("COMMIT", (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ status: "success", count: entries.length });
        });
    });
});

app.patch('/api/entries/:id', (req, res) => {
    const email = getUserEmail(req);
    const entryId = req.params.id;
    const { outcome } = req.body;

    if (!outcome) return res.status(400).json({ error: "Outcome is required" });

    db.run(`UPDATE entries SET outcome = ? WHERE id = ? AND user_email = ?`, [outcome, entryId, email], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: "Entry not found" });
        res.json({ status: "success", id: entryId, outcome });
    });
});

app.delete('/api/entries/:id', (req, res) => {
    const email = getUserEmail(req);
    db.run(`DELETE FROM entries WHERE id = ? AND user_email = ?`, [req.params.id, email], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ status: "success", deleted: this.changes });
    });
});

app.get('/api/entries', (req, res) => {
    const email = getUserEmail(req);
    const isAdmin = ADMIN_EMAILS.includes(email);
    const scope = req.query.scope;

    let sql = `SELECT * FROM entries WHERE user_email = ? ORDER BY activity_time DESC`;
    let params = [email];

    if (scope === 'all' && isAdmin) {
        sql = `SELECT * FROM entries ORDER BY activity_time DESC`;
        params = [];
    }

    db.all(sql, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        const parsed = rows.map(r => ({
            id: r.id,
            user_email: r.user_email,
            activity_time: r.activity_time,
            recorded_at: r.recorded_at,
            category: r.category,
            engine: r.engine,
            location: JSON.parse(r.location_json),
            user_input: JSON.parse(r.user_input_json),
            calculated_blueprint: JSON.parse(r.calculated_blueprint_json),
            divergence: JSON.parse(r.divergence_json),
            outcome: r.outcome,
            notes: r.notes
        }));
        res.json(parsed);
    });
});

// Deterministic Associative Mining Engine
app.get('/api/analytics', (req, res) => {
    const email = getUserEmail(req);
    const isAdmin = ADMIN_EMAILS.includes(email);
    const scope = (req.query.scope === 'all' && isAdmin) ? 'all' : 'user';
    const categoryFilter = req.query.category || 'all';

    let clauses = [];
    let params = [];

    if (scope === 'user') {
        clauses.push(`user_email = ?`);
        params.push(email);
    }
    if (categoryFilter !== 'all') {
        clauses.push(`category = ?`);
        params.push(categoryFilter);
    }

    const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const query = `SELECT outcome, category, divergence_json, calculated_blueprint_json, user_input_json FROM entries ${whereSql}`;

    db.all(query, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });

        let total = rows.length;
        let outcomes = { success: 0, failure: 0, pending: 0 };
        let metrics = {
            nadiWins: 0, nadiTot: 0,
            tattvaWins: 0, tattvaTot: 0,
            travelWins: 0, travelTot: 0
        };

        const comboStats = {};

        rows.forEach(r => {
            const outcome = (r.outcome === 'positive' || r.outcome === 'success') ? 'success' : (r.outcome === 'negative' || r.outcome === 'failure' ? 'failure' : 'pending');
            outcomes[outcome] = (outcomes[outcome] || 0) + 1;

            if (outcome === 'pending') return;

            const blueprint = JSON.parse(r.calculated_blueprint_json || '{}');
            const div = JSON.parse(r.divergence_json || '{}');
            const userInput = JSON.parse(r.user_input_json || '{}');
            const isWin = (outcome === 'success');

            if (div.nadi_match !== undefined) {
                metrics.nadiTot++;
                if (isWin && div.nadi_match) metrics.nadiWins++;
            }
            if (div.tattva_match !== undefined) {
                metrics.tattvaTot++;
                if (isWin && div.tattva_match) metrics.tattvaWins++;
            }
            if (div.travel_aligned !== undefined) {
                metrics.travelTot++;
                if (isWin && div.travel_aligned) metrics.travelWins++;
            }

            // Variable pool for tuple generation
            const tokens = [];
            if (blueprint.hora) tokens.push(`Hora: ${blueprint.hora}`);
            if (blueprint.yaamam_tattva) tokens.push(`Yaamam: ${blueprint.yaamam_tattva}`);
            if (blueprint.vaara) tokens.push(`Vaara: ${blueprint.vaara}`);
            if (blueprint.paksha) tokens.push(`Paksha: ${blueprint.paksha}`);
            if (blueprint.nadi) tokens.push(`Calculated Nadi: ${blueprint.nadi.toUpperCase()}`);
            if (userInput.observed_nadi) tokens.push(`Observed Nadi: ${userInput.observed_nadi.toUpperCase()}`);
            if (userInput.observed_tattva) tokens.push(`Observed Tattva: ${userInput.observed_tattva}`);
            if (userInput.travel_direction) tokens.push(`Travel: ${userInput.travel_direction}`);
            if (userInput.facing_direction) tokens.push(`Facing: ${userInput.facing_direction}`);
            if (div.travel_aligned !== undefined) tokens.push(div.travel_aligned ? 'Travel: Cleared' : 'Travel: Blocked');
            if (div.nadi_match !== undefined) tokens.push(div.nadi_match ? 'Nadi: Aligned' : 'Nadi: Misaligned');

            // Generate 1-tuples and 2-tuples
            for (let i = 0; i < tokens.length; i++) {
                const k1 = tokens[i];
                if (!comboStats[k1]) comboStats[k1] = { wins: 0, losses: 0, total: 0 };
                comboStats[k1].total++;
                if (isWin) comboStats[k1].wins++; else comboStats[k1].losses++;

                for (let j = i + 1; j < tokens.length; j++) {
                    const k2 = `${tokens[i]} + ${tokens[j]}`;
                    if (!comboStats[k2]) comboStats[k2] = { wins: 0, losses: 0, total: 0 };
                    comboStats[k2].total++;
                    if (isWin) comboStats[k2].wins++; else comboStats[k2].losses++;
                }
            }
        });

        // Separate and rank Triggers vs Traps
        const allTuples = Object.entries(comboStats).map(([combo, s]) => ({
            combination: combo,
            total: s.total,
            wins: s.wins,
            losses: s.losses,
            winRate: parseFloat(((s.wins / s.total) * 100).toFixed(1)),
            lossRate: parseFloat(((s.losses / s.total) * 100).toFixed(1))
        }));

        const triggers = allTuples
            .filter(t => t.winRate >= 50)
            .sort((a, b) => b.winRate - a.winRate || b.total - a.total)
            .slice(0, 10);

        const traps = allTuples
            .filter(t => t.lossRate > 50)
            .sort((a, b) => b.lossRate - a.lossRate || b.total - a.total)
            .slice(0, 10);

        res.json({
            scope,
            category: categoryFilter,
            total,
            outcomes,
            correlations: {
                nadi: metrics.nadiTot ? ((metrics.nadiWins / metrics.nadiTot) * 100).toFixed(1) : "0.0",
                tattva: metrics.tattvaTot ? ((metrics.tattvaWins / metrics.tattvaTot) * 100).toFixed(1) : "0.0",
                travel: metrics.travelTot ? ((metrics.travelWins / metrics.travelTot) * 100).toFixed(1) : "0.0"
            },
            triggers,
            traps
        });
    });
});

app.listen(PORT, '0.0.0.0', () => console.log(`Swara Journal running on port ${PORT}`));