/**
 * ProxyCurl LinkedIn data service.
 * Replaces Serper (Google snippet scraping) with direct LinkedIn profile data.
 *
 * Why this is better than Serper:
 *  - Real structured data — actual job history, skills, education from LinkedIn
 *  - Real experience years — calculated from experiences[].starts_at/ends_at dates
 *  - Accurate location — profile.city / profile.country, not extracted from a 2-line snippet
 *  - No OpenAI enrichment needed — data is already structured
 */
import axios from 'axios';
import logger from './logger.js';

const BASE_URL = 'https://nubela.co/proxycurl/api';

// Location string → ISO 3166-1 alpha-2 country code
const COUNTRY_TO_ISO = {
  india: 'IN', uk: 'GB', 'united kingdom': 'GB', germany: 'DE',
  usa: 'US', us: 'US', 'united states': 'US', canada: 'CA',
  australia: 'AU', singapore: 'SG', france: 'FR', netherlands: 'NL',
  spain: 'ES', italy: 'IT', sweden: 'SE', norway: 'NO', denmark: 'DK',
  switzerland: 'CH', austria: 'AT', belgium: 'BE', poland: 'PL',
  portugal: 'PT', uae: 'AE', 'united arab emirates': 'AE',
  'saudi arabia': 'SA', japan: 'JP', 'south korea': 'KR',
  thailand: 'TH', vietnam: 'VN', philippines: 'PH', indonesia: 'ID',
  malaysia: 'MY', pakistan: 'PK', bangladesh: 'BD', 'new zealand': 'NZ',
  brazil: 'BR', mexico: 'MX', argentina: 'AR', 'south africa': 'ZA',
  ireland: 'IE', israel: 'IL', ukraine: 'UA', russia: 'RU',
};

// City → ISO alpha-2 for cities not matching a country keyword directly
const CITY_TO_ISO = {
  hyderabad: 'IN', bangalore: 'IN', bengaluru: 'IN', mumbai: 'IN',
  delhi: 'IN', 'new delhi': 'IN', chennai: 'IN', pune: 'IN',
  kolkata: 'IN', gurgaon: 'IN', noida: 'IN', ahmedabad: 'IN',
  kochi: 'IN', jaipur: 'IN', coimbatore: 'IN',
  london: 'GB', manchester: 'GB', birmingham: 'GB', edinburgh: 'GB', bristol: 'GB',
  berlin: 'DE', munich: 'DE', frankfurt: 'DE', hamburg: 'DE', cologne: 'DE',
  toronto: 'CA', vancouver: 'CA', montreal: 'CA', calgary: 'CA',
  sydney: 'AU', melbourne: 'AU', brisbane: 'AU', perth: 'AU',
  singapore: 'SG',
  'new york': 'US', 'san francisco': 'US', seattle: 'US', austin: 'US',
  chicago: 'US', boston: 'US', 'los angeles': 'US', denver: 'US',
  dubai: 'AE', 'abu dhabi': 'AE',
  amsterdam: 'NL', paris: 'FR', madrid: 'ES', rome: 'IT',
  stockholm: 'SE', oslo: 'NO', copenhagen: 'DK', zurich: 'CH',
  warsaw: 'PL', lisbon: 'PT', brussels: 'BE', vienna: 'AT',
  tokyo: 'JP', seoul: 'KR', bangkok: 'TH',
};

function getApiKey() {
  return String(process.env.PROXYCURL_API_KEY || '').trim();
}

export function isConfigured() {
  return Boolean(getApiKey());
}

/**
 * Resolve city + ISO country code from a location string like "Hyderabad, India"
 */
export function resolveLocationParams(location) {
  if (!location || /unspecified|not specified|remote/i.test(location)) {
    return { countryIso: '', city: '' };
  }

  const parts = location.split(',').map(p => p.trim());
  const cityRaw = parts[0] || '';
  const cityLower = cityRaw.toLowerCase();
  const countryRaw = parts[parts.length - 1]?.toLowerCase() || '';

  const countryIso =
    CITY_TO_ISO[cityLower] ||
    COUNTRY_TO_ISO[countryRaw] ||
    COUNTRY_TO_ISO[cityLower] ||
    '';

  return {
    countryIso,
    city: cityRaw,
  };
}

/**
 * Calculate total professional experience years from LinkedIn experiences array.
 * Handles overlapping roles by summing raw duration per role (intentional — mirrors
 * how LinkedIn itself displays "X years of experience").
 */
export function calcExperienceYears(experiences) {
  if (!Array.isArray(experiences) || experiences.length === 0) return 0;
  const now = new Date();
  let totalMs = 0;

  for (const exp of experiences) {
    if (!exp.starts_at?.year) continue;
    const start = new Date(
      exp.starts_at.year,
      (exp.starts_at.month || 1) - 1,
      exp.starts_at.day || 1
    );
    const end = exp.ends_at?.year
      ? new Date(
          exp.ends_at.year,
          (exp.ends_at.month || 12) - 1,
          exp.ends_at.day || 1
        )
      : now;
    const ms = end - start;
    if (ms > 0) totalMs += ms;
  }

  return Math.round((totalMs / (1000 * 60 * 60 * 24 * 365.25)) * 10) / 10;
}

/**
 * Transform a raw ProxyCurl result into our internal candidate format.
 */
function transformProfile(result) {
  const profile = result.profile || {};
  const linkedinUrl = (result.linkedin_profile_url || '').split('?')[0].replace(/\/$/, '');

  // Current experience = the most recent role without an end date, or first role
  const currentRole = (profile.experiences || []).find(e => !e.ends_at)
    || (profile.experiences || [])[0]
    || {};

  const expYears = calcExperienceYears(profile.experiences || []);

  // Skills: LinkedIn skills array (strings)
  const skills = (profile.skills || []).filter(s => s && typeof s === 'string');

  // Education: top entry formatted as "Degree, School"
  const education = (profile.education || [])
    .slice(0, 1)
    .map(e => [e.degree_name, e.field_of_study, e.school].filter(Boolean).join(', '))
    .join('');

  // Location from actual profile — this is reliable, not extracted from a snippet
  const locationParts = [profile.city, profile.state, profile.country_full_name].filter(Boolean);
  const location = locationParts.join(', ');

  return {
    // Identity
    name: profile.full_name || '',
    fullName: profile.full_name || '',
    jobTitle: currentRole.title || profile.occupation || '',
    company: currentRole.company || '',

    // Location — from actual LinkedIn profile data, not a snippet
    location,
    city: profile.city || '',
    state: profile.state || '',
    country: profile.country_full_name || '',
    countryCode: profile.country || '',
    foundIn: profile.country_full_name || '',
    sourceCountry: profile.country_full_name || '',

    // Contact / social
    linkedinUrl,
    linkedInUrl: linkedinUrl,
    normalizedUrl: linkedinUrl.toLowerCase(),
    profilePic: profile.profile_pic_url || null,

    // Skills — real LinkedIn data
    skills,

    // Experience — REAL years from job history, not text-extracted
    experienceYears: expYears,
    totalExperience: expYears > 0 ? `${expYears} years` : '',

    // Education
    education,

    // Summary — LinkedIn "About" section
    about: profile.summary || '',
    headline: profile.headline || '',

    // Source flag
    source: 'AI_SOURCING',
    dataSource: 'proxycurl',
  };
}

/**
 * Single ProxyCurl Person Search call.
 *
 * @param {object} params
 * @param {string} params.jobTitle
 * @param {string[]} params.skills         up to 5
 * @param {string} params.city
 * @param {string} params.countryIso       ISO alpha-2
 * @param {number} params.pageSize         max 10
 * @returns {Promise<object[]>}            raw ProxyCurl results
 */
async function searchPersons({ jobTitle, skills = [], city, countryIso, pageSize = 10 }) {
  const apiKey = getApiKey();
  if (!apiKey) return [];

  const params = new URLSearchParams();
  if (countryIso) params.append('country', countryIso);
  if (jobTitle)   params.append('current_role_title', jobTitle);
  if (city)       params.append('city', city);
  params.append('enrich_profiles', 'enrich');
  params.append('page_size', String(Math.min(pageSize, 10)));

  // ProxyCurl supports multiple `skills` query params
  for (const skill of skills.slice(0, 5)) {
    params.append('skills', skill);
  }

  logger.info(`[ProxyCurl] Search: title="${jobTitle}" city="${city}" iso="${countryIso}" skills=[${skills.slice(0, 5).join(', ')}]`);

  try {
    const response = await axios.get(
      `${BASE_URL}/search/person?${params.toString()}`,
      {
        headers: { Authorization: `Bearer ${apiKey}` },
        timeout: 30000,
      }
    );

    const results = response.data?.results || [];
    logger.info(`[ProxyCurl] ${results.length} profiles returned`);
    return results;
  } catch (error) {
    const status = error.response?.status;
    const msg = error.response?.data?.message || error.message;
    if (status === 401) logger.error('[ProxyCurl] 401 — invalid API key');
    else if (status === 402) logger.error('[ProxyCurl] 402 — insufficient credits');
    else if (status === 429) logger.warn('[ProxyCurl] 429 — rate limited');
    else logger.warn(`[ProxyCurl] Search failed (HTTP ${status ?? 'timeout'}): ${msg}`);
    return [];
  }
}

/**
 * Source candidates via ProxyCurl Person Search.
 *
 * Runs multiple search batches (title variations × skill subsets) to maximise
 * coverage, then deduplicates by LinkedIn URL.
 *
 * @param {object} parsed         normalised JD requirements
 * @param {object} options
 * @param {number} options.maxCandidates
 * @returns {Promise<object[]|null>}  null when PROXYCURL_API_KEY is not set
 */
export async function sourceCandidatesViaProxyCurl(parsed, { maxCandidates = 50 } = {}) {
  if (!isConfigured()) return null;

  const { countryIso, city } = resolveLocationParams(parsed.location || '');

  const mainTitle    = parsed.job_title?.main || '';
  const titleSynonyms = (parsed.job_title?.synonyms || []).slice(0, 2);
  const mustHave     = parsed.must_have_skills  || [];
  const required     = parsed.required_skills   || [];
  const preferred    = parsed.preferred_skills  || [];

  const coreSkills = mustHave.length > 0 ? mustHave : required;

  // Build search batches:
  //   Batch per title variant with core skills
  //   Extra batch: main title + mix of preferred skills for richer variety
  const titleVariants = [mainTitle, ...titleSynonyms].filter(Boolean);
  const batchSize = Math.ceil(maxCandidates / (titleVariants.length + 1)) + 2;

  const batches = titleVariants.map(title => ({
    jobTitle: title,
    skills: coreSkills.slice(0, 5),
    city,
    countryIso,
    pageSize: Math.min(batchSize, 10),
  }));

  // Preferred-skills sweep if we have them
  if (preferred.length > 0) {
    batches.push({
      jobTitle: mainTitle,
      skills: [...coreSkills.slice(0, 3), ...preferred.slice(0, 2)],
      city,
      countryIso,
      pageSize: 10,
    });
  }

  logger.info(`[ProxyCurl] Running ${batches.length} batches for "${mainTitle}" in "${city || countryIso}"`);

  const seen = new Set();
  const candidates = [];

  for (const batch of batches) {
    const results = await searchPersons(batch);
    for (const r of results) {
      if (!r.profile) continue;
      const url = (r.linkedin_profile_url || '').split('?')[0].replace(/\/$/, '').toLowerCase();
      if (!url || seen.has(url)) continue;
      seen.add(url);
      candidates.push(transformProfile(r));
    }
  }

  logger.info(`[ProxyCurl] ${candidates.length} unique profiles collected`);
  return candidates;
}

export default {
  isConfigured,
  resolveLocationParams,
  calcExperienceYears,
  sourceCandidatesViaProxyCurl,
};
