import OpenAI from 'openai';
import logger from './logger.js';

/**
 * AI Service for parsing job descriptions
 * Uses OpenAI to extract structured candidate requirements
 */

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export const parseJobDescription = async (jobDescription) => {
  if (!jobDescription || jobDescription.trim().length < 20) {
    throw new Error('Job description must be at least 20 characters');
  }

  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY not set in environment variables');
  }

  try {
    logger.info(`🤖 Parsing job description (${jobDescription.length} chars)...`);

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini', // Cost-effective model
      messages: [
        {
          role: 'system',
          content: `You are a recruitment AI. Extract key information from job descriptions and return ONLY valid JSON with these exact fields:
- job_title: object with "main" (string) and "synonyms" (array of 2-3 strings)
- skills: array of required technical skills (max 8, strings)
- experience_years: minimum years required (number)
- experience_level: "Junior" | "Mid" | "Senior" | "Lead" | "Executive" (string)
- location: city/country mentioned, or "Remote" (string)
- remote: boolean, true if remote/work from home/distributed mentioned
- must_have_skills: array of critical skills (max 3, strings)
- nice_to_have_skills: array of secondary skills (max 3, strings)
- company_types: array of desired company types if mentioned (max 3, strings)

Return ONLY the JSON object, no other text.`,
        },
        {
          role: 'user',
          content: `Extract from this job description:\n\n${jobDescription}`,
        },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1, // Deterministic output
      max_tokens: 500,
    });

    const content = response.choices[0].message.content;
    const parsed = JSON.parse(content);

    // Validate required fields exist
    const required = ['job_title', 'skills', 'experience_years', 'location', 'remote'];
    for (const field of required) {
      if (!(field in parsed)) {
        parsed[field] = field === 'location' ? 'Unknown' : field === 'skills' ? [] : 0;
      }
    }

    // Ensure defaults for optional fields
    if (!parsed.experience_level)
      parsed.experience_level = parsed.experience_years >= 5 ? 'Senior' : 'Mid';
    if (!parsed.must_have_skills) parsed.must_have_skills = [];
    if (!parsed.nice_to_have_skills) parsed.nice_to_have_skills = [];
    if (!parsed.company_types) parsed.company_types = [];

    logger.info(`✅ JD Parsed successfully: ${parsed.job_title?.main || 'Unknown'}`);

    return parsed;
  } catch (error) {
    if (error instanceof SyntaxError) {
      logger.error('❌ Invalid JSON from OpenAI:', error.message);
      throw new Error('Failed to parse job description - invalid response format');
    }
    logger.error('❌ OpenAI API error:', error.message);
    throw new Error(`Job description parsing failed: ${error.message}`);
  }
};

/**
 * Generate optimized search queries from parsed job description
 */
export const generateSearchQueries = (parsed) => {
  const queries = [];

  const title = parsed.job_title?.main || 'Developer';
  const synonyms = parsed.job_title?.synonyms || [];
  const mustHaveSkills = parsed.must_have_skills || [];
  const skills = parsed.skills || [];

  // Build skill string for search
  const searchSkills = mustHaveSkills.length > 0 ? mustHaveSkills : skills.slice(0, 3);
  const skillStr = searchSkills.map((s) => `"${s}"`).join(' OR ');

  // Query 1: Exact title + skills + LinkedIn
  if (skillStr) {
    queries.push(`"${title}" (${skillStr}) site:linkedin.com/in`);
  } else {
    queries.push(`"${title}" site:linkedin.com/in`);
  }

  // Query 2: Synonym titles
  for (const syn of synonyms.slice(0, 2)) {
    queries.push(`"${syn}" ${skillStr ? `(${skillStr})` : ''} site:linkedin.com/in`);
  }

  // Query 3: High-intent searchers
  queries.push(
    `"${title}" ("open to work" OR "actively looking" OR "seeking" OR "available") site:linkedin.com/in`
  );

  // Query 4: Senior/Lead specific (if applicable)
  if (['Senior', 'Lead', 'Executive'].includes(parsed.experience_level)) {
    queries.push(
      `("Senior ${title}" OR "Lead ${title}") ${skillStr ? `(${skillStr})` : ''} site:linkedin.com/in`
    );
  }

  return queries.filter(Boolean).slice(0, 4); // Max 4 queries to control costs
};

/**
 * Determine target countries based on location in JD
 */
export const determineTargetCountries = (location, isRemote) => {
  const location_lower = (location || '').toLowerCase();

  // Remote jobs - search top talent markets
  if (isRemote || location_lower.includes('remote') || location_lower.includes('anywhere')) {
    return ['india', 'uk', 'us', 'canada', 'germany'];
  }

  // Country mapping
  const countryMap = {
    india: ['india'],
    pune: ['india'],
    bangalore: ['india'],
    mumbai: ['india'],
    hyderabad: ['india'],
    chennai: ['india'],
    delhi: ['india'],
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
    melbourne: ['australia'],
    canada: ['canada'],
    toronto: ['canada'],
    vancouver: ['canada'],
    us: ['us'],
    usa: ['us'],
    'united states': ['us'],
  };

  for (const [key, countries] of Object.entries(countryMap)) {
    if (location_lower.includes(key)) {
      return countries;
    }
  }

  // Default to India + UK for broad searches
  return ['india', 'uk'];
};
