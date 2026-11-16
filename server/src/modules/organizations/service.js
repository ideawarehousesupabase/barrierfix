import { config } from '../../config/env.js';
import { Organization, User } from '../../models/index.js';
import { conflict } from '../../utils/http.js';
import { createAccount } from '../users/service.js';

// Creates a company (it gets its Organisation ID, e.g. BF-000001) and its first Company Admin with a
// temporary password. Used by the Platform Admin, directly or when approving an account request.
export async function createOrgWithAdmin({ name, staffCount, sector, bankHolidayRegion, plan, admin, creator }) {
  if (await User.exists({ email: admin.email })) throw conflict('That email address already has a BarrierFix account');
  const org = await Organization.create({
    name,
    staffCount,
    sector,
    plan: plan || config.defaultPlan,
    createdBy: creator._id,
    settings: { bankHolidayRegion: bankHolidayRegion || 'england-and-wales' },
  });
  try {
    const account = await createAccount({
      org,
      creator,
      email: admin.email,
      name: admin.name || '',
      jobTitle: admin.jobTitle || '',
      roles: [...new Set(['admin', ...(admin.roles || [])])],
      emailDetails: Boolean(admin.emailDetails),
    });
    return { org, admin: account.user, temporaryPassword: account.temporaryPassword };
  } catch (err) {
    // No company is left behind without an admin.
    await Organization.deleteOne({ _id: org._id });
    throw err;
  }
}
