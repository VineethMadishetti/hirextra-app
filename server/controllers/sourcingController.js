import aiSourcingService from '../utils/aiSourcingService.js';
import cseService from '../utils/cseService.js';
import {
  extractCandidates,
  rankCandidates,
  deduplicateCandidates,
  formatCandidates,
} from '../utils/candidateExtraction.js';
import contactEnrichmentService from '../utils/contactEnrichmentService.js';
import logger from '../utils/logger.js';
import Candidate from '../models/Candidate.js';

function clampNumber(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(num)));
}

function buildParsedRequirements(parsed) {
  return {
    jobTitle: parsed?.job_title?.main || 'Unknown',
    titleVariations: parsed?.job_title?.synonyms || [],
    requiredSkills: parsed?.skills || [],
    mustHaveSkills: parsed?.must_have_skills || [],
    niceToHaveSkills: parsed?.nice_to_have_skills || [],
    experienceLevel: parsed?.experience_level || 'Unknown',
    experienceYears: Number(parsed?.experience_years || 0),
    location: parsed?.location || 'Unspecified',
    remote: Boolean(parsed?.remote),
    companyTypes: parsed?.company_types || [],
  };
}

function deriveCandidatePayload(candidate, parsed, userId) {
  const linkedInUrl = candidate.linkedInUrl || candidate.linkedinUrl || null;
  const fullName = candidate.name || candidate.fullName || null;
  const locationFallback = parsed?.location && !/remote|unspecified|unknown/i.test(parsed.location)
    ? parsed.location
    : null;
  const location = candidate.location || locationFallback || '';
  const experienceYears = Number(parsed?.experience_years || 0);
  const experience = experienceYears > 0 ? `${experienceYears}+ years` : '';

  const contactEmail = candidate.contact?.email || candidate.email || '';
  const contactPhone = candidate.contact?.phone || candidate.phone || '';
  const enrichmentSource = candidate.contact?.source || candidate.enrichmentSource || '';
  const enrichmentConfidence = Number(candidate.contact?.confidence || candidate.enrichmentConfidence || 0);

  return {
    linkedInUrl,
    fullName,
    jobTitle: candidate.jobTitle || candidate.title || parsed?.job_title?.main || '',
    company: candidate.company || '',
    location,
    country: candidate.sourceCountry || candidate.foundIn || '',
    email: contactEmail,
    phone: contactPhone,
    skills: Array.isArray(parsed?.skills) ? parsed.skills.join(', ') : '',
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
          linkedinUrl: payload.linkedInUrl,
          source: payload.source,
          sourceCountry: payload.sourceCountry,
          enrichmentStatus: payload.enrichmentStatus,
        },
        $setOnInsert: {
          createdBy: payload.createdBy,
        },
      };

      if (payload.skills) update.$set.skills = payload.skills;
      if (payload.experience) update.$set.experience = payload.experience;
      if (payload.email) update.$set.email = payload.email;
      if (payload.phone) update.$set.phone = payload.phone;
      if (payload.enrichmentMetadata) {
        update.$set.enrichmentMetadata = payload.enrichmentMetadata;
      }

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
 * POST /api/ai-source
 * Main sourcing endpoint: parse -> query generation -> CSE search -> extraction -> enrichment -> save.
 */
export const sourceCandidates = async (req, res) => {
  const {
    jobDescription,
    maxCandidates = 50,
    maxQueries = 6,
    resultsPerCountry = 3,
    enrichContacts = true,
    enrichTopN = 15,
    autoSave = true,
  } = req.body || {};

  const userId = req.user?._id;
  const startedAt = Date.now();

  try {
    if (!jobDescription || String(jobDescription).trim().length < 20) {
      return res.status(400).json({
        success: false,
        error: 'Job description must be at least 20 characters',
      });
    }

    const maxCandidatesSafe = clampNumber(maxCandidates, 1, 100, 50);
    const maxQueriesSafe = clampNumber(maxQueries, 1, 8, 6);
    const resultsPerCountrySafe = clampNumber(resultsPerCountry, 1, 10, 3);
    const enrichTopNSafe = clampNumber(enrichTopN, 1, 50, 15);

    logger.info(`AI sourcing started by user ${userId}`);

    // Step 1: Parse JD
    const parsed = await aiSourcingService.parseJobDescription(jobDescription);
    const parsedRequirements = buildParsedRequirements(parsed);

    // Step 2: Generate boolean queries
    const searchQueries = aiSourcingService.generateSearchQueries(parsed, maxQueriesSafe);
    if (searchQueries.length === 0) {
      return res.status(500).json({
        success: false,
        error: 'Failed to generate search queries',
      });
    }

    // Step 3: Determine countries for CSE search
    const targetCountries = aiSourcingService.determineTargetCountries(
      parsedRequirements.location,
      parsedRequirements.remote
    );

    if (!cseService.isConfigured()) {
      return res.status(200).json({
        success: true,
        parseOnly: true,
        message:
          'Job description parsed and search plan generated. Add GOOGLE_CSE_API_KEY to run external sourcing.',
        parsedRequirements,
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
        metadata: {
          parseOnly: true,
          parseOnlyReason: 'GOOGLE_CSE_API_KEY not configured',
          jobTitle: parsedRequirements.jobTitle,
          skills: parsedRequirements.requiredSkills,
          mustHaveSkills: parsedRequirements.mustHaveSkills,
          location: parsedRequirements.location,
          remote: parsedRequirements.remote,
          searchQueries,
          countriesSearched: targetCountries.length,
          totalExtracted: 0,
          contactsEnriched: 0,
          timeMs: Date.now() - startedAt,
        },
      });
    }

    // Step 4: Search all generated queries across target countries
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
        message: 'No candidate profiles found for this job description.',
        parsedRequirements,
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

    // Step 5: Candidate extraction and dedupe
    let candidates = extractCandidates(allResults, targetCountries, searchQueries);
    candidates = deduplicateCandidates(candidates);
    candidates = rankCandidates(candidates, parsedRequirements.mustHaveSkills);
    candidates = candidates.slice(0, maxCandidatesSafe);

    // Step 6: Contact enrichment (top candidates only)
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

    // Step 7: Persist sourced candidates to DB
    let savedCount = 0;
    let savedIds = new Map();
    if (autoSave) {
      const persisted = await persistSourcedCandidates(candidates, parsed, userId);
      savedCount = persisted.savedCount;
      savedIds = persisted.savedIds;
    }

    for (const candidate of candidates) {
      const savedId = savedIds.get(candidate.linkedInUrl);
      if (savedId) {
        candidate.savedCandidateId = savedId;
        candidate.savedToDatabase = true;
      } else {
        candidate.savedCandidateId = null;
        candidate.savedToDatabase = false;
      }
    }

    const formatted = formatCandidates(candidates);
    const enrichedCount = formatted.filter((c) => c.email || c.phone).length;
    const totalTime = Date.now() - startedAt;

    return res.status(200).json({
      success: true,
      parseOnly: false,
      message: 'AI sourcing completed successfully.',
      parsedRequirements,
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
        jobTitle: parsedRequirements.jobTitle,
        skills: parsedRequirements.requiredSkills,
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
 * Save (or upsert) a sourced candidate manually.
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
        'fullName jobTitle company location sourceCountry email phone linkedinUrl createdAt enrichmentStatus enrichmentMetadata'
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

    const byStatus = await Candidate.aggregate([
      { $match: query },
      { $group: { _id: '$enrichmentStatus', count: { $sum: 1 } } },
    ]);

    return res.status(200).json({
      success: true,
      total,
      enrichedCount: enriched,
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
        'fullName jobTitle company location sourceCountry email phone linkedinUrl enrichmentMetadata createdAt'
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

export default {
  sourceCandidates,
  parseSearchQuery,
  saveSourcingResult,
  getSourcingHistory,
  getSourcingStats,
  exportSourcedCandidatesCSV,
  exportCandidatesAsCSV,
};
