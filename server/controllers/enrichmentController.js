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
      const isFailureCache = !hasCachedContact;

      if (!(forceRefresh && isFailureCache)) {
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
            error: enrichedContact.lastError || null,
            verifiedAt: enrichedContact.verifiedAt,
            cachedAt: enrichedContact.createdAt,
          },
        });
      }

      logger.info(`Bypassing failure cache for candidate ${candidateId} (force=true)`);
    }

    // Not in cache, run enrichment
    logger.info(`Starting enrichment for candidate ${candidateId}`);
    const result = await contactEnrichmentService.enrichCandidate(candidate);

    if (result.source === 'error' && !result.email && !result.phone) {
      throw new Error(result.error || 'Contact enrichment provider unavailable');
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

