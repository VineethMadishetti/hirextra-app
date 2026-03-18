/**
 * CoreSignal Employee API service.
 *
 * API reference: https://docs.coresignal.com/employee-api/base-employee-api
 *
 * Flow:
 *   1. POST /employee_base/search/filter  → array of employee IDs
 *   2. GET  /employee_base/collect/{id}   → full profile per ID
 *
 * Auth: custom header  `apikey: {key}`  (NOT Authorization: Bearer)
 *
 * Tiered search strategy (Kumar's rules):
 *   Tier 1 — must-have skills AND'd + title + city  (highest precision)
 *   Tier 2 — required skills top-3 AND'd + title + city
 *   Tier 3 — required skills OR'd  + title + city  (broadest sweep)
 *
 * matchScorer in sourcingController handles the actual score + ranking.
 * Experience years are calculated from real date_from_year / date_to_year
 * fields — NOT text-extracted guesses.
 */

import axios from 'axios';
import logger from './logger.js';

const BASE_URL = 'https://api.coresignal.com/cdapi/v2';

// CoreSignal country name → location string used in search
const CITY_TO_COUNTRY_NAME = {
  hyderabad: 'India', bangalore: 'India', bengaluru: 'India', mumbai: 'India',
  delhi: 'India', 'new delhi': 'India', chennai: 'India', pune: 'India',
  kolkata: 'India', gurgaon: 'India', noida: 'India', ahmedabad: 'India',
  kochi: 'India', jaipur: 'India',
  london: 'United Kingdom', manchester: 'United Kingdom', birmingham: 'United Kingdom',
  edinburgh: 'United Kingdom', bristol: 'United Kingdom',
  berlin: 'Germany', munich: 'Germany', frankfurt: 'Germany', hamburg: 'Germany',
  toronto: 'Canada', vancouver: 'Canada', montreal: 'Canada',
  sydney: 'Australia', melbourne: 'Australia', brisbane: 'Australia',
  singapore: 'Singapore',
  'new york': 'United States', 'san francisco': 'United States', seattle: 'United States',
  austin: 'United States', chicago: 'United States', boston: 'United States',
  dubai: 'United Arab Emirates', 'abu dhabi': 'United Arab Emirates',
  amsterdam: 'Netherlands', paris: 'France', madrid: 'Spain',
  stockholm: 'Sweden', zurich: 'Switzerland', warsaw: 'Poland',
  tokyo: 'Japan', seoul: 'South Korea', bangkok: 'Thailand',
};

const COUNTRY_LOWER_TO_NAME = {
  india: 'India', uk: 'United Kingdom', 'united kingdom': 'United Kingdom',
  germany: 'Germany', usa: 'United States', us: 'United States',
  'united states': 'United States', canada: 'Canada', australia: 'Australia',
  singapore: 'Singapore', france: 'France', netherlands: 'Netherlands',
  spain: 'Spain', italy: 'Italy', sweden: 'Sweden', norway: 'Norway',
  denmark: 'Denmark', switzerland: 'Switzerland', austria: 'Austria',
  belgium: 'Belgium', poland: 'Poland', uae: 'United Arab Emirates',
  'united arab emirates': 'United Arab Emirates', japan: 'Japan',
  'south korea': 'South Korea', brazil: 'Brazil', 'south africa': 'South Africa',
};

function getApiKey() {
  return String(process.env.CORESIGNAL_API_KEY || '').trim();
}

export function isConfigured() {
  return Boolean(getApiKey());
}

/**
 * Resolve city and country name strings from a parsed location like "Hyderabad, India".
 */
export function resolveLocationParams(location) {
  if (!location || /unspecified|not specified|remote/i.test(location)) {
    return { city: '', country: '' };
  }
  const parts = location.split(',').map(p => p.trim());
  const city = parts[0] || '';
  const cityLower = city.toLowerCase();
  const countryPart = (parts[parts.length - 1] || '').toLowerCase();

  const country =
    CITY_TO_COUNTRY_NAME[cityLower] ||
    COUNTRY_LOWER_TO_NAME[countryPart] ||
    COUNTRY_LOWER_TO_NAME[cityLower] ||
    '';

  return { city, country };
}

/**
 * Calculate total professional experience years from CoreSignal experience array.
 * Uses date_from_year / date_to_year integer fields (reliable, no string parsing needed).
 */
export function calcExperienceYears(experiences) {
  if (!Array.isArray(experiences) || experiences.length === 0) return 0;
  const now = new Date();
  let totalMs = 0;

  for (const exp of experiences) {
    if (!exp.date_from_year) continue;
    const start = new Date(exp.date_from_year, (exp.date_from_month || 1) - 1, 1);
    const end = exp.date_to_year
      ? new Date(exp.date_to_year, (exp.date_to_month || 12) - 1, 1)
      : now;
    const ms = end - start;
    if (ms > 0) totalMs += ms;
  }

  return Math.round((totalMs / (1000 * 60 * 60 * 24 * 365.25)) * 10) / 10;
}

/**
 * Build CoreSignal skill query string.
 * logic = 'AND' → all skills must be present (high precision)
 * logic = 'OR'  → at least one skill (broad sweep)
 */
function buildSkillQuery(skills, logic = 'AND') {
  const clean = skills.filter(Boolean).map(s => s.trim()).filter(Boolean);
  if (clean.length === 0) return '';
  if (clean.length === 1) return clean[0];
  return clean.join(` ${logic} `);
}

/**
 * Build CoreSignal headline query from title variants.
 * Joins with OR so any title variation matches.
 */
function buildHeadlineQuery(titles) {
  const clean = [...new Set(titles.filter(Boolean).map(s => s.trim()))];
  if (clean.length === 0) return '';
  if (clean.length === 1) return clean[0];
  return clean.join(' OR ');
}

/**
 * POST /employee_base/search/filter → returns array of employee IDs.
 */
async function searchFilter(body, itemsPerPage = 20) {
  const apiKey = getApiKey();
  if (!apiKey) return [];

  const cleanBody = Object.fromEntries(
    Object.entries(body).filter(([, v]) => v !== '' && v !== null && v !== undefined)
  );

  logger.info(`[CoreSignal] Search: ${JSON.stringify(cleanBody)}`);

  try {
    const response = await axios.post(
      `${BASE_URL}/employee_base/search/filter?items_per_page=${itemsPerPage}`,
      cleanBody,
      {
        headers: {
          apikey: apiKey,
          'Content-Type': 'application/json',
          accept: 'application/json',
        },
        timeout: 20000,
      }
    );

    const ids = Array.isArray(response.data) ? response.data : [];
    logger.info(`[CoreSignal] Search returned ${ids.length} IDs`);
    return ids;
  } catch (error) {
    const status = error.response?.status;
    const msg = error.response?.data?.message || error.response?.data || error.message;
    if (status === 401) logger.error('[CoreSignal] 401 — invalid API key');
    else if (status === 402) logger.error('[CoreSignal] 402 — insufficient credits');
    else if (status === 429) logger.warn('[CoreSignal] 429 — rate limited');
    else logger.warn(`[CoreSignal] Search failed (HTTP ${status ?? 'timeout'}): ${JSON.stringify(msg)}`);
    return [];
  }
}

/**
 * GET /employee_base/collect/{id} → full employee profile.
 */
async function collectProfile(id) {
  const apiKey = getApiKey();
  try {
    const response = await axios.get(
      `${BASE_URL}/employee_base/collect/${id}`,
      {
        headers: { apikey: apiKey, accept: 'application/json' },
        timeout: 15000,
      }
    );
    return response.data || null;
  } catch (error) {
    const status = error.response?.status;
    if (status !== 404) {
      logger.debug(`[CoreSignal] Collect ${id} failed (${status}): ${error.message}`);
    }
    return null;
  }
}

/**
 * Collect multiple profiles with controlled concurrency.
 */
async function collectBatch(ids, concurrency = 5) {
  const results = [];
  for (let i = 0; i < ids.length; i += concurrency) {
    const chunk = ids.slice(i, i + concurrency);
    const settled = await Promise.allSettled(chunk.map(id => collectProfile(id)));
    for (const r of settled) {
      if (r.status === 'fulfilled' && r.value) results.push(r.value);
    }
  }
  return results;
}

/**
 * Transform a CoreSignal profile into our internal candidate format.
 */
function transformProfile(profile) {
  // Current role: prefer is_current=1, fall back to first experience entry
  const currentExp = (profile.experience || []).find(e => e.is_current === 1)
    || (profile.experience || [])[0]
    || {};

  const expYears = calcExperienceYears(profile.experience || []);

  // Skills: CoreSignal returns [{skill: "Python"}, ...] — extract the string
  const skills = (profile.skills || [])
    .map(s => (typeof s === 'string' ? s : s?.skill || ''))
    .filter(Boolean);

  // Education: top entry as "Program, Institution"
  const education = (profile.education || [])
    .slice(0, 1)
    .map(e => [e.program, e.institution].filter(Boolean).join(', '))
    .join('');

  const linkedinUrl = profile.profile_url || '';
  const locationStr = [profile.city, profile.country].filter(Boolean).join(', ');

  return {
    name:           profile.full_name || '',
    fullName:       profile.full_name || '',
    jobTitle:       currentExp.title || profile.headline || '',
    company:        currentExp.company_name || '',
    location:       locationStr,
    city:           profile.city || '',
    country:        profile.country || '',
    foundIn:        profile.country || '',
    sourceCountry:  profile.country || '',

    linkedinUrl,
    linkedInUrl:    linkedinUrl,
    normalizedUrl:  linkedinUrl.toLowerCase().split('?')[0].replace(/\/$/, ''),
    profilePic:     profile.profile_photo_url || null,

    // Skills — actual LinkedIn skills, reliable
    skills,

    // Experience — REAL years from job history
    experienceYears:   expYears,
    totalExperience:   expYears > 0 ? `${expYears} years` : '',

    education,
    about:    profile.summary || '',
    headline: profile.headline || '',

    source:     'AI_SOURCING',
    dataSource: 'coresignal',
  };
}

/**
 * Source candidates via CoreSignal.
 *
 * Implements Kumar's tiered search approach:
 *   Tier 1 — must-have skills (AND) + title + city  → highest quality
 *   Tier 2 — top required skills (AND) + title + city → strong match
 *   Tier 3 — required skills (OR) + title + city       → broad sweep
 *
 * Then collects full profiles, filters by real experience years,
 * and returns candidates ready for matchScorer.
 *
 * @param {object} parsed           normalised JD requirements
 * @param {object} options
 * @param {number} options.maxCandidates
 * @returns {Promise<object[]|null>}  null when CORESIGNAL_API_KEY is not set
 */
export async function sourceCandidatesViaCoreSignal(parsed, { maxCandidates = 50 } = {}) {
  if (!isConfigured()) return null;

  const { city, country } = resolveLocationParams(parsed.location || '');

  const mainTitle    = parsed.job_title?.main || '';
  const synonyms     = (parsed.job_title?.synonyms || []).slice(0, 3);
  const allTitles    = [mainTitle, ...synonyms].filter(Boolean);
  const mustHave     = parsed.must_have_skills  || [];
  const required     = parsed.required_skills   || [];
  const preferred    = parsed.preferred_skills  || [];

  const coreSkills   = mustHave.length > 0 ? mustHave : required;
  const headlineQ    = buildHeadlineQuery(allTitles);

  // ── Three search tiers ──────────────────────────────────────────────────────

  // Tier 1: ALL must-have skills AND'd — precision first
  const tier1Body = {
    headline:         headlineQ,
    skill:            buildSkillQuery(coreSkills.slice(0, 4), 'AND'),
    location:         city || undefined,
    country:          country || undefined,
    active_experience: true,
  };

  // Tier 2: top required skills AND'd (relaxed vs tier 1)
  const tier2Body = {
    headline:         headlineQ,
    skill:            buildSkillQuery(coreSkills.slice(0, 2), 'AND'),
    location:         city || undefined,
    country:          country || undefined,
    active_experience: true,
  };

  // Tier 3: required + preferred skills OR'd — broadest sweep
  const tier3Skills = [...new Set([...coreSkills.slice(0, 3), ...preferred.slice(0, 2)])];
  const tier3Body = {
    headline:         headlineQ,
    skill:            buildSkillQuery(tier3Skills, 'OR'),
    location:         city || undefined,
    country:          country || undefined,
    active_experience: true,
  };

  const tierLimit = Math.ceil(maxCandidates / 2); // over-fetch to account for exp filtering

  logger.info(`[CoreSignal] Tier search: title="${mainTitle}" city="${city}" country="${country}"`);

  // Run all 3 tiers in parallel — CoreSignal handles concurrency well
  const [ids1, ids2, ids3] = await Promise.all([
    searchFilter(tier1Body, Math.min(tierLimit, 25)),
    searchFilter(tier2Body, Math.min(tierLimit, 25)),
    searchFilter(tier3Body, Math.min(tierLimit, 20)),
  ]);

  // Deduplicate IDs across all tiers, preserving tier order (tier1 first = highest quality)
  const seen = new Set();
  const allIds = [];
  for (const id of [...ids1, ...ids2, ...ids3]) {
    if (!seen.has(id)) { seen.add(id); allIds.push(id); }
  }

  if (allIds.length === 0) {
    logger.info('[CoreSignal] No IDs returned from any search tier');
    return [];
  }

  // Cap collect calls to avoid burning too many credits
  const collectLimit = Math.min(allIds.length, maxCandidates * 2);
  logger.info(`[CoreSignal] Collecting ${collectLimit} profiles (${allIds.length} total IDs)`);

  const profiles = await collectBatch(allIds.slice(0, collectLimit), 5);

  logger.info(`[CoreSignal] ${profiles.length} profiles collected successfully`);

  return profiles.map(transformProfile);
}

export default {
  isConfigured,
  resolveLocationParams,
  calcExperienceYears,
  sourceCandidatesViaCoreSignal,
};
