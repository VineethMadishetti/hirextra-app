const TECH_KEYWORDS = new Set([
  'react', 'react.js', 'reactjs', 'javascript', 'js', 'typescript', 'ts',
  'node.js', 'nodejs', 'node', 'python', 'java', 'angular', 'vue', 'vue.js',
  'vuejs', 'html', 'css', 'php', 'ruby', 'swift', 'kotlin', 'flutter', 'dart',
  'golang', 'go', 'rust', 'c++', 'c#', '.net', 'dotnet', 'aws', 'azure', 'gcp',
  'docker', 'kubernetes', 'sql', 'mongodb', 'postgres', 'postgresql', 'mysql',
  'redis', 'graphql', 'django', 'flask', 'spring', 'spring boot', 'laravel',
  'rails', 'jquery', 'bootstrap', 'tailwind', 'sass', 'less', 'webpack', 'vite',
  'terraform', 'ansible', 'jenkins', 'kafka', 'spark', 'hadoop', 'airflow',
  'tableau', 'power bi', 'salesforce', 'sap', 'microservices', 'rest api',
  'fastapi', 'next.js', 'nextjs', 'express', 'nestjs', 'machine learning',
  'deep learning', 'nlp', 'computer vision', 'devops', 'ci/cd', 'agile', 'scrum',
]);

const COMPANY_HINT_RE = /\b(inc|corp|corporation|company|co\.?|llc|llp|ltd|limited|pvt|private|technologies|technology|solutions|systems|services|software|consulting|labs|lab|group|studio|works|digital|ventures|partners|gmbh|plc)\b/i;
const TITLE_HINT_RE = /\b(engineer|developer|architect|manager|lead|principal|staff|consultant|analyst|specialist|recruiter|designer|director|head|officer|administrator|scientist|qa|sdet|tester|product|project|sales|marketing|operations|support|devops|sre|frontend|front-end|backend|back-end|full stack|full-stack|software|programmer|sde|java|python|react|node|data|ml|ai|cloud|security|talent|staffing)\b/i;
const LOCATION_HINT_RE = /\b(india|usa|united states|us|uk|united kingdom|canada|germany|singapore|australia|uae|united arab emirates|netherlands|bangalore|bengaluru|hyderabad|mumbai|delhi|new delhi|chennai|pune|kolkata|gurgaon|gurugram|noida|ahmedabad|jaipur|kochi|coimbatore|nagpur|indore|chandigarh|london|berlin|munich|toronto|vancouver|sydney|melbourne|dubai|amsterdam|new york|san francisco|seattle|austin)\b/i;
const EXPERIENCE_HINT_RE = /\b\d+(?:\.\d+)?\s*(?:\+|plus)?\s*(?:year|yr|month|mo)s?\b/i;
const DEGREE_HINT_RE = /\b(b\.?tech|m\.?tech|bachelor|master|mba|ph\.?d|b\.?e|m\.?s|b\.?s|education)\b/i;

function cleanText(value) {
  if (value == null) return '';
  return String(value)
    .replace(/\s*\|\s*linkedin.*$/i, '')
    .replace(/[•·]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function uniqueStrings(values, max = 20) {
  const result = [];
  const seen = new Set();

  for (const value of values || []) {
    const cleaned = cleanText(value);
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(cleaned);
    if (result.length >= max) break;
  }

  return result;
}

function isTechKeyword(value) {
  const cleaned = cleanText(value).toLowerCase();
  if (!cleaned) return false;
  if (TECH_KEYWORDS.has(cleaned)) return true;

  const words = cleaned.split(/\s+/).filter(Boolean);
  return words.length > 0 && words.every((word) => TECH_KEYWORDS.has(word));
}

function looksLikeSkillList(value) {
  const cleaned = cleanText(value);
  if (!cleaned) return false;
  if (/[;,/|]/.test(cleaned)) return true;

  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length <= 1) return false;
  return words.every((word) => TECH_KEYWORDS.has(word.toLowerCase()));
}

function normalizeName(value) {
  const cleaned = cleanText(value);
  if (!cleaned) return null;
  const words = cleaned.split(' ');
  if (words.length < 2 || words.length > 6) return null;
  if (TITLE_HINT_RE.test(cleaned) || COMPANY_HINT_RE.test(cleaned)) return null;
  return cleaned;
}

export function extractExperienceYears(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.floor(value));
  }

  const cleaned = cleanText(value);
  if (!cleaned) return 0;

  // "X months" with no "years" mention → convert to fractional years (e.g. 6 months → 0.5)
  const monthsOnly = cleaned.match(/(\d+)\s*months?/i);
  if (monthsOnly && !/years?/i.test(cleaned)) {
    return Math.round((Number(monthsOnly[1]) / 12) * 10) / 10;
  }

  const rangeMatch = cleaned.match(/(\d+)\s*[-to]{1,3}\s*(\d+)/i);
  if (rangeMatch) {
    return Math.max(Number(rangeMatch[1]) || 0, Number(rangeMatch[2]) || 0);
  }

  const match = cleaned.match(/(\d+(?:\.\d+)?)/);
  return match ? Math.floor(Number(match[1]) || 0) : 0;
}

export function normalizeExperienceText(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    const years = Math.max(0, Math.floor(value));
    return years > 0 ? `${years}+ years` : null;
  }

  const cleaned = cleanText(value);
  if (!cleaned) return null;
  if (EXPERIENCE_HINT_RE.test(cleaned)) return cleaned;

  const years = extractExperienceYears(cleaned);
  return years > 0 ? `${years}+ years` : null;
}

export function normalizeLocationText(value) {
  const cleaned = cleanText(value);
  if (!cleaned) return null;
  if (cleaned.length > 80) return null;
  if (COMPANY_HINT_RE.test(cleaned) && !LOCATION_HINT_RE.test(cleaned)) return null;
  if (TITLE_HINT_RE.test(cleaned) && !LOCATION_HINT_RE.test(cleaned)) return null;
  return cleaned;
}

export function normalizeEducationText(value) {
  const cleaned = cleanText(value);
  if (!cleaned) return null;
  if (cleaned.length > 120) return cleaned.slice(0, 120).trim();
  return cleaned;
}

export function normalizeJobTitleText(value, { location } = {}) {
  let cleaned = cleanText(value);
  if (!cleaned) return null;

  cleaned = cleaned
    .replace(/\s+(?:at|@)\s+.+$/i, '')
    .replace(/^\s*-\s*/, '')
    .trim();

  if (location) {
    const escapedLocation = String(location).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    cleaned = cleaned.replace(new RegExp(`,?\\s*${escapedLocation}\\s*$`, 'i'), '').trim();
  }

  if (!cleaned) return null;
  if (EXPERIENCE_HINT_RE.test(cleaned) || DEGREE_HINT_RE.test(cleaned)) return null;
  if (looksLikeSkillList(cleaned)) return null;
  if (COMPANY_HINT_RE.test(cleaned) && !TITLE_HINT_RE.test(cleaned)) return null;
  if (!TITLE_HINT_RE.test(cleaned) && cleaned.split(/\s+/).length > 7) return null;
  return cleaned;
}

export function normalizeCompanyText(value) {
  let cleaned = cleanText(value);
  if (!cleaned) return null;

  cleaned = cleaned.split(/\s*[|]\s*/)[0].trim();
  if (!cleaned) return null;

  if (EXPERIENCE_HINT_RE.test(cleaned) || DEGREE_HINT_RE.test(cleaned)) return null;
  if (looksLikeSkillList(cleaned) || isTechKeyword(cleaned)) return null;
  if (TITLE_HINT_RE.test(cleaned) && !COMPANY_HINT_RE.test(cleaned)) return null;
  if (cleaned.split(/\s+/).length > 8 && !COMPANY_HINT_RE.test(cleaned)) return null;
  if (LOCATION_HINT_RE.test(cleaned) && cleaned.split(/\s+/).length <= 2 && !COMPANY_HINT_RE.test(cleaned)) return null;
  return cleaned;
}

function splitSkillValues(raw) {
  if (Array.isArray(raw)) {
    return raw.flatMap((item) => splitSkillValues(item));
  }

  const cleaned = cleanText(raw);
  if (!cleaned) return [];

  return cleaned
    .split(/[,;|•·]+/)
    .map((item) => cleanText(item))
    .filter(Boolean);
}

export function normalizeSkills(rawSkills, context = {}) {
  const rejectTerms = uniqueStrings([
    context.jobTitle,
    context.company,
    context.location,
  ]).map((item) => item.toLowerCase());

  const normalized = [];
  const seen = new Set();

  for (const value of splitSkillValues(rawSkills)) {
    const cleaned = cleanText(value);
    if (!cleaned) continue;

    const lower = cleaned.toLowerCase();
    if (seen.has(lower)) continue;
    if (cleaned.length < 2 || cleaned.length > 40) continue;
    if (EXPERIENCE_HINT_RE.test(cleaned) || DEGREE_HINT_RE.test(cleaned)) continue;
    if (COMPANY_HINT_RE.test(cleaned)) continue;
    if (LOCATION_HINT_RE.test(cleaned)) continue;
    if (rejectTerms.includes(lower)) continue;
    if (/\b(?:linkedin|profile|summary|about|experience|education|location)\b/i.test(cleaned)) continue;
    if (/[.!?]/.test(cleaned) && cleaned.split(/\s+/).length > 4) continue;

    seen.add(lower);
    normalized.push(cleaned);
    if (normalized.length >= 15) break;
  }

  return normalized;
}

function normalizeAboutText(value) {
  const cleaned = cleanText(value);
  if (!cleaned) return null;
  if (cleaned.length < 40) return null;
  return cleaned;
}

export function computeCandidateCompleteness(candidate = {}) {
  const hasEmail = Boolean(candidate.contact?.email || candidate.email);
  const hasPhone = Boolean(candidate.contact?.phone || candidate.phone);
  const skillCount = Array.isArray(candidate.skills) ? candidate.skills.length : normalizeSkills(candidate.skills).length;

  return [
    Boolean(candidate.name || candidate.fullName),
    Boolean(candidate.jobTitle || candidate.title),
    Boolean(candidate.company),
    Boolean(candidate.location || candidate.locality),
    Boolean(candidate.totalExperience || candidate.experience || candidate.experienceYears),
    skillCount > 0,
    Boolean(candidate.about || candidate.summary),
    hasEmail,
    hasPhone,
  ].filter(Boolean).length;
}

export function canonicalizeCandidateProfile(candidate = {}) {
  const location = normalizeLocationText(candidate.location || candidate.locality || null);
  const company = normalizeCompanyText(candidate.company || candidate.companyName || candidate.currentCompany || null);
  const jobTitle = normalizeJobTitleText(candidate.jobTitle || candidate.title || candidate.headline || null, { location });
  const skills = normalizeSkills(candidate.skills, { jobTitle, company, location });
  const about = normalizeAboutText(candidate.about || candidate.summary || null);
  const totalExperience = normalizeExperienceText(
    candidate.totalExperience != null ? candidate.totalExperience : candidate.experience
  );
  const experienceYears = extractExperienceYears(
    candidate.experienceYears != null ? candidate.experienceYears : totalExperience
  );

  return {
    ...candidate,
    name: normalizeName(candidate.name || candidate.fullName) || candidate.name || candidate.fullName || null,
    jobTitle,
    company,
    location,
    education: normalizeEducationText(candidate.education || null),
    skills,
    about,
    totalExperience,
    experienceYears: experienceYears || null,
    completenessScore: computeCandidateCompleteness({
      ...candidate,
      jobTitle,
      company,
      location,
      skills,
      about,
      totalExperience,
      experienceYears,
    }),
  };
}

export function mergeCandidateWithAi(baseCandidate = {}, aiCandidate = {}) {
  const base = canonicalizeCandidateProfile(baseCandidate);
  const aiLocation = normalizeLocationText(aiCandidate.location || null);
  const merged = {
    ...base,
    name: base.name || normalizeName(aiCandidate.name || null),
    jobTitle: base.jobTitle || normalizeJobTitleText(aiCandidate.jobTitle || null, { location: base.location || aiLocation }),
    company: base.company || normalizeCompanyText(aiCandidate.company || null),
    location: base.location || aiLocation,
    education: base.education || normalizeEducationText(aiCandidate.education || null),
    totalExperience: base.totalExperience || normalizeExperienceText(aiCandidate.totalExperience || null),
    about: (() => {
      const baseAbout = normalizeAboutText(base.about || null);
      const aiAbout = normalizeAboutText(aiCandidate.about || null);
      if (aiAbout && (!baseAbout || aiAbout.length > baseAbout.length)) return aiAbout;
      return baseAbout;
    })(),
  };

  merged.experienceYears = base.experienceYears || extractExperienceYears(
    merged.totalExperience || aiCandidate.totalExperience || 0
  ) || null;
  merged.skills = normalizeSkills(
    [...(base.skills || []), ...(Array.isArray(aiCandidate.skills) ? aiCandidate.skills : [])],
    {
      jobTitle: merged.jobTitle,
      company: merged.company,
      location: merged.location,
    }
  );

  return canonicalizeCandidateProfile(merged);
}

export default {
  canonicalizeCandidateProfile,
  computeCandidateCompleteness,
  extractExperienceYears,
  mergeCandidateWithAi,
  normalizeCompanyText,
  normalizeEducationText,
  normalizeExperienceText,
  normalizeJobTitleText,
  normalizeLocationText,
  normalizeSkills,
};
