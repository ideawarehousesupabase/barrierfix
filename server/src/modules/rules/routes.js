import { Router } from 'express';
import { RULE_GROUP_LABELS } from '../../config/constants.js';
import { Rule } from '../../models/index.js';
import { ah } from '../../utils/http.js';

const router = Router();

// The adjustment library, grouped for browsing.
router.get(
  '/',
  ah(async (req, res) => {
    const filter = req.isPlatformAdmin && req.query.all === '1' ? {} : { active: true };
    const rules = await Rule.find(filter).sort({ group: 1, priority: 1, code: 1 });
    res.json({ rules, groups: RULE_GROUP_LABELS });
  }),
);

export async function ruleMap() {
  const rules = await Rule.find({});
  return new Map(rules.map((r) => [r.code, r]));
}

export default router;
