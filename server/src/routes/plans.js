import { Router } from 'express';
import { getDB } from '../db/index.js';
import { requireAuthenticatedUser } from '../services/auth-service.js';
import { getPlansState, replacePlan } from '../services/plan-service.js';

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const db = await getDB();
    const user = await requireAuthenticatedUser(req, res, db);
    if (!user) return;
    return res.json({ plans: await getPlansState(db, user.id) });
  } catch (error) {
    next(error);
  }
});

router.put('/:planType', async (req, res, next) => {
  try {
    const db = await getDB();
    const user = await requireAuthenticatedUser(req, res, db);
    if (!user) return;
    const { plan, expectedRevision } = req.body || {};
    if (expectedRevision !== undefined && (!Number.isInteger(Number(expectedRevision)) || Number(expectedRevision) < 0)) {
      return res.status(400).json({ error: 'expectedRevision 必须是非负整数' });
    }
    // replacePlan uses conditional MySQL writes for optimistic concurrency.
    // Keeping this request out of a surrounding transaction avoids gap-lock
    // deadlocks when two clients create the user's first plan simultaneously.
    const nextState = await replacePlan(
      db,
      user.id,
      req.params.planType,
      plan,
      expectedRevision === undefined ? undefined : Number(expectedRevision),
    );
    return res.json({ planType: req.params.planType, ...nextState });
  } catch (error) {
    return next(error);
  }
});

export default router;
