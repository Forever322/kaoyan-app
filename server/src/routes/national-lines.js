import { Router } from 'express';
import { getDB } from '../db/index.js';
import { requireReferenceDataWriteToken } from '../middleware/reference-data-write.js';

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const db = await getDB();
    const { year, degree, category } = req.query;
    let sql = 'SELECT * FROM national_lines WHERE 1=1';
    const params = [];

    if (year) { sql += ' AND year = ?'; params.push(Number(year)); }
    if (degree) { sql += ' AND degree = ?'; params.push(degree); }
    if (category) { sql += ' AND category = ?'; params.push(category); }

    sql += ' ORDER BY year DESC, degree, category, zone';
    const rows = await db.all(sql, params);
    return res.json({ total: rows.length, data: rows.map((row) => ({ ...row, id: Number(row.id) })) });
  } catch (error) { return next(error); }
});

router.post('/', requireReferenceDataWriteToken, async (req, res, next) => {
  try {
    const db = await getDB();
    const { year, degree, category, zone, score } = req.body || {};
    if (!year || !degree || !category || !zone || !score) return res.status(400).json({ error: 'missing fields' });
    await db.execute(`INSERT INTO national_lines (year, degree, category, zone, score) VALUES (?,?,?,?,?)
      ON DUPLICATE KEY UPDATE score=VALUES(score)`, [year, degree, category, zone, score]);
    return res.status(201).json({ year, degree, category, zone, score });
  } catch (error) { return next(error); }
});

export default router;
