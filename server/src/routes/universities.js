import { Router } from 'express';
import { getDB, save } from '../db/index.js';

const router = Router();

router.get('/', (req, res) => {
    const db = getDB();
    const { zone, province, level, keyword } = req.query;
    let sql = 'SELECT * FROM universities WHERE 1=1';
    const params = [];

    if (zone) { sql += ' AND zone = ?'; params.push(zone); }
    if (province) { sql += ' AND province = ?'; params.push(province); }
    if (level) { sql += ' AND level = ?'; params.push(level); }
    if (keyword) { sql += ' AND name LIKE ?'; params.push(`%${keyword}%`); }

    sql += ' ORDER BY level DESC, name ASC';
    const rows = db.prepare(sql).all(...params);
    res.json({ total: rows.length, data: rows });
});

router.get('/:id', (req, res) => {
    const db = getDB();
    const uni = db.prepare('SELECT * FROM universities WHERE id = ?').get(req.params.id);
    if (!uni) return res.status(404).json({ error: 'not found' });

    const detail = db.prepare('SELECT * FROM uni_details WHERE university_id = ?').get(uni.id);
    const photos = db.prepare('SELECT * FROM uni_photos WHERE university_id = ?').all(uni.id);
    const scores = db.prepare('SELECT * FROM admission_scores WHERE university_id = ? ORDER BY year DESC').all(uni.id);
    const reqs = db.prepare('SELECT * FROM uni_requirements WHERE university_id = ?').all(uni.id);

    res.json({ ...uni, detail, photos, scores, requirements: reqs });
});

router.post('/', (req, res) => {
    const db = getDB();
    const { name, province, city, zone, level, type } = req.body;
    if (!name || !province || !zone || !level) {
        return res.status(400).json({ error: 'missing fields' });
    }
    db.prepare('INSERT OR IGNORE INTO universities (name, province, city, zone, level, type) VALUES (?,?,?,?,?,?)')
        .run(name, province, city || '', zone, level, type || '');
    save();
    const u = db.prepare('SELECT id FROM universities WHERE name = ?').get(name);
    res.status(201).json({ id: u?.id, name, province, city, zone, level, type });
});

export default router;
