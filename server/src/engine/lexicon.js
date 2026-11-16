// Language data for the rule-based translation engine. Plain lists so the content
// team can review and extend them without touching engine logic.

export const STOPWORDS = new Set(
  `a about above after again against all am an and any are aren't as at be because been before being below between both but by
  can can't cannot could couldn't did didn't do does doesn't doing don't down during each few for from further had hadn't has
  hasn't have haven't having he he'd he'll he's her here here's hers herself him himself his how how's i i'd i'll i'm i've if in
  into is isn't it it's its itself let's me more most mustn't my myself of off on once only or other ought our ours ourselves out
  over own same shan't she she'd she'll she's should shouldn't so some such than that that's the their theirs them themselves
  then there there's these they they'd they'll they're they've this those through to too under until up very was wasn't we we'd
  we'll we're we've were weren't what what's when when's where where's which while who who's whom why why's with won't would
  wouldn't you you'd you'll you're you've your yours yourself yourselves will just also get got bit quick quickly really
  maybe perhaps please pls plz thanks thank cheers hi hey hello morning afternoon evening team ta ok okay great cool lovely`
    .split(/\s+/)
    .filter(Boolean),
);

export const PLEASANTRY_ONLY =
  /^(?:(?:hi|hey|hello|morning|good morning|afternoon|good afternoon|evening|thanks|thank you|thanks so much|many thanks|cheers|ta|nice one|great|brilliant|lovely|perfect|ok|okay|sure|no worries|lol|haha|appreciated|much appreciated)[\s,!.:;-]*)+(?:@?[A-Z][\w'-]*[\s,!.]*)?$/i;

// Base-form verbs that start an instruction ("Add the new numbers", "flag anything").
export const WORK_VERBS = new Set(
  `accept access add adjust agree allocate amend analyse analyze annotate answer apply approve archive arrange ask assess assign
  attach attend audit balance book brief bring build calculate call cancel capture change chase check choose circulate clarify
  clean clear close code collate collect come compare compile complete confirm connect consider contact continue coordinate copy
  correct cost create cut deal debug decide define delete deliver deploy describe design develop discuss do document download
  draft draw drop duplicate edit email enter estimate evaluate export extract fill file film finalise finalize find finish fix
  flag follow format forward gather generate get give go grab handle have help highlight hold identify implement import improve leave
  include inform input insert install investigate invite invoice issue join keep label launch lead let list load log look make
  manage map mark measure meet merge message migrate monitor move note notify open order organise organize outline pack pay phone
  pick pitch place plan polish post prepare present price print prioritise prioritize process produce proofread provide publish
  pull push put quote raise read rebook receive record redo reduce refactor refresh register remind remove rename renew reorder
  repair replace reply report request research reserve resolve respond restart restore review revise rewrite ring run save scan
  schedule scope search see select send set settle share ship shortlist show sign sketch sort source speak specify split start
  stop store storyboard structure submit summarise summarize supply support take talk tell test tidy track train transfer
  translate try turn type update upload use validate verify visit wireframe write`
    .split(/\s+/)
    .filter(Boolean),
);

// Words that can follow an imperative verb. Used to tell "and send it" (a new
// instruction) from "the deck, report and notes" (a list of nouns).
export const VERB_FOLLOWERS = new Set(
  `the a an this that these those it its them me us him her my our your his their some any all every each both up out over back
  through together to with in on off down about for by sure anything everything something nothing everyone someone anyone round
  around across into onto ahead last next new one two three more less few another quick first final latest whatever which what
  when where how if whether as again yourself`
    .split(/\s+/)
    .filter(Boolean),
);

export const PARTICLES = new Set(['together', 'up', 'out', 'over', 'back', 'off', 'through', 'in', 'down', 'on', 'around', 'round', 'ahead']);

export const REQUEST_PATTERNS = [
  /\b(?:can|could|would|will) you\b/i,
  /\bplease\b/i,
  /\b(?:i|we)(?:'d| would)? (?:need|want|like) (?:you|someone) to\b/i,
  /\byou(?:'ll)? (?:need|have|will need) to\b/i,
  /\bmake sure\b/i,
  /\bdon'?t forget\b/i,
  /\bremember to\b/i,
  /\bare you able to\b/i,
  /\bcan we get\b/i,
  /\bwould be (?:great|good|helpful|ideal) if you\b/i,
  /\bif you could\b/i,
  /\bneeds? to be (?:done|sent|finished|ready|completed|updated|booked)\b/i,
  /^\s*(?:action|to ?do|task)\s*:/i,
];

// Leading words that turn a request into a plain instruction ("Can you send..." -> "Send...").
export const REQUEST_WRAPPER =
  /^(?:(?:so|ok|okay|right|also|and|then|plus|but)[\s,]+)*(?:(?:please|pls|plz|kindly)\s+)?(?:(?:can|could|would|will) you(?:\s+(?:please|pls|plz|possibly|also|quickly|just))*\s+|(?:i|we)(?:'d| would)?\s+(?:need|want|like) you to\s+|you(?:'ll)? (?:need|have|will need) to\s+|are you able to\s+|is it possible (?:for you )?to\s+|would it be possible (?:for you )?to\s+|it would be (?:great|good|helpful|ideal) if you could\s+|if you could\s+|don'?t forget to\s+|remember to\s+|make sure (?:you|to)\s+|try to\s+|(?:please|pls|plz|kindly)\s+)+/i;

export const NEW_TASK_MARKER =
  /^(?:also|separately|another thing|one more thing|additionally|secondly|thirdly|lastly|finally|plus|on another note|oh,? and|and (?:also|separately)|ps|p\.s\.)\b[\s,:.-]*/i;

export const LEADING_CONNECTOR = /^(?:and then|and also|and|then|also|plus|but|so|after that|afterwards|next|finally|lastly)\b[\s,]*/i;

export const NEGATION = /\b(?:not|no|never|nothing|none|nobody|neither|nor|without|avoid|cannot)\b|n['’]t\b/gi;

export const VAGUE_DEADLINE =
  /\b(?:asap|a\.s\.a\.p\.?|as soon as (?:possible|you can|you're able|you are able)|when(?:ever)? you (?:can|get (?:a )?(?:chance|minute|moment)|have (?:a )?(?:chance|minute|moment|time))|at your earliest convenience|soon(?:ish)?|urgent(?:ly)?|at some point|sometime|in due course|no rush)\b/i;

export const EVENT_WORDS =
  /\b(?:meeting|call|catch[- ]?up|stand[- ]?up|1:1|one[- ]to[- ]one|session|workshop|interview|demo|presentation|webinar|lunch|appointment|sync|huddle|kick[- ]?off|review meeting|training)\b/i;

export const DEADLINE_KEYWORD =
  /\b(?:by|before|due|until|till|til|no later than|deadline(?:\s+(?:is|of))?|ahead of|for|latest|on|at)\s+(?:the\s+)?(?:end of\s+)?$/i;

// Irregular past participles for the "Done when: you have ..." line.
export const IRREGULAR_PARTICIPLES = {
  be: 'been', begin: 'begun', bring: 'brought', build: 'built', buy: 'bought', catch: 'caught', choose: 'chosen', come: 'come',
  cut: 'cut', deal: 'dealt', do: 'done', draw: 'drawn', drive: 'driven', find: 'found', get: 'got', give: 'given', go: 'gone',
  grow: 'grown', have: 'had', hold: 'held', keep: 'kept', know: 'known', lay: 'laid', lead: 'led', leave: 'left', lend: 'lent',
  let: 'let', make: 'made', meet: 'met', pay: 'paid', put: 'put', read: 'read', ring: 'rung', run: 'run', say: 'said',
  see: 'seen', sell: 'sold', send: 'sent', set: 'set', show: 'shown', sign: 'signed', speak: 'spoken', spend: 'spent',
  split: 'split', take: 'taken', teach: 'taught', tell: 'told', think: 'thought', throw: 'thrown', understand: 'understood',
  write: 'written', rewrite: 'rewritten', redo: 'redone', proofread: 'proofread', forward: 'forwarded', commit: 'committed',
  submit: 'submitted', permit: 'permitted', refer: 'referred', prefer: 'preferred', control: 'controlled', label: 'labelled',
  cancel: 'cancelled', travel: 'travelled', model: 'modelled', total: 'totalled', fill: 'filled', film: 'filmed',
  sketch: 'sketched', stop: 'stopped', plan: 'planned', flag: 'flagged', ship: 'shipped', drop: 'dropped', map: 'mapped',
  chat: 'chatted', tidy: 'tidied', copy: 'copied', reply: 'replied', apply: 'applied', supply: 'supplied', try: 'tried',
  verify: 'verified', notify: 'notified', clarify: 'clarified', identify: 'identified', specify: 'specified', type: 'typed',
};

// CM1 plain language: idioms and office jargon with a plain alternative.
export const PLAIN_LANGUAGE = [
  ['circle back', 'talk again'],
  ['circling back', 'following up'],
  ['touch base', 'check in'],
  ['touching base', 'checking in'],
  ['touched base', 'checked in'],
  ['ping me', 'message me'],
  ['ping over', 'send'],
  ['shoot me an email', 'email me'],
  ['shoot me a message', 'message me'],
  ['keep me in the loop', 'keep me updated'],
  ['keep (\\w+) in the loop', 'keep $1 updated'],
  ['loop (\\w+) in', 'include $1'],
  ['loop in', 'include'],
  ['close the loop', 'confirm it is finished'],
  ['low[- ]hanging fruit', 'easiest tasks'],
  ['bandwidth', 'time'],
  ['a deep dive (?:into|on)', 'a detailed look at'],
  ['deep dive (?:into|on)', 'look in detail at'],
  ['drill down (?:into|on)', 'look in more detail at'],
  ['on my radar', 'something I know about'],
  ['move the needle', 'make a real difference'],
  ['ballpark (?:figure|number|estimate)', 'rough estimate'],
  ['run (?:it|this) (?:by|past)', 'check it with'],
  ['get the ball rolling', 'get started'],
  ['hit the ground running', 'start quickly'],
  ['give me a heads[- ]up', 'tell me in advance'],
  ['heads[- ]up', 'advance notice'],
  ['leverage', 'use'],
  ['utili[sz]e', 'use'],
  ['facilitate', 'help with'],
  ['going forward', 'from now on'],
  ['moving forward', 'from now on'],
  ['at your earliest convenience', 'as soon as you can'],
  ['take (?:this|it) offline', 'discuss this separately'],
  ['quick sync', 'short meeting'],
  ['sync up', 'meet'],
  ['quick wins', 'easy improvements'],
  ['quick win', 'easy improvement'],
  ['park (?:this|it) for now', 'pause this for now'],
  ['flesh out', 'add more detail to'],
  ['action (?:this|that|it)', 'do this'],
  ['tee up', 'prepare'],
  ['wrap up', 'finish'],
  ['sense[- ]check', 'check'],
  ['eyeball', 'look over'],
  ['get your ducks in a row', 'get everything organised'],
  ['in the pipeline', 'planned'],
  ['touch on', 'mention'],
  ['bottom line', 'main point'],
  ['have a stab at', 'try'],
  ['take a stab at', 'try'],
  ['get your head around', 'understand'],
  ['bring (\\w+) up to speed', 'update $1'],
  ['up to speed', 'up to date'],
  ['hard stop', 'fixed end time'],
  ['on the back burner', 'paused for now'],
  ['top of mind', 'a priority'],
  ['reach out to', 'contact'],
  ['reaching out to', 'contacting'],
  ['reached out to', 'contacted'],
  ['pick (?:this|it) up', 'take this on'],
  ['run with (?:this|it)', 'take this on'],
  ['the long and short of it', 'in summary'],
];

// CM3 abbreviations. "explain" keeps the abbreviation and adds the meaning in
// brackets; "replace" swaps informal shorthand for the full word.
export const ABBREVIATIONS = [
  ['ASAP', 'as soon as possible', 'explain'],
  ['EOD', 'end of day', 'explain'],
  ['COB', 'close of business', 'explain'],
  ['EOP', 'end of play', 'explain'],
  ['EOW', 'end of week', 'explain'],
  ['EOM', 'end of month', 'explain'],
  ['FYI', 'for your information', 'explain'],
  ['ETA', 'when it will be ready', 'explain'],
  ['WIP', 'work in progress', 'explain'],
  ['TBC', 'to be confirmed', 'explain'],
  ['TBD', 'to be decided', 'explain'],
  ['OOO', 'out of office', 'explain'],
  ['AFAIK', 'as far as I know', 'explain'],
  ['IMO', 'in my opinion', 'explain'],
  ['KPIs', 'key performance indicators', 'explain'],
  ['KPI', 'key performance indicator', 'explain'],
  ['ROI', 'return on investment', 'explain'],
  ['QA', 'quality check', 'explain'],
  ['BAU', 'business as usual', 'explain'],
  ['AOB', 'any other business', 'explain'],
  ['SLA', 'service level agreement', 'explain'],
  ['CTA', 'call to action', 'explain'],
  ['SOW', 'statement of work', 'explain'],
  ['PO', 'purchase order', 'explain'],
  ['WFH', 'working from home', 'explain'],
  ['SLT', 'senior leadership team', 'explain'],
  ['YTD', 'year to date', 'explain'],
  ['P&L', 'profit and loss', 'explain'],
  ['OKRs', 'objectives and key results', 'explain'],
  ['OKR', 'objective and key result', 'explain'],
  ['RFP', 'request for proposal', 'explain'],
  ['NDA', 'non-disclosure agreement', 'explain'],
  ['PTO', 'time off', 'explain'],
  ['TLDR', 'short summary', 'explain'],
  ['TL;DR', 'short summary', 'explain'],
  ['N/A', 'not applicable', 'explain'],
  ['w/c', 'week commencing', 'explain'],
  ['1:1', 'one-to-one meeting', 'explain'],
  ['approx', 'approximately', 'replace'],
  ['pls', 'please', 'replace'],
  ['plz', 'please', 'replace'],
  ['thx', 'thanks', 'replace'],
  ['e.g.', 'for example', 'replace'],
  ['i.e.', 'that is', 'replace'],
];
