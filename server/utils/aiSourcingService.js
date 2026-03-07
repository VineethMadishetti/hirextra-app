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

  const must_have_skills = uniqueStrings(raw.must_have_skills || raw.mustHaveSkills || required_skills, 6);
  const experience_years = normalizeNumber(raw.experience_years || raw.experienceYears || raw.yearsOfExperience, 0);
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

  return {
    job_title,
    industry,
    duration_type,
    location,
    experience_years,
    experience_level,
    organization_hierarchy,
    salary_package,
    availability,
    education,
    required_skills,
    preferred_skills,
    must_have_skills,
    company_types,
    remote,
  };
}

function fallbackParse(jd) {
  logger.warn('AI parsing failed, using regex-based fallback.');
  const lowerJd = jd.toLowerCase();

  // Extract years of experience
  const yearsMatch = lowerJd.match(/(\d+)\+?\s*years?/);
  const years = yearsMatch ? parseInt(yearsMatch[1], 10) : 3;

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
  "industry": "string",
  "duration_type": "string",
  "location": "string",
  "experience_years": number,
  "experience_level": "Junior|Mid|Senior|Lead|Executive",
  "organization_hierarchy": "string",
  "salary_package": "string",
  "availability": "string",
  "education": "string",
  "required_skills": ["string"],
  "preferred_skills": ["string"],
  "must_have_skills": ["string"],
  "company_types": ["string"],
  "remote": boolean
}

Extraction policy:
- Keep concise and precise.
- Extract from text only; do not invent.
- Required skills <= 12, preferred skills <= 10, must-have <= 6.
- If missing, use "Not Specified" for string fields and 0 for experience_years.
- Return JSON only.

Example:
User Input: "Seeking a Senior Backend Engineer with 8+ years of experience in Java and Spring Boot for our fintech team in London. Must have strong knowledge of microservices and AWS. Kafka is a plus. This is a full-time permanent role."
Your JSON Output:
{
  "job_title": { "main": "Senior Backend Engineer", "synonyms": ["Senior Java Developer", "Senior Software Engineer"] },
  "industry": "Fintech",
  "duration_type": "Full-time",
  "location": "London",
  "experience_years": 8,
  "experience_level": "Senior",
  "organization_hierarchy": "Not Specified",
  "salary_package": "Not Specified",
  "availability": "Not Specified",
  "education": "Not Specified",
  "required_skills": ["Java", "Spring Boot", "Microservices", "AWS"],
  "preferred_skills": ["Kafka"],
  "must_have_skills": ["Java", "Spring Boot", "Microservices", "AWS"],
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
      max_tokens: 900,
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
  const titleBase = [parsed?.job_title?.main, ...(parsed?.job_title?.synonyms || [])];
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
  const locationClause = includeLocation ? `("${location}")` : '';
  const linkedinClause = '"linkedin.com/in"';

  const requiredBoolean = [titleClause, requiredClause, locationClause, linkedinClause]
    .filter(Boolean)
    .join(' AND ');
  const preferredBoolean = [titleClause, requiredClause, preferredClause, linkedinClause]
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
  const locationClause = includeLocation ? `("${location}")` : '';
  const durationType = String(parsed.duration_type || '').trim();
  const includeDuration = Boolean(durationType && !/not specified/i.test(durationType));
  const durationClause = includeDuration ? `("${durationType}")` : '';
  const salaryPackage = String(parsed.salary_package || '').trim();
  const includeSalary = Boolean(salaryPackage && !/not specified/i.test(salaryPackage));
  const salaryClause = includeSalary ? `("${salaryPackage}")` : '';

  const queries = [];
  for (const title of titles) {
    queries.push(
      [`"${title}"`, skillsClause, locationClause, durationClause, salaryClause, '"linkedin.com/in"']
        .filter(Boolean)
        .join(' ')
    );
  }

  if (titles.length) {
    queries.push(
      [`(${titles.map((t) => `"${t}"`).join(' OR ')})`, skillsClause, durationClause, salaryClause, '"open to work"', '"linkedin.com/in"']
        .filter(Boolean)
        .join(' ')
    );
  }

  if (parsed.remote) {
    queries.push(
      [`"${parsed.job_title.main}"`, skillsClause, durationClause, salaryClause, '("remote" OR "distributed")', '"linkedin.com/in"']
        .filter(Boolean)
        .join(' ')
    );
  }

  // Resume-oriented pass (still linked to LinkedIn profile results)
  queries.push(
    [`"${parsed.job_title.main}"`, skillsClause, durationClause, salaryClause, '("resume" OR "cv")', '"linkedin.com/in"']
      .filter(Boolean)
      .join(' ')
  );

  return uniqueStrings(queries, Math.min(Math.max(1, Number(maxQueries) || 6), 8));
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
  determineTargetCountries,
};
