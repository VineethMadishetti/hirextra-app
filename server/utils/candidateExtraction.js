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

// Tech skill keywords that should never be treated as company names
const TECH_KEYWORDS = new Set([
  'react', 'react.js', 'reactjs', 'javascript', 'js', 'typescript', 'ts',
  'node.js', 'nodejs', 'node', 'python', 'java', 'angular', 'vue', 'vue.js',
  'vuejs', 'html', 'css', 'php', 'ruby', 'swift', 'kotlin', 'flutter', 'dart',
  'golang', 'go', 'rust', 'c++', 'c#', '.net', 'dotnet', 'aws', 'azure', 'gcp',
  'docker', 'kubernetes', 'sql', 'mongodb', 'postgres', 'postgresql', 'mysql',
  'redis', 'graphql', 'django', 'flask', 'spring', 'laravel', 'rails',
  'jquery', 'bootstrap', 'tailwind', 'sass', 'less', 'webpack', 'vite',
]);

function _isTechKeyword(str) {
  if (!str) return false;
  const lower = str.toLowerCase().trim();
  // Exact match (single keyword like "react.js")
  if (TECH_KEYWORDS.has(lower)) return true;
  // Multi-word string like "Vue.Js React.Js" — if every space-separated word is a tech keyword, it's a skill list
  const words = lower.split(/\s+/).filter(Boolean);
  return words.length > 0 && words.every(w => TECH_KEYWORDS.has(w));
}

/**
 * Parse LinkedIn's structured Google snippet format.
 * LinkedIn often produces snippets like:
 *   "Python developer, Hyderabad · Experience: Josh Software, Inc. · Education: CVR College of Engineering · Location: 500009"
 *
 * Returns { jobTitleHint, company, education, location } — any field may be undefined.
 */
function parseStructuredSnippet(snippet) {
  if (!snippet) return {};
  const result = {};

  const parts = snippet.split(/\s*[·•]\s*/);

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i].trim();
    if (!part) continue;

    const colonIdx = part.indexOf(':');
    if (colonIdx === -1) {
      // First unlabeled part is typically "Role, City"
      if (i === 0) result.jobTitleHint = part;
      continue;
    }

    const label = part.substring(0, colonIdx).trim().toLowerCase();
    const value = part.substring(colonIdx + 1).trim();
    if (!value) continue;

    if (label === 'experience') {
      // LinkedIn uses "Experience:" to mean the current employer in card snippets.
      // But some snippets use it for duration ("5+ years", "8 years") or role descriptions.
      // Only treat it as a company name when it doesn't look like a duration or bare role.
      const looksLikeDuration = /^\d+\s*\+?\s*(year|yr|month|mo)/i.test(value.trim());
      const looksLikeBareRole = /^(senior|junior|lead|principal|staff|mid|entry)\s+\w/i.test(value.trim())
        && !/\b(at|@|pvt|ltd|inc|corp|limited|solutions|technologies|systems|services)\b/i.test(value);
      if (!looksLikeDuration && !looksLikeBareRole) {
        result.company = value;
      }
    } else if (label === 'education') {
      result.education = value;
    } else if (label === 'location') {
      // Skip pure pin codes (e.g., "500009")
      if (!/^\d{4,10}$/.test(value)) result.location = value;
    }
  }

  // If Location was a pin code (missing), try to pull city from jobTitleHint suffix
  // e.g. "Python developer, Hyderabad" → location = "Hyderabad"
  if (!result.location && result.jobTitleHint) {
    const titleParts = result.jobTitleHint.split(',').map((p) => p.trim());
    if (titleParts.length >= 2) {
      const lastPart = titleParts[titleParts.length - 1];
      // City-like: 1-3 properly-cased words, no digits
      if (/^[A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,2}$/.test(lastPart)) {
        result.location = lastPart;
      }
    }
  }

  return result;
}

function _extractCompanyFromSnippet(snippet) {
  if (!snippet) return null;

  // Pattern 1: "at Company Name" or "@ Company Name" before a sentence boundary
  const atMatch = snippet.match(/\b(?:at|@)\s+([A-Z][A-Za-z0-9 &()'-]{2,50})(?=\s*[·.|,\n]|\s*$)/);
  if (atMatch?.[1]) {
    // Strip trailing temporal phrases like "since 2020", "from Jan 2021", "for 3 years"
    const c = atMatch[1].trim()
      .replace(/[.,]$/, '')
      .replace(/\s+(?:since|from|for|until|till|as\s+of)\s+.*/i, '')
      .trim();
    if (!_isTechKeyword(c) && c.split(' ').length <= 6) return c;
  }

  // Pattern 2: Formal company name (contains Pvt/Ltd/Corp/Inc/Solutions/etc.)
  // Matches ". Cyrrup Solutions Pvt Ltd" or "Cyrrup Solutions Pvt Ltd" after period
  const formalMatch = snippet.match(/(?:^|\.\s+)([A-Z][A-Za-z0-9 &()-]{2,60}?\s+(?:Pvt\.?\s*Ltd\.?|Ltd\.?|Corp\.?|Inc\.?|LLC|LLP|Limited|Solutions|Technologies|Systems|Services|Consulting|Group|Software|Infotech|Infosystems))\b/);
  if (formalMatch?.[1]) {
    const c = formalMatch[1].trim().replace(/\.$/, '');
    if (!_isTechKeyword(c) && c.split(' ').length <= 8) return c;
  }

  return null;
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

  // Parse structured LinkedIn snippet first — highest accuracy source
  const structured = parseStructuredSnippet(snippet);

  const cleanedTitle = String(title || '')
    .replace(/\s*\|\s*LinkedIn.*$/i, '') // remove "| LinkedIn..."
    .replace(/\s*[·•]\s*.+$/, '')        // remove " · Location" suffix (middle dot)
    .trim();

  // Strip leading name portion: "Name - ..."
  const titleWithoutName = cleanedTitle.replace(/^[^-|:]+[-|:]\s*/, '').trim();

  // Common format: "Role at Company"
  const roleAtCompany = titleWithoutName.match(/^(.*?)\s+(?:at|@)\s+(.+)$/i);
  if (roleAtCompany) {
    jobInfo.jobTitle = roleAtCompany[1]?.trim() || null;
    // Strip trailing "| City" from company name
    const companyRaw = roleAtCompany[2]?.trim() || null;
    const companyPart = companyRaw ? companyRaw.split(/\s*[|·•]\s*/)[0].trim() : null;
    // Apply tech-keyword filter (same as fallback path)
    jobInfo.company = (companyPart && !_isTechKeyword(companyPart)) ? companyPart : null;
  } else {
    // Fallback format: "Role | Company"
    // Note: do NOT split on '-' — it breaks hyphenated titles like "Front-End Developer"
    const parts = titleWithoutName
      .split(/\s*[|:·•]\s*/)
      .map((p) => p.trim())
      .filter(Boolean);

    if (parts.length > 0) jobInfo.jobTitle = parts[0];
    // Only use the second part as company if it doesn't look like a tech skill/keyword
    if (parts.length > 1 && !_isTechKeyword(parts[1])) {
      jobInfo.company = parts[1];
    }
  }

  // Fall back to snippet "at Company" pattern extraction
  if (!jobInfo.company && snippet) {
    jobInfo.company = _extractCompanyFromSnippet(snippet);
  }

  // Final fallback: use structured snippet's Experience: field (most reliable for LinkedIn cards)
  if (!jobInfo.company && structured.company) {
    jobInfo.company = structured.company;
  }

  // Clean job title: strip trailing ", City" when we know the city from structured snippet
  if (jobInfo.jobTitle && structured.location) {
    const escapedLoc = structured.location.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    jobInfo.jobTitle = jobInfo.jobTitle
      .replace(new RegExp(',?\\s*' + escapedLoc + '\\s*$', 'i'), '')
      .trim();
  }

  // If job title is still null, derive from structured jobTitleHint (e.g., "Python developer, Hyderabad")
  if (!jobInfo.jobTitle && structured.jobTitleHint) {
    let hint = structured.jobTitleHint;
    if (structured.location) {
      const escapedLoc = structured.location.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      hint = hint.replace(new RegExp(',?\\s*' + escapedLoc + '\\s*$', 'i'), '').trim();
    }
    jobInfo.jobTitle = hint || null;
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
  // Strategy 0: Structured LinkedIn snippet "Location:" field (highest priority)
  const structured = parseStructuredSnippet(snippet);
  if (structured.location) return structured.location;

  // Strategy 1: LinkedIn puts "· City, State, Country" in title
  // e.g. "Name - Role at Company · Hyderabad, Telangana, India | LinkedIn"
  const titleRaw = String(title || '').replace(/\s*\|\s*LinkedIn.*$/i, '');
  const dotMatch = titleRaw.match(/[·•]\s*([A-Za-z][A-Za-z .'-]+(?:,\s*[A-Za-z][A-Za-z .'-]+){0,2})/);
  if (dotMatch?.[1]) {
    const loc = dotMatch[1].trim();
    if (loc.length >= 3 && loc.length <= 80) return loc;
  }

  // Strategy 2: "Greater X Area" — LinkedIn's standard metro format
  const fullText = `${title || ''} ${snippet || ''}`;
  const greaterArea = fullText.match(/\b(Greater\s+[A-Za-z]+(?:\s+[A-Za-z]+)?\s+Area)\b/i);
  if (greaterArea?.[1]) return greaterArea[1].trim();

  // Strategy 3: LinkedIn snippet starts with "City, State · connections"
  const snippetText = String(snippet || '');
  const cityState = snippetText.match(/^([A-Za-z][A-Za-z .'-]{2,30},\s*[A-Za-z][A-Za-z .'-]{2,30}(?:,\s*[A-Za-z][A-Za-z .'-]{2,30})?)\s*[·•]/);
  if (cityState?.[1]) {
    const loc = cityState[1].trim();
    if (loc.length >= 5 && loc.length <= 80) return loc;
  }

  // Strategy 4: explicit "based in" / "located in" phrases only (not bare "in X" which matches skills)
  const text = fullText.replace(/\s+/g, ' ').trim();
  const explicitLocMatch = text.match(/\b(?:based in|located in|location[:\s]+)\s*([A-Za-z][A-Za-z .'-]+(?:,\s*[A-Za-z][A-Za-z .'-]+){0,2})/i);
  if (explicitLocMatch?.[1]) {
    const loc = explicitLocMatch[1].trim().replace(/\s{2,}/g, ' ');
    if (loc.length >= 3 && loc.length <= 80) return loc;
  }

  // Strategy 5: City name appearing at the end of snippet (common LinkedIn pattern: "... Hyderabad ...")
  const trailingCity = snippetText.match(/\.\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?(?:,\s*[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)?)\s*(?:\.{2,}|…)?\s*$/);
  if (trailingCity?.[1]) {
    const loc = trailingCity[1].trim();
    // Reject strings that look like institution/company names (contain "Ltd", "Pvt", "Inc", "University", etc.)
    if (loc.length >= 3 && loc.length <= 60 && !/\b(Ltd|Pvt|Inc|Corp|University|College|Institute|School|Technologies|Solutions|Services)\b/i.test(loc)) {
      return loc;
    }
  }

  return null;
}

/**
 * Extract education info from title + snippet text.
 * Prioritises structured LinkedIn snippet "Education:" field, then premium institutes, then degree keywords.
 */
export function extractEducationFromText(title, snippet) {
  // Priority 0: Structured LinkedIn snippet "Education:" field (highest accuracy)
  const structured = parseStructuredSnippet(snippet);
  if (structured.education) return structured.education;

  const fullText = `${title || ''} ${snippet || ''}`;

  // Priority 1: Well-known premium Indian institutes
  const premiumMatch = fullText.match(
    /\b(IIT(?:\s+(?:Bombay|Delhi|Madras|Kanpur|Kharagpur|Roorkee|Guwahati|Hyderabad|Varanasi|BHU|ISM|Jodhpur|Indore|Mandi|Patna|Bhubaneswar|Tirupati|Jammu|Palakkad|Dharwad|Bhilai|Dhanbad))?|IIM(?:\s+(?:Ahmedabad|Bangalore|Calcutta|Lucknow|Kozhikode|Indore|Shillong|Udaipur|Raipur|Rohtak|Trichy|Kashipur|Amritsar|Nagpur))?|IISC(?:\s+Bangalore)?|BITS(?:\s+(?:Pilani|Goa|Hyderabad))?|NIT(?:\s+(?:Trichy|Warangal|Surathkal|Calicut|Allahabad|Rourkela|Durgapur|Jamshedpur|Silchar|Kurukshetra|Hamirpur|Srinagar|Jalandhar|Patna|Raipur|Goa|Delhi|Puducherry))?|IIIT(?:\s+(?:Hyderabad|Allahabad|Delhi|Bangalore|Gwalior))?)\b/i
  );
  if (premiumMatch?.[0]) return premiumMatch[0].trim().replace(/\s+/g, ' ');

  // Priority 2: Degree keywords in snippet (not title, to avoid false-matches)
  const snippetText = String(snippet || '');
  const degreeMatch = snippetText.match(
    /\b(Ph\.?D\.?(?:\s+in\s+[A-Za-z\s]{3,30})?|M\.?Tech\.?(?:\s+in\s+[A-Za-z\s]{3,30})?|B\.?Tech\.?(?:\s+in\s+[A-Za-z\s]{3,30})?|MBA|M\.?S\.?(?:\s+in\s+[A-Za-z\s]{3,30})?|B\.?E\.?(?:\s+in\s+[A-Za-z\s]{3,30})?|Bachelor(?:'s)?(?:\s+(?:of|in)\s+[A-Za-z\s]{3,30})?|Master(?:'s)?(?:\s+(?:of|in)\s+[A-Za-z\s]{3,30})?)\b/i
  );
  if (degreeMatch?.[0]) return degreeMatch[0].trim();

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
      const education = extractEducationFromText(result.title, result.snippet);

      const candidate = {
        linkedInUrl,
        normalizedUrl,
        name,
        jobTitle: jobInfo.jobTitle,
        company: jobInfo.company,
        location,
        level: jobInfo.level,
        education,
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
        // Also check AI-extracted skills array for accurate matching
        const candidateSkillsLower = (Array.isArray(candidate.skills) ? candidate.skills : [])
          .map((s) => String(s).toLowerCase());
        const skillMatches = targetSkills.filter((skill) => {
          const s = String(skill || '').toLowerCase();
          return s && (
            snippetLower.includes(s) ||
            titleLower.includes(s) ||
            candidateSkillsLower.some((cs) => cs.includes(s) || s.includes(cs))
          );
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
    education: c.education || null,
    skills: Array.isArray(c.skills) ? c.skills : [],
    totalExperience: c.totalExperience || null,
    about: c.about || null,
    email: c.contact?.email || null,
    phone: c.contact?.phone || null,
    enrichmentSource: c.contact?.source || null,
    enrichmentConfidence: c.contact?.confidence || null,
    sourceCountry: c.sourceCountry || c.foundIn || null,
    snippet: c.snippet || '',
    sources: c.sources || [],
    relevanceScore: c.relevanceScore || 0,
    // Boolean match scoring fields (populated by matchScorer)
    matchScore:      c.matchScore      ?? null,
    matchCategory:   c.matchCategory   ?? null,
    matchedSkills:   c.matchedSkills   ?? [],
    missingSkills:   c.missingSkills   ?? [],
    locationMatch:   c.locationMatch   ?? null,
    experienceMatch: c.experienceMatch ?? null,
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
  extractEducationFromText,
  filterCandidates,
  rankCandidates,
  deduplicateCandidates,
  formatCandidates,
};
