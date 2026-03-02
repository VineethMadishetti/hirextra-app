import OpenAI from 'openai';
import logger from './logger.js';

let openai = null;

function getOpenAIClient() {
  if (!openai) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY not configured. Please set it in environment variables.');
    }
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openai;
}

function normalizeSkillList(input, maxItems = 8) {
  const list = Array.isArray(input) ? input : [];
  const deduped = [];
  const seen = new Set();

  for (const item of list) {
    const value = String(item || '').trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(value);
    if (deduped.length >= maxItems) break;
  }

  return deduped;
}

function normalizeTitleObject(jobTitle) {
  const main = String(jobTitle?.main || '').trim();
  const synonyms = normalizeSkillList(jobTitle?.synonyms || [], 4).filter(
    (s) => s.toLowerCase() !== main.toLowerCase()
  );
  return { main: main || 'Software Engineer', synonyms };
}

export const parseJobDescription = async (jobDescription) => {
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
          content: `You are a recruitment AI parser. Return ONLY valid JSON using this schema:
{
  "job_title": { "main": "string", "synonyms": ["string"] },
  "skills": ["string"],
  "must_have_skills": ["string"],
  "nice_to_have_skills": ["string"],
  "experience_years": number,
  "experience_level": "Junior|Mid|Senior|Lead|Executive",
  "location": "string",
  "remote": boolean,
  "company_types": ["string"]
}

Rules:
- Extract concise values from text only. Do not invent.
- Keep skills <= 10, must_have_skills <= 5, nice_to_have_skills <= 5.
- If location missing, use "Unspecified".
- If experience is missing, use 0.
- Return JSON only.`,
        },
        {
          role: 'user',
          content: `Extract structured hiring requirements from this JD:\n\n${jobDescription}`,
        },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
      max_tokens: 700,
    });

    const parsedRaw = JSON.parse(response.choices?.[0]?.message?.content || '{}');
    const job_title = normalizeTitleObject(parsedRaw.job_title || {});
    const skills = normalizeSkillList(parsedRaw.skills, 10);
    const must_have_skills = normalizeSkillList(parsedRaw.must_have_skills, 5);
    const nice_to_have_skills = normalizeSkillList(parsedRaw.nice_to_have_skills, 5);
    const experience_years = Math.max(0, Number(parsedRaw.experience_years || 0));
    const experience_level = String(
      parsedRaw.experience_level || (experience_years >= 8 ? 'Lead' : experience_years >= 4 ? 'Senior' : 'Mid')
    ).trim();
    const location = String(parsedRaw.location || 'Unspecified').trim() || 'Unspecified';
    const remote = Boolean(parsedRaw.remote);
    const company_types = normalizeSkillList(parsedRaw.company_types, 5);

    const parsed = {
      job_title,
      skills,
      must_have_skills,
      nice_to_have_skills,
      experience_years,
      experience_level,
      location,
      remote,
      company_types,
    };

    logger.info(`JD parsed successfully: ${parsed.job_title.main}`);
    return parsed;
  } catch (error) {
    logger.error(`OpenAI parsing error: ${error.message}`);
    throw new Error(`Job description parsing failed: ${error.message}`);
  }
};

export const generateSearchQueries = (parsed, maxQueries = 6) => {
  const titleMain = parsed?.job_title?.main || 'Software Engineer';
  const titleVariants = [titleMain, ...(parsed?.job_title?.synonyms || [])]
    .map((t) => String(t || '').trim())
    .filter(Boolean)
    .slice(0, 3);

  const mustHave = normalizeSkillList(parsed?.must_have_skills || [], 4);
  const fallbackSkills = normalizeSkillList(parsed?.skills || [], 4);
  const skills = mustHave.length > 0 ? mustHave : fallbackSkills;

  const location = String(parsed?.location || '').trim();
  const includeLocation = Boolean(location && !/unspecified|unknown|remote/i.test(location));
  const locationToken = includeLocation ? `("${location}")` : '';
  const skillToken = skills.length > 0 ? `(${skills.map((s) => `"${s}"`).join(' OR ')})` : '';

  const queries = [];
  for (const title of titleVariants) {
    const baseParts = [`"${title}"`, skillToken, locationToken, 'site:linkedin.com/in'];
    queries.push(baseParts.filter(Boolean).join(' '));
  }

  if (skills.length > 0) {
    queries.push(
      `("${titleVariants.join('" OR "')}") ${skillToken} ("open to work" OR "actively looking") site:linkedin.com/in`
    );
  }

  if (['Senior', 'Lead', 'Executive'].includes(parsed?.experience_level)) {
    queries.push(
      `("Senior ${titleMain}" OR "Lead ${titleMain}" OR "Principal ${titleMain}") ${skillToken} site:linkedin.com/in`
    );
  }

  if (parsed?.remote) {
    queries.push(`"${titleMain}" ${skillToken} ("remote" OR "distributed") site:linkedin.com/in`);
  }

  return normalizeSkillList(queries, maxQueries);
};

export const determineTargetCountries = (location, isRemote) => {
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
    amsterdam: ['netherlands'],
    singapore: ['singapore'],
    australia: ['australia'],
    sydney: ['australia'],
    canada: ['canada'],
    toronto: ['canada'],
    us: ['us'],
    usa: ['us'],
    'united states': ['us'],
    california: ['us'],
    'new york': ['us'],
  };

  for (const [key, countries] of Object.entries(countryMap)) {
    if (normalized.includes(key)) return countries;
  }

  return ['india', 'uk', 'us'];
};

export default {
  parseJobDescription,
  generateSearchQueries,
  determineTargetCountries,
};
