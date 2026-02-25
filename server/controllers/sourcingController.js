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

/**
 * AI Sourcing Controller
 * Handles end-to-end candidate sourcing from job descriptions
 */

/**
 * POST /api/ai-source
 * Main sourcing endpoint - full pipeline
 */
export const sourceCandidates = async (req, res) => {
  const { jobDescription, maxCandidates = 50, enrichContacts = true } = req.body;
  const userId = req.user._id;

  const startTime = Date.now();

  try {
    // Validate input
    if (!jobDescription || jobDescription.trim().length < 20) {
      return res.status(400).json({
        error: 'Job description must be at least 20 characters',
      });
    }

    logger.info(`🎯 Starting AI sourcing for user ${userId}`);

    // Step 1: Parse job description with OpenAI
    logger.info(`📋 Step 1: Parsing job description...`);
    const parsed = await aiSourcingService.parseJobDescription(jobDescription);

    if (!parsed) {
      return res.status(500).json({
        error: 'Failed to parse job description. Please try again.',
      });
    }

    logger.info(`✅ Parsed JD: ${parsed.job_title?.main || 'Unknown'}`);

    // Step 2: Generate search queries
    logger.info(`🔍 Step 2: Generating search queries...`);
    const searchQueries = aiSourcingService.generateSearchQueries(parsed);

    if (!searchQueries || searchQueries.length === 0) {
      return res.status(500).json({
        error: 'Failed to generate search queries',
      });
    }

    logger.info(`✅ Generated ${searchQueries.length} search queries`);

    // Step 3: Determine target countries
    logger.info(`🌍 Step 3: Determining target countries...`);
    const targetCountries = aiSourcingService.determineTargetCountries(
      parsed.location,
      parsed.remote
    );

    logger.info(`✅ Target countries: ${targetCountries.join(', ')}`);

    // Step 4: Search across countries
    logger.info(`🔎 Step 4: Searching across ${targetCountries.length} countries...`);
    const allResults = [];

    for (const query of searchQueries) {
      const results = await cseService.searchCountries(query, targetCountries, 3);
      allResults.push(...results);
    }

    if (allResults.length === 0) {
      return res.status(200).json({
        message: 'No candidates found matching the job description',
        candidates: [],
        metadata: {
          jobTitle: parsed.job_title?.main,
          searchQueries: searchQueries.length,
          countriesSearched: targetCountries.length,
          totalResults: 0,
          timeMs: Date.now() - startTime,
        },
      });
    }

    logger.info(`✅ Found ${allResults.length} results across countries`);

    // Step 5: Extract candidates
    logger.info(`📊 Step 5: Extracting and deduplicating candidates...`);
    let candidates = extractCandidates(
      allResults.map((r) => ({ ...r, query: 'general' })),
      targetCountries,
      searchQueries
    );

    candidates = deduplicateCandidates(candidates);
    candidates = rankCandidates(candidates, parsed.must_have_skills || []);

    // Limit to requested amount
    candidates = candidates.slice(0, maxCandidates);

    logger.info(`✅ Extracted ${candidates.length} unique candidates`);

    // Step 6: Enrich contacts if requested
    if (enrichContacts) {
      logger.info(`💎 Step 6: Enriching candidate contacts...`);

      for (let i = 0; i < candidates.length; i++) {
        try {
          const candidate = candidates[i];
          const enriched = await contactEnrichmentService.enrichCandidate({
            linkedInUrl: candidate.linkedInUrl,
            name: candidate.name,
            company: candidate.company,
          });

          if (enriched && enriched.contact) {
            candidates[i].contact = {
              email: enriched.contact.email,
              phone: enriched.contact.phone,
              confidence: enriched.contact.confidence,
              source: enriched.contact.source,
            };
          }

          // Rate limiting between enrichment calls
          if ((i + 1) % 5 === 0) {
            await new Promise((resolve) => setTimeout(resolve, 500));
          }
        } catch (error) {
          logger.debug(`Failed to enrich candidate ${candidates[i].name}: ${error.message}`);
          // Continue with next candidate
        }
      }

      logger.info(`✅ Enrichment complete`);
    }

    // Format response
    const formattedCandidates = formatCandidates(candidates);

    res.status(200).json({
      candidates: formattedCandidates,
      metadata: {
        jobTitle: parsed.job_title?.main,
        skills: parsed.must_have_skills || [],
        searchQueries: searchQueries.length,
        countriesSearched: targetCountries.length,
        totalExtracted: candidates.length,
        contactsEnriched: enrichContacts ? candidates.filter((c) => c.contact).length : 0,
        timeMs: Date.now() - startTime,
      },
    });
  } catch (error) {
    logger.error(`Sourcing failed: ${error.message}`);
    res.status(500).json({
      error: 'Sourcing failed. Please try again later.',
      message: error.message,
    });
  }
};

/**
 * POST /api/ai-source/save-candidate
 * Save a sourced candidate to database
 */
export const saveSourcingResult = async (req, res) => {
  const {
    name,
    linkedInUrl,
    jobTitle,
    company,
    location,
    contact,
  } = req.body;
  const userId = req.user._id;

  try {
    if (!linkedInUrl || !name) {
      return res.status(400).json({
        error: 'Missing required fields: name, linkedInUrl',
      });
    }

    // Check for duplicates (by LinkedIn URL)
    const existing = await Candidate.findOne({ linkedInUrl });
    if (existing) {
      return res.status(409).json({
        error: 'Candidate already exists in database',
        duplicateId: existing._id,
      });
    }

    // Create new candidate
    const newCandidate = await Candidate.create({
      name,
      linkedInUrl,
      jobTitle,
      company,
      location,
      email: contact?.email || null,
      phone: contact?.phone || null,
      linkedInId: linkedInUrl.split('/in/')[1]?.split('/')[0] || null,
      source: 'AI_SOURCING',
      enrichmentStatus: contact?.email || contact?.phone ? 'ENRICHED' : 'NEW',
      createdBy: userId,
    });

    // If contact was enriched, save enrichment metadata
    if (contact?.source) {
      newCandidate.enrichmentMetadata = {
        enrichedAt: new Date(),
        source: contact.source,
        confidence: contact.confidence,
      };
      await newCandidate.save();
    }

    logger.info(`✅ Saved candidate: ${name}`);

    res.status(201).json({
      message: 'Candidate saved successfully',
      candidateId: newCandidate._id,
      candidate: {
        _id: newCandidate._id,
        name: newCandidate.name,
        linkedInUrl: newCandidate.linkedInUrl,
        email: newCandidate.email,
        phone: newCandidate.phone,
      },
    });
  } catch (error) {
    logger.error(`Failed to save sourced candidate: ${error.message}`);
    res.status(500).json({
      error: 'Failed to save candidate',
      message: error.message,
    });
  }
};

/**
 * GET /api/ai-source/history
 * List previous sourcing searches by user
 */
export const getSourcingHistory = async (req, res) => {
  const userId = req.user._id;
  const { limit = 10, skip = 0 } = req.query;

  try {
    // Count candidates created by this user via AI sourcing
    const total = await Candidate.countDocuments({
      createdBy: userId,
      source: 'AI_SOURCING',
    });

    // Get recent candidates
    const candidates = await Candidate.find({
      createdBy: userId,
      source: 'AI_SOURCING',
    })
      .select('name jobTitle company email phone linkedInUrl createdAt enrichmentStatus')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip(parseInt(skip));

    res.status(200).json({
      total,
      limit: parseInt(limit),
      skip: parseInt(skip),
      candidates,
    });
  } catch (error) {
    logger.error(`Failed to get sourcing history: ${error.message}`);
    res.status(500).json({
      error: 'Failed to retrieve history',
      message: error.message,
    });
  }
};

/**
 * GET /api/ai-source/stats
 * Get sourcing statistics
 */
export const getSourcingStats = async (req, res) => {
  const userId = req.user._id;

  try {
    const total = await Candidate.countDocuments({
      createdBy: userId,
      source: 'AI_SOURCING',
    });

    const enriched = await Candidate.countDocuments({
      createdBy: userId,
      source: 'AI_SOURCING',
      email: { $ne: null },
    });

    const byStatus = await Candidate.aggregate([
      { $match: { createdBy: userId, source: 'AI_SOURCING' } },
      { $group: { _id: '$enrichmentStatus', count: { $sum: 1 } } },
    ]);

    res.status(200).json({
      total,
      enrichedCount: enriched,
      enrichmentRate: total > 0 ? ((enriched / total) * 100).toFixed(2) + '%' : '0%',
      byStatus: Object.fromEntries(byStatus.map((s) => [s._id, s.count])),
    });
  } catch (error) {
    logger.error(`Failed to get sourcing stats: ${error.message}`);
    res.status(500).json({
      error: 'Failed to retrieve stats',
      message: error.message,
    });
  }
};

/**
 * Helper function: Convert candidates array to CSV format
 */
function convertToCSV(candidates) {
  // Define CSV headers
  const headers = [
    'Name',
    'LinkedIn URL',
    'Job Title',
    'Company',
    'Level',
    'Email',
    'Phone',
    'Found In',
    'Snippet Preview',
    'Enrichment Source',
    'Contact Confidence',
    'Saved At',
  ];

  // Convert rows
  const rows = candidates.map((c) => [
    `"${(c.name || '').replace(/"/g, '""')}"`, // Escape quotes
    `"${(c.linkedInUrl || '').replace(/"/g, '""')}"`,
    `"${(c.jobTitle || '').replace(/"/g, '""')}"`,
    `"${(c.company || '').replace(/"/g, '""')}"`,
    `"${(c.level || '').replace(/"/g, '""')}"`,
    `"${(c.email || '').replace(/"/g, '""')}"`,
    `"${(c.phone || '').replace(/"/g, '""')}"`,
    `"${(c.foundIn || '').replace(/"/g, '""')}"`,
    `"${((c.snippet || '').substring(0, 100)).replace(/"/g, '""')}"`,
    `"${(c.enrichmentMetadata?.source || '').replace(/"/g, '""')}"`,
    `"${(c.enrichmentMetadata?.confidence || '').toString().replace(/"/g, '""')}"`,
    `"${(c.createdAt || '').substring(0, 10)}"`,
  ]);

  // Combine headers and rows
  const csvContent = [
    headers.join(','),
    ...rows.map((row) => row.join(',')),
  ].join('\n');

  return csvContent;
}

/**
 * GET /api/ai-source/export/csv
 * Export sourced candidates as CSV
 */
export const exportSourcedCandidatesCSV = async (req, res) => {
  const userId = req.user._id;

  try {
    // Get all sourced candidates for this user
    const candidates = await Candidate.find({
      createdBy: userId,
      source: 'AI_SOURCING',
    }).select('name linkedInUrl jobTitle company level email phone foundIn snippet enrichmentMetadata createdAt');

    if (candidates.length === 0) {
      return res.status(200).json({
        message: 'No sourced candidates found to export',
        csvContent: convertToCSV([]),
      });
    }

    // Convert to CSV
    const csvContent = convertToCSV(candidates);

    // Set response headers for file download
    const timestamp = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const filename = `sourced-candidates-${timestamp}.csv`;

    res.setHeader('Content-Type', 'text/csv;charset=utf-8;');
    res.setHeader('Content-Disposition', `attachment;filename="${filename}"`);
    res.status(200).send(csvContent);

    logger.info(`✅ Exported ${candidates.length} candidates as CSV for user ${userId}`);
  } catch (error) {
    logger.error(`Failed to export candidates as CSV: ${error.message}`);
    res.status(500).json({
      error: 'Failed to export candidates',
      message: error.message,
    });
  }
};

/**
 * POST /api/ai-source/export/csv
 * Export specific candidates as CSV (from modal results)
 */
export const exportCandidatesAsCSV = async (req, res) => {
  const { candidates } = req.body;
  const userId = req.user._id;

  try {
    if (!candidates || !Array.isArray(candidates) || candidates.length === 0) {
      return res.status(400).json({
        error: 'No candidates provided for export',
      });
    }

    // Convert to CSV
    const csvContent = convertToCSV(candidates);

    // Set response headers for file download
    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `sourced-candidates-${timestamp}.csv`;

    res.setHeader('Content-Type', 'text/csv;charset=utf-8;');
    res.setHeader('Content-Disposition', `attachment;filename="${filename}"`);
    res.status(200).send(csvContent);

    logger.info(`✅ Exported ${candidates.length} candidates as CSV for user ${userId}`);
  } catch (error) {
    logger.error(`Failed to export candidates as CSV: ${error.message}`);
    res.status(500).json({
      error: 'Failed to export candidates',
      message: error.message,
    });
  }
};

export default {
  sourceCandidates,
  saveSourcingResult,
  getSourcingHistory,
  getSourcingStats,
  exportSourcedCandidatesCSV,
  exportCandidatesAsCSV,
};
