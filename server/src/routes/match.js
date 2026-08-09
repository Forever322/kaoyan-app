import { Router } from 'express';
import { getDB } from '../db/index.js';

export function createMatchRouter({ database = getDB } = {}) {
  const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const db = await database();
    const { score, degree, category, zone, limit } = req.query;
    if (!score || !degree || !category || !zone) {
      return res.status(400).json({ error: 'missing params: score, degree, category, zone' });
    }

    const userScore = Number(score);
    const maxResults = Math.min(Number(limit) || 50, 200);
    const [nationalLines, universities] = await Promise.all([
      db.all('SELECT year, score FROM national_lines WHERE degree=? AND category=? AND zone=? ORDER BY year DESC', [degree, category, zone]),
      db.all(`SELECT u.*, GROUP_CONCAT(CONCAT(a.year, ':', a.score) ORDER BY a.year DESC SEPARATOR ',') AS score_history
        FROM universities u
        LEFT JOIN admission_scores a ON a.university_id = u.id AND a.degree = ? AND a.category = ?
          AND COALESCE(a.catalog_status,'active')='active'
        WHERE u.zone = ? AND COALESCE(u.catalog_status,'active')='active'
        GROUP BY u.id
        ORDER BY u.level DESC, u.name ASC`, [degree, category, zone]),
    ]);

    const results = universities.map((university) => {
      const scoreMap = {};
      if (university.score_history) {
        university.score_history.split(',').forEach((pair) => {
          const [year, line] = pair.split(':');
          scoreMap[Number(year)] = Number(line);
        });
      }
      const recentScores = [2023, 2024, 2025, 2026].map((year) => scoreMap[year]).filter(Boolean);
      const avgLine = recentScores.length ? Math.round(recentScores.reduce((total, line) => total + line, 0) / recentScores.length) : null;
      const diff = avgLine === null ? null : userScore - avgLine;
      let verdict;
      let sortPriority;
      if (diff === null) { verdict = 'no data'; sortPriority = 3; }
      else if (diff >= 15) { verdict = 'safe'; sortPriority = 1; }
      else if (diff >= 0) { verdict = 'likely'; sortPriority = 2; }
      else if (diff >= -15) { verdict = 'reach'; sortPriority = 3; }
      else { verdict = 'gap'; sortPriority = 4; }
      return {
        id: Number(university.id), name: university.name, province: university.province, city: university.city,
        zone: university.zone, level: university.level, type: university.type,
        scores: recentScores, avgLine, diff, verdict, sortPriority,
      };
    });

    results.sort((left, right) => left.sortPriority - right.sortPriority || left.name.localeCompare(right.name, 'zh'));
    const verdictCounts = {};
    results.forEach((result) => { verdictCounts[result.verdict] = (verdictCounts[result.verdict] || 0) + 1; });

    return res.json({
      query: { score: userScore, degree, category, zone },
      nationalLines: nationalLines.map((row) => ({ year: Number(row.year), score: Number(row.score) })),
      total: results.length,
      verdictCounts,
      data: results.slice(0, maxResults),
    });
  } catch (error) { return next(error); }
});

  return router;
}

export default createMatchRouter();
