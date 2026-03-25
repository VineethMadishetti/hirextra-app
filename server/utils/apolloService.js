/**
 * apolloService.js
 *
 * Apollo.io People Search API wrapper.
 * Returns structured candidate profiles with email included — no separate enrichment needed.
 * Docs: https://apolloio.github.io/apollo-api-docs/#people-search
 */

import axios from 'axios';
import logger from './logger.js';

const APOLLO_BASE = 'https://api.apollo.io/api/v1';

class ApolloService {
  getApiKey() {
    return String(process.env.APOLLO_API_KEY || '').trim();
  }

  isConfigured() {
    return Boolean(this.getApiKey());
  }

  /**
   * Search for people matching the given criteria.
   *
   * @param {Object} params
   *   personTitles      string[]  — job title filters
   *   personLocations   string[]  — location filters ("City, State, Country")
   *   personSeniorities string[]  — e.g. ["senior", "manager"]
   *   keywords          string    — skill/keyword query
   *   perPage           number    — results per page (max 100)
   *   page              number    — page number (1-based)
   * @returns {{ people: Array, total: number }}
   */
  async searchPeople(params = {}, page = 1) {
    const key = this.getApiKey();
    if (!key) return { people: [], total: 0 };

    const perPage = Math.min(Math.max(Number(params.perPage) || 25, 1), 100);

    const body = {
      api_key:  key,
      per_page: perPage,
      page,
    };

    // Only include non-empty arrays — Apollo returns 422 on some empty array fields
    if (params.personTitles?.length)      body.person_titles      = params.personTitles;
    if (params.personLocations?.length)   body.person_locations   = params.personLocations;
    if (params.personSeniorities?.length) body.person_seniorities = params.personSeniorities;
    if (params.keywords?.trim())          body.q_keywords         = params.keywords.trim();

    logger.info(
      `[Apollo] Searching — titles=${body.person_titles.length} loc=${body.person_locations.join('|')} ` +
      `seniority=${body.person_seniorities.join(',')} keywords="${body.q_keywords}" page=${page}`
    );

    try {
      const resp = await axios.post(`${APOLLO_BASE}/mixed_people/search`, body, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 15000,
      });

      const people = resp.data?.people || [];
      const total  = resp.data?.pagination?.total_entries || people.length;
      logger.info(`[Apollo] ${total} total profiles found, received ${people.length} on page ${page}`);
      return { people, total };
    } catch (err) {
      const status  = err.response?.status;
      const errBody = JSON.stringify(err.response?.data || {});
      logger.error(`[Apollo] Search failed: HTTP ${status || '?'} — ${errBody}`);
      return { people: [], total: 0 };
    }
  }

  /**
   * Fetch multiple pages to reach the requested count.
   * Stops early if fewer results are available.
   *
   * @param {Object} params  - same as searchPeople
   * @param {number} maxResults - total profiles to collect (capped at 100)
   * @returns {{ people: Array, total: number }}
   */
  async searchPeopleMultiPage(params = {}, maxResults = 25) {
    const perPage  = Math.min(maxResults, 100);
    const { people: firstPage, total } = await this.searchPeople({ ...params, perPage }, 1);

    // For free tier / small requests one page is enough
    if (firstPage.length >= maxResults || firstPage.length >= total) {
      return { people: firstPage.slice(0, maxResults), total };
    }

    // Collect more pages if needed (max 2 pages to stay within rate limits)
    const allPeople = [...firstPage];
    let page = 2;
    while (allPeople.length < maxResults && page <= 2) {
      const { people } = await this.searchPeople({ ...params, perPage }, page);
      if (!people.length) break;
      allPeople.push(...people);
      page++;
    }

    return { people: allPeople.slice(0, maxResults), total };
  }
}

export default new ApolloService();
