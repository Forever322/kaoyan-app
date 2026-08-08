import { Router } from 'express';
import { getDB, save } from '../db/index.js';

const router = Router();

router.get('/', (req, res) => {
    const db = getDB();
    const { year, degree, category } = req.query;
    let sql = 'SELECT * FROM national_lines WHERE 1=1';
    const params = [];

    if (year) { sql += ' AND year = ?'; params.push(Number(year)); }
    if (degree) { sql += ' AND degree = ?'; params.push(degree); }
    if (category) { sql += ' AND category = ?'; params.push(category); }

    sql += ' ORDER BY year DESC, degree, category, zone';
    const rows = db.prepare(sql).all(...params);
    res.json({ total: rows.length, data: rows });
});

router.post('/', (req, res) => {
    const db = getDB();
    const { year, degree, category, zone, score } = req.body;
    if (!year || !degree || !category || !zone || !score) {
        return res.status(400).json({ error: 'missing fields' });
    }
    db.prepare('INSERT OR REPLACE INTO national_lines (year, degree, category, zone, score) VALUES (?,?,?,?,?)')
        .run(year, degree, category, zone, score);
    save();
    res.status(201).json({ year, degree, category, zone, score });
});

export default router;
