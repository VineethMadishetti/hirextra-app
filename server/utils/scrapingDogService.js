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
  // Response is an array: [{...}] — unwrap it
  const raw = Array.isArray(profileData)
    ? profileData[0]
    : Array.isArray(profileData?.data)
      ? profileData.data[0]
      : (profileData?.data || profileData);

  if (!raw) return candidate;

  const experience     = Array.isArray(raw.experience)   ? raw.experience   : [];
  const education      = Array.isArray(raw.education)    ? raw.education    : [];
  const certifications = Array.isArray(raw.certification) ? raw.certification : []; // field is 'certification' (singular)
  const languages      = Array.isArray(raw.languages)    ? raw.languages    : [];

  // Current job = first experience entry (no end date = current)
  const currentJob = experience.find((e) => !e.ends_at && !e.end_date) || experience[0];

  // Company: from experience or description.description1 fallback
  const company = currentJob?.company_name
    || raw.description?.description1
    || candidate.company;

  // Job title: from headline or experience company_position (title field in experience)
  const jobTitle = raw.headline
    || currentJob?.title
    || currentJob?.company_position
    || candidate.jobTitle;

  // Total experience from earliest start year
  let totalExperience = candidate.totalExperience;
  const startYears = experience
    .map((e) => parseYearFromDate(e.starts_at || e.start_date || e.startDate))
    .filter(Boolean);
  if (startYears.length > 0) {
    const earliest = Math.min(...startYears);
    const years = new Date().getFullYear() - earliest;
    totalExperience = `${years}+ years`;
  }

  // Education: from education array or description.description2 fallback
  const primaryEdu = education[0];
  const educationStr = primaryEdu
    ? [
        primaryEdu.degree,
        primaryEdu.field_of_study || primaryEdu.fieldOfStudy,
        primaryEdu.school || primaryEdu.school_name,
      ]
        .filter(Boolean)
        .join(', ')
    : (raw.description?.description2 || candidate.education);

  // Structured work history
  const workHistory = experience.map((e) => ({
    title:       e.title || e.company_position || null,
    company:     e.company_name || null,
    location:    e.location || null,
    startDate:   e.starts_at || e.start_date || null,
    endDate:     e.ends_at  || e.end_date   || null,
    current:     !e.ends_at && !e.end_date,
    description: e.description || null,
  }));

  // Structured education history
  const educationHistory = education.map((e) => ({
    school:       e.school || e.school_name || null,
    degree:       e.degree || null,
    fieldOfStudy: e.field_of_study || e.fieldOfStudy || null,
    startDate:    e.starts_at || e.start_date || null,
    endDate:      e.ends_at  || e.end_date   || null,
  }));

  return {
    ...candidate,
    name:            raw.fullName                  || candidate.name,
    jobTitle:        jobTitle                      || candidate.jobTitle,
    company:         company                       || candidate.company,
    location:        raw.location                  || candidate.location,
    about:           raw.about                     || null,
    // ScrapingDog does not return a skills array — keep enriched/snippet skills
    skills:          candidate.skills              || [],
    totalExperience,
    education:       educationStr                  || candidate.education,
    workHistory,
    educationHistory,
    certifications:  certifications.map((c) => (typeof c === 'string' ? c : c.title || c.name)).filter(Boolean),
    languages:       languages.map((l) => (typeof l === 'string' ? l : l.name)).filter(Boolean),
    _scrapingDogEnriched: true,
  };
}

async function scrapeLinkedInProfile(linkedInUrl) {
  const apiKey  = getApiKey();
  const linkId  = extractProfileSlug(linkedInUrl);
  if (!apiKey || !linkId) return null;

  try {
    const response = await axios.get(BASE_URL, {
      params: { api_key: apiKey, type: 'profile', linkId, premium: true },
      timeout: 30000,
    });
    // Log raw response keys in development so field mapping can be verified
    if (process.env.NODE_ENV !== 'production') {
      const rawArr = Array.isArray(response.data) ? response.data : (Array.isArray(response.data?.data) ? response.data.data : null);
      const raw = rawArr ? rawArr[0] : (response.data?.data || response.data);
      logger.info(`ScrapingDog raw keys for ${linkId}: ${JSON.stringify(Object.keys(raw || {}))}`);
      if (raw?.experience?.[0]) logger.info(`ScrapingDog experience[0] keys: ${JSON.stringify(Object.keys(raw.experience[0]))}`);
      if (raw?.education?.[0])  logger.info(`ScrapingDog education[0] keys: ${JSON.stringify(Object.keys(raw.education[0]))}`);
    }
    return response.data;
  } catch (error) {
    if (error.response?.status === 202) {
      logger.info(`ScrapingDog: ${linkId} still being scraped — skipping`);
    } else {
      logger.warn(`ScrapingDog scrape failed for ${linkId}: ${error.message} | response: ${JSON.stringify(error.response?.data)}`);
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
