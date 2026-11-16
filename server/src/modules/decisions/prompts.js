import { DECISION_DISCLAIMER, DECISION_FACTORS } from '../../content/decisionFactors.js';
import { DecisionPromptSet } from '../../models/index.js';

// Version 1 is the draft wording shipped in content/decisionFactors.js. It is written to the
// database the first time it is needed; every later version is added by a Platform Admin.
async function ensureFirstVersion() {
  try {
    await DecisionPromptSet.create({ version: 1, effectiveFrom: new Date(0), changeNote: 'Initial draft wording, pending employment law review', createdBy: 'system', factors: DECISION_FACTORS, disclaimer: DECISION_DISCLAIMER });
  } catch (err) {
    if (err.code !== 11000) throw err;
  }
}

// The version new records use: the latest whose effective date has arrived.
export async function currentPromptSet(now = new Date()) {
  let set = await DecisionPromptSet.findOne({ effectiveFrom: { $lte: now } }).sort({ version: -1 });
  if (!set) {
    await ensureFirstVersion();
    set = await DecisionPromptSet.findOne({ effectiveFrom: { $lte: now } }).sort({ version: -1 });
  }
  return set;
}

// The wording a given record was completed with.
export async function promptSetFor(version) {
  return (version && (await DecisionPromptSet.findOne({ version }))) || currentPromptSet();
}

export async function listPromptSets() {
  await currentPromptSet();
  return DecisionPromptSet.find().sort({ version: -1 });
}

export async function addPromptSet({ factors, disclaimer, changeNote, effectiveFrom, by }) {
  const current = await currentPromptSet();
  const latest = await DecisionPromptSet.findOne().sort({ version: -1 });
  const byKey = new Map(factors.map((f) => [f.key, f]));
  // Keys and behaviour flags (cost estimate, "none identified", Access to Work) stay as coded; only the wording changes.
  const merged = DECISION_FACTORS.map((base) => {
    const edit = byKey.get(base.key);
    return { ...base, title: edit.title, prompt: edit.prompt, help: edit.help ?? base.help };
  });
  return DecisionPromptSet.create({
    version: latest.version + 1,
    effectiveFrom: effectiveFrom || new Date(),
    changeNote,
    createdBy: by,
    factors: merged,
    disclaimer: disclaimer || current.disclaimer,
  });
}
