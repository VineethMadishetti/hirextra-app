import { computeCandidateCompleteness, extractExperienceYears } from './candidateProfileNormalizer.js';

const SKILL_ALIASES = {
  javascript: ['js', 'javascript', 'ecmascript', 'es6', 'es2015'],
  typescript: ['ts', 'typescript'],
  'node.js': ['nodejs', 'node', 'node.js'],
  react: ['reactjs', 'react.js', 'react js'],
  'react native': ['react-native', 'reactnative'],
  angular: ['angularjs', 'angular.js', 'angular 2+'],
  vue: ['vuejs', 'vue.js'],
  'next.js': ['nextjs', 'next js'],
  postgresql: ['postgres', 'postgresql', 'psql'],
  mongodb: ['mongo', 'mongodb'],
  mysql: ['mysql', 'my sql'],
  aws: ['amazon web services', 'aws'],
  gcp: ['google cloud', 'gcp', 'google cloud platform'],
  azure: ['microsoft azure', 'azure'],
  docker: ['docker', 'containerization'],
  kubernetes: ['k8s', 'kubernetes'],
  graphql: ['graphql', 'graph ql'],
  'rest api': ['rest', 'restful', 'rest api', 'restful api'],
  python: ['python', 'python3', 'python 3'],
  java: ['java', 'java8', 'java 8', 'java 11', 'java 17'],
  'spring boot': ['spring boot', 'springboot', 'spring-boot'],
  django: ['django', 'django rest framework', 'drf'],
  fastapi: ['fastapi', 'fast api'],
  redis: ['redis', 'redis cache'],
  elasticsearch: ['elasticsearch', 'elastic search', 'es'],
  // Data integration & ETL tools
  'oracle data integrator': ['odi', 'oracle data integration', 'oracle di'],
  'azure data factory': ['adf', 'azure data factory'],
  'sql server integration services': ['ssis', 'sql server integration'],
  'sql server reporting services': ['ssrs'],
  'sql server analysis services': ['ssas'],
  snaplogic: ['snap logic', 'snaplogic'],
  informatica: ['informatica powercenter', 'iics', 'informatica cloud', 'informatica idmc'],
  talend: ['talend open studio', 'talend data integration'],
  mulesoft: ['mule esb', 'anypoint platform', 'mule', 'mulesoft anypoint'],
  boomi: ['dell boomi', 'boomi atomsphere'],
  kafka: ['apache kafka', 'kafka streaming'],
  spark: ['apache spark', 'pyspark', 'spark streaming'],
  databricks: ['databricks', 'databricks notebooks'],
  snowflake: ['snowflake dw', 'snowflake data warehouse'],
  dbt: ['dbt core', 'data build tool'],
  airflow: ['apache airflow', 'airflow dag'],
  nifi: ['apache nifi'],
  pentaho: ['pentaho data integration', 'kettle'],
  'azure synapse': ['azure synapse analytics', 'synapse analytics'],
  'google bigquery': ['bigquery', 'bq'],
  'amazon redshift': ['redshift'],
  'power bi': ['powerbi', 'power bi desktop'],
  tableau: ['tableau desktop', 'tableau server'],
  sap: ['sap hana', 'sap bw', 'sap bo', 'sap business objects'],
  oracle: ['oracle database', 'oracle db', 'oracle 19c', 'oracle 12c'],
  teradata: ['teradata sql'],
  // Cloud & DevOps
  'google cloud': ['gcp', 'google cloud platform'],
  'amazon web services': ['aws', 'amazon aws'],
  'microsoft azure': ['azure', 'ms azure'],
  terraform: ['terraform iac', 'hashicorp terraform'],
  ansible: ['ansible automation'],
  jenkins: ['jenkins ci', 'jenkins pipeline'],
  gitlab: ['gitlab ci', 'gitlab ci/cd'],
  // Languages
  scala: ['scala lang'],
  golang: ['go lang', 'go programming'],
  'c#': ['csharp', 'c sharp', '.net c#'],
  '.net': ['dotnet', '.net core', 'asp.net'],
};

const LOCATION_SYNONYMS = {
  bangalore:   ['bengaluru', 'bangalore'],
  bengaluru:   ['bengaluru', 'bangalore'],
  delhi:       ['delhi', 'new delhi'],
  'new delhi': ['delhi', 'new delhi'],
  mumbai:      ['mumbai', 'bombay'],
  bombay:      ['mumbai', 'bombay'],
  chennai:     ['chennai', 'madras'],
  madras:      ['chennai', 'madras'],
  kolkata:     ['kolkata', 'calcutta'],
  calcutta:    ['kolkata', 'calcutta'],
  hyderabad:   ['hyderabad'],
  pune:        ['pune'],
  gurgaon:     ['gurgaon', 'gurugram'],
  gurugram:    ['gurgaon', 'gurugram'],
  noida:       ['noida'],
  ahmedabad:   ['ahmedabad'],
  jaipur:      ['jaipur'],
  kochi:       ['kochi', 'cochin'],
  cochin:      ['kochi', 'cochin'],
  coimbatore:  ['coimbatore'],
  nagpur:      ['nagpur'],
  indore:      ['indore'],
  chandigarh:  ['chandigarh'],
  london:      ['london'],
  berlin:      ['berlin'],
  toronto:     ['toronto'],
  sydney:      ['sydney'],
  singapore:   ['singapore'],
  dubai:       ['dubai'],
  amsterdam:   ['amsterdam'],
  'new york':  ['new york', 'nyc'],
  nyc:         ['new york', 'nyc'],
  'san francisco': ['san francisco', 'sf', 'bay area'],
  seattle:     ['seattle'],
  austin:      ['austin'],
};

// Weights per matched skill — must-have >> required >> preferred.
// Location is mandatory (gates search params) but adds 0 score points.
const WEIGHT = {
  mustHave: 60,  // 12× preferred — any missing must-have already disqualifies
  required: 15,  // 3× preferred
  preferred: 5,
};

function skillAliasSet(skill) {
  const lower = String(skill || '').toLowerCase().trim();
  const set = new Set([lower]);

  const direct = SKILL_ALIASES[lower];
  if (direct) direct.forEach((alias) => set.add(alias.toLowerCase()));

  for (const [canonical, aliases] of Object.entries(SKILL_ALIASES)) {
    if (aliases.map((alias) => alias.toLowerCase()).includes(lower)) {
      set.add(canonical);
      aliases.forEach((alias) => set.add(alias.toLowerCase()));
    }
  }

  return set;
}

function skillMatches(candidateSkills, requiredSkill, aiAliases = {}) {
  if (!requiredSkill) return false;

  const haystack = Array.isArray(candidateSkills)
    ? candidateSkills.join(' ').toLowerCase()
    : String(candidateSkills || '').toLowerCase();

  if (!haystack) return false;

  // Build alias set: hardcoded SKILL_ALIASES first, then AI-generated aliases on top
  const aliases = skillAliasSet(requiredSkill);
  const aiExtras = aiAliases[requiredSkill] || aiAliases[requiredSkill.toLowerCase()] || [];
  for (const extra of aiExtras) {
    const e = String(extra || '').toLowerCase().trim();
    if (e) aliases.add(e);
  }

  for (const alias of aliases) {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(?:^|[\\s,/|.+#])${escaped}(?:$|[\\s,/|.+#])`, 'i');
    if (regex.test(` ${haystack} `)) return true;
  }

  return false;
}


export function locationMatches(candidateLocation, requiredLocation) {
  if (!requiredLocation || /unspecified|not specified|remote/i.test(requiredLocation)) return true;
  if (!candidateLocation) return false;

  const candLow = String(candidateLocation).toLowerCase();
  const cities = String(requiredLocation)
    .split(/\s*[\/|;]\s*|\s+or\s+/i)
    .map((part) => part.split(',')[0].trim().toLowerCase())
    .filter(Boolean);

  for (const city of cities) {
    const variants = LOCATION_SYNONYMS[city] || [city];
    if (variants.some((variant) => candLow.includes(variant))) return true;
  }

  return false;
}

function parseExperienceYears(exp) {
  return extractExperienceYears(exp);
}

// 0=intern/junior  1=mid  2=senior  3=lead  4=principal  5=director+  -1=unknown
function extractSeniorityLevel(text) {
  const t = String(text || '').toLowerCase();
  if (/\b(vp|vice president|director|head of|chief|cto|ceo|cfo|coo)\b/.test(t)) return 5;
  if (/\b(principal|staff|architect)\b/.test(t)) return 4;
  if (/\b(lead|manager)\b/.test(t)) return 3;
  if (/\b(senior|sr\.?)\b/.test(t)) return 2;
  if (/\b(mid[- ]?level|mid)\b/.test(t)) return 1;
  if (/\b(junior|jr\.?|intern|associate|fresher|trainee|entry[- ]?level)\b/.test(t)) return 0;
  return -1;
}

// Extract skills from a headline like "Python | Java | Node.js | React.js | Enthusiast"
// Splits on | , ; · and keeps tokens that look like tech skills (≤ 4 words, no filler phrases).
const HEADLINE_FILLER = /\b(enthusiast|passionate|about|lover|aspiring|fresher|learner|seeker|looking|open|to|work|hire|and|with|for|at|in|the|a|an)\b/i;
function extractSkillsFromHeadline(headline) {
  if (!headline) return [];
  return headline
    .split(/[|,;·\-–]+/)
    .map(t => t.trim())
    .filter(t => {
      if (!t || t.length < 2) return false;
      const words = t.split(/\s+/);
      if (words.length > 4) return false;               // long phrases are job titles/descriptions
      if (HEADLINE_FILLER.test(t) && words.length === 1) return false; // single filler words
      if (/^\d+$/.test(t)) return false;                // pure numbers
      return true;
    });
}

// Extract known skills from free-form `about` text by matching against SKILL_ALIASES keys.
function extractSkillsFromAbout(about) {
  if (!about) return [];
  const found = [];
  for (const canonicalSkill of Object.keys(SKILL_ALIASES)) {
    if (skillMatches(about, canonicalSkill)) {
      found.push(canonicalSkill);
    }
  }
  return found;
}

// Merge skills from headline + about into candidate.skills (deduplicated, case-preserved).
function mergeImpliedSkills(candidate) {
  const existing = Array.isArray(candidate.skills)
    ? candidate.skills
    : String(candidate.skills || '').split(/[,;|·]+/).map(s => s.trim()).filter(Boolean);
  const fromHeadline = extractSkillsFromHeadline(candidate.headline || '');
  const fromAbout    = extractSkillsFromAbout(candidate.about || '');
  const extra = [...fromHeadline, ...fromAbout];
  if (extra.length === 0) return existing;
  const existingLower = new Set(existing.map(s => s.toLowerCase()));
  const novel = extra.filter(s => !existingLower.has(s.toLowerCase()));
  return [...existing, ...novel];
}

// Build a haystack from the most recent 1–2 experienceTimeline entries
function getRecentHaystack(candidate) {
  const timeline = Array.isArray(candidate.experienceTimeline) ? candidate.experienceTimeline : [];
  if (timeline.length === 0) return '';
  return timeline
    .slice(0, 2)
    .map(e => [e.title, e.company, e.description].filter(Boolean).join(' '))
    .join(' ')
    .toLowerCase();
}

function sortValue(candidate) {
  const hasEmail = Boolean(candidate.contact?.email || candidate.email);
  const hasPhone = Boolean(candidate.contact?.phone || candidate.phone);
  const completeness = computeCandidateCompleteness(candidate);
  const expYears = parseExperienceYears(candidate.experienceYears || candidate.totalExperience || candidate.experience);
  const mustHaveCount = candidate.matchedMustHave?.length || 0;
  const requiredCount = candidate.matchedRequired?.length || 0;
  const preferredCount = candidate.matchedPreferred?.length || 0;

  // Recency: count skills found in the most recent 1–2 jobs as a tiebreaker.
  // (Skills are already on the candidate object from scoreCandidate — no re-computation needed.)
  const recentHaystack = getRecentHaystack(candidate);
  const recentScore = recentHaystack
    ? (candidate.matchedMustHave || []).filter(s => skillMatches(recentHaystack, s)).length * 3
      + (candidate.matchedRequired || []).filter(s => skillMatches(recentHaystack, s)).length
    : 0;

  // Primary: match score · Secondary: must-have → required → preferred → recency → completeness → contact
  return (
    (Number(candidate.matchScore) || 0) * 100000 +
    mustHaveCount * 5000 +
    requiredCount * 1000 +
    preferredCount * 200 +
    recentScore * 50 +
    completeness * 10 +
    (hasEmail ? 8 : 0) +
    (hasPhone ? 5 : 0) +
    expYears
  );
}

export function scoreCandidate(candidate, requirements) {
  const req = requirements || {};

  const mustHaveSkills = Array.isArray(req.must_have_skills)
    ? req.must_have_skills
    : Array.isArray(req.mustHaveSkills)
      ? req.mustHaveSkills
      : [];
  const requiredSkills = Array.isArray(req.required_skills)
    ? req.required_skills
    : Array.isArray(req.requiredSkills)
      ? req.requiredSkills
      : [];
  const preferredSkills = Array.isArray(req.preferred_skills)
    ? req.preferred_skills
    : Array.isArray(req.preferredSkills)
      ? req.preferredSkills
      : [];
  const reqLocation    = String(req.location || '');
  const reqExpYears    = Number(req.experience_years    || req.experienceYears    || 0);
  const reqMaxExpYears = Number(req.max_experience_years || req.maxExperienceYears || 0);

  const skillsArr = Array.isArray(candidate.skills)
    ? candidate.skills
    : String(candidate.skills || '').split(/[,;|·]+/).map((skill) => skill.trim()).filter(Boolean);

  // Build full-profile text from all structured sections so skills mentioned only in
  // experience descriptions or certifications are not missed.
  const experienceText = (Array.isArray(candidate.experienceTimeline) ? candidate.experienceTimeline : [])
    .map(e => [e.title, e.company, e.description, Array.isArray(e.skills) ? e.skills.join(' ') : ''].filter(Boolean).join(' '))
    .join(' ');
  const certText = (Array.isArray(candidate.certifications) ? candidate.certifications : [])
    .map(c => [c.name, c.issuer, c.description].filter(Boolean).join(' '))
    .join(' ');

  // strictHaystack: used for must-have AND gate.
  // Includes skills + title + headline + about + all experience + certifications.
  // "strict" means we trust everything on a LinkedIn profile — not just the skills array —
  // because candidates routinely list tools only in job descriptions, not the skills section.
  const strictHaystack = [
    ...skillsArr,
    String(candidate.jobTitle || candidate.title || ''),
    String(candidate.headline || ''),
    String(candidate.about || ''),
    experienceText,
    certText,
  ].join(' ');

  // broadHaystack: required + preferred scoring — also include snippet/summary
  const broadHaystack = [
    strictHaystack,
    String(candidate.snippet || ''),
  ].join(' ');

  const candidateLocation = String(candidate.location || candidate.locality || '');
  const candidateExp = candidate.experience || candidate.totalExperience || candidate.experienceYears || 0;

  // AI-generated skill aliases from the parsed JD (works for any domain/language)
  const aiAliases = (req.skill_aliases && typeof req.skill_aliases === 'object') ? req.skill_aliases : {};

  // AND gate: ALL must-have skills must appear in strict haystack
  const matchedMustHave = mustHaveSkills.filter((skill) => skillMatches(strictHaystack, skill, aiAliases));
  const missingMustHave = mustHaveSkills.filter((skill) => !skillMatches(strictHaystack, skill, aiAliases));

  // Deduplicate required: remove skills already in must_have so they are not double-counted.
  // GPT typically puts must-have skills in both lists; scoring them twice inflates scores
  // and makes the requiredFail threshold trivially easy to pass via must-have matches alone.
  const mustHaveSet = new Set(mustHaveSkills.map((s) => s.toLowerCase()));
  const dedupRequired = requiredSkills.filter((s) => !mustHaveSet.has(s.toLowerCase()));
  const dedupPreferred = preferredSkills.filter((s) => !mustHaveSet.has(s.toLowerCase()));

  // OR gate: required skills (excluding must-haves)
  const matchedRequired = dedupRequired.filter((skill) => skillMatches(broadHaystack, skill, aiAliases));
  const missingRequired = dedupRequired.filter((skill) => !skillMatches(broadHaystack, skill, aiAliases));

  // Preferred: scoring bonus only (also deduplicated)
  const matchedPreferred = dedupPreferred.filter((skill) => skillMatches(broadHaystack, skill, aiAliases));

  const locMatch = locationMatches(candidateLocation, reqLocation);
  const candExpYears = parseExperienceYears(candidateExp);
  const expMatch = reqExpYears > 0 ? candExpYears >= reqExpYears : true;

  // AND gate: any missing must-have → disqualify
  const mustHaveFail = mustHaveSkills.length > 0 && missingMustHave.length > 0;
  // Threshold gate: fewer than 40% of required skills (excl. must-haves) matched → disqualify
  const REQUIRED_THRESHOLD = 0.40;
  const requiredMatchRatio = dedupRequired.length > 0 ? matchedRequired.length / dedupRequired.length : 1;
  const requiredFail = dedupRequired.length > 0 && requiredMatchRatio < REQUIRED_THRESHOLD;
  // Experience range gate: only fires when candidate experience is known (> 0).
  // Too junior: more than 1 year below the minimum — hard disqualify.
  // Too senior: more than 2 years above the max (if a max was specified) — hard disqualify.
  const tooJunior = candExpYears > 0 && reqExpYears > 0 && candExpYears < reqExpYears - 1;
  const tooSenior = candExpYears > 0 && reqMaxExpYears > 0 && candExpYears > reqMaxExpYears + 2;
  const expFail = tooJunior || tooSenior;
  // Availability gate — only fires when JD explicitly requires IMMEDIATE joiners.
  // UNKNOWN candidates get benefit of the doubt (most profiles don't state availability).
  const reqAvailability  = String(req.availability || 'ANY').toUpperCase();
  const candAvailability = String(candidate.availability || 'UNKNOWN').toUpperCase();
  const availFail = reqAvailability === 'IMMEDIATE' &&
    candAvailability !== 'IMMEDIATE' &&
    candAvailability !== 'UNKNOWN';

  const disqualified = mustHaveFail || requiredFail || expFail || availFail;

  // ── Score calculation ─────────────────────────────────────────────────────
  // Rule: 100% = has ALL must-have skills + ALL required skills.
  // Preferred skills are a small bonus ON TOP — they never reduce the score.
  // Recency is used only for sort ordering, not the displayed percentage.
  //
  // maxPossible is based on must-have + required ONLY (not preferred),
  // so a candidate who has every critical skill always reaches 100%.

  const basePossible =
    mustHaveSkills.length * WEIGHT.mustHave +
    dedupRequired.length  * WEIGHT.required;

  const baseRaw =
    matchedMustHave.length * WEIGHT.mustHave +
    matchedRequired.length * WEIGHT.required;

  // If no skill requirements at all, everyone scores 100 (no constraint to measure against).
  const baseScore = basePossible > 0 ? Math.round((baseRaw / basePossible) * 100) : 100;

  // Preferred skills add a small fixed bonus (max 5 pts) — they must NEVER compensate
  // for missing required skills or push a weak candidate above a strong one.
  const preferredBonus = baseScore < 100 && matchedPreferred.length > 0 ? Math.min(5, matchedPreferred.length * 2) : 0;

  const score = Math.min(100, baseScore + preferredBonus);

  // Store pts for sorting tiebreaker (recency still used in sortValue via matchedMustHave count)
  const mustHavePts  = matchedMustHave.length  * WEIGHT.mustHave;
  const requiredPts  = matchedRequired.length  * WEIGHT.required;
  const preferredPts = matchedPreferred.length * WEIGHT.preferred;

  let matchCategory;
  if (score >= 90) matchCategory = 'PERFECT';
  else if (score >= 70) matchCategory = 'STRONG';
  else if (score >= 50) matchCategory = 'GOOD';
  else if (score >= 30) matchCategory = 'PARTIAL';
  else matchCategory = 'WEAK';

  return {
    score,
    matchCategory,
    matchedMustHave,
    missingMustHave,
    matchedRequired,
    missingRequired,
    matchedPreferred,
    locationMatch: locMatch,
    experienceMatch: expMatch,
    breakdown: { mustHavePts, requiredPts, preferredPts, locationPts: 0, experiencePts: 0 },
    disqualified,
  };
}

export function scoreCandidates(candidates, requirements, options = {}) {
  const { minScore = 0, excludeDisqualified = true } = options;

  return candidates
    .map((candidate) => {
      const result = scoreCandidate(candidate, requirements);
      // All skills the scorer identified (from headline, about, experience, skills box)
      // must be visible in the UI skill boxes — merge them into the skills array.
      const baseSkills = mergeImpliedSkills(candidate);
      const scorerIdentified = [...result.matchedMustHave, ...result.matchedRequired, ...result.matchedPreferred];
      const baseSkillsLower = new Set(baseSkills.map(s => s.toLowerCase()));
      const extraFromScorer = scorerIdentified.filter(s => !baseSkillsLower.has(s.toLowerCase()));
      const mergedSkills = [...new Set([...baseSkills, ...extraFromScorer])];
      return {
        ...candidate,
        skills: mergedSkills,
        matchScore: result.score,
        matchCategory: result.matchCategory,
        matchedMustHave: result.matchedMustHave,
        matchedRequired: result.matchedRequired,
        matchedPreferred: result.matchedPreferred,
        matchedSkills: [...new Set([...result.matchedMustHave, ...result.matchedRequired, ...result.matchedPreferred])],
        missingSkills: [...new Set([...result.missingMustHave, ...result.missingRequired])],
        locationMatch: result.locationMatch,
        experienceMatch: result.experienceMatch,
        scoreBreakdown: result.breakdown,
        disqualified: result.disqualified,
      };
    })
    .filter((candidate) => {
      if (excludeDisqualified && candidate.disqualified) return false;
      return candidate.matchScore >= minScore;
    })
    .sort((a, b) => sortValue(b) - sortValue(a));
}

export function bucketByMatchCategory(scoredCandidates) {
  const buckets = { perfect: [], strong: [], good: [], partial: [], weak: [] };
  for (const candidate of scoredCandidates) {
    const key = (candidate.matchCategory || 'WEAK').toLowerCase();
    if (buckets[key]) buckets[key].push(candidate);
    else buckets.weak.push(candidate);
  }
  return buckets;
}

export default {
  bucketByMatchCategory,
  locationMatches,
  scoreCandidate,
  scoreCandidates,
};
