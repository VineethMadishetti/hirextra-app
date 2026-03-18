/**
 * People Data Labs (PDL) Person Search service.
 *
 * API reference: https://docs.peopledatalabs.com/docs/person-search-api
 *
 * Flow:
 *   POST /v5/person/search  → array of person profiles (no separate collect step needed)
 *
 * Auth: header  `X-Api-Key: {key}`
 *
 * Tiered search strategy (Kumar's rules):
 *   Tier 1 — top 2 must-have skills AND + title + city   (highest precision)
 *   Tier 2 — primary skill + title + city                (strong match)
 *   Tier 3 — skills OR'd + title + country               (broad sweep)
 *   Tier 4 — title + country only                        (safety fallback)
 *
 * PDL profile fields:
 *   - job_title / experience[].title  — current / historical titles
 *   - location_country (lowercase, e.g. "india")
 *   - location_locality (lowercase city, e.g. "hyderabad")
 *   - skills (array of lowercase strings, e.g. ["python", "spring boot"])
 *   - experience[].start_date / end_date  — "YYYY-MM-DD" strings
 *   - inferred_years_experience  — integer, PDL's own calculated years
 */

import axios from 'axios';
import logger from './logger.js';

const BASE_URL = 'https://api.peopledatalabs.com/v5';

// City → PDL location_country value (always lowercase)
const CITY_TO_COUNTRY = {
  hyderabad: 'india', bangalore: 'india', bengaluru: 'india', mumbai: 'india',
  delhi: 'india', 'new delhi': 'india', chennai: 'india', pune: 'india',
  kolkata: 'india', gurgaon: 'india', noida: 'india', ahmedabad: 'india',
  kochi: 'india', jaipur: 'india',
  london: 'united kingdom', manchester: 'united kingdom', birmingham: 'united kingdom',
  edinburgh: 'united kingdom', bristol: 'united kingdom',
  berlin: 'germany', munich: 'germany', frankfurt: 'germany', hamburg: 'germany',
  toronto: 'canada', vancouver: 'canada', montreal: 'canada',
  sydney: 'australia', melbourne: 'australia', brisbane: 'australia',
  singapore: 'singapore',
  'new york': 'united states', 'san francisco': 'united states', seattle: 'united states',
  austin: 'united states', chicago: 'united states', boston: 'united states',
  dubai: 'united arab emirates', 'abu dhabi': 'united arab emirates',
  amsterdam: 'netherlands', paris: 'france', madrid: 'spain',
  stockholm: 'sweden', zurich: 'switzerland', warsaw: 'poland',
  tokyo: 'japan', seoul: 'south korea', bangkok: 'thailand',
};

// Country name/alias → PDL location_country value (always lowercase)
const COUNTRY_TO_PDL = {
  india: 'india', uk: 'united kingdom', 'united kingdom': 'united kingdom',
  germany: 'germany', usa: 'united states', us: 'united states',
  'united states': 'united states', canada: 'canada', australia: 'australia',
  singapore: 'singapore', france: 'france', netherlands: 'netherlands',
  spain: 'spain', italy: 'italy', sweden: 'sweden', norway: 'norway',
  denmark: 'denmark', switzerland: 'switzerland', austria: 'austria',
  belgium: 'belgium', poland: 'poland', uae: 'united arab emirates',
  'united arab emirates': 'united arab emirates', japan: 'japan',
  'south korea': 'south korea', brazil: 'brazil', 'south africa': 'south africa',
};

function getApiKey() {
  return String(process.env.PDL_API_KEY || '').trim();
}

export function isConfigured() {
  return Boolean(getApiKey());
}

/**
 * Resolve PDL-compatible location params from a string like "Hyderabad, India".
 * PDL uses lowercase country names (location_country) and lowercase city (location_locality).
 */
export function resolveLocationParams(location) {
  if (!location || /unspecified|not specified|remote/i.test(location)) {
    return { city: '', country: '' };
  }
  const parts = location.split(',').map(p => p.trim().toLowerCase());
  const firstPart = parts[0] || '';
  const countryPart = parts[parts.length - 1] || '';

  const country =
    CITY_TO_COUNTRY[firstPart] ||
    COUNTRY_TO_PDL[countryPart] ||
    COUNTRY_TO_PDL[firstPart] ||
    '';

  // If the first part is itself a country name (no specific city given), leave city empty.
  // e.g. "India" → city='', country='india' — avoids filtering location_locality='india' in PDL.
  const city = COUNTRY_TO_PDL[firstPart] ? '' : firstPart;

  return { city, country };
}

/**
 * Calculate total professional experience years from PDL experience array.
 * PDL start_date / end_date format: "YYYY-MM-DD" or "YYYY-MM" or "YYYY"
 */
export function calcExperienceYears(experiences) {
  if (!Array.isArray(experiences) || experiences.length === 0) return 0;
  const now = new Date();
  let totalMs = 0;

  for (const exp of experiences) {
    if (!exp.start_date) continue;
    const startParts = String(exp.start_date).split('-');
    const start = new Date(
      parseInt(startParts[0], 10),
      parseInt(startParts[1] || '1', 10) - 1,
      parseInt(startParts[2] || '1', 10)
    );
    let end = now;
    if (exp.end_date) {
      const endParts = String(exp.end_date).split('-');
      end = new Date(
        parseInt(endParts[0], 10),
        parseInt(endParts[1] || '12', 10) - 1,
        parseInt(endParts[2] || '1', 10)
      );
    }
    const ms = end - start;
    if (ms > 0) totalMs += ms;
  }

  return Math.round((totalMs / (1000 * 60 * 60 * 24 * 365.25)) * 10) / 10;
}

/**
 * Build a PDL-compatible Elasticsearch DSL bool query.
 *
 * PDL's ES DSL supports: must, should, filter, term, terms, match
 * PDL does NOT support: minimum_should_match inside nested bool clauses
 *
 * Strategy:
 *   - Primary title → `match` in `must` (required)
 *   - Title synonyms → `match` in `should` (optional score boosters)
 *   - mustSkills → `term` per skill in `filter` (all required — AND)
 *   - anySkills  → `terms` in `must` (at least one required — OR via terms array)
 *   - country    → `term` in `filter`
 *   - city       → `term` in `filter` (exact lowercase locality match)
 *
 * @param {object} opts
 * @param {string[]} opts.titles         job title keywords (first is primary, rest optional)
 * @param {string[]} opts.mustSkills     skills that must ALL be present (AND)
 * @param {string[]} opts.anySkills      skills where at least one must be present (OR)
 * @param {string}   opts.city           lowercase city for location_locality filter
 * @param {string}   opts.country        lowercase PDL country for location_country filter
 */
function buildEsQuery({ titles = [], mustSkills = [], anySkills = [], city, country }) {
  const must = [];
  const should = [];
  const filter = [];

  // Title: primary title required (must), synonyms are optional score boosters (should)
  if (titles.length > 0) {
    must.push({ match: { job_title: titles[0] } });
    for (let i = 1; i < titles.length; i++) {
      should.push({ match: { job_title: titles[i] } });
    }
  }

  // Must-have skills: every skill must appear in the skills array (AND)
  for (const skill of mustSkills.map(s => s.toLowerCase())) {
    filter.push({ term: { skills: skill } });
  }

  // Any-skills: `terms` returns docs that have at least ONE of the listed values (OR)
  if (anySkills.length > 0) {
    must.push({ terms: { skills: anySkills.map(s => s.toLowerCase()) } });
  }

  // Location filters (exact keyword match — PDL stores these as lowercase)
  if (country) filter.push({ term: { location_country: country } });
  if (city)    filter.push({ term: { location_locality: city } });

  const boolClause = { must, filter };
  if (should.length > 0) boolClause.should = should;
  return { bool: boolClause };
}

/**
 * POST /v5/person/search → returns array of person profiles.
 */
async function searchPersons(esQuery, size = 20) {
  const apiKey = getApiKey();
  if (!apiKey) return [];

  const body = {
    query: esQuery,
    size: Math.min(size, 100),
    pretty: false,
    titlecase: false,
  };

  logger.info(`[PDL] Search (size=${size}): ${JSON.stringify(esQuery).slice(0, 300)}`);

  try {
    const response = await axios.post(
      `${BASE_URL}/person/search`,
      body,
      {
        headers: {
          'X-Api-Key': apiKey,
          'Content-Type': 'application/json',
        },
        timeout: 25000,
      }
    );

    const data = response.data?.data;
    const profiles = Array.isArray(data) ? data : [];
    logger.info(`[PDL] Search returned ${profiles.length} profiles (total=${response.data?.total ?? '?'})`);
    return profiles;
  } catch (error) {
    const status = error.response?.status;
    const msg = error.response?.data?.error?.message || error.response?.data?.message || JSON.stringify(error.response?.data) || error.message;
    if (status === 401) logger.error(`[PDL] 401 — invalid API key: ${msg}`);
    else if (status === 402) logger.error(`[PDL] 402 — insufficient credits: ${msg}`);
    else if (status === 422) logger.warn(`[PDL] 422 — invalid query: ${msg}`);
    else if (status === 429) logger.warn('[PDL] 429 — rate limited');
    else logger.warn(`[PDL] Search failed (HTTP ${status ?? 'timeout'}): ${msg}`);
    return [];
  }
}

/**
 * Transform a PDL person profile into our internal candidate format.
 */
function transformProfile(profile) {
  // Current role: prefer is_primary=true or most recent experience
  const experiences = profile.experience || [];
  const currentExp = experiences.find(e => e.is_primary) || experiences[0] || {};

  // Calculate real experience years from dates; fall back to PDL's inferred value
  const expYears = calcExperienceYears(experiences) || (profile.inferred_years_experience || 0);

  // Skills: PDL returns lowercase strings — preserve as-is (matchScorer lowercases both sides)
  const skills = (profile.skills || []).filter(s => s && typeof s === 'string');

  // Education: top entry formatted as "Degree, School"
  const education = (profile.education || [])
    .slice(0, 1)
    .map(e => [e.degree, e.field_of_study, e.school?.name].filter(Boolean).join(', '))
    .join('');

  // Location: PDL gives location_name (full string) and individual fields
  const city    = profile.location_locality || '';
  const country = profile.location_country  || '';
  const locationStr = profile.location_name || [city, country].filter(Boolean).join(', ');

  const linkedinUrl = (profile.linkedin_url || '').split('?')[0].replace(/\/$/, '');

  return {
    name:          profile.full_name || '',
    fullName:      profile.full_name || '',
    jobTitle:      currentExp.title || profile.job_title || '',
    company:       currentExp.company?.name || profile.job_company_name || '',

    location:      locationStr,
    city:          city,
    country:       country,
    foundIn:       country,
    sourceCountry: country,

    linkedinUrl,
    linkedInUrl:   linkedinUrl,
    normalizedUrl: linkedinUrl.toLowerCase().split('?')[0].replace(/\/$/, ''),
    profilePic:    profile.profile_pic_url || null,

    skills,

    experienceYears:  expYears,
    totalExperience:  expYears > 0 ? `${expYears} years` : '',

    education,
    about:    profile.summary || profile.bio || '',
    headline: profile.headline || profile.job_title || '',

    source:     'AI_SOURCING',
    dataSource: 'pdl',
  };
}

/**
 * Source candidates via People Data Labs.
 *
 * Runs 4 tiers in parallel (progressively more lenient), deduplicates,
 * and returns candidates ready for matchScorer.
 *
 * @param {object} parsed           normalised JD requirements
 * @param {object} options
 * @param {number} options.maxCandidates
 * @returns {Promise<object[]|null>}  null when PDL_API_KEY is not set
 */
export async function sourceCandidatesViaPDL(parsed, { maxCandidates = 50 } = {}) {
  if (!isConfigured()) return null;

  const { city, country } = resolveLocationParams(parsed.location || '');

  const mainTitle  = parsed.job_title?.main || '';
  const synonyms   = (parsed.job_title?.synonyms || []).slice(0, 3);
  const allTitles  = [mainTitle, ...synonyms].filter(Boolean);
  const mustHave   = parsed.must_have_skills  || [];
  const required   = parsed.required_skills   || [];
  const preferred  = parsed.preferred_skills  || [];

  const coreSkills = mustHave.length > 0 ? mustHave : required;

  const tierLimit = Math.ceil(maxCandidates / 2); // over-fetch, scorer will rank

  logger.info(`[PDL] Tier search: title="${mainTitle}" city="${city}" country="${country}"`);

  // Tier 1: top 2 core skills AND + title + city + country (highest precision)
  const tier1Query = buildEsQuery({
    titles:     allTitles,
    mustSkills: coreSkills.slice(0, 2),
    city,
    country,
  });

  // Tier 2: primary skill AND + title + city + country (strong match)
  const tier2Query = buildEsQuery({
    titles:     allTitles,
    mustSkills: coreSkills.slice(0, 1),
    city,
    country,
  });

  // Tier 3: all core + preferred skills OR + title + country only (broad sweep)
  const tier3Skills = [...new Set([...coreSkills.slice(0, 5), ...preferred.slice(0, 2)])];
  const tier3Query = buildEsQuery({
    titles:    allTitles,
    anySkills: tier3Skills,
    country,
  });

  // Tier 4: title + country only — safety fallback when city or skills too restrictive
  const tier4Query = buildEsQuery({
    titles: allTitles,
    country,
  });

  // Run all 4 tiers in parallel
  const [profiles1, profiles2, profiles3, profiles4] = await Promise.all([
    searchPersons(tier1Query, Math.min(tierLimit, 25)),
    searchPersons(tier2Query, Math.min(tierLimit, 25)),
    searchPersons(tier3Query, Math.min(tierLimit, 20)),
    searchPersons(tier4Query, 15),
  ]);

  logger.info(`[PDL] Tier results — T1:${profiles1.length} T2:${profiles2.length} T3:${profiles3.length} T4:${profiles4.length}`);

  // Deduplicate by linkedin_url — tier1 first means highest quality collected first
  const seen = new Set();
  const allProfiles = [];
  for (const p of [...profiles1, ...profiles2, ...profiles3, ...profiles4]) {
    const key = (p.linkedin_url || p.id || '').toLowerCase().split('?')[0].replace(/\/$/, '');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    allProfiles.push(p);
  }

  if (allProfiles.length === 0) {
    logger.warn('[PDL] No profiles returned from any search tier — check API key and query params');
    return [];
  }

  logger.info(`[PDL] ${allProfiles.length} unique profiles collected`);
  return allProfiles.map(transformProfile);
}

export default {
  isConfigured,
  resolveLocationParams,
  calcExperienceYears,
  sourceCandidatesViaPDL,
};
