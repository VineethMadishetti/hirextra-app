import express from 'express';
import {
  enrichContact,
  enrichContactBulk,
  getEnrichmentStatus,
  clearEnrichmentCache,
} from '../controllers/enrichmentController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

/**
 * Enrich single candidate
 * GET /api/enrich-contact/:candidateId
 */
router.get('/:candidateId', protect, enrichContact);

/**
 * Bulk enrich candidates
 * POST /api/enrich-contact/bulk
 */
router.post('/bulk', protect, enrichContactBulk);

/**
 * Get enrichment status
 * GET /api/enrich-contact/:candidateId/status
 */
router.get('/:candidateId/status', protect, getEnrichmentStatus);

/**
 * Clear cache
 * DELETE /api/enrich-contact/:candidateId/cache
 */
router.delete('/:candidateId/cache', protect, clearEnrichmentCache);

export default router;
