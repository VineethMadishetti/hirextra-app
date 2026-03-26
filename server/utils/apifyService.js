/**
 * apifyService.js
 *
 * Two Apify actors:
 *   1. harvestapi~linkedin-profile-search      — main candidate discovery (structured profiles)
 *   2. apify/google-search-scraper            — OSINT only (GitHub/SO dorking)
 */

import axios from 'axios';
import logger from './logger.js';

const APIFY_BASE           = 'https://api.apify.com/v2';
const ACTOR_ID             = 'apify~google-search-scraper';
const LINKEDIN_ACTOR_ID    = 'harvestapi~linkedin-profile-search';
const POLL_INTERVAL        = 3000;   // ms between status polls
const MAX_WAIT_MS          = 180000; // 3-minute hard timeout

class ApifyService {
  getApiKey() {
    return String(process.env.APIFY_API_KEY || '').trim();
  }

  isConfigured() {
    return Boolean(this.getApiKey());
  }

  // ── Shared: poll an actor run until SUCCEEDED/FAILED ─────────────────────
  async _pollRun(runId, label = 'run') {
    const token = this.getApiKey();
    const deadline = Date.now() + MAX_WAIT_MS;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL));
      try {
        const statusResp = await axios.get(
          `${APIFY_BASE}/actor-runs/${runId}?token=${token}`,
          { timeout: 10000 }
        );
        const status = statusResp.data?.data?.status;
        logger.debug(`[Apify] ${label} ${runId} → ${status}`);
        if (status === 'SUCCEEDED') return true;
        if (status === 'FAILED' || status === 'ABORTED' || status === 'TIMED-OUT') {
          logger.error(`[Apify] ${label} ${runId} ended with status: ${status}`);
          return false;
        }
      } catch (err) {
        logger.warn(`[Apify] Poll error: ${err.message}`);
      }
    }
    logger.error(`[Apify] ${label} ${runId} timed out after ${MAX_WAIT_MS / 1000}s`);
    return false;
  }

  // ── Shared: fetch dataset items ───────────────────────────────────────────
  async _fetchDataset(datasetId) {
    const token = this.getApiKey();
    try {
      const dataResp = await axios.get(
        `${APIFY_BASE}/datasets/${datasetId}/items?token=${token}&clean=true&limit=1000`,
        { timeout: 30000 }
      );
      return Array.isArray(dataResp.data) ? dataResp.data : [];
    } catch (err) {
      logger.error(`[Apify] Failed to fetch dataset ${datasetId}: ${err.message}`);
      return [];
    }
  }

  /**
   * HarvestAPI LinkedIn Company Employees — main candidate discovery.
   * Uses currentJobTitles filter (Lead search endpoint) to return real profiles,
   * bypassing the "LinkedIn Member" anonymization that searchQuery triggers.
   *
   * @param {Object} params - Structured search params from buildLinkedInSearchParams()
   *   {currentJobTitles, locations, yearsOfExperienceIds,
   *    seniorityLevelIds, industryIds, profileScraperMode, takePages}
   * @returns {Promise<Array>} - Raw HarvestAPI profile objects
   */
  async runLinkedInSearch(params = {}) {
    const token = this.getApiKey();
    if (!token || !params) return [];

    const currentJobTitles = params.currentJobTitles || [];
    if (currentJobTitles.length === 0) {
      logger.warn('[Apify] runLinkedInSearch called with no currentJobTitles — skipping');
      return [];
    }

    const takePages = Math.min(Math.max(Number(params.takePages) || 1, 1), 20);
    logger.info(
      `[Apify] LinkedIn search — titles=${currentJobTitles.join('|')} | loc=${(params.locations || []).join(',')} | seniority=${(params.seniorityLevelIds || []).join(',')} | pages=${takePages}`
    );

    const body = {
      currentJobTitles,
      locations:             params.locations              || [],
      yearsOfExperienceIds:  params.yearsOfExperienceIds  || [],
      seniorityLevelIds:     params.seniorityLevelIds      || [],
      industryIds:           params.industryIds            || [],
      profileScraperMode:    params.profileScraperMode    || 'Full',
      takePages,
      maxItems:              25,
      proxy: { useApifyProxy: true },
    };
    if (params.postFilteringMongoQuery) {
      body.postFilteringMongoQuery = params.postFilteringMongoQuery;
    }

    let runId, datasetId;
    try {
      const resp = await axios.post(
        `${APIFY_BASE}/acts/${LINKEDIN_ACTOR_ID}/runs?token=${token}`,
        body,
        { timeout: 30000 }
      );
      runId     = resp.data?.data?.id;
      datasetId = resp.data?.data?.defaultDatasetId;
    } catch (err) {
      logger.error(`[Apify] Failed to start LinkedIn actor: HTTP ${err.response?.status || '?'} — ${err.message}`);
      return [];
    }

    if (!runId) { logger.error('[Apify] LinkedIn actor returned no runId'); return []; }
    logger.info(`[Apify] LinkedIn run started — runId=${runId}`);

    const succeeded = await this._pollRun(runId, 'LinkedIn');
    if (!succeeded) return [];

    const profiles = await this._fetchDataset(datasetId);
    logger.info(`[Apify] LinkedIn run complete — ${profiles.length} profiles returned`);
    if (profiles.length > 0) {
      logger.info(`[Apify] Sample profile keys: ${Object.keys(profiles[0]).join(', ')}`);
      logger.info(`[Apify] Sample profile[0]: ${JSON.stringify(profiles[0], null, 2)}`);
    }
    return profiles;
  }

  /**
   * Run the Google Search Scraper for an array of queries.
   * Returns an array of normalised result objects.
   *
   * @param {string[]} queries          - Boolean search queries (already location-aware)
   * @param {number}   resultsPerQuery  - how many organic results to fetch per query (1-100)
   * @returns {Promise<Array<{title,link,snippet,displayLink,query}>>}
   */
  /**
   * Google Search Scraper — used only for OSINT (GitHub/SO dorking).
   * Returns normalised { title, link, snippet, displayLink, query } objects.
   */
  async runGoogleSearch(queries, resultsPerQuery = 10) {
    const token = this.getApiKey();
    if (!token || !Array.isArray(queries) || queries.length === 0) return [];

    const numResults = Math.min(Math.max(Number(resultsPerQuery) || 10, 1), 100);
    logger.info(`[Apify] Starting google-search-scraper (OSINT) — ${queries.length} queries, ${numResults} results/query`);

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
      logger.error(`[Apify] Failed to start Google actor: HTTP ${err.response?.status || '?'} — ${err.message}`);
      return [];
    }

    if (!runId) { logger.error('[Apify] Google actor returned no runId'); return []; }
    logger.info(`[Apify] Google run started — runId=${runId}`);

    const succeeded = await this._pollRun(runId, 'Google');
    if (!succeeded) return [];

    const items = await this._fetchDataset(datasetId);
    logger.info(`[Apify] Google run complete — ${items.length} result page(s) returned`);

    const results = [];
    for (const page of items) {
      const queryTerm = page.searchQuery?.term || '';
      for (const r of (page.organicResults || [])) {
        results.push({
          title:       r.title        || '',
          link:        r.url          || '',
          snippet:     r.description  || '',
          displayLink: r.displayedUrl || '',
          query:       queryTerm,
        });
      }
    }

    logger.info(`[Apify] Normalised ${results.length} organic results across all queries`);
    return results;
  }
}

export default new ApifyService();
