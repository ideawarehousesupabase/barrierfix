import { AuditLog } from '../models/index.js';

// Writes one append-only audit entry. Accepts an Express request or a plain actor.
// With `strict`, a failed write is thrown instead of logged, for events that must never go unrecorded.
export async function audit(actor, action, { entity, entityId, meta, orgId, strict = false } = {}) {
  try {
    const user = actor?.user || actor;
    await AuditLog.create({
      orgId: orgId || user?.orgId || null,
      actorId: user?._id || null,
      actorEmail: user?.email || (typeof actor === 'string' ? actor : 'system'),
      action,
      entity,
      entityId: entityId ? String(entityId) : undefined,
      meta: meta || {},
      ip: actor?.ip,
    });
  } catch (err) {
    if (strict) throw err;
    console.error('[audit] failed to write entry:', err.message);
  }
}
