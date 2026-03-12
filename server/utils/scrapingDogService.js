/**
 * ScrapingDog LinkedIn Profile Scraper Service
 * Cost: 50 credits per profile (non-protected), 100 for protected
 * Endpoint: GET https://api.scrapingdog.com/linkedin/?api_key=KEY&type=profile&linkId=SLUG
 */

import axios from 'axios';
import logger from './logger.js';

const BASE_URL = 'https://api.scrapingdog.com/linkedin/';

function getApiKey() {
  return process.env.SCRAPINGDOG_API_KEY;
}

export function isConfigured() {
  return Boolean(getApiKey());
}

function extractProfileSlug(linkedInUrl) {
  if (!linkedInUrl) return null;
  const match = linkedInUrl.match(/linkedin\.com\/in\/([^/?#]+)/i);
  return match ? match[1].replace(/\/$/, '').toLowerCase() : null;
}

function parseYearFromDate(dateStr) {
  if (!dateStr) return null;
  if (typeof dateStr === 'object' && dateStr.year) return dateStr.year;
  const match = String(dateStr).match(/(\d{4})/);
  return match ? parseInt(match[1]) : null;
}

function mergeScrapingDogData(candidate, profileData) {
  const profile = profileData.data || profileData;

  const experience    = Array.isArray(profile.experience)     ? profile.experience     : [];
  const education     = Array.isArray(profile.education)      ? profile.education      : [];
  const rawSkills     = Array.isArray(profile.skills)         ? profile.skills         : [];
  const certifications = Array.isArray(profile.certifications) ? profile.certifications : [];
  const languages     = Array.isArray(profile.languages)      ? profile.languages      : [];

  // Current job — first with no end date, or just first entry
  const currentJob = experience.find((e) => !e.endDate && !e.ends_at) || experience[0];

  // Skills: handle both string arrays and {name: ...} object arrays
  const skills = rawSkills
    .map((s) => (typeof s === 'string' ? s : s.name || s.title))
    .filter(Boolean)
    .slice(0, 15);

  // Total experience from earliest start year to now
  let totalExperience = candidate.totalExperience;
  const startYears = experience
    .map((e) => parseYearFromDate(e.startDate || e.starts_at))
    .filter(Boolean);
  if (startYears.length > 0) {
    const earliest = Math.min(...startYears);
    const years = new Date().getFullYear() - earliest;
    totalExperience = `${years}+ years`;
  }

  // Primary education summary line
  const primaryEdu = education[0];
  const educationStr = primaryEdu
    ? [
        primaryEdu.degree,
        primaryEdu.field_of_study || primaryEdu.fieldOfStudy,
        primaryEdu.school || primaryEdu.schoolName,
      ]
        .filter(Boolean)
        .join(', ')
    : candidate.education;

  // Structured work history
  const workHistory = experience.map((e) => ({
    title:       e.title || null,
    company:     e.company || e.companyName || null,
    location:    e.location || null,
    startDate:   e.startDate || e.starts_at || null,
    endDate:     e.endDate   || e.ends_at   || null,
    current:     !e.endDate && !e.ends_at,
    description: e.description || null,
  }));

  // Structured education history
  const educationHistory = education.map((e) => ({
    school:       e.school || e.schoolName || null,
    degree:       e.degree || null,
    fieldOfStudy: e.field_of_study || e.fieldOfStudy || null,
    startDate:    e.startDate || e.starts_at || null,
    endDate:      e.endDate   || e.ends_at   || null,
  }));

  return {
    ...candidate,
    name:          profile.name       || profile.fullName  || candidate.name,
    jobTitle:      profile.headline   || currentJob?.title || candidate.jobTitle,
    company:       currentJob?.company || currentJob?.companyName || candidate.company,
    location:      profile.location   || profile.city      || candidate.location,
    about:         profile.summary    || profile.about     || null,
    skills:        skills.length > 0  ? skills             : (candidate.skills || []),
    totalExperience,
    education:     educationStr       || candidate.education,
    workHistory,
    educationHistory,
    certifications: certifications.map((c) => (typeof c === 'string' ? c : c.name || c.title)).filter(Boolean),
    languages:      languages.map((l) => (typeof l === 'string' ? l : l.name)).filter(Boolean),
    _scrapingDogEnriched: true,
  };
}

async function scrapeLinkedInProfile(linkedInUrl) {
  const apiKey  = getApiKey();
  const linkId  = extractProfileSlug(linkedInUrl);
  if (!apiKey || !linkId) return null;

  try {
    const response = await axios.get(BASE_URL, {
      params: { api_key: apiKey, type: 'profile', linkId },
      timeout: 30000,
    });
    return response.data;
  } catch (error) {
    if (error.response?.status === 202) {
      logger.info(`ScrapingDog: ${linkId} still being scraped — skipping`);
    } else {
      logger.warn(`ScrapingDog scrape failed for ${linkId}: ${error.message}`);
    }
    return null;
  }
}

/**
 * Enrich the top N ranked candidates with full LinkedIn profile data via ScrapingDog.
 * Processes in batches of 3 to avoid hammering the API.
 *
 * @param {Array}  candidates   — already ranked candidate list
 * @param {number} maxToScrape  — how many top candidates to scrape (default 10)
 * @returns {Array} candidates with merged ScrapingDog profile data for top N
 */
export async function enrichCandidatesWithScrapingDog(candidates, maxToScrape = 10) {
  if (!isConfigured()) {
    logger.info('SCRAPINGDOG_API_KEY not set — skipping LinkedIn profile enrichment');
    return candidates;
  }

  const toEnrich = candidates.slice(0, maxToScrape);
  const rest     = candidates.slice(maxToScrape);

  logger.info(`ScrapingDog: enriching top ${toEnrich.length} candidates (${50 * toEnrich.length} credits)...`);

  const BATCH_SIZE = 3;
  const enrichedTop = [...toEnrich];

  for (let i = 0; i < toEnrich.length; i += BATCH_SIZE) {
    const batch   = toEnrich.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map((c) => scrapeLinkedInProfile(c.linkedInUrl))
    );
    for (let j = 0; j < results.length; j++) {
      const result = results[j];
      if (result.status === 'fulfilled' && result.value) {
        enrichedTop[i + j] = mergeScrapingDogData(enrichedTop[i + j], result.value);
      }
    }
  }

  const successCount = enrichedTop.filter((c) => c._scrapingDogEnriched).length;
  logger.info(`ScrapingDog: ${successCount}/${toEnrich.length} profiles scraped successfully`);

  return [...enrichedTop, ...rest];
}
