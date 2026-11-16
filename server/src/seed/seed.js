// Seeds the adjustment library: npm run seed (add missing rules)
// or npm run seed -- --overwrite (also refresh wording from content/ruleLibrary.js).
import { connectDatabase, disconnectDatabase } from '../db/connect.js';
import { ensureRuleLibrary } from './rules.js';

const overwrite = process.argv.includes('--overwrite');
await connectDatabase();
const result = await ensureRuleLibrary({ overwrite });
console.log(`Rule library: ${result.added} added, ${result.updated} updated.`);
await disconnectDatabase();
process.exit(0);
