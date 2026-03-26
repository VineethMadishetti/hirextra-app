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

function skillMatches(candidateSkills, requiredSkill) {
  if (!requiredSkill) return false;

  const haystack = Array.isArray(candidateSkills)
    ? candidateSkills.join(' ').toLowerCase()
    : String(candidateSkills || '').toLowerCase();

  if (!haystack) return false;

  const aliases = skillAliasSet(requiredSkill);
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

  // Primary key: match score (0-100) scaled to dominate all tie-breakers
  // Secondary: must-have count > required count > completeness > contact > experience
  return (
    (Number(candidate.matchScore) || 0) * 10000 +
    mustHaveCount * 500 +
    requiredCount * 100 +
    completeness * 15 +
    (hasEmail ? 12 : 0) +
    (hasPhone ? 8 : 0) +
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

  // For must-have AND gate: match strictly against the skills array + job title only.
  // This prevents a passing mention in an unrelated about/summary from counting.
  const strictHaystack = [
    ...skillsArr,
    String(candidate.jobTitle || candidate.title || ''),
    String(candidate.headline || ''),
  ].join(' ');

  // For required (OR gate) and preferred: also search about/snippet for broader recall.
  const broadHaystack = [
    strictHaystack,
    String(candidate.about || ''),
    String(candidate.snippet || ''),
  ].join(' ');

  const candidateLocation = String(candidate.location || candidate.locality || '');
  const candidateExp = candidate.experience || candidate.totalExperience || candidate.experienceYears || 0;

  // AND gate: ALL must-have skills must appear in strict haystack
  const matchedMustHave = mustHaveSkills.filter((skill) => skillMatches(strictHaystack, skill));
  const missingMustHave = mustHaveSkills.filter((skill) => !skillMatches(strictHaystack, skill));

  // OR gate: at least one required skill must appear
  const matchedRequired = requiredSkills.filter((skill) => skillMatches(broadHaystack, skill));
  const missingRequired = requiredSkills.filter((skill) => !skillMatches(broadHaystack, skill));

  // Preferred: scoring bonus only
  const matchedPreferred = preferredSkills.filter((skill) => skillMatches(broadHaystack, skill));

  const locMatch = locationMatches(candidateLocation, reqLocation);
  const candExpYears = parseExperienceYears(candidateExp);
  const expMatch = reqExpYears > 0 ? candExpYears >= reqExpYears : true;

  // AND gate: any missing must-have → disqualify
  const mustHaveFail = mustHaveSkills.length > 0 && missingMustHave.length > 0;
  // Threshold gate: fewer than 30% of required skills matched → disqualify
  const REQUIRED_THRESHOLD = 0.30;
  const requiredMatchRatio = requiredSkills.length > 0 ? matchedRequired.length / requiredSkills.length : 1;
  const requiredFail = requiredSkills.length > 0 && requiredMatchRatio < REQUIRED_THRESHOLD;
  // Experience range gate: only fires when candidate experience is known (> 0).
  // Too junior: more than 1 year below the minimum — hard disqualify.
  // Too senior: more than 2 years above the max (if a max was specified) — hard disqualify.
  const tooJunior = candExpYears > 0 && reqExpYears > 0 && candExpYears < reqExpYears - 1;
  const tooSenior = candExpYears > 0 && reqMaxExpYears > 0 && candExpYears > reqMaxExpYears + 2;
  const expFail = tooJunior || tooSenior;
  const disqualified = mustHaveFail || requiredFail || expFail;

  // Always compute the actual skill-match score regardless of disqualification.
  // Disqualified candidates still surface with their real partial score so the
  // recruiter can see how close they were (e.g. 80% but missing one must-have).

  // Recency bonus: skills found in the most recent 1-2 jobs get +30% weight bonus.
  const recentHaystack = getRecentHaystack(candidate);
  const mustHavePts  = matchedMustHave.reduce((sum, skill) => {
    const bonus = recentHaystack && skillMatches(recentHaystack, skill) ? WEIGHT.mustHave * 0.3 : 0;
    return sum + WEIGHT.mustHave + bonus;
  }, 0);
  const requiredPts  = matchedRequired.reduce((sum, skill) => {
    const bonus = recentHaystack && skillMatches(recentHaystack, skill) ? WEIGHT.required * 0.3 : 0;
    return sum + WEIGHT.required + bonus;
  }, 0);
  const preferredPts = matchedPreferred.reduce((sum, skill) => {
    const bonus = recentHaystack && skillMatches(recentHaystack, skill) ? WEIGHT.preferred * 0.3 : 0;
    return sum + WEIGHT.preferred + bonus;
  }, 0);
  const rawScore     = mustHavePts + requiredPts + preferredPts;

  const maxPossible =
    mustHaveSkills.length  * WEIGHT.mustHave +
    requiredSkills.length  * WEIGHT.required +
    preferredSkills.length * WEIGHT.preferred;

  // Seniority penalty: if JD asks for Senior+ but candidate title is Junior/Intern,
  // deduct up to 25 points based on the seniority gap (gap ≥ 2 levels).
  const reqSeniority  = extractSeniorityLevel(req.title || req.jobTitle || req.job_title || '');
  const candSeniority = extractSeniorityLevel(
    String(candidate.jobTitle || candidate.title || candidate.headline || '')
  );
  let seniorityPenalty = 0;
  if (reqSeniority >= 2 && candSeniority >= 0) {
    const gap = reqSeniority - candSeniority;
    if (gap >= 2) seniorityPenalty = Math.min(gap * 8, 25); // 2 levels→16, 3+→25 cap
  }

  // If no skill requirements exist score all candidates at 100 (no constraint).
  const baseScore = maxPossible > 0 ? Math.round((rawScore / maxPossible) * 100) : 100;
  const score = Math.max(0, Math.min(100, baseScore - seniorityPenalty));

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
    breakdown: { mustHavePts, requiredPts, preferredPts, locationPts: 0, experiencePts: 0, seniorityPenalty },
    disqualified,
  };
}

export function scoreCandidates(candidates, requirements, options = {}) {
  const { minScore = 0, excludeDisqualified = true } = options;

  return candidates
    .map((candidate) => {
      const result = scoreCandidate(candidate, requirements);
      return {
        ...candidate,
        matchScore: result.score,
        matchCategory: result.matchCategory,
        matchedMustHave: result.matchedMustHave,
        matchedRequired: result.matchedRequired,
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
