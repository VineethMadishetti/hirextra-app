/**
 * apifyService.js
 *
 * Runs Apify's Google Search Results Scraper actor to find LinkedIn profiles.
 * Actor: apify/google-search-scraper
 *
 * All search queries are batched into a single actor run for efficiency.
 * Normalises output to { title, link, snippet, displayLink, query } —
 * the same shape consumed by candidateExtraction.extractCandidates().
 */

import axios from 'axios';
import logger from './logger.js';

const APIFY_BASE      = 'https://api.apify.com/v2';
const ACTOR_ID        = 'apify~google-search-scraper';
const POLL_INTERVAL   = 3000;   // ms between status polls
const MAX_WAIT_MS     = 180000; // 3-minute hard timeout

class ApifyService {
  getApiKey() {
    return String(process.env.APIFY_API_KEY || '').trim();
  }

  isConfigured() {
    return Boolean(this.getApiKey());
  }

  /**
   * Run the Google Search Scraper for an array of queries.
   * Returns an array of normalised result objects.
   *
   * @param {string[]} queries          - Boolean search queries (already location-aware)
   * @param {number}   resultsPerQuery  - how many organic results to fetch per query (1-100)
   * @returns {Promise<Array<{title,link,snippet,displayLink,query}>>}
   */
  async runGoogleSearch(queries, resultsPerQuery = 10) {
    const token = this.getApiKey();
    if (!token || !Array.isArray(queries) || queries.length === 0) return [];

    const numResults = Math.min(Math.max(Number(resultsPerQuery) || 10, 1), 100);

    logger.info(`[Apify] Starting google-search-scraper — ${queries.length} queries, ${numResults} results/query`);

    // ── Start actor run ───────────────────────────────────────────────────────
    let runId, datasetId;
    try {
      const resp = await axios.post(
        `${APIFY_BASE}/acts/${ACTOR_ID}/runs?token=${token}`,
        {
          queries:                  queries.join('\n'),
          maxPagesPerQuery:         1,
          resultsPerPage:           numResults,
          languageCode:             'en',
          csvFriendlyOutput:        false,
          includeUnfilteredResults: false,
        },
        { timeout: 30000 }
      );
      runId     = resp.data?.data?.id;
      datasetId = resp.data?.data?.defaultDatasetId;
    } catch (err) {
      const status = err.response?.status;
      logger.error(`[Apify] Failed to start actor run: HTTP ${status || '?'} — ${err.message}`);
      return [];
    }

    if (!runId) {
      logger.error('[Apify] Actor start returned no runId');
      return [];
    }

    logger.info(`[Apify] Run started — runId=${runId}`);

    // ── Poll for completion ───────────────────────────────────────────────────
    const deadline = Date.now() + MAX_WAIT_MS;
    let succeeded  = false;

    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, POLL_INTERVAL));
      try {
        const statusResp = await axios.get(
          `${APIFY_BASE}/actor-runs/${runId}?token=${token}`,
          { timeout: 10000 }
        );
        const status = statusResp.data?.data?.status;
        logger.debug(`[Apify] Run ${runId} → ${status}`);

        if (status === 'SUCCEEDED') { succeeded = true; break; }
        if (status === 'FAILED' || status === 'ABORTED' || status === 'TIMED-OUT') {
          logger.error(`[Apify] Run ${runId} ended with status: ${status}`);
          return [];
        }
      } catch (err) {
        logger.warn(`[Apify] Poll error: ${err.message}`);
      }
    }

    if (!succeeded) {
      logger.error(`[Apify] Run ${runId} timed out after ${MAX_WAIT_MS / 1000}s`);
      return [];
    }

    // ── Fetch dataset items ───────────────────────────────────────────────────
    let items = [];
    try {
      const dataResp = await axios.get(
        `${APIFY_BASE}/datasets/${datasetId}/items?token=${token}&clean=true&limit=1000`,
        { timeout: 30000 }
      );
      items = Array.isArray(dataResp.data) ? dataResp.data : [];
    } catch (err) {
      logger.error(`[Apify] Failed to fetch dataset ${datasetId}: ${err.message}`);
      return [];
    }

    logger.info(`[Apify] Run complete — ${items.length} result page(s) returned`);

    // ── Normalise to { title, link, snippet, displayLink, query } ─────────────
    const results = [];
    for (const page of items) {
      const queryTerm = page.searchQuery?.term || '';
      for (const r of (page.organicResults || [])) {
        results.push({
          title:       r.title          || '',
          link:        r.url            || '',
          snippet:     r.description    || '',
          displayLink: r.displayedUrl   || '',
          query:       queryTerm,
        });
      }
    }

    logger.info(`[Apify] Normalised ${results.length} organic results across all queries`);
    return results;
  }
}

export default new ApifyService();
