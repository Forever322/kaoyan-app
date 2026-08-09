import { Router } from 'express';
import { getDB } from '../db/index.js';
import { requireReferenceDataWriteToken } from '../middleware/reference-data-write.js';

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const db = await getDB();
    const { zone, province, level, keyword } = req.query;
    // 已归档院校仅能由管理后台查看，避免用户端继续展示被撤回或待治理的资料。
    let sql = "SELECT * FROM universities WHERE COALESCE(catalog_status,'active')='active'";
    const params = [];

    if (zone) { sql += ' AND zone = ?'; params.push(zone); }
    if (province) { sql += ' AND province = ?'; params.push(province); }
    if (level) { sql += ' AND level = ?'; params.push(level); }
    if (keyword) { sql += ' AND name LIKE ?'; params.push(`%${keyword}%`); }

    sql += ' ORDER BY level DESC, name ASC';
    const rows = await db.all(sql, params);
    return res.json({ total: rows.length, data: rows.map((row) => ({ ...row, id: Number(row.id) })) });
  } catch (error) { return next(error); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const db = await getDB();
    const university = await db.one("SELECT * FROM universities WHERE id = ? AND COALESCE(catalog_status,'active')='active'", [req.params.id]);
    if (!university) return res.status(404).json({ error: 'not found' });

    const [detail, photos, scores, requirements] = await Promise.all([
      db.one("SELECT * FROM uni_details WHERE university_id = ? AND COALESCE(catalog_status,'active')='active'", [university.id]),
      db.all("SELECT * FROM uni_photos WHERE university_id = ? AND COALESCE(catalog_status,'active')='active' ORDER BY id ASC", [university.id]),
      db.all("SELECT * FROM admission_scores WHERE university_id = ? AND COALESCE(catalog_status,'active')='active' ORDER BY year DESC", [university.id]),
      db.all("SELECT * FROM uni_requirements WHERE university_id = ? AND COALESCE(catalog_status,'active')='active' ORDER BY id ASC", [university.id]),
    ]);

    return res.json({
      ...university,
      id: Number(university.id),
      detail: detail && { ...detail, id: Number(detail.id), university_id: Number(detail.university_id) },
      photos: photos.map((row) => ({ ...row, id: Number(row.id), university_id: Number(row.university_id) })),
      scores: scores.map((row) => ({ ...row, id: Number(row.id), university_id: Number(row.university_id) })),
      requirements: requirements.map((row) => ({ ...row, id: Number(row.id), university_id: Number(row.university_id) })),
    });
  } catch (error) { return next(error); }
});

router.post('/', requireReferenceDataWriteToken, async (req, res, next) => {
  try {
    const db = await getDB();
    const { name, province, city, zone, level, type } = req.body || {};
    if (!name || !province || !zone || !level) return res.status(400).json({ error: 'missing fields' });
    await db.execute(`INSERT INTO universities(name, province, city, zone, level, type) VALUES (?,?,?,?,?,?)
      ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)`, [name, province, city || '', zone, level, type || '综合']);
    const university = await db.one('SELECT id,name,province,city,zone,level,type FROM universities WHERE name = ?', [name]);
    return res.status(201).json({ ...university, id: Number(university.id) });
  } catch (error) { return next(error); }
});

export default router;
