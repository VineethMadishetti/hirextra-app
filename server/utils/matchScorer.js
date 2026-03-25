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
  bangalore: ['bengaluru', 'bangalore'],
  bengaluru: ['bengaluru', 'bangalore'],
  delhi: ['delhi', 'new delhi'],
  'new delhi': ['delhi', 'new delhi'],
  mumbai: ['mumbai', 'bombay'],
  bombay: ['mumbai', 'bombay'],
  chennai: ['chennai', 'madras'],
  madras: ['chennai', 'madras'],
  kolkata: ['kolkata', 'calcutta'],
  calcutta: ['kolkata', 'calcutta'],
};

const WEIGHT = {
  mustHave: 30,
  required: 12,
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

function sortValue(candidate) {
  const hasEmail = Boolean(candidate.contact?.email || candidate.email);
  const hasPhone = Boolean(candidate.contact?.phone || candidate.phone);
  const completeness = computeCandidateCompleteness(candidate);
  const expYears = parseExperienceYears(candidate.experienceYears || candidate.totalExperience || candidate.experience);

  return (
    (Number(candidate.matchScore) || 0) * 1000 +
    (candidate.matchedSkills?.length || 0) * 100 +
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
  const reqLocation = String(req.location || '');
  const reqExpYears = Number(req.experience_years || req.experienceYears || 0);

  const skillsArr = Array.isArray(candidate.skills)
    ? candidate.skills
    : String(candidate.skills || '').split(/[,;|·]+/).map((skill) => skill.trim()).filter(Boolean);
  const candidateSkills = [
    ...skillsArr,
    String(candidate.jobTitle || candidate.title || ''),
    String(candidate.about || ''),
    String(candidate.headline || ''),
    String(candidate.snippet || ''),
  ].join(' ');

  const candidateLocation = String(candidate.location || candidate.locality || '');
  const candidateExp = candidate.experience || candidate.totalExperience || candidate.experienceYears || 0;

  const matchedMustHave = mustHaveSkills.filter((skill) => skillMatches(candidateSkills, skill));
  const missingMustHave = mustHaveSkills.filter((skill) => !skillMatches(candidateSkills, skill));
  const matchedRequired = requiredSkills.filter((skill) => skillMatches(candidateSkills, skill));
  const missingRequired = requiredSkills.filter((skill) => !skillMatches(candidateSkills, skill));
  const matchedPreferred = preferredSkills.filter((skill) => skillMatches(candidateSkills, skill));

  const locMatch = locationMatches(candidateLocation, reqLocation);
  const candExpYears = parseExperienceYears(candidateExp);
  const expMatch = reqExpYears > 0 ? candExpYears >= reqExpYears : true;

  const hasSkillRequirements = mustHaveSkills.length > 0 || requiredSkills.length > 0 || preferredSkills.length > 0;
  const totalSkillsMatched = matchedMustHave.length + matchedRequired.length + matchedPreferred.length;

  const mustHaveFail = mustHaveSkills.length > 0 && missingMustHave.length > 0;
  const requiredFail = mustHaveSkills.length === 0 && requiredSkills.length > 0 && matchedRequired.length === 0;
  const zeroSkillMatch = hasSkillRequirements && totalSkillsMatched === 0;
  const disqualified = mustHaveFail || requiredFail || zeroSkillMatch;

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
      experienceMatch: expMatch,
      breakdown: { mustHavePts: 0, requiredPts: 0, preferredPts: 0, locationPts: 0, experiencePts: 0 },
      disqualified: true,
    };
  }

  const mustHavePts = matchedMustHave.length * WEIGHT.mustHave;
  const requiredPts = matchedRequired.length * WEIGHT.required;
  const preferredPts = matchedPreferred.length * WEIGHT.preferred;
  const rawScore = mustHavePts + requiredPts + preferredPts;

  const maxPossible =
    mustHaveSkills.length * WEIGHT.mustHave +
    requiredSkills.length * WEIGHT.required +
    preferredSkills.length * WEIGHT.preferred;

  const score = maxPossible > 0 ? Math.round((rawScore / maxPossible) * 100) : 0;

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
    disqualified: false,
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
