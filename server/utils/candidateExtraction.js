import logger from './logger.js';

/**
 * Candidate Extraction & Deduplication Service
 * Parses CSE search results into structured candidate objects
 */

/**
 * Extract LinkedIn profile URL from various formats
 */
export function extractLinkedInUrl(link, displayLink) {
  if (!link) return null;

  // Normalize LinkedIn URLs
  if (link.includes('linkedin.com/in/')) {
    return link.split('?')[0]; // Remove query params
  }

  if (link.includes('linkedin.com')) {
    return link.split('?')[0];
  }

  return null;
}

/**
 * Extract name from search result title
 * LinkedIn titles typically follow pattern: "Name - Job Title | Company | LinkedIn"
 */
export function extractName(title) {
  if (!title) return null;

  // Remove LinkedIn suffix
  let cleaned = title.replace(/\s*\|\s*LinkedIn.*$/i, '');

  // Take first part before common separators
  const namePart = cleaned.split(/\s*[-|–]\s*/)[0].trim();

  // Validate: should have at least one space (first and last name)
  if (!namePart || namePart.split(' ').length < 2) {
    return null;
  }

  return namePart.length > 1 ? namePart : null;
}

/**
 * Extract job information from snippet or title
 * Returns {jobTitle, company, level}
 */
export function extractJobInfo(title, snippet) {
  const jobInfo = {
    jobTitle: null,
    company: null,
    level: null,
  };

  // Extract from title (between name and company)
  const titleMatch = title.match(/(?:at|@)\s+([^|]+?)(?:\||–|-|$)/i);
  if (titleMatch) {
    jobInfo.company = titleMatch[1].trim();
  }

  // Extract job level indicators
  const levelKeywords = ['senior', 'lead', 'principal', 'director', 'manager', 'intern', 'junior'];
  const lowerSnippet = (snippet || '').toLowerCase();

  for (const keyword of levelKeywords) {
    if (lowerSnippet.includes(keyword)) {
      jobInfo.level = keyword;
      break;
    }
  }

  return jobInfo;
}

/**
 * Normalize URL for comparison (removes trailing slashes, query params)
 */
function normalizeUrl(url) {
  if (!url) return null;
  return url.split('?')[0].replace(/\/$/, '').toLowerCase();
}

/**
 * Detect if URL is LinkedIn profile
 */
function isLinkedInProfile(url) {
  return url && url.includes('linkedin.com/in/');
}

/**
 * Extract candidates from CSE results
 * Params:
 *   - searchResults: Array of {title, link, snippet, displayLink, country}
 *   - targetCountries: Array of countries that were searched
 *   - searchQueries: Array of queries used (for tracking)
 * Returns: Deduplicated array of candidate objects
 */
export function extractCandidates(searchResults, targetCountries = [], searchQueries = []) {
  if (!searchResults || !Array.isArray(searchResults)) {
    return [];
  }

  logger.info(`📊 Extracting candidates from ${searchResults.length} results`);

  const candidateMap = new Map(); // Track by LinkedIn URL

  for (const result of searchResults) {
    try {
      const linkedInUrl = extractLinkedInUrl(result.link, result.displayLink);

      // Skip non-LinkedIn results
      if (!linkedInUrl) {
        continue;
      }

      const normalizedUrl = normalizeUrl(linkedInUrl);

      // Extract candidate info
      const name = extractName(result.title);
      if (!name) {
        continue;
      }

      const jobInfo = extractJobInfo(result.title, result.snippet);

      // Build candidate object
      const candidate = {
        linkedInUrl,
        normalizedUrl,
        name,
        jobTitle: jobInfo.jobTitle,
        company: jobInfo.company,
        level: jobInfo.level,
        snippet: result.snippet,
        foundIn: result.country,
        sources: [
          {
            country: result.country,
            query: result.query || 'general',
            snippetPreview: result.snippet.substring(0, 100),
          },
        ],
      };

      // Deduplication: merge if URL already exists
      if (candidateMap.has(normalizedUrl)) {
        const existing = candidateMap.get(normalizedUrl);
        // Merge sources (track which countries/queries found them)
        const sourceIndex = existing.sources.findIndex(
          (s) => s.country === result.country && s.query === (result.query || 'general')
        );
        if (sourceIndex === -1) {
          existing.sources.push({
            country: result.country,
            query: result.query || 'general',
            snippetPreview: result.snippet.substring(0, 100),
          });
        }
      } else {
        candidateMap.set(normalizedUrl, candidate);
      }
    } catch (error) {
      logger.debug(`Failed to extract candidate from result: ${error.message}`);
    }
  }

  const candidates = Array.from(candidateMap.values());
  logger.info(`✨ Extracted ${candidates.length} unique candidates from ${searchResults.length} results`);

  return candidates;
}

/**
 * Filter candidates by criteria
 */
export function filterCandidates(candidates, filters = {}) {
  let filtered = candidates;

  // Filter by job level
  if (filters.minLevel) {
    const levelRank = { intern: 0, junior: 1, senior: 2, lead: 3, principal: 4, director: 5 };
    filtered = filtered.filter((c) => {
      const rank = levelRank[c.level?.toLowerCase()] ?? -1;
      return rank >= (levelRank[filters.minLevel.toLowerCase()] ?? -1);
    });
  }

  // Filter by keywords in name/company/snippet
  if (filters.keywords && filters.keywords.length > 0) {
    const lowerKeywords = filters.keywords.map((k) => k.toLowerCase());
    filtered = filtered.filter((c) => {
      const searchableText = `${c.name} ${c.company || ''} ${c.snippet}`.toLowerCase();
      return lowerKeywords.some((k) => searchableText.includes(k));
    });
  }

  // Filter by countries
  if (filters.countries && filters.countries.length > 0) {
    filtered = filtered.filter((c) =>
      c.sources.some((s) => filters.countries.includes(s.country))
    );
  }

  return filtered;
}

/**
 * Rank candidates by relevance
 * Returns candidates sorted by score (highest first)
 */
export function rankCandidates(candidates, targetSkills = []) {
  return candidates
    .map((candidate) => {
      let score = 0;

      // Score by level
      const levelScores = { director: 5, principal: 4, lead: 3, senior: 2, junior: 1, intern: 0 };
      score += levelScores[candidate.level?.toLowerCase()] || 0;

      // Score by target skills match
      if (targetSkills.length > 0) {
        const snippetLower = candidate.snippet.toLowerCase();
        const skillMatches = targetSkills.filter((skill) =>
          snippetLower.includes(skill.toLowerCase())
        ).length;
        score += skillMatches * 2;
      }

      // Multiple sources = higher relevance
      score += Math.min(candidate.sources.length, 3);

      return { ...candidate, relevanceScore: score };
    })
    .sort((a, b) => b.relevanceScore - a.relevanceScore);
}

/**
 * Deduplicate candidates by multiple criteria
 * Can match by LinkedIn URL OR name + company
 */
export function deduplicateCandidates(candidates) {
  const seen = new Set();
  const deduped = [];

  for (const candidate of candidates) {
    // Primary dedup: LinkedIn URL
    if (!seen.has(candidate.normalizedUrl)) {
      seen.add(candidate.normalizedUrl);

      // Secondary dedup: name + company combo
      const nameCompanyKey = `${candidate.name.toLowerCase()}:${(candidate.company || 'unknown').toLowerCase()}`;
      if (!seen.has(nameCompanyKey)) {
        seen.add(nameCompanyKey);
        deduped.push(candidate);
      }
    }
  }

  return deduped;
}

/**
 * Format candidates for API response
 */
export function formatCandidates(candidates) {
  return candidates.map((c) => ({
    linkedInUrl: c.linkedInUrl,
    name: c.name,
    jobTitle: c.jobTitle,
    company: c.company,
    level: c.level,
    snippet: c.snippet,
    sources: c.sources,
    relevanceScore: c.relevanceScore,
  }));
}

export default {
  extractCandidates,
  extractName,
  extractJobInfo,
  extractLinkedInUrl,
  filterCandidates,
  rankCandidates,
  deduplicateCandidates,
  formatCandidates,
};
