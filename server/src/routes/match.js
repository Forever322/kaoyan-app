import { Router } from 'express';
import { getDB } from '../db/index.js';

const router = Router();

router.get('/', (req, res) => {
    const db = getDB();
    const { score, degree, category, zone, limit } = req.query;

    if (!score || !degree || !category || !zone) {
        return res.status(400).json({ error: 'missing params: score, degree, category, zone' });
    }

    const userScore = Number(score);
    const maxResults = Math.min(Number(limit) || 50, 200);

    const nlRows = db.prepare(
        'SELECT year, score FROM national_lines WHERE degree=? AND category=? AND zone=? ORDER BY year DESC'
    ).all(degree, category, zone);

    const unis = db.prepare(`
    SELECT u.*, GROUP_CONCAT(a.year || ':' || a.score, ',') AS score_history
    FROM universities u
    LEFT JOIN admission_scores a ON a.university_id = u.id AND a.degree = ? AND a.category = ?
    WHERE u.zone = ?
    GROUP BY u.id
    ORDER BY u.level DESC, u.name ASC
  `).all(degree, category, zone);

    const results = unis.map(uni => {
        const scoreMap = {};
        if (uni.score_history) {
            uni.score_history.split(',').forEach(pair => {
                const [y, s] = pair.split(':');
                scoreMap[Number(y)] = Number(s);
            });
        }

        const recentScores = [2023, 2024, 2025, 2026].map(y => scoreMap[y]).filter(Boolean);
        const avgLine = recentScores.length
            ? Math.round(recentScores.reduce((a, b) => a + b, 0) / recentScores.length)
            : null;
        const diff = avgLine !== null ? userScore - avgLine : null;

        let verdict, sortPriority;
        if (diff === null) { verdict = 'no data'; sortPriority = 3; }
        else if (diff >= 15) { verdict = 'safe'; sortPriority = 1; }
        else if (diff >= 0) { verdict = 'likely'; sortPriority = 2; }
        else if (diff >= -15) { verdict = 'reach'; sortPriority = 3; }
        else { verdict = 'gap'; sortPriority = 4; }

        return {
            id: uni.id, name: uni.name, province: uni.province, city: uni.city,
            zone: uni.zone, level: uni.level, type: uni.type,
            scores: recentScores, avgLine, diff, verdict, sortPriority,
        };
    });

    results.sort((a, b) => a.sortPriority - b.sortPriority || a.name.localeCompare(b.name, 'zh'));

    const verdictCounts = {};
    results.forEach(r => { verdictCounts[r.verdict] = (verdictCounts[r.verdict] || 0) + 1; });

    res.json({
        query: { score: userScore, degree, category, zone },
        nationalLines: nlRows,
        total: results.length,
        verdictCounts,
        data: results.slice(0, maxResults),
    });
});

export default router;
