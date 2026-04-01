import OpenAI from 'openai';
import logger from './logger.js';

let openai = null;

const TITLE_ALIAS_MAP = {
  'full stack developer': [
    'fullstack developer',
    'full stack engineer',
    'fullstack engineer',
    'software engineer',
  ],
  'frontend developer': ['front end developer', 'frontend engineer', 'ui developer', 'react developer'],
  'backend developer': ['back end developer', 'backend engineer', 'api developer', 'server-side developer'],
  'software engineer': ['software developer', 'application engineer'],
  'data engineer': ['big data engineer', 'etl engineer'],
  'devops engineer': ['site reliability engineer', 'sre', 'platform engineer'],
};

const SKILL_ALIAS_MAP = {
  react: ['reactjs', 'react.js'],
  javascript: ['js', 'ecmascript'],
  typescript: ['ts'],
  'node.js': ['nodejs', 'node'],
  postgresql: ['postgres', 'postgresql db'],
  aws: ['amazon web services'],
  docker: ['containerization'],
  kubernetes: ['k8s'],
  'ci/cd': ['continuous integration', 'continuous delivery'],
};

function getOpenAIClient() {
  if (!openai) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY not configured. Please set it in environment variables.');
    }
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openai;
}

function uniqueStrings(values, max = 10) {
  const out = [];
  const seen = new Set();

  for (const value of values || []) {
    const clean = String(value || '').replace(/\s+/g, ' ').trim();
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
    if (out.length >= max) break;
  }
  return out;
}

function normalizeNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? Math.max(0, Math.floor(num)) : fallback;
}

function normalizeTitleObject(rawTitle) {
  if (typeof rawTitle === 'string') {
    const mainFromString = String(rawTitle).trim();
    return { main: mainFromString || 'Software Engineer', synonyms: [] };
  }

  const main = String(rawTitle?.main || '').trim();
  const synonyms = uniqueStrings(rawTitle?.synonyms || [], 5).filter(
    (item) => item.toLowerCase() !== main.toLowerCase()
  );

  return {
    main: main || 'Software Engineer',
    synonyms,
  };
}

function normalizeRemote(value, location) {
  const byFlag = value === true || String(value || '').toLowerCase() === 'true';
  const byText = /remote|work from home|anywhere/i.test(String(location || ''));
  return Boolean(byFlag || byText);
}

function expandByAliasMap(items, aliasMap) {
  const expanded = [];

  for (const raw of items || []) {
    const clean = String(raw || '').trim();
    if (!clean) continue;
    expanded.push(clean);

    const mapValues = aliasMap[clean.toLowerCase()] || [];
    expanded.push(...mapValues);
  }

  return uniqueStrings(expanded, 20);
}

function deriveTitleVariants(title) {
  const clean = String(title || '').replace(/\s+/g, ' ').trim();
  if (!clean) return [];

  const variants = [clean];
  const noSeniority = clean
    .replace(/\b(senior|sr\.?|junior|jr\.?|lead|principal|staff|associate|mid|mid-level|mid level)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (noSeniority && noSeniority.toLowerCase() !== clean.toLowerCase()) {
    variants.push(noSeniority);
  }

  const normalized = noSeniority || clean;
  const lower = normalized.toLowerCase();

  if (/\bbackend\b/.test(lower)) {
    variants.push('Backend Developer', 'Backend Engineer');
  }
  if (/\bfrontend\b|\bfront end\b/.test(lower)) {
    variants.push('Frontend Developer', 'Frontend Engineer');
  }
  if (/\bfull\s*stack\b/.test(lower)) {
    variants.push('Full Stack Developer', 'Full Stack Engineer');
  }
  if (/\bjava\b/.test(lower)) {
    variants.push('Java Developer', 'Java Engineer');
    if (/\bbackend\b/.test(lower)) {
      variants.push('Java Backend Developer');
    }
  }
  if (/\breact\b/.test(lower)) {
    variants.push('React Developer', 'Frontend Developer');
  }

  return uniqueStrings(variants, 10);
}

export function normalizeParsedRequirements(raw = {}) {
  const job_title = normalizeTitleObject({
    ...(raw.job_title || {}),
    ...(typeof raw.jobTitle === 'string' ? { main: raw.jobTitle } : raw.jobTitle || {}),
    synonyms: raw.titleVariations || raw.job_title?.synonyms || raw.jobTitle?.synonyms || [],
  });
  const required_skills = uniqueStrings(
    raw.required_skills ||
      raw.requiredSkills ||
      raw.skills ||
      raw.must_have_skills ||
      raw.mustHaveSkills ||
      [],
    12
  );
  const preferred_skills = uniqueStrings(
    raw.preferred_skills || raw.preferredSkills || raw.nice_to_have_skills || raw.niceToHaveSkills || [],
    10
  );

  // must_have_skills must stay independent of required_skills.
  // Falling back to required_skills turns every skill into a hard gate and disqualifies
  // all candidates who are missing even one skill from a 10-skill required list.
  const must_have_skills = uniqueStrings(raw.must_have_skills || raw.mustHaveSkills || [], 6);
  const experience_years     = normalizeNumber(raw.experience_years     || raw.experienceYears    || raw.yearsOfExperience, 0);
  const max_experience_years = normalizeNumber(raw.max_experience_years || raw.maxExperienceYears  || 0, 0);
  const experience_level = String(
    raw.experience_level ||
      raw.experienceLevel ||
      (experience_years >= 8 ? 'Lead' : experience_years >= 4 ? 'Senior' : 'Mid')
  ).trim();

  const location = String(raw.location || 'Unspecified').trim() || 'Unspecified';
  const industry = String(raw.industry || 'Not Specified').trim() || 'Not Specified';
  const duration_type = String(raw.duration_type || raw.durationType || raw.jobType || 'Not Specified').trim();
  const organization_hierarchy = String(
    raw.organization_hierarchy || raw.organizationHierarchy || 'Not Specified'
  ).trim();
  const salary_package = String(raw.salary_package || raw.salaryPackage || raw.salaryRange || 'Not Specified').trim();
  const availability = String(raw.availability || 'Not Specified').trim();
  const education = String(raw.education || 'Not Specified').trim();
  const company_types = uniqueStrings(raw.company_types || raw.companyTypes || [], 5);
  const remote = normalizeRemote(raw.remote, location);

  // Pass through AI-generated dynamic expansions
  const title_variants    = uniqueStrings(raw.title_variants || [], 5);
  const linkedin_locations = Array.isArray(raw.linkedin_locations) ? raw.linkedin_locations.filter(Boolean) : [];
  const skill_aliases     = (raw.skill_aliases && typeof raw.skill_aliases === 'object' && !Array.isArray(raw.skill_aliases))
    ? raw.skill_aliases
    : {};

  return {
    job_title,
    title_variants,
    industry,
    duration_type,
    location,
    linkedin_locations,
    experience_years,
    max_experience_years,
    experience_level,
    organization_hierarchy,
    salary_package,
    availability,
    education,
    required_skills,
    preferred_skills,
    must_have_skills,
    skill_aliases,
    company_types,
    remote,
  };
}

function fallbackParse(jd) {
  logger.warn('AI parsing failed, using regex-based fallback.');
  const lowerJd = jd.toLowerCase();

  // Extract years of experience — handle months (e.g. "6 months" → 0.5)
  const yearsMatch = lowerJd.match(/(\d+)\+?\s*years?/);
  const monthsMatch = !yearsMatch && lowerJd.match(/(\d+)\s*months?/);
  const years = yearsMatch
    ? parseInt(yearsMatch[1], 10)
    : monthsMatch
      ? Math.round((parseInt(monthsMatch[1], 10) / 12) * 10) / 10
      : 3;

  // Common skills list
  const commonSkills = ['java', 'python', 'javascript', 'react', 'angular', 'node.js', 'aws', 'azure', 'docker', 'kubernetes', 'sql', 'mongodb', 'spring boot', 'microservices'];
  const foundSkills = commonSkills.filter(skill => lowerJd.includes(skill));

  // Extract job title (simple approach)
  const titleMatch = lowerJd.match(/(?:position|role|job title|seeking a|hiring a)\s*([a-z\s]+)/);
  let title = 'Developer';
  if (titleMatch && titleMatch[1]) {
      title = titleMatch[1].split('\n')[0].trim().replace(/\b\w/g, l => l.toUpperCase());
  }

  // This is a simplified fallback, so we only populate the most critical fields
  return {
    job_title: { main: title, synonyms: [] },
    required_skills: foundSkills.slice(0, 8),
    experience_years: years,
    location: 'Not Specified',
    remote: /remote|work from home|wfh/i.test(lowerJd),
    must_have_skills: foundSkills.slice(0, 3),
  };
}

export async function parseJobDescription(jobDescription) {
  if (!jobDescription || String(jobDescription).trim().length < 20) {
    throw new Error('Job description must be at least 20 characters');
  }

  try {
    logger.info(`Parsing job description (${jobDescription.length} chars)`);
    const client = getOpenAIClient();

    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are a recruitment AI parser.
Return ONLY valid JSON with this exact schema:
{
  "job_title": { "main": "string", "synonyms": ["string"] },
  "title_variants": ["string"],
  "industry": "string",
  "duration_type": "string",
  "location": "string",
  "linkedin_locations": ["string"],
  "experience_years": number,
  "max_experience_years": number,
  "experience_level": "Junior|Mid|Senior|Lead|Executive",
  "organization_hierarchy": "string",
  "salary_package": "string",
  "availability": "string",
  "education": "string",
  "required_skills": ["string"],
  "preferred_skills": ["string"],
  "must_have_skills": ["string"],
  "skill_aliases": { "skill_name": ["alias1", "alias2"] },
  "company_types": ["string"],
  "remote": boolean
}

Extraction policy:
- Keep concise and precise.
- Extract from text only; do not invent.
- Required skills <= 12, preferred skills <= 10, must-have <= 6.
- If missing, use "Not Specified" for string fields and 0 for experience_years / max_experience_years.
- For experience ranges like "4-7 years", set experience_years=4 and max_experience_years=7. For "5+ years", set experience_years=5 and max_experience_years=0 (no upper limit).
- If experience is given in months only (e.g. "6 months"), set experience_years=0.5. For "6 months – 4 years", set experience_years=0.5 and max_experience_years=4.
- For availability: output exactly one of "IMMEDIATE", "15_DAYS", "30_DAYS", "ANY". "Immediate joiners only" → "IMMEDIATE". "15 days notice" → "15_DAYS". "30 days / 1 month notice" → "30_DAYS". Not mentioned → "ANY".
- title_variants: 3-5 natural synonyms/alternate job titles that recruiters actually use on LinkedIn (e.g. for "Ward Sister" → ["Charge Nurse", "Senior Staff Nurse", "Clinical Team Leader"]). Works for ANY role in ANY language or domain.
- linkedin_locations: for each city/region in the location field, provide the exact "City, State/Region, Country" string that LinkedIn uses — e.g. "Malmö, Skåne County, Sweden", "Cape Town, Western Cape, South Africa". If location is remote or unspecified, return []. If multiple cities, return one entry per city.
- skill_aliases: for each must_have and required skill, provide 1-3 common alternate names professionals use on LinkedIn (e.g. "Kubernetes": ["k8s", "K8"], "React": ["ReactJS", "React.js"], "SAP HANA": ["HANA", "SAP In-Memory DB"]). Only include aliases that are meaningfully different from the skill name.
- Return JSON only.

Example:
User Input: "Seeking a Senior Backend Engineer with 8+ years of experience in Java and Spring Boot for our fintech team in London. Must have strong knowledge of microservices and AWS. Kafka is a plus. This is a full-time permanent role."
Your JSON Output:
{
  "job_title": { "main": "Senior Backend Engineer", "synonyms": ["Senior Java Developer", "Senior Software Engineer"] },
  "title_variants": ["Senior Java Engineer", "Backend Software Engineer", "Senior API Developer"],
  "industry": "Fintech",
  "duration_type": "Full-time",
  "location": "London",
  "linkedin_locations": ["London, England, United Kingdom"],
  "experience_years": 8,
  "max_experience_years": 0,
  "experience_level": "Senior",
  "organization_hierarchy": "Not Specified",
  "salary_package": "Not Specified",
  "availability": "ANY",
  "education": "Not Specified",
  "required_skills": ["Java", "Spring Boot", "Microservices", "AWS"],
  "preferred_skills": ["Kafka"],
  "must_have_skills": ["Java", "Spring Boot", "Microservices", "AWS"],
  "skill_aliases": { "Java": ["Java EE", "J2EE"], "Spring Boot": ["Spring Framework", "Spring"], "AWS": ["Amazon Web Services", "Amazon AWS"] },
  "company_types": [],
  "remote": false
}`,
        },
        {
          role: 'user',
          content: `Extract hiring requirements from this JD:\n\n${jobDescription}`,
        },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
      max_tokens: 1400,
    });

    const raw = JSON.parse(response.choices?.[0]?.message?.content || '{}');
    const normalized = normalizeParsedRequirements(raw);
    logger.info(`JD parsed successfully: ${normalized.job_title.main}`);
    return normalized;
  } catch (error) {
    logger.error(`OpenAI parsing error: ${error.message}. Falling back to basic extraction.`);
    const fallbackResult = fallbackParse(jobDescription);
    return normalizeParsedRequirements(fallbackResult);
  }
}

export function buildAliases(parsed) {
  const titleBase = [
    ...deriveTitleVariants(parsed?.job_title?.main),
    ...(parsed?.job_title?.synonyms || []),
  ];
  const titleAliases = expandByAliasMap(uniqueStrings(titleBase, 6), TITLE_ALIAS_MAP);

  const skillBase = uniqueStrings(
    parsed?.must_have_skills?.length ? parsed.must_have_skills : parsed?.required_skills || [],
    8
  );
  const skillAliases = expandByAliasMap(skillBase, SKILL_ALIAS_MAP);

  return {
    titleAliases,
    skillAliases,
  };
}

export function buildBooleanQueries(parsed) {
  const aliases = buildAliases(parsed);
  const location = String(parsed?.location || '').trim();
  const includeLocation = Boolean(location && !/unspecified|not specified|remote/i.test(location));

  const titleClause = aliases.titleAliases.length
    ? `(${aliases.titleAliases.map((t) => `"${t}"`).join(' OR ')})`
    : '';
  const requiredClause = aliases.skillAliases.length
    ? `(${aliases.skillAliases.map((s) => `"${s}"`).join(' OR ')})`
    : '';
  const preferredClause = uniqueStrings(parsed?.preferred_skills || [], 6).length
    ? `(${uniqueStrings(parsed?.preferred_skills || [], 6).map((s) => `"${s}"`).join(' OR ')})`
    : '';
  const cityName = location.split(',')[0].trim();
  const locationClause = includeLocation
    ? `("${location}" OR "Greater ${cityName} Area" OR "${cityName}")`
    : '';
  const linkedinClause = 'site:linkedin.com/in';

  // Location is always AND'd — it is a hard geographic gate, not a scoring hint.
  const requiredBoolean = [titleClause, requiredClause, locationClause, linkedinClause]
    .filter(Boolean)
    .join(' AND ');
  const preferredBoolean = [titleClause, requiredClause, preferredClause, locationClause, linkedinClause]
    .filter(Boolean)
    .join(' AND ');

  return {
    requiredBoolean,
    preferredBoolean,
  };
}

export function toStructuredRequirements(parsedInput) {
  const parsed = normalizeParsedRequirements(parsedInput);
  const aliases = buildAliases(parsed);
  const booleanQueries = buildBooleanQueries(parsed);

  return {
    jobTitle: parsed.job_title.main,
    titleVariations: parsed.job_title.synonyms,
    industry: parsed.industry,
    durationType: parsed.duration_type,
    location: parsed.location,
    experienceYears: parsed.experience_years,
    maxExperienceYears: parsed.max_experience_years,
    experienceLevel: parsed.experience_level,
    organizationHierarchy: parsed.organization_hierarchy,
    salaryPackage: parsed.salary_package,
    availability: parsed.availability,
    education: parsed.education,
    requiredSkills: parsed.required_skills,
    preferredSkills: parsed.preferred_skills,
    mustHaveSkills: parsed.must_have_skills,
    companyTypes: parsed.company_types,
    remote: parsed.remote,
    aliases,
    booleanQueries,
    idly: {
      industry: parsed.industry,
      durationType: parsed.duration_type,
      location: parsed.location,
      yearsOfExperience: parsed.experience_years,
    },
    dosa: {
      desiredSkills: parsed.required_skills,
      organizationHierarchy: parsed.organization_hierarchy,
      salaryPackage: parsed.salary_package,
      availability: parsed.availability,
    },
  };
}

export function generateSearchQueries(parsedInput, maxQueries = 6) {
  const parsed = normalizeParsedRequirements(parsedInput);
  const aliases = buildAliases(parsed);

  const titles = uniqueStrings(aliases.titleAliases, 4);
  const coreSkills = uniqueStrings(
    parsed.must_have_skills.length ? parsed.must_have_skills : parsed.required_skills,
    5
  );
  const skillsClause = coreSkills.length ? `(${coreSkills.map((s) => `"${s}"`).join(' OR ')})` : '';
  const location = String(parsed.location || '').trim();
  const includeLocation = Boolean(location && !/unspecified|not specified|remote/i.test(location));
  const cityName = location.split(',')[0].trim();
  const locationClause = includeLocation
    ? `("${location}" OR "Greater ${cityName} Area" OR "${cityName}")`
    : '';
  const durationType = String(parsed.duration_type || '').trim();
  const includeDuration = Boolean(durationType && !/not specified/i.test(durationType));
  const durationClause = includeDuration ? `("${durationType}")` : '';
  const salaryPackage = String(parsed.salary_package || '').trim();
  const includeSalary = Boolean(salaryPackage && !/not specified/i.test(salaryPackage));
  const salaryClause = includeSalary ? `("${salaryPackage}")` : '';

  // When location is specified, make it an AND clause (not OR) so Google only returns
  // profiles that mention the target city — this is the primary location gate.
  // locationClause is already built as `("City" OR "Greater City Area" OR "City")` which
  // is fine because all variants point to the same geography.
  const locationAnd = includeLocation ? locationClause : '';

  const queries = [];
  for (const title of titles) {
    queries.push(
      [`"${title}"`, skillsClause, locationAnd, durationClause, salaryClause, 'site:linkedin.com/in']
        .filter(Boolean)
        .join(' AND ')
    );
  }

  if (titles.length) {
    queries.push(
      [`(${titles.map((t) => `"${t}"`).join(' OR ')})`, skillsClause, locationAnd, '"open to work"', 'site:linkedin.com/in']
        .filter(Boolean)
        .join(' AND ')
    );
  }

  if (parsed.remote) {
    queries.push(
      [`"${parsed.job_title.main}"`, skillsClause, '("remote" OR "distributed")', 'site:linkedin.com/in']
        .filter(Boolean)
        .join(' AND ')
    );
  }

  // Resume-oriented pass
  queries.push(
    [`"${parsed.job_title.main}"`, skillsClause, locationAnd, '("resume" OR "cv")', 'site:linkedin.com/in']
      .filter(Boolean)
      .join(' AND ')
  );

  return uniqueStrings(queries, Math.min(Math.max(1, Number(maxQueries) || 6), 8));
}

/**
 * Generate simple keyword queries for HarvestAPI LinkedIn Profile Search.
 * LinkedIn's search engine handles relevance — no Boolean syntax needed.
 */
export function generateLinkedInQueries(parsedInput, maxQueries = 4) {
  const parsed = normalizeParsedRequirements(parsedInput);
  const aliases = buildAliases(parsed);
  const titles = uniqueStrings(aliases.titleAliases, 3);
  const coreSkills = uniqueStrings(
    parsed.must_have_skills.length ? parsed.must_have_skills : parsed.required_skills,
    3
  );
  const skillsPart = coreSkills.join(' ');
  const location = String(parsed.location || '').trim();
  const cityName = location.split(',')[0].trim();
  const locationPart = cityName && !/unspecified|not specified|remote/i.test(cityName) ? cityName : '';

  const queries = [];
  for (const title of titles) {
    queries.push([title, skillsPart, locationPart].filter(Boolean).join(' '));
  }
  if (parsed.job_title.main) {
    queries.push([parsed.job_title.main, skillsPart, locationPart].filter(Boolean).join(' '));
  }

  return uniqueStrings(queries, Math.min(Math.max(1, Number(maxQueries) || 4), 6));
}

/**
 * Generate GitHub + Stack Overflow dorking queries for the same role/skills.
 * These run in the same Apify batch as LinkedIn queries (no extra API cost).
 * Only generated for tech roles (skills required).
 */
export function generateOsintQueries(parsedInput) {
  const parsed = normalizeParsedRequirements(parsedInput);
  const coreSkills = uniqueStrings(
    parsed.must_have_skills.length ? parsed.must_have_skills : parsed.required_skills,
    4
  );

  // Skip OSINT queries if no technical skills — non-tech roles won't have GitHub profiles
  if (coreSkills.length === 0) return [];

  const skillsClause = `(${coreSkills.map((s) => `"${s}"`).join(' OR ')})`;
  const mainTitle = parsed.job_title.main;
  const location = String(parsed.location || '').trim();
  const includeLocation = Boolean(location && !/unspecified|not specified|remote/i.test(location));
  const cityName = location.split(',')[0].trim();
  const locationClause = includeLocation ? `("${cityName}")` : '';

  const queries = [];

  // GitHub — developer profiles showing skills and title
  queries.push(
    [`"${mainTitle}"`, skillsClause, locationClause, 'site:github.com']
      .filter(Boolean).join(' AND ')
  );

  // Stack Overflow — user profile pages
  queries.push(
    [`"${mainTitle}"`, skillsClause, 'site:stackoverflow.com/users']
      .filter(Boolean).join(' AND ')
  );

  return uniqueStrings(queries, 4);
}

// ── LinkedIn Filter ID Mappers ─────────────────────────────────────────────

function mapExperienceYearsToIds(years) {
  // 1=<1yr, 2=1-2yrs, 3=3-5yrs, 4=6-10yrs, 5=10+yrs
  const y = Number(years) || 0;
  if (y <= 0) return [];
  if (y <= 1) return ['1', '2'];
  if (y <= 2) return ['2', '3'];
  if (y <= 5) return ['3', '4'];
  if (y <= 10) return ['4', '5'];
  return ['5'];
}

function mapExperienceLevelToSeniorityIds(level) {
  // 110=Entry, 120=Senior, 200=EntryManager, 210=ExperiencedManager, 220=Director, 300=VP, 310=CXO
  const l = String(level || '').toLowerCase();
  if (l === 'junior') return ['110'];
  if (l === 'mid') return ['110', '120'];
  if (l === 'senior') return ['120'];
  if (l === 'lead') return ['120', '200'];
  if (l === 'executive') return ['220', '300', '310'];
  return ['120'];
}

function mapIndustryToIds(industry) {
  // 4=Software, 96=IT Services, 6=Internet, 43=Financial Services, 14=Healthcare
  const ind = String(industry || '').toLowerCase();
  if (/fintech|finance|banking|financial/i.test(ind)) return ['43', '4'];
  if (/health|medical|pharma/i.test(ind)) return ['14'];
  if (/ecommerce|e-commerce|retail/i.test(ind)) return ['27', '4'];
  if (/internet|saas/i.test(ind)) return ['6', '4'];
  if (/tech|software|it |information technology/i.test(ind)) return ['4', '96'];
  return ['4', '96'];
}

// Known city names — used to detect comma-separated multi-city strings.
// "Hyderabad, Pune" → split; "Bangalore, India" → keep as one (India not a city).
const KNOWN_CITIES = new Set([
  'bangalore', 'bengaluru', 'hyderabad', 'pune', 'mumbai', 'delhi', 'new delhi',
  'chennai', 'kolkata', 'gurgaon', 'noida', 'ahmedabad', 'jaipur', 'kochi',
  'coimbatore', 'surat', 'nagpur', 'indore', 'bhopal', 'lucknow', 'chandigarh',
  'london', 'berlin', 'munich', 'toronto', 'vancouver', 'sydney', 'melbourne',
  'singapore', 'new york', 'san francisco', 'seattle', 'austin', 'dubai', 'amsterdam',
]);

/**
 * Parse a location string that may contain multiple cities.
 * Supports: "/" "|" ";" "or" separators AND comma-separated known city names.
 * e.g. "Bangalore / Pune / Hyderabad" → ["Bangalore", "Pune", "Hyderabad"]
 * e.g. "Hyderabad, Pune"              → ["Hyderabad", "Pune"]   (both are known cities)
 * e.g. "Bangalore, India"             → ["Bangalore, India"]    (India is not a city)
 */
export function parseMultipleLocations(locationStr) {
  const raw = String(locationStr || '').trim();
  if (!raw || /unspecified|not specified|remote/i.test(raw)) return [];

  // Split on explicit multi-city separators first (/ | ; or)
  if (/[\/|;]|\bor\b/i.test(raw)) {
    const parts = raw
      .split(/\s*[\/|;]\s*|\s+or\s+/i)
      .map((p) => p.trim())
      .filter((p) => p && !/unspecified|not specified|remote/i.test(p));
    if (parts.length > 1) return parts;
  }

  // Comma-split: only when every part is a known city name
  // This avoids splitting "Bangalore, India" or "Bengaluru, Karnataka, India"
  if (raw.includes(',')) {
    const parts = raw.split(',').map((p) => p.trim()).filter(Boolean);
    if (parts.length > 1 && parts.every((p) => KNOWN_CITIES.has(p.toLowerCase()))) {
      return parts;
    }
  }

  return [raw];
}

// Full LinkedIn location strings for common cities.
// HarvestAPI needs "City, State, Country" to resolve locations unambiguously.
const CITY_TO_LINKEDIN_LOCATION = {
  bangalore:   'Bengaluru, Karnataka, India',
  bengaluru:   'Bengaluru, Karnataka, India',
  hyderabad:   'Hyderabad, Telangana, India',
  pune:        'Pune, Maharashtra, India',
  mumbai:      'Mumbai, Maharashtra, India',
  delhi:       'Delhi, India',
  'new delhi': 'New Delhi, Delhi, India',
  chennai:     'Chennai, Tamil Nadu, India',
  kolkata:     'Kolkata, West Bengal, India',
  gurgaon:     'Gurugram, Haryana, India',
  gurugram:    'Gurugram, Haryana, India',
  noida:       'Noida, Uttar Pradesh, India',
  ahmedabad:   'Ahmedabad, Gujarat, India',
  jaipur:      'Jaipur, Rajasthan, India',
  kochi:       'Kochi, Kerala, India',
  coimbatore:  'Coimbatore, Tamil Nadu, India',
  nagpur:      'Nagpur, Maharashtra, India',
  indore:      'Indore, Madhya Pradesh, India',
  chandigarh:  'Chandigarh, India',
  london:      'London, England, United Kingdom',
  berlin:      'Berlin, Germany',
  toronto:     'Toronto, Ontario, Canada',
  sydney:      'Sydney, New South Wales, Australia',
  singapore:   'Singapore',
  dubai:       'Dubai, United Arab Emirates',
};

function expandLocationForLinkedIn(city) {
  const key = city.trim().toLowerCase();
  return CITY_TO_LINKEDIN_LOCATION[key] || city;
}

/**
 * Build structured LinkedIn search parameters for the HarvestAPI actor.
 * Uses currentJobTitles filter (Lead search endpoint) instead of searchQuery to bypass
 * the "LinkedIn Member" anonymization that the basic searchQuery endpoint returns.
 */
export function buildLinkedInSearchParams(parsedInput) {
  const parsed = normalizeParsedRequirements(parsedInput);
  const aliases = buildAliases(parsed);

  // currentJobTitles triggers the Lead search endpoint — returns real profiles with URLs.
  // AI-generated title_variants take priority — they work for any role in any domain/language.
  // Hardcoded TITLE_ALIAS_MAP aliases are a fallback for common tech titles.
  const currentJobTitles = uniqueStrings(
    [
      parsed.job_title.main,
      ...(parsed.title_variants || []),   // AI-generated — works worldwide
      ...parsed.job_title.synonyms,
      ...aliases.titleAliases,            // hardcoded map fallback
    ],
    6
  );

  // Use AI-generated linkedin_locations if available — works for any city on Earth.
  // Fall back to the hardcoded CITY_TO_LINKEDIN_LOCATION map for common cities.
  const locations = (parsed.linkedin_locations && parsed.linkedin_locations.length > 0)
    ? parsed.linkedin_locations
    : parseMultipleLocations(parsed.location).map(expandLocationForLinkedIn);

  if (locations.length > 0) {
    logger.info(`[HarvestAPI] Resolved locations: ${locations.join(' | ')}`);
  }

  // Keep actor-side recall broad. Experience and industry are filtered/scored server-side.
  const yearsOfExperienceIds = [];
  const seniorityLevelIds = mapExperienceLevelToSeniorityIds(parsed.experience_level);
  const industryIds = [];

  return {
    currentJobTitles,
    locations,
    yearsOfExperienceIds,
    seniorityLevelIds,
    industryIds,
    profileScraperMode: 'Full',
    takePages: 1,
    postFilteringMongoQuery: null,
  };
}

/**
 * Build a free-text searchQuery from the JD's must-have + required skills.
 * Used as a fallback / parallel search when job titles are too niche to return results.
 * Returns null if no skills are available.
 */
export function buildSkillSearchQuery(parsedInput) {
  const parsed = normalizeParsedRequirements(parsedInput);
  const coreSkills = uniqueStrings(
    [
      ...(parsed.must_have_skills || []),
      ...(parsed.required_skills  || []).slice(0, 4),
    ],
    6
  );
  if (coreSkills.length === 0) return null;

  // Append one AI-generated alias per skill to widen LinkedIn free-text recall.
  // e.g. "Kubernetes k8s React ReactJS" finds more profiles than "Kubernetes React" alone.
  const aiAliases = parsed.skill_aliases || {};
  const terms = [];
  for (const skill of coreSkills) {
    terms.push(skill);
    const aliases = aiAliases[skill] || aiAliases[skill.toLowerCase()] || [];
    if (aliases.length > 0) terms.push(aliases[0]); // just the first alias to keep query short
  }
  return uniqueStrings(terms, 10).join(' ');
}

export function determineTargetCountries(location, isRemote) {
  const normalized = String(location || '').toLowerCase();

  if (isRemote || normalized.includes('remote') || normalized.includes('anywhere')) {
    return ['us', 'india', 'uk', 'canada', 'germany'];
  }

  const countryMap = {
    india: ['india'],
    pune: ['india'],
    bangalore: ['india'],
    bengaluru: ['india'],
    hyderabad: ['india'],
    mumbai: ['india'],
    chennai: ['india'],
    delhi: ['india'],
    gurgaon: ['india'],
    uk: ['uk'],
    london: ['uk'],
    'united kingdom': ['uk'],
    germany: ['germany'],
    berlin: ['germany'],
    munich: ['germany'],
    netherlands: ['netherlands'],
    singapore: ['singapore'],
    australia: ['australia'],
    canada: ['canada'],
    us: ['us'],
    usa: ['us'],
    'united states': ['us'],
  };

  for (const [key, countries] of Object.entries(countryMap)) {
    if (normalized.includes(key)) return countries;
  }
  return ['india', 'uk', 'us'];
}

export default {
  parseJobDescription,
  normalizeParsedRequirements,
  toStructuredRequirements,
  buildAliases,
  buildBooleanQueries,
  generateSearchQueries,
  generateLinkedInQueries,
  generateOsintQueries,
  buildLinkedInSearchParams,
  buildSkillSearchQuery,
  parseMultipleLocations,
  determineTargetCountries,
};
