import { Router } from 'express';
import { getDB, save } from '../db/index.js';
import { requireAuthenticatedUser } from '../services/auth-service.js';
import { getPlansState, replacePlan } from '../services/plan-service.js';

const router = Router();

router.get('/', (req, res) => {
  const user = requireAuthenticatedUser(req, res);
  if (!user) return;
  return res.json({ plans: getPlansState(getDB(), user.id) });
});

router.put('/:planType', (req, res, next) => {
  try {
    const user = requireAuthenticatedUser(req, res);
    if (!user) return;
    const { plan, expectedRevision } = req.body || {};
    if (expectedRevision !== undefined && (!Number.isInteger(Number(expectedRevision)) || Number(expectedRevision) < 0)) {
      return res.status(400).json({ error: 'expectedRevision 必须是非负整数' });
    }
    const db = getDB();
    let nextState;
    db.transaction(() => {
      nextState = replacePlan(db, user.id, req.params.planType, plan, expectedRevision === undefined ? undefined : Number(expectedRevision));
    })();
    save();
    return res.json({ planType: req.params.planType, ...nextState });
  } catch (error) {
    return next(error);
  }
});

export default router;
