import logger from './logger.js';

/**
 * Candidate extraction and deduplication utilities for AI sourcing results.
 */

/**
 * Extract LinkedIn profile URL from result link, snippet, or title text.
 * Strategy 1: result.link is already a linkedin.com/in/ URL
 * Strategy 2: snippet or title text contains a linkedin.com/in/username pattern
 */
export function extractLinkedInUrl(link, snippet, title) {
  // Strategy 1: direct link
  if (link && link.includes('linkedin.com') && link.includes('/in/')) {
    return link.split('?')[0];
  }

  // Strategy 2: extract from snippet/title text
  const text = `${snippet || ''} ${title || ''}`;
  const match = text.match(/linkedin\.com\/in\/([A-Za-z0-9_%-]{3,60})/i);
  if (match) {
    return `https://www.linkedin.com/in/${match[1]}`.split('?')[0];
  }

  return null;
}

/**
 * Extract candidate name from search result title.
 * Example: "Jane Doe - Senior Backend Engineer at Acme | LinkedIn"
 */
export function extractName(title) {
  if (!title) return null;

  const cleaned = String(title).replace(/\s*\|\s*LinkedIn.*$/i, '');
  const firstPart = cleaned.split(/\s*[-|:]\s*/)[0].trim();

  if (!firstPart || firstPart.split(' ').length < 2) return null;
  return firstPart.length > 1 ? firstPart : null;
}

/**
 * Extract job title / company / level from title + snippet.
 */
export function extractJobInfo(title, snippet) {
  const jobInfo = {
    jobTitle: null,
    company: null,
    level: null,
  };

  const cleanedTitle = String(title || '')
    .replace(/\s*\|\s*LinkedIn.*$/i, '')
    .trim();

  // Strip leading name portion: "Name - ..."
  const titleWithoutName = cleanedTitle.replace(/^[^-|:]+[-|:]\s*/, '').trim();

  // Common format: "Role at Company"
  const roleAtCompany = titleWithoutName.match(/^(.*?)\s+(?:at|@)\s+(.+)$/i);
  if (roleAtCompany) {
    jobInfo.jobTitle = roleAtCompany[1]?.trim() || null;
    jobInfo.company = roleAtCompany[2]?.trim() || null;
  } else {
    // Fallback format: "Role | Company"
    const parts = titleWithoutName
      .split(/\s*[|:-]\s*/)
      .map((p) => p.trim())
      .filter(Boolean);

    if (parts.length > 0) jobInfo.jobTitle = parts[0];
    if (parts.length > 1) jobInfo.company = parts[1];
  }

  const levelKeywords = [
    'executive',
    'director',
    'principal',
    'lead',
    'senior',
    'manager',
    'junior',
    'intern',
  ];
  const contextText = `${snippet || ''} ${jobInfo.jobTitle || ''}`.toLowerCase();
  for (const keyword of levelKeywords) {
    if (contextText.includes(keyword)) {
      jobInfo.level = keyword;
      break;
    }
  }

  return jobInfo;
}

/**
 * Best-effort location extraction from title/snippet text.
 */
export function extractLocation(title, snippet) {
  const text = `${title || ''} ${snippet || ''}`.replace(/\s+/g, ' ').trim();
  if (!text) return null;

  const patterns = [
    /\b(?:based in|located in|location[:\s]+)\s*([A-Za-z .'-]+(?:,\s*[A-Za-z .'-]+){0,2})/i,
    /\bin\s+([A-Za-z .'-]+,\s*[A-Za-z .'-]+(?:,\s*[A-Za-z .'-]+)?)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match?.[1]) continue;

    const location = match[1].trim().replace(/\s{2,}/g, ' ');
    if (location.length >= 3 && location.length <= 80) return location;
  }

  return null;
}

function normalizeUrl(url) {
  if (!url) return null;
  return url.split('?')[0].replace(/\/$/, '').toLowerCase();
}

/**
 * Build candidate list from CSE results.
 */
export function extractCandidates(searchResults) {
  if (!Array.isArray(searchResults)) return [];

  logger.info(`Extracting candidates from ${searchResults.length} results`);
  const candidateMap = new Map();

  for (const result of searchResults) {
    try {
      const linkedInUrl = extractLinkedInUrl(result.link, result.snippet, result.title);
      if (!linkedInUrl) continue;

      const normalizedUrl = normalizeUrl(linkedInUrl);
      const name = extractName(result.title);
      if (!name) continue;

      const jobInfo = extractJobInfo(result.title, result.snippet);
      const location = extractLocation(result.title, result.snippet);

      const candidate = {
        linkedInUrl,
        normalizedUrl,
        name,
        jobTitle: jobInfo.jobTitle,
        company: jobInfo.company,
        location,
        level: jobInfo.level,
        snippet: result.snippet || '',
        foundIn: result.country || '',
        sourceCountry: result.country || '',
        sources: [
          {
            country: result.country || '',
            query: result.query || 'general',
            snippetPreview: String(result.snippet || '').substring(0, 100),
          },
        ],
      };

      if (candidateMap.has(normalizedUrl)) {
        const existing = candidateMap.get(normalizedUrl);
        const sourceExists = existing.sources.some(
          (s) => s.country === (result.country || '') && s.query === (result.query || 'general')
        );
        if (!sourceExists) {
          existing.sources.push({
            country: result.country || '',
            query: result.query || 'general',
            snippetPreview: String(result.snippet || '').substring(0, 100),
          });
        }
      } else {
        candidateMap.set(normalizedUrl, candidate);
      }
    } catch (error) {
      logger.debug(`Failed candidate extraction for a result: ${error.message}`);
    }
  }

  const candidates = Array.from(candidateMap.values());
  logger.info(`Extracted ${candidates.length} unique candidates`);
  return candidates;
}

export function filterCandidates(candidates, filters = {}) {
  let filtered = candidates;

  if (filters.minLevel) {
    const levelRank = {
      intern: 0,
      junior: 1,
      senior: 2,
      lead: 3,
      principal: 4,
      director: 5,
      executive: 6,
    };
    filtered = filtered.filter((c) => {
      const rank = levelRank[c.level?.toLowerCase()] ?? -1;
      return rank >= (levelRank[String(filters.minLevel).toLowerCase()] ?? -1);
    });
  }

  if (Array.isArray(filters.keywords) && filters.keywords.length > 0) {
    const lowerKeywords = filters.keywords.map((k) => String(k).toLowerCase());
    filtered = filtered.filter((c) => {
      const searchableText = `${c.name} ${c.company || ''} ${c.jobTitle || ''} ${c.snippet}`.toLowerCase();
      return lowerKeywords.some((k) => searchableText.includes(k));
    });
  }

  if (Array.isArray(filters.countries) && filters.countries.length > 0) {
    filtered = filtered.filter((c) => c.sources.some((s) => filters.countries.includes(s.country)));
  }

  return filtered;
}

export function rankCandidates(candidates, targetSkills = []) {
  return candidates
    .map((candidate) => {
      let score = 0;

      const levelScores = {
        executive: 6,
        director: 5,
        principal: 4,
        lead: 3,
        senior: 2,
        junior: 1,
        intern: 0,
      };
      score += levelScores[candidate.level?.toLowerCase()] || 0;

      if (Array.isArray(targetSkills) && targetSkills.length > 0) {
        const snippetLower = String(candidate.snippet || '').toLowerCase();
        const titleLower = String(candidate.jobTitle || '').toLowerCase();
        const skillMatches = targetSkills.filter((skill) => {
          const s = String(skill || '').toLowerCase();
          return s && (snippetLower.includes(s) || titleLower.includes(s));
        }).length;
        score += skillMatches * 2;
      }

      score += Math.min(candidate.sources.length, 3);
      return { ...candidate, relevanceScore: score };
    })
    .sort((a, b) => b.relevanceScore - a.relevanceScore);
}

export function deduplicateCandidates(candidates) {
  const seen = new Set();
  const deduped = [];

  for (const candidate of candidates) {
    if (seen.has(candidate.normalizedUrl)) continue;
    seen.add(candidate.normalizedUrl);

    const nameCompanyKey = `${String(candidate.name || '').toLowerCase()}:${String(
      candidate.company || 'unknown'
    ).toLowerCase()}`;
    if (seen.has(nameCompanyKey)) continue;
    seen.add(nameCompanyKey);
    deduped.push(candidate);
  }

  return deduped;
}

export function formatCandidates(candidates) {
  return candidates.map((c) => ({
    linkedInUrl: c.linkedInUrl,
    linkedinUrl: c.linkedInUrl,
    name: c.name,
    title: c.jobTitle || null,
    jobTitle: c.jobTitle || null,
    company: c.company || null,
    location: c.location || null,
    level: c.level || null,
    email: c.contact?.email || null,
    phone: c.contact?.phone || null,
    enrichmentSource: c.contact?.source || null,
    enrichmentConfidence: c.contact?.confidence || null,
    sourceCountry: c.sourceCountry || c.foundIn || null,
    snippet: c.snippet || '',
    sources: c.sources || [],
    relevanceScore: c.relevanceScore || 0,
    savedCandidateId: c.savedCandidateId || null,
    savedToDatabase: Boolean(c.savedToDatabase),
    pipelineStage: c.pipelineStage || 'DISCOVERED',
    sequenceStatus: c.sequenceStatus || 'NOT_STARTED',
    callStatus: c.callStatus || 'NOT_SCHEDULED',
  }));
}

export default {
  extractCandidates,
  extractName,
  extractJobInfo,
  extractLocation,
  extractLinkedInUrl,
  filterCandidates,
  rankCandidates,
  deduplicateCandidates,
  formatCandidates,
};
