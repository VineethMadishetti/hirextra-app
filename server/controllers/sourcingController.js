import mammoth from 'mammoth';
import { createRequire } from 'module';
import aiSourcingService from '../utils/aiSourcingService.js';
import cseService from '../utils/cseService.js';
import {
  extractCandidates,
  rankCandidates,
  deduplicateCandidates,
  formatCandidates,
} from '../utils/candidateExtraction.js';
import { aiEnrichCandidates } from '../utils/aiCandidateExtraction.js';
import { enrichCandidatesWithScrapingDog, isConfigured as isScrapingDogConfigured } from '../utils/scrapingDogService.js';
import contactEnrichmentService from '../utils/contactEnrichmentService.js';
import logger from '../utils/logger.js';
import Candidate from '../models/Candidate.js';

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

  return {
    linkedInUrl,
    fullName,
    jobTitle: candidate.jobTitle || candidate.title || parsed?.job_title?.main || '',
    company: candidate.company || '',
    location,
    country: candidate.sourceCountry || candidate.foundIn || '',
    industry: parsed?.industry || 'Not Specified',
    availability: normalizeAvailability(parsed?.availability),
    education: parsed?.education || 'Not Specified',
    email: contactEmail,
    phone: contactPhone,
    skills: Array.isArray(parsed?.required_skills) ? parsed.required_skills.join(', ') : '',
    experience,
    createdBy: userId,
    source: 'AI_SOURCING',
    sourceCountry: candidate.sourceCountry || candidate.foundIn || '',
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

    const searchQueries = aiSourcingService.generateSearchQueries(parsed, maxQueriesSafe);
    if (searchQueries.length === 0) {
      return res.status(500).json({
        success: false,
        error: 'Failed to generate search queries',
      });
    }

    const targetCountries = aiSourcingService.determineTargetCountries(
      structured.location,
      structured.remote
    );

    if (!cseService.isConfigured()) {
      return res.status(200).json({
        success: true,
        parseOnly: true,
        message:
          'Requirements extracted and search plan generated. Add GOOGLE_CSE_API_KEY to run candidate discovery.',
        parsedRequirements: structured,
        searchPlan: {
          queries: searchQueries,
          countries: targetCountries,
          resultsPerCountry: resultsPerCountrySafe,
          maxQueries: maxQueriesSafe,
        },
        candidates: [],
        results: [],
        summary: {
          totalDiscovered: 0,
          totalExtracted: 0,
          totalEnriched: 0,
          totalSaved: 0,
          countriesSearched: targetCountries.length,
          queryCount: searchQueries.length,
          timeMs: Date.now() - startedAt,
        },
      });
    }

    const searchPromises = searchQueries.map(async (query) => {
      const rows = await cseService.searchCountries(query, targetCountries, resultsPerCountrySafe);
      return rows.map((row) => ({ ...row, query }));
    });
    const searchResponses = await Promise.allSettled(searchPromises);
    const allResults = searchResponses
      .filter((item) => item.status === 'fulfilled')
      .flatMap((item) => item.value || []);

    if (allResults.length === 0) {
      return res.status(200).json({
        success: true,
        parseOnly: false,
        message: 'No candidate profiles found for this requirement set.',
        parsedRequirements: structured,
        searchPlan: {
          queries: searchQueries,
          countries: targetCountries,
          resultsPerCountry: resultsPerCountrySafe,
          maxQueries: maxQueriesSafe,
        },
        candidates: [],
        results: [],
        summary: {
          totalDiscovered: 0,
          totalExtracted: 0,
          totalEnriched: 0,
          totalSaved: 0,
          countriesSearched: targetCountries.length,
          queryCount: searchQueries.length,
          timeMs: Date.now() - startedAt,
        },
      });
    }

    let candidates = extractCandidates(allResults, targetCountries, searchQueries);
    candidates = deduplicateCandidates(candidates);

    // Step 1: OpenAI snippet enrichment (fast, no credit cost — fills fields from Serper snippets)
    // Only runs when OPENAI_API_KEY is set and ScrapingDog is NOT configured (avoids redundant work).
    if (!isScrapingDogConfigured()) {
      const aiMap = await aiEnrichCandidates(allResults);
      if (aiMap && aiMap.size > 0) {
        candidates = candidates.map((c) => {
          const ai = aiMap.get(c.normalizedUrl);
          if (!ai) return c;
          return {
            ...c,
            name: (ai.name?.trim()) || c.name,
            jobTitle: (ai.jobTitle?.trim()) || c.jobTitle,
            company: (ai.company?.trim()) || c.company,
            location: (ai.location?.trim()) || c.location,
            education: (ai.education?.trim()) || c.education,
            skills: Array.isArray(ai.skills) ? ai.skills.filter(Boolean).slice(0, 8) : (c.skills || []),
            totalExperience: ai.totalExperience || c.totalExperience || null,
          };
        });
        logger.info(`OpenAI snippet enrichment: ${aiMap.size} candidates enriched`);
      }
    }

    // Step 2: Rank candidates (skills + seniority score)
    candidates = rankCandidates(candidates, structured.mustHaveSkills || []);

    // Step 3: Location boost + filter — runs BEFORE ScrapingDog so we only scrape
    // location-matched candidates and don't waste credits on wrong-location profiles.
    const requiredLocation = parsed.location || '';
    if (requiredLocation && !/unspecified|not specified|remote/i.test(requiredLocation)) {
      const locLower = requiredLocation.split(',')[0].trim().toLowerCase();

      // Boost candidates whose snippet/location already mentions the city
      candidates = candidates.map((c) => {
        const text = `${c.snippet || ''} ${c.location || ''}`.toLowerCase();
        if (text.includes(locLower)) {
          return { ...c, relevanceScore: (c.relevanceScore || 0) + 10 };
        }
        return c;
      });
      candidates.sort((a, b) => b.relevanceScore - a.relevanceScore);

      // Strict: only show candidates whose snippet or extracted location mentions the required city.
      candidates = candidates.filter((c) => {
        const text = `${c.snippet || ''} ${c.location || ''}`.toLowerCase();
        return text.includes(locLower);
      });
    }

    candidates = candidates.slice(0, maxCandidatesSafe);

    // Step 4: ScrapingDog full LinkedIn profile enrichment (50 credits/profile).
    // Runs AFTER location filter so credits are spent only on location-relevant candidates.
    // Falls back gracefully when SCRAPINGDOG_API_KEY is not set.
    if (isScrapingDogConfigured()) {
      const maxToScrape = Math.min(candidates.length, 10);
      candidates = await enrichCandidatesWithScrapingDog(candidates, maxToScrape);
      // Re-rank after enrichment so ScrapingDog-enriched skills influence the score
      candidates = rankCandidates(candidates, structured.mustHaveSkills || []);
    }

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

    return res.status(200).json({
      success: true,
      parseOnly: false,
      message: 'AI sourcing completed successfully.',
      parsedRequirements: structured,
      searchPlan: {
        queries: searchQueries,
        countries: targetCountries,
        resultsPerCountry: resultsPerCountrySafe,
        maxQueries: maxQueriesSafe,
      },
      candidates: formatted,
      results: formatted,
      totalFound: formatted.length,
      enrichedCount,
      countriesSearched: targetCountries,
      summary: {
        totalDiscovered: allResults.length,
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
 * GET /api/ai-source/test-scrapingdog?url=linkedin.com/in/SLUG
 * Returns the raw ScrapingDog API response so field names can be verified.
 */
export const testScrapingDog = async (req, res) => {
  const apiKey = process.env.SCRAPINGDOG_API_KEY;
  if (!apiKey) {
    return res.status(400).json({ error: 'SCRAPINGDOG_API_KEY is not set in .env' });
  }
  const linkedInUrl = req.query.url || '';
  const match = linkedInUrl.match(/linkedin\.com\/in\/([^/?#]+)/i);
  const linkId = match ? match[1].replace(/\/$/, '').toLowerCase() : null;
  if (!linkId) {
    return res.status(400).json({ error: 'Pass ?url=linkedin.com/in/PROFILE_SLUG' });
  }
  try {
    const axios = (await import('axios')).default;
    const response = await axios.get('https://api.scrapingdog.com/linkedin/', {
      params: { api_key: apiKey, type: 'profile', linkId, premium: true },
      timeout: 30000,
    });
    // Return raw response so field names are visible
    return res.json({ linkId, status: response.status, data: response.data });
  } catch (err) {
    return res.status(500).json({ error: err.message, status: err.response?.status, data: err.response?.data });
  }
};

export default {
  extractRequirements,
  sourceCandidates,
  updateCandidateStage,
  parseSearchQuery,
  saveSourcingResult,
  getSourcingHistory,
  getSourcingStats,
  exportSourcedCandidatesCSV,
  exportCandidatesAsCSV,
  testScrapingDog,
};
