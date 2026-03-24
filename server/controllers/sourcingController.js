import mammoth from 'mammoth';
import { createRequire } from 'module';
import aiSourcingService from '../utils/aiSourcingService.js';
import cseService from '../utils/cseService.js';
import apifyService from '../utils/apifyService.js';
import {
  extractCandidates,
  normalizeLinkedInProfiles,
  deduplicateCandidates,
  formatCandidates,
  mergeOsintData,
} from '../utils/candidateExtraction.js';
import { aiEnrichCandidates } from '../utils/aiCandidateExtraction.js';
import contactEnrichmentService from '../utils/contactEnrichmentService.js';
import githubService from '../utils/githubService.js';
import logger from '../utils/logger.js';
import Candidate from '../models/Candidate.js';
import SourcingSession from '../models/SourcingSession.js';
import { scoreCandidates, bucketByMatchCategory } from '../utils/matchScorer.js';

const require = createRequire(import.meta.url);

let pdfParse = null;
try {
  const pdfModule = require('pdf-parse');
  pdfParse =
    typeof pdfModule === 'function'
      ? pdfModule
      : typeof pdfModule?.default === 'function'
        ? pdfModule.default
        : null;
} catch (error) {
  logger.warn(`PDF parser initialization failed: ${error.message}`);
}

function clampNumber(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(num)));
}

function stageToStatus(stage) {
  const normalized = String(stage || '').toUpperCase();
  if (normalized === 'SEQUENCED') {
    return { pipelineStage: 'SEQUENCED', sequenceStatus: 'QUEUED', callStatus: 'NOT_SCHEDULED' };
  }
  if (normalized === 'CALL_QUEUED') {
    return { pipelineStage: 'CALL_QUEUED', sequenceStatus: 'QUEUED', callStatus: 'QUEUED' };
  }
  if (normalized === 'SHORTLISTED') {
    return { pipelineStage: 'SHORTLISTED', sequenceStatus: 'QUEUED', callStatus: 'QUEUED' };
  }
  return { pipelineStage: 'DISCOVERED', sequenceStatus: 'NOT_STARTED', callStatus: 'NOT_SCHEDULED' };
}

function normalizeAvailability(value) {
  const text = String(value || '').toLowerCase();
  if (!text) return 'UNKNOWN';
  if (text.includes('immediate')) return 'IMMEDIATE';
  if (text.includes('15')) return '15_DAYS';
  if (text.includes('30') || text.includes('month')) return '30_DAYS';
  return 'UNKNOWN';
}

function buildStructuredRequirements(parsed) {
  return aiSourcingService.toStructuredRequirements(parsed);
}

function toInternalParsed({ parsedRequirements, jobDescription }) {
  if (parsedRequirements && typeof parsedRequirements === 'object') {
    return aiSourcingService.normalizeParsedRequirements(parsedRequirements);
  }
  if (!jobDescription || String(jobDescription).trim().length < 20) {
    throw new Error('Job description must be at least 20 characters');
  }
  return aiSourcingService.parseJobDescription(jobDescription);
}

async function extractTextFromFile(file) {
  if (!file?.buffer) {
    throw new Error('Uploaded file is empty');
  }

  const name = String(file.originalname || '').toLowerCase();
  const mime = String(file.mimetype || '').toLowerCase();

  if (mime.includes('pdf') || name.endsWith('.pdf')) {
    if (!pdfParse) {
      throw new Error('PDF parsing is currently unavailable on server runtime');
    }
    const parsed = await pdfParse(file.buffer);
    return String(parsed?.text || '').trim();
  }

  if (
    mime.includes('officedocument.wordprocessingml.document') ||
    name.endsWith('.docx')
  ) {
    const parsed = await mammoth.extractRawText({ buffer: file.buffer });
    return String(parsed?.value || '').trim();
  }

  if (mime.includes('text/plain') || name.endsWith('.txt')) {
    return file.buffer.toString('utf8').trim();
  }

  throw new Error('Unsupported file type. Upload PDF, DOCX, or TXT.');
}

function deriveCandidatePayload(candidate, parsed, userId) {
  const linkedInUrl = candidate.linkedInUrl || candidate.linkedinUrl || null;
  const fullName = candidate.name || candidate.fullName || null;
  const locationFallback = parsed?.location && !/remote|unspecified|unknown|not specified/i.test(parsed.location)
    ? parsed.location
    : '';
  const location = candidate.location || locationFallback || '';
  const experienceYears = Number(parsed?.experience_years || 0);
  const experience = experienceYears > 0 ? `${experienceYears}+ years` : '';

  const contactEmail = candidate.contact?.email || candidate.email || '';
  const contactPhone = candidate.contact?.phone || candidate.phone || '';
  const enrichmentSource = candidate.contact?.source || candidate.enrichmentSource || '';
  const enrichmentConfidence = Number(candidate.contact?.confidence || candidate.enrichmentConfidence || 0);
  const baseStage = contactEmail || contactPhone ? 'CONTACT_ENRICHED' : 'DISCOVERED';

  // Candidate's actual skills (array or CSV string)
  let candidateSkills = '';
  if (Array.isArray(candidate.skills) && candidate.skills.length > 0) {
    candidateSkills = candidate.skills.join(', ');
  } else if (typeof candidate.skills === 'string' && candidate.skills.trim()) {
    candidateSkills = candidate.skills.trim();
  }

  // Candidate's actual experience (text like "5+ years" or numeric years)
  const candidateExperience =
    candidate.totalExperience ||
    (typeof candidate.experienceYears === 'number' && candidate.experienceYears > 0
      ? `${candidate.experienceYears} years`
      : '') ||
    experience; // fallback to JD-derived value if nothing on the candidate

  return {
    linkedInUrl,
    fullName,
    jobTitle: candidate.jobTitle || candidate.title || parsed?.job_title?.main || '',
    company: candidate.company || '',
    location,
    country: candidate.sourceCountry || candidate.foundIn || candidate.country || '',
    industry: parsed?.industry || 'Not Specified',
    availability: normalizeAvailability(parsed?.availability),
    education: candidate.education || '',
    email: contactEmail,
    phone: contactPhone,
    skills: candidateSkills,
    experience: candidateExperience,
    summary: candidate.about || '',
    createdBy: userId,
    source: 'AI_SOURCING',
    sourceCountry: candidate.sourceCountry || candidate.foundIn || candidate.country || '',
    enrichmentStatus: contactEmail || contactPhone ? 'ENRICHED' : 'NEW',
    enrichmentMetadata:
      enrichmentSource || enrichmentConfidence
        ? {
            source: enrichmentSource || 'unknown',
            confidence: enrichmentConfidence,
            enrichedAt: new Date(),
          }
        : null,
    pipelineStage: baseStage,
    sequenceStatus: 'NOT_STARTED',
    callStatus: 'NOT_SCHEDULED',
  };
}

async function persistSourcedCandidates(candidates, parsed, userId) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return { savedCount: 0, savedIds: new Map() };
  }

  const savedIds = new Map();
  let savedCount = 0;

  for (const candidate of candidates) {
    try {
      const payload = deriveCandidatePayload(candidate, parsed, userId);
      if (!payload.linkedInUrl || !payload.fullName) continue;

      const update = {
        $set: {
          fullName: payload.fullName,
          jobTitle: payload.jobTitle,
          company: payload.company,
          location: payload.location,
          country: payload.country,
          industry: payload.industry,
          availability: payload.availability,
          education: payload.education,
          linkedinUrl: payload.linkedInUrl,
          source: payload.source,
          sourceCountry: payload.sourceCountry,
          enrichmentStatus: payload.enrichmentStatus,
          pipelineStage: payload.pipelineStage,
          sequenceStatus: payload.sequenceStatus,
          callStatus: payload.callStatus,
          candidateStatus: payload.candidateStatus || 'ACTIVE',
        },
        $setOnInsert: {
          createdBy: payload.createdBy,
        },
      };

      if (payload.skills) update.$set.skills = payload.skills;
      if (payload.experience) update.$set.experience = payload.experience;
      if (payload.email) update.$set.email = payload.email;
      if (payload.phone) update.$set.phone = payload.phone;
      if (payload.enrichmentMetadata) update.$set.enrichmentMetadata = payload.enrichmentMetadata;

      const doc = await Candidate.findOneAndUpdate(
        { linkedinUrl: payload.linkedInUrl },
        update,
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );

      if (doc?._id) {
        savedCount += 1;
        savedIds.set(payload.linkedInUrl, String(doc._id));
      }
    } catch (error) {
      logger.debug(`Failed to persist sourced candidate: ${error.message}`);
    }
  }

  return { savedCount, savedIds };
}

/**
 * POST /api/ai-source/requirements
 * Extract structured requirements from JD text or uploaded file.
 */
export const extractRequirements = async (req, res) => {
  try {
    const textInput = String(req.body?.jobDescription || '').trim();
    let rawText = textInput;

    if (!rawText && req.file) {
      rawText = await extractTextFromFile(req.file);
    }

    if (!rawText || rawText.length < 20) {
      return res.status(400).json({
        success: false,
        error: 'Provide at least 20 characters of JD text or upload a valid file.',
      });
    }

    const parsed = await aiSourcingService.parseJobDescription(rawText);
    const structured = buildStructuredRequirements(parsed);
    const searchQueries = aiSourcingService.generateSearchQueries(parsed, 6);
    const targetCountries = aiSourcingService.determineTargetCountries(
      structured.location,
      structured.remote
    );

    return res.status(200).json({
      success: true,
      sourceTextLength: rawText.length,
      sourceTextPreview: rawText.slice(0, 900),
      parsedRequirements: structured,
      searchPlanPreview: {
        queries: searchQueries,
        countries: targetCountries,
      },
    });
  } catch (error) {
    logger.error(`JD requirements extraction failed: ${error.message}`);
    return res.status(500).json({
      success: false,
      error: 'Failed to extract requirements',
      message: error.message,
    });
  }
};

/**
 * POST /api/ai-source
 * Main sourcing endpoint.
 */
export const sourceCandidates = async (req, res) => {
  const {
    jobDescription,
    parsedRequirements,
    maxCandidates = 50,
    maxQueries = 6,
    resultsPerCountry = 7,
    enrichContacts = false,
    enrichTopN = 0,
    autoSave = true,
    discoverGithub = false,   // Phase 2: run secondary Apify batch for LinkedIn slug → GitHub
    enrichGithub = false,     // Phase 3: call GitHub API to get stats for candidates with githubUrl
  } = req.body || {};

  const userId = req.user?._id;
  const startedAt = Date.now();

  try {
    const parsed = await toInternalParsed({ parsedRequirements, jobDescription });
    const structured = buildStructuredRequirements(parsed);

    const maxCandidatesSafe = clampNumber(maxCandidates, 1, 120, 50);
    const maxQueriesSafe = clampNumber(maxQueries, 1, 8, 6);
    const resultsPerCountrySafe = clampNumber(resultsPerCountry, 1, 10, 7);
    const enrichTopNSafe = clampNumber(enrichTopN, 1, 50, 15);

    // ── Candidate Discovery ───────────────────────────────────────────────────
    //
    // Apify (Google search) — Boolean queries + OpenAI snippet enrichment.
    //
    let candidates = [];
    let dataSource = 'unknown';
    let searchQueries = [];
    let targetCountries = [];
    let allResults = [];
    let linkedInProfiles = [];

    if (apifyService.isConfigured()) {
      targetCountries = aiSourcingService.determineTargetCountries(structured.location, structured.remote);

      // ── HarvestAPI LinkedIn Profile Search — main candidate discovery ────
      dataSource = 'apify';
      const linkedInParams = aiSourcingService.buildLinkedInSearchParams(parsed);
      const osintQueries = aiSourcingService.generateOsintQueries(parsed);
      logger.info(
        `[HarvestAPI] searchQuery="${linkedInParams.searchQuery}" titles=${linkedInParams.currentJobTitles.length} ` +
        `seniority=${linkedInParams.seniorityLevelIds.join(',')} pages=${linkedInParams.takePages} | OSINT=${osintQueries.length} queries`
      );

      linkedInProfiles = await apifyService.runLinkedInSearch(linkedInParams);

      // Auto-retry 1: 0 results → remove seniorityLevelIds (too restrictive)
      if (linkedInProfiles.length === 0 && linkedInParams.seniorityLevelIds.length > 0) {
        logger.info('[HarvestAPI] 0 results — retrying without seniorityLevelIds');
        linkedInProfiles = await apifyService.runLinkedInSearch({
          ...linkedInParams,
          seniorityLevelIds: [],
        });
      }

      // Auto-retry 2: <10 results → remove postFilteringMongoQuery + double pages
      if (linkedInProfiles.length < 10 && linkedInParams.postFilteringMongoQuery) {
        logger.info(`[HarvestAPI] ${linkedInProfiles.length} results — retrying without postFilteringMongoQuery`);
        linkedInProfiles = await apifyService.runLinkedInSearch({
          ...linkedInParams,
          seniorityLevelIds: linkedInProfiles.length === 0 ? [] : linkedInParams.seniorityLevelIds,
          postFilteringMongoQuery: null,
          takePages: 8,
        });
      }

      if (linkedInProfiles.length === 0) {
        return res.status(200).json({
          success: true, parseOnly: false,
          message: 'No candidate profiles found for this requirement set.',
          parsedRequirements: structured, candidates: [], results: [],
          summary: { totalDiscovered: 0, totalExtracted: 0, totalEnriched: 0, totalSaved: 0, timeMs: Date.now() - startedAt },
        });
      }

      candidates = normalizeLinkedInProfiles(linkedInProfiles);
      candidates = deduplicateCandidates(candidates);

      // ── OSINT: GitHub + Stack Overflow dorking (same Apify account) ──────
      if (osintQueries.length > 0) {
        const apifyResultsPerQuery = Math.min(resultsPerCountrySafe * Math.max(targetCountries.length, 1), 50);
        allResults = await apifyService.runGoogleSearch(osintQueries, apifyResultsPerQuery);
        candidates = mergeOsintData(candidates, allResults);
      }

      // ── Phase 2: LinkedIn slug → GitHub correlation (opt-in) ─────────────
      if (discoverGithub && candidates.length > 0) {
        const slugQueries = candidates
          .slice(0, 10)
          .map((c) => c.linkedInUrl)
          .filter(Boolean)
          .map((url) => {
            const slug = url.split('/in/')[1]?.replace(/\/$/, '');
            return slug ? `site:github.com "${slug}"` : null;
          })
          .filter(Boolean);

        if (slugQueries.length > 0) {
          logger.info(`[OSINT] Phase 2 — running ${slugQueries.length} LinkedIn slug → GitHub queries`);
          const slugResults = await apifyService.runGoogleSearch(slugQueries, 3);
          candidates = mergeOsintData(candidates, slugResults);
        }
      }

      // HarvestAPI already returns structured data — OpenAI enrichment is skipped.
      // We still run it if the snippet (headline) has useful info to parse.
      const aiMap = await aiEnrichCandidates(linkedInProfiles.map(p => ({
        title: p.headline || '',
        link:  p.profileUrl || p.linkedInUrl || '',
        snippet: p.about || p.headline || '',
        query: 'linkedin-search',
      })));
      if (aiMap && aiMap.size > 0) {
        candidates = candidates.map((c) => {
          const ai = aiMap.get(c.normalizedUrl);
          if (!ai) return c;
          return {
            ...c,
            name:      (ai.name?.trim())      || c.name,
            jobTitle:  (ai.jobTitle?.trim())  || c.jobTitle,
            company:   (ai.company?.trim())   || c.company,
            location:  (ai.location?.trim())  || c.location,
            education: (ai.education?.trim()) || c.education,
            skills: Array.isArray(ai.skills)
              ? ai.skills
                  .filter(Boolean)
                  .map(s => String(s).trim())
                  .filter(s =>
                    s.length >= 2 && s.length <= 40 &&
                    !/\b(pvt|ltd|inc|corp|llc|llp|limited|solutions|technologies|systems|services|consulting|group|software|infotech)\b/i.test(s) &&
                    !/\b(india|usa|uk|canada|germany|singapore|australia|bangalore|bengaluru|hyderabad|mumbai|delhi|chennai|pune|kolkata|gurgaon|noida|london|berlin|new york|toronto|sydney)\b/i.test(s) &&
                    !/^\d+\s*\+?\s*(year|yr|month|mo)/i.test(s) &&
                    !s.includes(',')
                  )
                  .slice(0, 8)
              : (c.skills || []),
            totalExperience: ai.totalExperience || c.totalExperience || null,
            about: (ai.about?.trim()) || c.about || null,
          };
        });
        logger.info(`[Serper] OpenAI enrichment: ${aiMap.size} candidates enriched`);
      }

    } else if (candidates.length === 0) {
      // ── No source available or all fell through ─────────────────────────────
      searchQueries = aiSourcingService.generateSearchQueries(parsed, maxQueriesSafe);
      targetCountries = aiSourcingService.determineTargetCountries(structured.location, structured.remote);
      return res.status(200).json({
        success: true, parseOnly: true,
        message: 'Requirements extracted. Add APIFY_API_KEY or SERPER_API_KEY to run candidate discovery.',
        parsedRequirements: structured,
        searchPlan: { queries: searchQueries, countries: targetCountries },
        candidates: [], results: [],
        summary: { totalDiscovered: 0, totalExtracted: 0, totalEnriched: 0, totalSaved: 0, timeMs: Date.now() - startedAt },
      });
    }

    // ── Step 1: Experience hard filter ────────────────────────────────────────
    // Serper: text like "5+ years" parsed as a number.
    // Rejects anyone clearly below the required minimum.
    const minExpYears = Number(parsed.experience_years || 0);
    if (minExpYears > 0) {
      const beforeExp = candidates.length;
      candidates = candidates.filter(c => {
        if (typeof c.experienceYears === 'number' && c.experienceYears > 0) {
          return c.experienceYears >= minExpYears;
        }
        // Serper fallback: parse the text field
        const expStr = String(c.totalExperience || c.experience || '');
        const match = expStr.match(/(\d+(\.\d+)?)/);
        if (match) return parseFloat(match[1]) >= minExpYears;
        // No experience data at all — keep the candidate (don't discard unknowns)
        return true;
      });
      logger.info(`Experience filter (>=${minExpYears} yrs): ${candidates.length}/${beforeExp} passed`);
    }

    // Step 2: Boolean match scoring.
    // For HarvestAPI (apify) sourcing: LinkedIn native filters already pre-screen by seniority,
    // experience IDs and keywords — score for ranking only, do NOT hard-exclude on score.
    // For fallback text-search (serper): apply a 30-point floor since we have no upstream filter.
    const isPreFiltered = dataSource === 'apify';
    candidates = scoreCandidates(candidates, parsed, {
      minScore: isPreFiltered ? 0 : 30,
      excludeDisqualified: !isPreFiltered,
    });

    // Step 3: Strict location filter — two-tier approach.
    //
    // Tier 1 (city-confirmed): c.location contains the required city.
    //   e.g. AI-extracted location → PASS if city found in string
    //
    // Tier 2 (country-fallback): city not in c.location but country matches.
    //   e.g. required="Hyderabad", c.country="India" → PASS (flagged as location unverified)
    const requiredLocation = parsed.location || '';
    if (requiredLocation && !/unspecified|not specified|remote/i.test(requiredLocation)) {
      const locLower = requiredLocation.split(',')[0].trim().toLowerCase();

      // City spelling synonyms — e.g. "bangalore" ↔ "bengaluru", "new delhi" ↔ "delhi"
      const CITY_SYNONYMS = {
        bangalore: ['bengaluru', 'bangalore'],
        bengaluru: ['bengaluru', 'bangalore'],
        'new delhi': ['new delhi', 'delhi'],
        delhi: ['delhi', 'new delhi'],
        mumbai: ['mumbai', 'bombay'],
        bombay: ['mumbai', 'bombay'],
        kolkata: ['kolkata', 'calcutta'],
        calcutta: ['kolkata', 'calcutta'],
        chennai: ['chennai', 'madras'],
        madras: ['chennai', 'madras'],
      };
      const cityVariants = CITY_SYNONYMS[locLower] || [locLower];

      // Build a country keyword from the required location so we can match c.foundIn.
      // e.g. "Hyderabad" → "india", "London" → "uk", "Berlin" → "germany"
      // Comparisons are done after toLowerCase() so capitalisation doesn't matter.
      const CITY_TO_COUNTRY = {
        hyderabad: 'india', bangalore: 'india', bengaluru: 'india', mumbai: 'india',
        delhi: 'india', 'new delhi': 'india', chennai: 'india', pune: 'india',
        kolkata: 'india', gurgaon: 'india', noida: 'india', ahmedabad: 'india',
        london: 'united kingdom', manchester: 'united kingdom', birmingham: 'united kingdom', edinburgh: 'united kingdom',
        berlin: 'germany', munich: 'germany', frankfurt: 'germany', hamburg: 'germany',
        toronto: 'canada', vancouver: 'canada', montreal: 'canada',
        sydney: 'australia', melbourne: 'australia', brisbane: 'australia',
        singapore: 'singapore',
        'new york': 'united states', 'san francisco': 'united states', seattle: 'united states',
        austin: 'united states', chicago: 'united states', boston: 'united states',
        dubai: 'united arab emirates', amsterdam: 'netherlands',
        paris: 'france', madrid: 'spain', stockholm: 'sweden',
      };
      const countryForCity = CITY_TO_COUNTRY[locLower] || null;

      const beforeCount = candidates.length;
      const cityConfirmed = [];
      const countryFallback = [];

      for (const c of candidates) {
        const currentLocation = String(c.location || '').toLowerCase();

        if (cityVariants.some((v) => currentLocation.includes(v))) {
          // Tier 1: city confirmed — location string contains the required city (or its synonym)
          cityConfirmed.push(c);
        } else if (countryForCity) {
          // Tier 2: city not found in location — check country instead.
          // Use foundIn / sourceCountry / country / location itself for country check.
          const countryStr = String(c.foundIn || c.sourceCountry || c.country || currentLocation).toLowerCase();
          if (countryStr && countryStr.includes(countryForCity)) {
            countryFallback.push({ ...c, locationUnverified: true });
          }
        }
      }

      // City-confirmed first (already sorted by matchScore), country-fallback appended after
      candidates = [...cityConfirmed, ...countryFallback];

      logger.info(`Location filter "${locLower}": ${cityConfirmed.length} city-confirmed + ${countryFallback.length} country-fallback (${candidates.length}/${beforeCount} total)`);
    }

    candidates = candidates.slice(0, maxCandidatesSafe);

    if (enrichContacts) {
      const enrichCount = Math.min(candidates.length, enrichTopNSafe);
      for (let i = 0; i < enrichCount; i += 1) {
        try {
          const candidate = candidates[i];
          const enriched = await contactEnrichmentService.enrichCandidate({
            linkedInUrl: candidate.linkedInUrl,
            name: candidate.name,
            company: candidate.company,
          });

          if (enriched && (enriched.email || enriched.phone)) {
            candidates[i].contact = {
              email: enriched.email || null,
              phone: enriched.phone || null,
              confidence: enriched.confidence || 0,
              source: enriched.source || null,
            };
          }
        } catch (error) {
          logger.debug(`Enrichment failed for ${candidates[i]?.name}: ${error.message}`);
        }
      }
    }

    // ── Phase 3: GitHub API stats enrichment (opt-in) ────────────────────
    if (enrichGithub) {
      const githubCandidatesCount = candidates.filter((c) => c.githubUrl).length;
      if (githubCandidatesCount > 0) {
        logger.info(`[GitHub] Phase 3 — fetching stats for ${Math.min(githubCandidatesCount, 10)} candidates`);
        candidates = await githubService.enrichCandidates(candidates, 10);
      }
    }

    let savedCount = 0;
    let savedIds = new Map();
    if (autoSave) {
      const persisted = await persistSourcedCandidates(candidates, parsed, userId);
      savedCount = persisted.savedCount;
      savedIds = persisted.savedIds;
    }

    for (const candidate of candidates) {
      const savedId = savedIds.get(candidate.linkedInUrl);
      candidate.savedCandidateId = savedId || null;
      candidate.savedToDatabase = Boolean(savedId);
      candidate.pipelineStage = candidate.contact?.email || candidate.contact?.phone ? 'CONTACT_ENRICHED' : 'DISCOVERED';
      candidate.sequenceStatus = 'NOT_STARTED';
      candidate.callStatus = 'NOT_SCHEDULED';
    }

    const formatted = formatCandidates(candidates);
    const enrichedCount = formatted.filter((c) => c.email || c.phone).length;
    const totalTime = Date.now() - startedAt;

    // ── Persist search session (fire-and-forget, never blocks response) ───────
    if (userId && formatted.length > 0) {
      SourcingSession.create({
        userId,
        jobTitle:       structured.jobTitle || '',
        location:       structured.location || '',
        dataSource,
        candidateCount: formatted.length,
        parsedRequirements: structured,
        candidates:     formatted.slice(0, 50),
      }).catch((err) => logger.warn(`[Session] Failed to persist sourcing session: ${err.message}`));
    }

    // Build match-category bucket counts for the frontend
    const bucketCounts = { perfect: 0, strong: 0, good: 0, partial: 0, weak: 0 };
    for (const c of formatted) {
      const key = (c.matchCategory || 'weak').toLowerCase();
      if (key in bucketCounts) bucketCounts[key]++;
    }

    return res.status(200).json({
      success: true,
      source: 'internet',
      dataSource,
      parseOnly: false,
      message: 'AI sourcing completed successfully.',
      parsedRequirements: structured,
      searchPlan: {
        queries: searchQueries,
        countries: targetCountries,
        resultsPerCountry: resultsPerCountrySafe,
        maxQueries: maxQueriesSafe,
      },
      bucketCounts,
      candidates: formatted,
      results: formatted,
      totalFound: formatted.length,
      enrichedCount,
      countriesSearched: targetCountries,
      summary: {
        totalDiscovered: linkedInProfiles?.length || allResults.length,
        totalExtracted: formatted.length,
        totalEnriched: enrichedCount,
        totalSaved: savedCount,
        countriesSearched: targetCountries.length,
        queryCount: searchQueries.length,
        timeMs: totalTime,
      },
      metadata: {
        jobTitle: structured.jobTitle,
        skills: structured.requiredSkills,
        searchQueries: searchQueries.length,
        countriesSearched: targetCountries.length,
        totalExtracted: formatted.length,
        contactsEnriched: enrichedCount,
        timeMs: totalTime,
      },
    });
  } catch (error) {
    logger.error(`AI sourcing failed: ${error.message}`);
    return res.status(500).json({
      success: false,
      error: 'Failed to source candidates. Please try again.',
      message: error.message,
    });
  }
};

/**
 * POST /api/ai-source/candidate-stage
 * Update sequence/call/shortlist stage for AI sourced candidate.
 */
export const updateCandidateStage = async (req, res) => {
  const userId = req.user?._id;
  const {
    linkedInUrl,
    linkedinUrl,
    stage,
    name,
    fullName,
    company,
    jobTitle,
    title,
    location,
    sourceCountry,
  } = req.body || {};

  try {
    const resolvedLinkedin = linkedInUrl || linkedinUrl;
    if (!resolvedLinkedin) {
      return res.status(400).json({ success: false, error: 'linkedinUrl is required' });
    }

    const stageStatus = stageToStatus(stage);
    const update = {
      $set: {
        source: 'AI_SOURCING',
        linkedinUrl: resolvedLinkedin,
        pipelineStage: stageStatus.pipelineStage,
        sequenceStatus: stageStatus.sequenceStatus,
        callStatus: stageStatus.callStatus,
      },
      $setOnInsert: {
        createdBy: userId,
        fullName: fullName || name || 'Unknown Candidate',
        company: company || '',
        jobTitle: jobTitle || title || '',
        location: location || '',
        sourceCountry: sourceCountry || '',
        availability: 'UNKNOWN',
      },
    };

    if (stageStatus.pipelineStage === 'SHORTLISTED') {
      update.$set.shortlistedAt = new Date();
    }

    const doc = await Candidate.findOneAndUpdate({ linkedinUrl: resolvedLinkedin }, update, {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
    }).lean();

    return res.status(200).json({
      success: true,
      candidateId: doc?._id,
      stage: doc?.pipelineStage || stageStatus.pipelineStage,
      sequenceStatus: doc?.sequenceStatus || stageStatus.sequenceStatus,
      callStatus: doc?.callStatus || stageStatus.callStatus,
    });
  } catch (error) {
    logger.error(`Failed to update candidate stage: ${error.message}`);
    return res.status(500).json({
      success: false,
      error: 'Failed to update candidate stage',
      message: error.message,
    });
  }
};

/**
 * POST /api/ai-source/parse-query
 * Parse free-text recruiter requirement into structured filters for AI Search.
 */
export const parseSearchQuery = async (req, res) => {
  try {
    const queryText = String(req.body?.queryText || '').trim();
    if (!queryText) {
      return res.status(400).json({ error: 'queryText is required' });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: 'OPENAI_API_KEY not configured on server' });
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        response_format: { type: 'json_object' },
        temperature: 0,
        max_tokens: 240,
        messages: [
          {
            role: 'system',
            content:
              'Extract precise recruiter filters from text. Return JSON only with keys: jobTitle, skills, location, experience, hasEmail, hasPhone, hasLinkedin. skills must be an array of strings. experience is minimum years as integer.',
          },
          { role: 'user', content: queryText },
        ],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`OpenAI API error: ${response.status} - ${errText}`);
    }

    const data = await response.json();
    const parsed = JSON.parse(data?.choices?.[0]?.message?.content || '{}');
    return res.status(200).json({
      jobTitle: String(parsed.jobTitle || '').trim(),
      skills: Array.isArray(parsed.skills)
        ? parsed.skills.map((s) => String(s || '').trim()).filter(Boolean)
        : [],
      location: String(parsed.location || '').trim(),
      experience: Number.isFinite(Number(parsed.experience)) ? Number(parsed.experience) : 0,
      hasEmail: Boolean(parsed.hasEmail),
      hasPhone: Boolean(parsed.hasPhone),
      hasLinkedin: Boolean(parsed.hasLinkedin),
    });
  } catch (error) {
    logger.error(`Failed to parse AI search query: ${error.message}`);
    return res.status(500).json({
      error: 'Failed to parse search query',
      message: error.message,
    });
  }
};

/**
 * POST /api/ai-source/save-candidate
 */
export const saveSourcingResult = async (req, res) => {
  const userId = req.user?._id;
  const {
    name,
    fullName,
    linkedInUrl,
    linkedinUrl,
    jobTitle,
    title,
    company,
    location,
    sourceCountry,
    contact,
    email,
    phone,
    pipelineStage,
    sequenceStatus,
    callStatus,
  } = req.body || {};

  try {
    const resolvedLinkedIn = linkedInUrl || linkedinUrl || null;
    const resolvedName = fullName || name || null;

    if (!resolvedLinkedIn || !resolvedName) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: name/fullName and linkedInUrl/linkedinUrl',
      });
    }

    const resolvedEmail = contact?.email || email || '';
    const resolvedPhone = contact?.phone || phone || '';
    const resolvedSource = contact?.source || '';
    const resolvedConfidence = Number(contact?.confidence || 0);

    const update = {
      $set: {
        fullName: resolvedName,
        jobTitle: jobTitle || title || '',
        company: company || '',
        location: location || '',
        linkedinUrl: resolvedLinkedIn,
        source: 'AI_SOURCING',
        sourceCountry: sourceCountry || '',
        enrichmentStatus: resolvedEmail || resolvedPhone ? 'ENRICHED' : 'NEW',
        availability: normalizeAvailability(req.body?.availability),
        pipelineStage: pipelineStage || 'DISCOVERED',
        sequenceStatus: sequenceStatus || 'NOT_STARTED',
        callStatus: callStatus || 'NOT_SCHEDULED',
      },
      $setOnInsert: {
        createdBy: userId,
      },
    };

    if (resolvedEmail) update.$set.email = resolvedEmail;
    if (resolvedPhone) update.$set.phone = resolvedPhone;
    if (resolvedSource || resolvedConfidence) {
      update.$set.enrichmentMetadata = {
        source: resolvedSource || 'unknown',
        confidence: resolvedConfidence,
        enrichedAt: new Date(),
      };
    }

    const saved = await Candidate.findOneAndUpdate({ linkedinUrl: resolvedLinkedIn }, update, {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
    });

    return res.status(200).json({
      success: true,
      message: 'Candidate saved successfully',
      candidateId: saved?._id,
      candidate: {
        _id: saved?._id,
        fullName: saved?.fullName,
        linkedInUrl: saved?.linkedinUrl,
        email: saved?.email || null,
        phone: saved?.phone || null,
      },
    });
  } catch (error) {
    logger.error(`Failed to save sourced candidate: ${error.message}`);
    return res.status(500).json({
      success: false,
      error: 'Failed to save candidate',
      message: error.message,
    });
  }
};

/**
 * GET /api/ai-source/history
 */
export const getSourcingHistory = async (req, res) => {
  const userId = req.user?._id;
  const limit = clampNumber(req.query.limit, 1, 200, 10);
  const skip = clampNumber(req.query.skip, 0, 10000, 0);

  try {
    const query = {
      createdBy: userId,
      source: 'AI_SOURCING',
      isDeleted: false,
    };

    const total = await Candidate.countDocuments(query);
    const candidates = await Candidate.find(query)
      .select(
        'fullName jobTitle company location sourceCountry email phone linkedinUrl createdAt enrichmentStatus enrichmentMetadata pipelineStage sequenceStatus callStatus shortlistedAt'
      )
      .sort({ createdAt: -1 })
      .limit(limit)
      .skip(skip)
      .lean();

    return res.status(200).json({
      success: true,
      total,
      limit,
      skip,
      candidates,
    });
  } catch (error) {
    logger.error(`Failed to get sourcing history: ${error.message}`);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve history',
      message: error.message,
    });
  }
};

/**
 * GET /api/ai-source/stats
 */
export const getSourcingStats = async (req, res) => {
  const userId = req.user?._id;

  try {
    const query = {
      createdBy: userId,
      source: 'AI_SOURCING',
      isDeleted: false,
    };
    const total = await Candidate.countDocuments(query);
    const enriched = await Candidate.countDocuments({
      ...query,
      $or: [{ email: { $nin: [null, ''] } }, { phone: { $nin: [null, ''] } }],
    });
    const shortlisted = await Candidate.countDocuments({
      ...query,
      pipelineStage: 'SHORTLISTED',
    });

    const byStatus = await Candidate.aggregate([
      { $match: query },
      { $group: { _id: '$pipelineStage', count: { $sum: 1 } } },
    ]);

    return res.status(200).json({
      success: true,
      total,
      enrichedCount: enriched,
      shortlistedCount: shortlisted,
      enrichmentRate: total > 0 ? `${((enriched / total) * 100).toFixed(2)}%` : '0%',
      byStatus: Object.fromEntries(byStatus.map((row) => [row._id || 'UNKNOWN', row.count])),
    });
  } catch (error) {
    logger.error(`Failed to get sourcing stats: ${error.message}`);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve stats',
      message: error.message,
    });
  }
};

function convertToCSV(candidates) {
  const headers = [
    'Name',
    'Current Title',
    'Company',
    'Location',
    'Source Country',
    'LinkedIn URL',
    'Email',
    'Phone',
    'Enrichment Source',
    'Pipeline Stage',
    'Saved At',
  ];

  const rows = candidates.map((c) => [
    `"${String(c.fullName || c.name || '').replace(/"/g, '""')}"`,
    `"${String(c.jobTitle || c.title || '').replace(/"/g, '""')}"`,
    `"${String(c.company || '').replace(/"/g, '""')}"`,
    `"${String(c.location || '').replace(/"/g, '""')}"`,
    `"${String(c.sourceCountry || c.foundIn || '').replace(/"/g, '""')}"`,
    `"${String(c.linkedinUrl || c.linkedInUrl || '').replace(/"/g, '""')}"`,
    `"${String(c.email || c.contact?.email || '').replace(/"/g, '""')}"`,
    `"${String(c.phone || c.contact?.phone || '').replace(/"/g, '""')}"`,
    `"${String(c.enrichmentMetadata?.source || c.enrichmentSource || '').replace(/"/g, '""')}"`,
    `"${String(c.pipelineStage || '').replace(/"/g, '""')}"`,
    `"${String(c.createdAt || '').substring(0, 10)}"`,
  ]);

  return [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');
}

/**
 * GET /api/ai-source/export/csv
 */
export const exportSourcedCandidatesCSV = async (req, res) => {
  const userId = req.user?._id;

  try {
    const candidates = await Candidate.find({
      createdBy: userId,
      source: 'AI_SOURCING',
      isDeleted: false,
    })
      .select(
        'fullName jobTitle company location sourceCountry email phone linkedinUrl enrichmentMetadata pipelineStage createdAt'
      )
      .lean();

    const csvContent = convertToCSV(candidates);
    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `sourced-candidates-${timestamp}.csv`;

    res.setHeader('Content-Type', 'text/csv;charset=utf-8;');
    res.setHeader('Content-Disposition', `attachment;filename="${filename}"`);
    return res.status(200).send(csvContent);
  } catch (error) {
    logger.error(`Failed to export sourced candidates CSV: ${error.message}`);
    return res.status(500).json({
      success: false,
      error: 'Failed to export candidates',
      message: error.message,
    });
  }
};

/**
 * POST /api/ai-source/export/csv
 */
export const exportCandidatesAsCSV = async (req, res) => {
  const { candidates } = req.body || {};

  try {
    if (!Array.isArray(candidates) || candidates.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No candidates provided for export',
      });
    }

    const csvContent = convertToCSV(candidates);
    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `sourced-candidates-${timestamp}.csv`;

    res.setHeader('Content-Type', 'text/csv;charset=utf-8;');
    res.setHeader('Content-Disposition', `attachment;filename="${filename}"`);
    return res.status(200).send(csvContent);
  } catch (error) {
    logger.error(`Failed to export provided candidates CSV: ${error.message}`);
    return res.status(500).json({
      success: false,
      error: 'Failed to export candidates',
      message: error.message,
    });
  }
};

/**
 * POST /api/ai-source/internal-db
 *
 * Search the internal MongoDB candidate database using Boolean match scoring.
 *
 * Flow:
 *   1. Parse JD → structured requirements (AI or passed directly)
 *   2. Build a broad MongoDB pre-filter using OR regex on all skills + location
 *      (uses existing indexes — does NOT do a full collection scan)
 *   3. Score each pre-filtered candidate with matchScorer
 *   4. Return candidates bucketed by match category (PERFECT / STRONG / GOOD / PARTIAL)
 *
 * Body params:
 *   jobDescription      {string}   raw JD text (used if parsedRequirements not provided)
 *   parsedRequirements  {object}   already-parsed requirements object (skips AI call)
 *   maxResults          {number}   max candidates to return (default 50, max 200)
 *   minScore            {number}   minimum match % to include (default 30)
 *   includeWeak         {boolean}  include WEAK matches in response (default false)
 */
export const searchInternalDb = async (req, res) => {
  const startedAt = Date.now();

  try {
    const {
      jobDescription,
      parsedRequirements,
      maxResults = 50,
      minScore = 30,
      includeWeak = false,
    } = req.body || {};

    // ── 1. Parse requirements ─────────────────────────────────────────────
    const parsed = await toInternalParsed({ parsedRequirements, jobDescription });
    const structured = buildStructuredRequirements(parsed);

    const mustHaveSkills  = parsed.must_have_skills  || [];
    const requiredSkills  = parsed.required_skills   || [];
    const preferredSkills = parsed.preferred_skills  || [];
    const reqLocation     = String(parsed.location || '');
    const hasLocation     = Boolean(reqLocation && !/unspecified|not specified/i.test(reqLocation));

    const maxResultsSafe = Math.min(Math.max(Number(maxResults) || 50, 1), 200);
    const minScoreSafe   = Math.min(Math.max(Number(minScore)   || 30, 0), 100);

    // ── 2. Build pre-filter using $text index ────────────────────────────
    // Internal DB stores skills as a comma-separated string e.g. "React, Node.js, Python"
    // jobTitle e.g. "Senior React Developer", locality e.g. "Hyderabad"
    //
    // CandidateTextIndex covers: fullName, jobTitle, skills, company, location, locality, summary
    // We quote each term so MongoDB treats "Node.js" as a phrase, not split tokens.
    //
    // IMPORTANT: $text cannot be combined with .sort(createdAt) — use textScore sort instead.
    const coreSkills = [...new Set([...mustHaveSkills, ...requiredSkills])].slice(0, 6);
    const textTerms  = [
      ...coreSkills,
      ...(hasLocation ? [reqLocation.split(',')[0].trim()] : []),
    ].filter(Boolean);

    const PRE_FETCH_LIMIT = 2000;
    const SELECT_FIELDS   = 'fullName jobTitle skills experience location locality country email phone linkedinUrl company industry education summary availability candidateStatus createdAt';

    let rawCandidates;

    if (textTerms.length > 0) {
      // Quoted phrases → exact token match ("Node.js" stays "Node.js", not split)
      const textSearch = textTerms.map(t => `"${t}"`).join(' ');
      const preFilter  = {
        isDeleted:   false,
        privateDbId: null,
        $text:       { $search: textSearch },
      };
      rawCandidates = await Candidate
        .find(preFilter, { _textScore: { $meta: 'textScore' } })
        .select(SELECT_FIELDS)
        .sort({ _textScore: { $meta: 'textScore' } })   // required when using $text
        .limit(PRE_FETCH_LIMIT)
        .lean()
        .maxTimeMS(30000);
    } else {
      // No skills/location — return most recent candidates for scoring
      rawCandidates = await Candidate
        .find({ isDeleted: false, privateDbId: null })
        .select(SELECT_FIELDS)
        .sort({ createdAt: -1 })
        .limit(PRE_FETCH_LIMIT)
        .lean()
        .maxTimeMS(30000);
    }

    // ── 3. Score & rank ───────────────────────────────────────────────────
    const scored = scoreCandidates(rawCandidates, parsed, {
      minScore: minScoreSafe,
      excludeDisqualified: true,
    });

    // ── 4. Bucket and trim ────────────────────────────────────────────────
    const allBucketed = bucketByMatchCategory(scored);

    // Optionally exclude WEAK bucket
    if (!includeWeak) delete allBucketed.weak;

    // Flatten in priority order for the `candidates` array, capped at maxResultsSafe
    const orderedCandidates = [
      ...(allBucketed.perfect  || []),
      ...(allBucketed.strong   || []),
      ...(allBucketed.good     || []),
      ...(allBucketed.partial  || []),
      ...(allBucketed.weak     || []),
    ].slice(0, maxResultsSafe);

    const bucketCounts = {
      perfect:  (allBucketed.perfect  || []).length,
      strong:   (allBucketed.strong   || []).length,
      good:     (allBucketed.good     || []).length,
      partial:  (allBucketed.partial  || []).length,
      weak:     (allBucketed.weak     || []).length,
    };

    return res.status(200).json({
      success: true,
      source: 'internal_db',
      parsedRequirements: structured,
      totalPreFiltered: rawCandidates.length,
      totalScored: scored.length,
      totalReturned: orderedCandidates.length,
      bucketCounts,
      buckets: allBucketed,
      candidates: orderedCandidates,
      summary: {
        jobTitle: structured.jobTitle,
        mustHaveSkills,
        requiredSkills,
        preferredSkills,
        location: reqLocation,
        minScore: minScoreSafe,
        timeMs: Date.now() - startedAt,
      },
    });
  } catch (error) {
    logger.error(`Internal DB search failed: ${error.message}`);
    return res.status(500).json({
      success: false,
      error: 'Internal DB search failed',
      message: error.message,
    });
  }
};

/**
 * GET /api/ai-source/sessions
 * List the current user's recent sourcing sessions (newest first, max 20).
 */
export const getSourcingSessions = async (req, res) => {
  const userId = req.user?._id;
  const limit = Math.min(Number(req.query.limit) || 20, 50);

  try {
    const sessions = await SourcingSession.find({ userId })
      .select('jobTitle location dataSource candidateCount createdAt')
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    return res.status(200).json({ success: true, sessions });
  } catch (error) {
    logger.error(`Failed to get sourcing sessions: ${error.message}`);
    return res.status(500).json({ success: false, error: 'Failed to retrieve sessions' });
  }
};

/**
 * GET /api/ai-source/sessions/:id
 * Get a single sourcing session including its candidates.
 */
export const getSessionById = async (req, res) => {
  const userId = req.user?._id;

  try {
    const session = await SourcingSession.findOne({ _id: req.params.id, userId }).lean();
    if (!session) {
      return res.status(404).json({ success: false, error: 'Session not found' });
    }
    return res.status(200).json({ success: true, session });
  } catch (error) {
    logger.error(`Failed to get sourcing session: ${error.message}`);
    return res.status(500).json({ success: false, error: 'Failed to retrieve session' });
  }
};

export default {
  extractRequirements,
  sourceCandidates,
  searchInternalDb,
  updateCandidateStage,
  parseSearchQuery,
  saveSourcingResult,
  getSourcingHistory,
  getSourcingStats,
  exportSourcedCandidatesCSV,
  exportCandidatesAsCSV,
  getSourcingSessions,
  getSessionById,
};
