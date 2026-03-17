/**
 * matchScorer.js
 *
 * Boolean match scoring engine.
 * Scores a candidate against structured job requirements (output of
 * aiSourcingService.normalizeParsedRequirements / toStructuredRequirements).
 *
 * Scoring model
 * ─────────────
 * must_have_skills   → 30 pts each  (hard blockers — 0 pts if NONE matched)
 * required_skills    → 12 pts each  (strong positive signal)
 * preferred_skills   →  5 pts each  (nice-to-have bonus)
 * location match     → 15 pts flat  (city/region in candidate location string)
 * experience match   → 10 pts flat  (candidate exp ≥ required years)
 *
 * Maximum possible raw score is computed dynamically from the JD so that
 * a "perfect" candidate always scores 100 regardless of JD size.
 *
 * Hard rule: if must_have_skills are present in the JD and NONE are matched,
 * the candidate is immediately scored 0 (disqualified).
 *
 * Match categories (returned as `matchCategory`)
 * ────────────────────────────────────────────────
 *   PERFECT  → score ≥ 90
 *   STRONG   → score 70 – 89
 *   GOOD     → score 50 – 69
 *   PARTIAL  → score 30 – 49
 *   WEAK     → score  0 – 29
 */

// ── Skill alias map (common abbreviations / alternate names) ─────────────────
// Maps lowercase canonical form → array of equivalent strings.
const SKILL_ALIASES = {
  'javascript':   ['js', 'javascript', 'ecmascript', 'es6', 'es2015'],
  'typescript':   ['ts', 'typescript'],
  'node.js':      ['nodejs', 'node', 'node.js'],
  'react':        ['reactjs', 'react.js', 'react js'],
  'react native': ['react-native', 'reactnative'],
  'angular':      ['angularjs', 'angular.js', 'angular 2+'],
  'vue':          ['vuejs', 'vue.js'],
  'next.js':      ['nextjs', 'next js'],
  'postgresql':   ['postgres', 'postgresql', 'psql'],
  'mongodb':      ['mongo', 'mongodb'],
  'mysql':        ['mysql', 'my sql'],
  'aws':          ['amazon web services', 'aws'],
  'gcp':          ['google cloud', 'gcp', 'google cloud platform'],
  'azure':        ['microsoft azure', 'azure'],
  'docker':       ['docker', 'containerization'],
  'kubernetes':   ['k8s', 'kubernetes'],
  'graphql':      ['graphql', 'graph ql'],
  'rest api':     ['rest', 'restful', 'rest api', 'restful api'],
  'python':       ['python', 'python3', 'python 3'],
  'java':         ['java', 'java8', 'java 8', 'java 11', 'java 17'],
  'spring boot':  ['spring boot', 'springboot', 'spring-boot'],
  'django':       ['django', 'django rest framework', 'drf'],
  'fastapi':      ['fastapi', 'fast api'],
  'redis':        ['redis', 'redis cache'],
  'elasticsearch':['elasticsearch', 'elastic search', 'es'],
};

/**
 * Build a flat set of lowercase alias terms for a skill string.
 * e.g. "Node.js" → Set { "node.js", "nodejs", "node" }
 */
function skillAliasSet(skill) {
  const lower = String(skill || '').toLowerCase().trim();
  const set = new Set([lower]);

  // Direct alias lookup
  const direct = SKILL_ALIASES[lower];
  if (direct) direct.forEach(a => set.add(a.toLowerCase()));

  // Reverse lookup — find any canonical key whose aliases include this skill
  for (const [canonical, aliases] of Object.entries(SKILL_ALIASES)) {
    if (aliases.map(a => a.toLowerCase()).includes(lower)) {
      set.add(canonical);
      aliases.forEach(a => set.add(a.toLowerCase()));
    }
  }

  return set;
}

/**
 * Test whether a candidate's skill string / array contains a required skill,
 * accounting for aliases and partial word boundaries.
 *
 * @param {string|string[]} candidateSkills  - candidate's skills field
 * @param {string}          requiredSkill    - single skill from JD
 * @returns {boolean}
 */
function skillMatches(candidateSkills, requiredSkill) {
  if (!requiredSkill) return false;

  // Normalise candidate skills to a single lowercase string
  let haystack;
  if (Array.isArray(candidateSkills)) {
    haystack = candidateSkills.join(' ').toLowerCase();
  } else {
    haystack = String(candidateSkills || '').toLowerCase();
  }

  if (!haystack) return false;

  const aliases = skillAliasSet(requiredSkill);
  for (const alias of aliases) {
    // Word-boundary-aware match so "java" doesn't match "javascript"
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(?:^|[\\s,/|·])${escaped}(?:$|[\\s,/|·.+#])`, 'i');
    if (regex.test(` ${haystack} `)) return true;
  }

  return false;
}

/**
 * Test whether a candidate's location matches a required location string.
 * Checks city-level (first comma-segment) inclusion both ways.
 *
 * @param {string} candidateLocation
 * @param {string} requiredLocation
 * @returns {boolean}
 */
function locationMatches(candidateLocation, requiredLocation) {
  if (!requiredLocation || /unspecified|not specified/i.test(requiredLocation)) return true; // no requirement
  if (!candidateLocation) return false;

  const candLow = String(candidateLocation).toLowerCase();
  const reqCity = requiredLocation.split(',')[0].trim().toLowerCase();

  if (!reqCity) return false;

  return candLow.includes(reqCity) || reqCity.includes(candLow.split(',')[0].trim());
}

/**
 * Parse years of experience from a candidate's experience string or number.
 * Handles formats like "5+ years", "3 years", 5, "Senior"
 *
 * @param {string|number} exp
 * @returns {number}  years (0 if unparseable)
 */
function parseExperienceYears(exp) {
  if (typeof exp === 'number' && Number.isFinite(exp)) return exp;
  const str = String(exp || '');
  const match = str.match(/(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
}

// ── Weights ──────────────────────────────────────────────────────────────────
const WEIGHT = {
  mustHave:   30,
  required:   12,
  preferred:   5,
  location:   15,
  experience: 10,
};

/**
 * Score a single candidate against structured job requirements.
 *
 * @param {object} candidate   - candidate document from DB or sourcing result
 *   Expected fields (all optional, best-effort):
 *     skills       {string|string[]}
 *     location     {string}
 *     experience   {string|number}   e.g. "5+ years" or 5
 *
 * @param {object} requirements  - normalized output from aiSourcingService
 *   Expected fields:
 *     must_have_skills   {string[]}
 *     required_skills    {string[]}
 *     preferred_skills   {string[]}
 *     location           {string}
 *     experience_years   {number}
 *
 * @returns {object} ScoreResult
 *   {
 *     score:           number   0–100
 *     matchCategory:   string   'PERFECT' | 'STRONG' | 'GOOD' | 'PARTIAL' | 'WEAK'
 *     matchedMustHave: string[]
 *     missingMustHave: string[]
 *     matchedRequired: string[]
 *     missingRequired: string[]
 *     matchedPreferred:string[]
 *     locationMatch:   boolean
 *     experienceMatch: boolean
 *     breakdown:       object   raw pts per section
 *     disqualified:    boolean  true when must-haves present but none matched
 *   }
 */
export function scoreCandidate(candidate, requirements) {
  const req = requirements || {};

  const mustHaveSkills  = Array.isArray(req.must_have_skills)  ? req.must_have_skills  :
                          Array.isArray(req.mustHaveSkills)    ? req.mustHaveSkills    : [];
  const requiredSkills  = Array.isArray(req.required_skills)   ? req.required_skills   :
                          Array.isArray(req.requiredSkills)    ? req.requiredSkills    : [];
  const preferredSkills = Array.isArray(req.preferred_skills)  ? req.preferred_skills  :
                          Array.isArray(req.preferredSkills)   ? req.preferredSkills   : [];
  const reqLocation     = String(req.location || '');
  const reqExpYears     = Number(req.experience_years || req.experienceYears || 0);

  const candidateSkills   = candidate.skills || '';
  const candidateLocation = String(candidate.location || candidate.locality || '');
  // Support both DB candidates (experience) and internet-sourced candidates (totalExperience)
  const candidateExp      = candidate.experience || candidate.totalExperience || candidate.experienceYears || 0;

  // ── Match each skill tier ─────────────────────────────────────────────────
  const matchedMustHave  = mustHaveSkills.filter(s  => skillMatches(candidateSkills, s));
  const missingMustHave  = mustHaveSkills.filter(s  => !skillMatches(candidateSkills, s));
  const matchedRequired  = requiredSkills.filter(s  => skillMatches(candidateSkills, s));
  const missingRequired  = requiredSkills.filter(s  => !skillMatches(candidateSkills, s));
  const matchedPreferred = preferredSkills.filter(s => skillMatches(candidateSkills, s));

  // ── Compute location match early (needed for hard rules below) ───────────
  const locMatch = locationMatches(candidateLocation, reqLocation);

  // ── Hard disqualification rules ───────────────────────────────────────────
  const hasSkillRequirements = mustHaveSkills.length > 0 || requiredSkills.length > 0 || preferredSkills.length > 0;
  const totalSkillsMatched   = matchedMustHave.length + matchedRequired.length + matchedPreferred.length;

  // Rule 1: must-have skills present but none matched
  const mustHaveFail = mustHaveSkills.length > 0 && matchedMustHave.length === 0;
  // Rule 2: skills are defined but candidate matches ZERO across all tiers
  const zeroSkillMatch = hasSkillRequirements && totalSkillsMatched === 0;
  // Rule 3: location is specified but doesn't match
  const hasLocationRequirement = Boolean(reqLocation && !/unspecified|not specified/i.test(reqLocation));
  const locationFail = hasLocationRequirement && !locMatch;

  const disqualified = mustHaveFail || zeroSkillMatch || locationFail;

  if (disqualified) {
    return {
      score: 0,
      matchCategory: 'WEAK',
      matchedMustHave: [],
      missingMustHave,
      matchedRequired,
      missingRequired,
      matchedPreferred,
      locationMatch: locMatch,
      experienceMatch: false,
      breakdown: { mustHavePts: 0, requiredPts: 0, preferredPts: 0, locationPts: 0, experiencePts: 0 },
      disqualified: true,
    };
  }

  // ── Compute raw points ────────────────────────────────────────────────────
  const mustHavePts   = matchedMustHave.length  * WEIGHT.mustHave;
  const requiredPts   = matchedRequired.length  * WEIGHT.required;
  const preferredPts  = matchedPreferred.length * WEIGHT.preferred;

  const locationPts   = locMatch ? WEIGHT.location : 0;

  const candExpYears  = parseExperienceYears(candidateExp);
  const expMatch      = reqExpYears > 0 ? candExpYears >= reqExpYears : true;
  const experiencePts = expMatch ? WEIGHT.experience : 0;

  const rawScore = mustHavePts + requiredPts + preferredPts + locationPts + experiencePts;

  // ── Compute maximum possible score for this JD ────────────────────────────
  const maxPossible =
    mustHaveSkills.length  * WEIGHT.mustHave  +
    requiredSkills.length  * WEIGHT.required  +
    preferredSkills.length * WEIGHT.preferred +
    WEIGHT.location +
    (reqExpYears > 0 ? WEIGHT.experience : 0);

  const score = maxPossible > 0
    ? Math.round((rawScore / maxPossible) * 100)
    : 0;

  // ── Categorise ────────────────────────────────────────────────────────────
  let matchCategory;
  if      (score >= 90) matchCategory = 'PERFECT';
  else if (score >= 70) matchCategory = 'STRONG';
  else if (score >= 50) matchCategory = 'GOOD';
  else if (score >= 30) matchCategory = 'PARTIAL';
  else                  matchCategory = 'WEAK';

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
    breakdown: { mustHavePts, requiredPts, preferredPts, locationPts, experiencePts },
    disqualified: false,
  };
}

/**
 * Score and sort an array of candidates.
 * Optionally filter out candidates below a minimum score threshold.
 *
 * @param {object[]} candidates
 * @param {object}   requirements  - normalized parsed requirements
 * @param {object}   [options]
 * @param {number}   [options.minScore=0]       filter out below this score
 * @param {boolean}  [options.excludeDisqualified=true]
 * @returns {object[]} candidates with `matchScore`, `matchCategory`, `matchedSkills`,
 *                     `missingSkills`, `locationMatch`, `experienceMatch` attached, sorted desc
 */
export function scoreCandidates(candidates, requirements, options = {}) {
  const { minScore = 0, excludeDisqualified = true } = options;

  const scored = candidates
    .map(candidate => {
      const result = scoreCandidate(candidate, requirements);
      return {
        ...candidate,
        matchScore:      result.score,
        matchCategory:   result.matchCategory,
        matchedSkills:   [...new Set([...result.matchedMustHave, ...result.matchedRequired, ...result.matchedPreferred])],
        missingSkills:   [...new Set([...result.missingMustHave, ...result.missingRequired])],
        locationMatch:   result.locationMatch,
        experienceMatch: result.experienceMatch,
        scoreBreakdown:  result.breakdown,
        disqualified:    result.disqualified,
      };
    })
    .filter(c => {
      if (excludeDisqualified && c.disqualified) return false;
      return c.matchScore >= minScore;
    })
    .sort((a, b) => b.matchScore - a.matchScore);

  return scored;
}

/**
 * Bucket a pre-scored candidate array into match categories.
 *
 * @param {object[]} scoredCandidates  - output of scoreCandidates()
 * @returns {{ perfect: object[], strong: object[], good: object[], partial: object[], weak: object[] }}
 */
export function bucketByMatchCategory(scoredCandidates) {
  const buckets = { perfect: [], strong: [], good: [], partial: [], weak: [] };
  for (const c of scoredCandidates) {
    const key = (c.matchCategory || 'WEAK').toLowerCase();
    if (buckets[key]) buckets[key].push(c);
    else buckets.weak.push(c);
  }
  return buckets;
}

export default { scoreCandidate, scoreCandidates, bucketByMatchCategory };
