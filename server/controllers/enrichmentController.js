import Candidate from '../models/Candidate.js';
import EnrichedContact from '../models/EnrichedContact.js';
import contactEnrichmentService from '../utils/contactEnrichmentService.js';
import logger from '../utils/logger.js';

const PERSISTENT_CONTACT_EXPIRY = new Date('2999-12-31T00:00:00.000Z');

/**
 * Enrich single candidate with email/phone
 * GET /api/enrich-contact/:candidateId
 */
export const enrichContact = async (req, res) => {
  const { candidateId } = req.params;
  const forceRefresh = req.query.force === 'true';

  try {
    // Validate candidate exists
    const candidate = await Candidate.findById(candidateId).lean();
    if (!candidate) {
      return res.status(404).json({
        success: false,
        error: 'Candidate not found',
      });
    }

    // Check cache first (30-day TTL handled by MongoDB)
    let enrichedContact = await EnrichedContact.findOne({
      candidateId,
      expiresAt: { $gt: new Date() },
    }).lean();

    if (enrichedContact) {
      const hasCachedContact = Boolean(enrichedContact.email || enrichedContact.phone);

      // Only serve cache when it has real contact data AND no force refresh requested
      if (hasCachedContact && !forceRefresh) {
        logger.info(`Cache hit for candidate ${candidateId}`);
        return res.json({
          success: true,
          data: {
            candidateId,
            email: enrichedContact.email,
            phone: enrichedContact.phone,
            linkedinUrl: enrichedContact.linkedinUrl,
            confidence: enrichedContact.confidence,
            source: enrichedContact.source,
            error: null,
            verifiedAt: enrichedContact.verifiedAt,
            cachedAt: enrichedContact.createdAt,
          },
        });
      }

      // Failure cache or force refresh → always retry provider
      logger.info(`Retrying provider for candidate ${candidateId} (cached failure or force)`);
    }

    // ── Step 0: Candidate already has contact data (e.g. PDL import) ─────────
    // PDL records were imported directly into the candidates collection with
    // email + phone already populated. No API call needed.
    if (!forceRefresh && (candidate.email || candidate.phone)) {
      logger.info(`Contact resolved from candidate document for ${candidateId} (PDL/import data)`);
      return res.json({
        success: true,
        data: {
          candidateId,
          email: candidate.email   || null,
          phone: candidate.phone   || null,
          linkedinUrl: candidate.linkedinUrl || null,
          confidence: 95,
          source: 'internal_pdl',
          error: null,
        },
      });
    }

    // ── Step 1: PDL lookup by linkedinUrl across the 416M local dataset ──────
    // Before calling any paid external API, check if another candidate record
    // in the DB matches this linkedinUrl and already has email/phone.
    const linkedinUrl = candidate.linkedinUrl || candidate.linkedInUrl;
    if (!forceRefresh && linkedinUrl) {
      const normalizedUrl = linkedinUrl.replace(/\/$/, '').toLowerCase();
      const pdlMatch = await Candidate.findOne({
        linkedinUrl: { $regex: new RegExp(`^${normalizedUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/?$`, 'i') },
        _id: { $ne: candidate._id },
        $or: [
          { email: { $exists: true, $ne: '' } },
          { phone:  { $exists: true, $ne: '' } },
        ],
        isDeleted: false,
      }).select('email phone linkedinUrl').lean();

      if (pdlMatch && (pdlMatch.email || pdlMatch.phone)) {
        logger.info(`PDL local lookup hit for ${candidateId} (linkedinUrl match)`);
        // Cache the result so future requests skip this lookup too
        await EnrichedContact.updateOne(
          { candidateId },
          {
            candidateId,
            email: pdlMatch.email || null,
            phone: pdlMatch.phone || null,
            linkedinUrl: pdlMatch.linkedinUrl || linkedinUrl,
            confidence: 92,
            source: 'internal_pdl',
            verifiedAt: new Date(),
            expiresAt: PERSISTENT_CONTACT_EXPIRY,
          },
          { upsert: true }
        );
        // Write back to candidate document so Step 0 catches it next time
        await Candidate.updateOne(
          { _id: candidateId },
          { $set: { email: pdlMatch.email || candidate.email, phone: pdlMatch.phone || candidate.phone, 'enrichment.lastEnrichedAt': new Date(), 'enrichment.verificationStatus': 'VERIFIED' } }
        );
        return res.json({
          success: true,
          data: {
            candidateId,
            email: pdlMatch.email   || null,
            phone: pdlMatch.phone   || null,
            linkedinUrl: pdlMatch.linkedinUrl || linkedinUrl,
            confidence: 92,
            source: 'internal_pdl',
            error: null,
          },
        });
      }
    }

    // ── Step 2: External enrichment APIs (paid) ───────────────────────────────
    logger.info(`Starting external enrichment for candidate ${candidateId}`);
    const result = await contactEnrichmentService.enrichCandidate(candidate);

    if (result.source === 'error' && !result.email && !result.phone) {
      // Configuration error — don't cache this, just return the reason clearly
      return res.json({
        success: false,
        data: {
          candidateId,
          email: null,
          phone: null,
          source: 'error',
          error: result.error || 'Contact enrichment providers not configured. Add APOLLO_API_KEY, SKRAPP_API_KEY, or import PDL contact data into the candidate database.',
        },
      });
    }

    // Save to cache (including failed lookups)
    if (result.email || result.phone) {
      await EnrichedContact.updateOne(
        { candidateId },
        {
          candidateId,
          email: result.email,
          phone: result.phone,
          linkedinUrl: result.linkedinUrl,
          confidence: result.confidence || 0,
          source: result.source,
          verifiedAt: result.verifiedAt,
          // Keep successful enrichments effectively permanent (non-ephemeral)
          expiresAt: PERSISTENT_CONTACT_EXPIRY,
        },
        { upsert: true }
      );

      // Also update candidate record with enriched data
      await Candidate.updateOne(
        { _id: candidateId },
        {
          $set: {
            email: result.email || candidate.email,
            phone: result.phone || candidate.phone,
            'enrichment.lastEnrichedAt': new Date(),
            'enrichment.verificationStatus': 'VERIFIED',
          },
        }
      );

      logger.info(`Enrichment successful for ${candidateId}: ${result.source}`);
    } else {
      await EnrichedContact.updateOne(
        { candidateId },
        {
          candidateId,
          email: null,
          phone: null,
          source: result.source || 'failed',
          lastError: result.error,
          errorCount: (await EnrichedContact.findOne({ candidateId }))?.errorCount + 1 || 1,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7-day TTL for failures
        },
        { upsert: true }
      );

      logger.warn(`Enrichment failed for ${candidateId}: ${result.error}`);
    }

    return res.json({
      success: true,
      data: {
        candidateId,
        email: result.email || null,
        phone: result.phone || null,
        linkedinUrl: result.linkedinUrl || candidate.linkedinUrl,
        confidence: result.confidence || 0,
        source: result.source,
        error: result.error || null,
        verifiedAt: result.verifiedAt,
      },
    });
  } catch (error) {
    logger.error(`Enrichment error for ${candidateId}:`, error.message);
    return res.status(500).json({
      success: false,
      error: 'Enrichment failed',
      message: error.message,
    });
  }
};
/**
 * Bulk enrich multiple candidates
 * POST /api/enrich-contact/bulk
 */
export const enrichContactBulk = async (req, res) => {
  const { candidateIds = [], maxResults = 50 } = req.body;

  if (!Array.isArray(candidateIds) || candidateIds.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'candidateIds array required',
    });
  }

  try {
    logger.info(`🔄 Starting bulk enrichment for ${candidateIds.length} candidates`);

    const results = [];
    let successCount = 0;
    let failureCount = 0;

    // Process in batches to avoid overwhelming APIs
    const batchSize = 5;
    for (let i = 0; i < candidateIds.length; i += batchSize) {
      const batch = candidateIds.slice(i, i + batchSize);

      // Process batch in parallel
      const batchPromises = batch.map(async (cid) => {
        try {
          const candidate = await Candidate.findById(cid).lean();
          if (!candidate) {
            return {
              candidateId: cid,
              success: false,
              error: 'Candidate not found',
            };
          }

          // Check cache first
          let enrichedContact = await EnrichedContact.findOne({
            candidateId: cid,
            expiresAt: { $gt: new Date() },
          }).lean();

          if (enrichedContact) {
            successCount++;
            return {
              candidateId: cid,
              success: true,
              email: enrichedContact.email,
              phone: enrichedContact.phone,
              source: enrichedContact.source,
              cached: true,
            };
          }

          // Run enrichment
          const result = await contactEnrichmentService.enrichCandidate(candidate);

          if (result.email || result.phone) {
            await EnrichedContact.updateOne(
              { candidateId: cid },
              {
                candidateId: cid,
                email: result.email,
                phone: result.phone,
                linkedinUrl: result.linkedinUrl,
                confidence: result.confidence || 0,
                source: result.source,
                verifiedAt: result.verifiedAt,
                // Keep successful enrichments effectively permanent (non-ephemeral)
                expiresAt: PERSISTENT_CONTACT_EXPIRY,
              },
              { upsert: true }
            );

            successCount++;
            return {
              candidateId: cid,
              success: true,
              email: result.email,
              phone: result.phone,
              source: result.source,
              cached: false,
            };
          } else {
            failureCount++;
            return {
              candidateId: cid,
              success: false,
              error: result.error,
            };
          }
        } catch (error) {
          failureCount++;
          return {
            candidateId: cid,
            success: false,
            error: error.message,
          };
        }
      });

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);

      // Small delay between batches to avoid rate limits
      if (i + batchSize < candidateIds.length) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }

    logger.info(
      `✅ Bulk enrichment complete: ${successCount} success, ${failureCount} failed`
    );

    return res.json({
      success: true,
      summary: {
        total: candidateIds.length,
        successful: successCount,
        failed: failureCount,
        successRate: Math.round((successCount / candidateIds.length) * 100),
      },
      results: results.slice(0, maxResults),
    });
  } catch (error) {
    logger.error('❌ Bulk enrichment error:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Bulk enrichment failed',
      message: error.message,
    });
  }
};

/**
 * Get enrichment status for candidate
 * GET /api/enrich-contact/:candidateId/status
 */
export const getEnrichmentStatus = async (req, res) => {
  const { candidateId } = req.params;

  try {
    const enriched = await EnrichedContact.findOne({
      candidateId,
      expiresAt: { $gt: new Date() },
    }).lean();

    if (!enriched) {
      return res.json({
        success: true,
        data: {
          candidateId,
          enriched: false,
          message: 'No cached enrichment found',
        },
      });
    }

    return res.json({
      success: true,
      data: {
        candidateId,
        enriched: !!(enriched.email || enriched.phone),
        email: enriched.email,
        phone: enriched.phone,
        source: enriched.source,
        confidence: enriched.confidence,
        cachedAt: enriched.createdAt,
        expiresAt: enriched.expiresAt,
      },
    });
  } catch (error) {
    logger.error('❌ Status check error:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Status check failed',
      message: error.message,
    });
  }
};

/**
 * Clear cache for candidate
 * DELETE /api/enrich-contact/:candidateId/cache
 */
export const clearEnrichmentCache = async (req, res) => {
  const { candidateId } = req.params;

  try {
    const result = await EnrichedContact.deleteOne({ candidateId });

    return res.json({
      success: true,
      message: `Cache cleared for candidate ${candidateId}`,
      deletedCount: result.deletedCount,
    });
  } catch (error) {
    logger.error('❌ Cache clear error:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Cache clear failed',
      message: error.message,
    });
  }
};
