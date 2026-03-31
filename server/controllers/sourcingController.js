import mammoth from 'mammoth';
import { createRequire } from 'module';
import aiSourcingService from '../utils/aiSourcingService.js';
// import cseService from '../utils/cseService.js';   // commented out — using HarvestAPI only
import apifyService from '../utils/apifyService.js';
// import apolloService from '../utils/apolloService.js';  // commented out — using HarvestAPI only
import {
  normalizeLinkedInProfiles,
  // normalizeApolloProfiles,  // commented out — Apollo not in use
  deduplicateCandidates,
  formatCandidates,
  mergeOsintData,
} from '../utils/candidateExtraction.js';
import { mergeCandidateWithAi } from '../utils/candidateProfileNormalizer.js';
import { aiEnrichCandidates } from '../utils/aiCandidateExtraction.js';
import contactEnrichmentService from '../utils/contactEnrichmentService.js';
import githubService from '../utils/githubService.js';
import logger from '../utils/logger.js';
import Candidate from '../models/Candidate.js';
import CandidatePool from '../models/CandidatePool.js';
import SourcingSession from '../models/SourcingSession.js';
import { scoreCandidates, bucketByMatchCategory, locationMatches } from '../utils/matchScorer.js';
import { saveToPool, searchPool } from '../utils/candidatePoolService.js';

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
  if (normalized === 'CONTACTED') {
    return { pipelineStage: 'CONTACTED', sequenceStatus: 'SENT', callStatus: 'NOT_SCHEDULED' };
  }
  if (normalized === 'RESPONDED') {
    return { pipelineStage: 'RESPONDED', sequenceStatus: 'SENT', callStatus: 'NOT_SCHEDULED' };
  }
  if (normalized === 'INTERVIEWING') {
    return { pipelineStage: 'INTERVIEWING', sequenceStatus: 'SENT', callStatus: 'COMPLETED' };
  }
  if (normalized === 'REJECTED') {
    return { pipelineStage: 'REJECTED', sequenceStatus: 'NOT_STARTED', callStatus: 'NOT_SCHEDULED' };
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

    const maxCandidatesSafe = clampNumber(maxCandidates, 1, 500, 100);
    const maxQueriesSafe = clampNumber(maxQueries, 1, 8, 6);
    const resultsPerCountrySafe = clampNumber(resultsPerCountry, 1, 10, 7);
    const enrichTopNSafe = clampNumber(enrichTopN, 1, 50, 15);

    // ── Candidate Discovery ───────────────────────────────────────────────────
    //
    // HarvestAPI LinkedIn Company Employees — structured profile discovery.
    //
    let candidates = [];
    let dataSource = 'unknown';
    let searchQueries = [];
    let targetCountries = [];
    let allResults = [];
    let linkedInProfiles = [];

    if (apifyService.isConfigured()) {
      targetCountries = aiSourcingService.determineTargetCountries(structured.location, structured.remote);
      const osintQueries = aiSourcingService.generateOsintQueries(parsed);

      // ── Step 1: Run cache lookup + Apify searches in parallel ────────────
      // Two parallel Apify searches:
      //   a) Title search  — uses currentJobTitles (Lead endpoint, best profile quality)
      //   b) Skill search  — uses searchQuery with key skills (fallback for niche job titles)
      dataSource = 'apify';
      const linkedInParams = aiSourcingService.buildLinkedInSearchParams(parsed);
      const skillQuery     = aiSourcingService.buildSkillSearchQuery(parsed);

      logger.info(
        `[HarvestAPI] titles=${linkedInParams.currentJobTitles.join('|')} ` +
        `loc=${linkedInParams.locations.join(',')} seniority=${linkedInParams.seniorityLevelIds.join(',')} pages=${linkedInParams.takePages}`
      );
      if (skillQuery) logger.info(`[HarvestAPI] Skill search query: "${skillQuery}"`);

      // Fire all three simultaneously — cache is instant, Apify takes ~30 s
      const [poolRaw, titleResults, skillResults] = await Promise.all([
        searchPool(parsed, linkedInParams.currentJobTitles),
        apifyService.runLinkedInSearch(linkedInParams).catch(err => {
          logger.warn(`[HarvestAPI] Title search error: ${err.message}`);
          return [];
        }),
        skillQuery
          ? apifyService.runLinkedInSkillSearch({
              searchQuery: skillQuery,
              locations: linkedInParams.locations,
              takePages: 1,
            }).catch(err => {
              logger.warn(`[HarvestAPI] Skill search error: ${err.message}`);
              return [];
            })
          : Promise.resolve([]),
      ]);

      logger.info(`[CandidatePool] ${poolRaw.length} cached profiles found`);
      logger.info(`[HarvestAPI] titleSearch=${titleResults.length} skillSearch=${skillResults.length}`);

      // Merge title + skill results, deduplicate by LinkedIn URL
      const titleUrls = new Set(titleResults.map(p => (p.linkedinUrl || '').toLowerCase()));
      const uniqueSkillResults = skillResults.filter(p => !titleUrls.has((p.linkedinUrl || '').toLowerCase()));
      let apifyFinal = [...titleResults, ...uniqueSkillResults];

      // Retry title search without seniority if title search returned nothing
      if (titleResults.length === 0 && linkedInParams.seniorityLevelIds.length > 0) {
        logger.info('[HarvestAPI] 0 title results — retrying without seniorityLevelIds');
        const retried = await apifyService.runLinkedInSearch({ ...linkedInParams, seniorityLevelIds: [] });
        const retriedUrls = new Set(apifyFinal.map(p => (p.linkedinUrl || '').toLowerCase()));
        apifyFinal = [...apifyFinal, ...retried.filter(p => !retriedUrls.has((p.linkedinUrl || '').toLowerCase()))];
      }

      // Retry title search without location if still no title results
      if (titleResults.length === 0 && linkedInParams.locations?.length > 0 && apifyFinal.length < 3) {
        logger.info('[HarvestAPI] still low results — retrying title search without location filter');
        const retried = await apifyService.runLinkedInSearch({
          ...linkedInParams,
          locations: [],
          seniorityLevelIds: [],
          takePages: 1,
        });
        const retriedUrls = new Set(apifyFinal.map(p => (p.linkedinUrl || '').toLowerCase()));
        apifyFinal = [...apifyFinal, ...retried.filter(p => !retriedUrls.has((p.linkedinUrl || '').toLowerCase()))];
      }

      // ── Step 2: Save fresh Apify results to pool (fire-and-forget) ────────
      if (apifyFinal.length > 0) {
        saveToPool(apifyFinal).catch(err =>
          logger.warn(`[CandidatePool] background save failed: ${err.message}`)
        );
      }

      // ── Step 3: Merge — Apify first, then cache-only profiles ─────────────
      // De-duplicate by LinkedIn URL so a profile that appears in both is not doubled.
      const apifyUrls = new Set(apifyFinal.map(p => (p.linkedinUrl || '').toLowerCase()));
      const poolOnly  = poolRaw.filter(p => !apifyUrls.has((p.linkedinUrl || '').toLowerCase()));

      linkedInProfiles = [...apifyFinal, ...poolOnly];
      dataSource = apifyFinal.length > 0 ? 'apify' : (poolRaw.length > 0 ? 'pool' : 'unknown');

      logger.info(
        `[Discovery] ${apifyFinal.length} from Apify + ${poolOnly.length} cache-only = ${linkedInProfiles.length} total`
      );

      candidates = normalizeLinkedInProfiles(linkedInProfiles);

      // ── Soft location gate ────────────────────────────────────────────────
      // Only apply when it keeps at least 20% of candidates — prevents blank pages
      // for multi-city locations like "London, UK & Chester, UK" where many profiles
      // say "United Kingdom" instead of matching the exact city name.
      const _requiredLoc = parsed.location || '';
      if (_requiredLoc && !/unspecified|not specified|remote/i.test(_requiredLoc)) {
        const beforeLoc = candidates.length;
        const locFiltered = candidates.filter((c) =>
          locationMatches(c.location || c.locality || '', _requiredLoc)
        );
        const keepRatio = beforeLoc > 0 ? locFiltered.length / beforeLoc : 0;
        if (locFiltered.length >= 3 && keepRatio >= 0.15) {
          candidates = locFiltered;
          logger.info(`[Location gate] ${candidates.length}/${beforeLoc} candidates match "${_requiredLoc}"`);
        } else {
          logger.info(`[Location gate] skipped — only ${locFiltered.length}/${beforeLoc} matched "${_requiredLoc}", keeping all to avoid blank page`);
        }
      }

      candidates = deduplicateCandidates(candidates);

      if (candidates.length === 0) {
        return res.status(200).json({
          success: true, parseOnly: false,
          message: 'No candidate profiles found for this requirement set.',
          parsedRequirements: structured, candidates: [], results: [],
          summary: { totalDiscovered: 0, totalExtracted: 0, totalEnriched: 0, totalSaved: 0, timeMs: Date.now() - startedAt },
        });
      }

      // ── OSINT: GitHub + Stack Overflow dorking (skip when Apify returned nothing) ──
      if (apifyFinal.length > 0 && osintQueries.length > 0) {
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
        link:  p.linkedinUrl || '',
        snippet: p.about || p.headline || '',
        query: 'linkedin-search',
      })));
      if (aiMap && aiMap.size > 0) {
        candidates = candidates.map((candidate) => mergeCandidateWithAi(
          candidate,
          aiMap.get(candidate.normalizedUrl) || null
        ));
        logger.info(`[OpenAI] Candidate normalization merge complete for ${aiMap.size} profiles`);
      }

    } else {
      // ── No source available ───────────────────────────────────────────────
      targetCountries = aiSourcingService.determineTargetCountries(structured.location, structured.remote);
      return res.status(200).json({
        success: true, parseOnly: true,
        message: 'Requirements extracted. Add APIFY_API_KEY to run candidate discovery.',
        parsedRequirements: structured,
        searchPlan: { countries: targetCountries },
        candidates: [], results: [],
        summary: { totalDiscovered: 0, totalExtracted: 0, totalEnriched: 0, totalSaved: 0, timeMs: Date.now() - startedAt },
      });
    }

    // Experience is surfaced as experienceMatch flag on each candidate (set by scoreCandidates).
    // We do not hard-filter here — HarvestAPI returns few profiles and dropping them all
    // produces zero results. The match score and experienceMatch flag inform the recruiter.

    // Step 2: Boolean match scoring.
    // must-have skills = hard AND gate — missing any must-have disqualifies a candidate.
    // required skills = OR gate with 40% threshold.
    // If strict scoring returns 0 results (all candidates failed), fall back to showing
    // all candidates scored but with a warning flag — recruiter should never see a blank page.
    // Internet sourcing: score all candidates, show only those with ≥25% match score.
    // No separate disqualification gate — score is the only filter so the recruiter
    // always sees a ranked list and never a blank page due to overly strict gates.
    let scored = scoreCandidates(candidates, parsed, { minScore: 0, excludeDisqualified: false });
    candidates = scored.filter(c => (c.matchScore || 0) >= 25);
    // Never return a blank page — if all candidates score below 25%, show the top ones anyway
    if (candidates.length === 0 && scored.length > 0) {
      logger.info(`[Scoring] All candidates below 25% threshold — showing top ${Math.min(scored.length, 20)} by score`);
      candidates = scored.slice(0, 20);
    }

    candidates = candidates.slice(0, maxCandidatesSafe);

    if (enrichContacts) {
      const enrichCount = Math.min(candidates.length, enrichTopNSafe);
      for (let i = 0; i < enrichCount; i += 1) {
        try {
          const candidate = candidates[i];
          if (candidate.contact?.email) continue; // already has email, skip
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
      servedFromPool: dataSource === 'pool',
      parseOnly: false,
      allFailed,
      message: allFailed
        ? 'Candidates found but none fully matched the must-have skills. Showing closest matches.'
        : 'AI sourcing completed successfully.',
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
      maxResults = 5,
      minScore = 25,
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

    const maxResultsSafe = Math.max(Number(maxResults) || 5, 1);
    const minScoreSafe   = Math.min(Math.max(Number(minScore)   || 25, 0), 100);

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
    let scored = scoreCandidates(rawCandidates, parsed, {
      minScore: minScoreSafe,
      excludeDisqualified: true,
    });

    if (hasLocation) {
      scored = scored.filter((candidate) =>
        locationMatches(candidate.location || candidate.locality || '', reqLocation)
      );
    }

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
  const q      = String(req.query.q || '').trim();
  const limit  = Math.min(Number(req.query.limit) || 500, 1000);

  let filter = { userId };
  if (q) {
    const regex = new RegExp(q, 'i');
    filter.$or = [{ jobTitle: regex }, { location: regex }];
  }

  try {
    const sessions = await SourcingSession.find(filter)
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

/**
 * POST /api/ai-source/notes
 * Save recruiter notes for a candidate (upsert by linkedinUrl).
 */
export const updateCandidateNotes = async (req, res) => {
  const userId = req.user?._id;
  const { linkedinUrl, linkedInUrl, notes } = req.body || {};
  const resolvedLinkedin = linkedinUrl || linkedInUrl;

  if (!resolvedLinkedin) {
    return res.status(400).json({ success: false, error: 'linkedinUrl is required' });
  }

  try {
    const doc = await Candidate.findOneAndUpdate(
      { linkedinUrl: resolvedLinkedin },
      { $set: { recruiterNotes: String(notes || '') } },
      { upsert: false, new: true }
    ).lean();

    if (!doc) {
      return res.status(404).json({ success: false, error: 'Candidate not found' });
    }

    return res.status(200).json({ success: true, recruiterNotes: doc.recruiterNotes });
  } catch (error) {
    logger.error(`Failed to update candidate notes: ${error.message}`);
    return res.status(500).json({ success: false, error: 'Failed to save notes', message: error.message });
  }
};

/**
 * POST /api/ai-source/generate-message
 * Generate a personalized LinkedIn outreach message using OpenAI.
 */
export const generateOutreachMessage = async (req, res) => {
  const { candidate, jobDescription, recruiterName } = req.body || {};

  if (!candidate) {
    return res.status(400).json({ success: false, error: 'candidate is required' });
  }

  try {
    const name = candidate.fullName || candidate.name || 'there';
    const title = candidate.jobTitle || candidate.title || '';
    const company = candidate.company || '';
    const skills = Array.isArray(candidate.skills)
      ? candidate.skills.slice(0, 8).join(', ')
      : String(candidate.skills || '').split(/[,;|]/).slice(0, 8).join(', ');
    const jd = String(jobDescription || '').slice(0, 800);
    const recruiter = String(recruiterName || 'our team');

    const prompt = `You are a recruiter writing a short, personalized LinkedIn outreach message.

Candidate: ${name}${title ? `, ${title}` : ''}${company ? ` at ${company}` : ''}
Key skills: ${skills || 'not specified'}
Job description summary: ${jd || 'a relevant role at our company'}
Recruiter/company: ${recruiter}

Write a concise, friendly LinkedIn message (max 150 words).
- Start with the candidate's first name
- Mention 1-2 specific skills or experiences from their profile
- Briefly describe the opportunity
- End with a soft call-to-action (e.g., "Would love to connect")
- Do NOT use generic phrases like "I came across your profile"
- Sound human, not like a template`;

    const OpenAI = (await import('openai')).default;
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 220,
      temperature: 0.7,
    });

    const message = response.choices?.[0]?.message?.content?.trim() || '';
    return res.status(200).json({ success: true, message });
  } catch (error) {
    logger.error(`Failed to generate outreach message: ${error.message}`);
    return res.status(500).json({ success: false, error: 'Failed to generate message', message: error.message });
  }
};

/**
 * GET /api/ai-source/pool
 * Browse all profiles in the CandidatePool with optional keyword search.
 * Query params: q (search text), page (default 1), limit (default 20)
 */
export const getCandidatePool = async (req, res) => {
  try {
    const q     = String(req.query.q || '').trim();
    const page  = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(5000, Math.max(1, parseInt(req.query.limit) || 20));
    const skip  = (page - 1) * limit;

    let filter = {};
    if (q) {
      const regex = new RegExp(q, 'i');
      filter = {
        $or: [
          { name:      regex },
          { jobTitle:  regex },
          { company:   regex },
          { location:  regex },
          { headline:  regex },
          { skills:    regex },
        ],
      };
    }

    const [profiles, total] = await Promise.all([
      CandidatePool.find(filter)
        .select('name jobTitle company location headline about skills profilePic linkedinUrl totalExperience experienceYears openToWork experienceTimeline certifications education educationGrade educationYear languages fetchedAt')
        .sort({ fetchedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      CandidatePool.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      profiles,
      total,
      page,
      pages: Math.ceil(total / limit),
    });
  } catch (error) {
    logger.error(`getCandidatePool error: ${error.message}`);
    return res.status(500).json({ success: false, error: 'Failed to fetch candidate pool' });
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
  updateCandidateNotes,
  generateOutreachMessage,
  getCandidatePool,
};
