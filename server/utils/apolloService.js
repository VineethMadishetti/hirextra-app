import axios from 'axios';
import logger from './logger.js';

const APOLLO_BASE = 'https://api.apollo.io/api/v1';

class ApolloService {
  constructor() {
    this.lastError = null;
  }

  getApiKey() {
    return String(process.env.APOLLO_API_KEY || '').trim();
  }

  isConfigured() {
    return Boolean(this.getApiKey());
  }

  getLastError() {
    return this.lastError;
  }

  async searchPeople(params = {}, page = 1) {
    const key = this.getApiKey();
    if (!key) return { people: [], total: 0 };
    this.lastError = null;

    const perPage = Math.min(Math.max(Number(params.perPage) || 25, 1), 100);
    const personTitles = Array.isArray(params.personTitles) ? params.personTitles : [];
    const personLocations = Array.isArray(params.personLocations) ? params.personLocations : [];
    const personSeniorities = Array.isArray(params.personSeniorities) ? params.personSeniorities : [];
    const keywords = String(params.keywords || '').trim();

    const body = {
      per_page: perPage,
      page,
    };

    if (personTitles.length) body.person_titles = personTitles;
    if (personLocations.length) body.person_locations = personLocations;
    if (personSeniorities.length) body.person_seniorities = personSeniorities;
    if (keywords) body.q_keywords = keywords;

    logger.info(
      `[Apollo] Searching - titles=${personTitles.length} loc=${personLocations.join('|')} ` +
      `seniority=${personSeniorities.join(',')} keywords="${keywords}" page=${page}`
    );

    try {
      const resp = await axios.post(`${APOLLO_BASE}/mixed_people/search`, body, {
        headers: {
          'Content-Type': 'application/json',
          'X-Api-Key': key,
        },
        timeout: 15000,
      });

      const people = resp.data?.people || [];
      const total = resp.data?.pagination?.total_entries || people.length;
      logger.info(`[Apollo] ${total} total profiles found, received ${people.length} on page ${page}`);
      return { people, total };
    } catch (err) {
      const status = err.response?.status;
      const errData = err.response?.data || {};
      const errBody = JSON.stringify(errData);
      this.lastError = {
        status: status || null,
        code: errData?.error_code || null,
        message: errData?.error || err.message,
      };
      logger.error(`[Apollo] Search failed: HTTP ${status || '?'} - ${errBody}`);
      return { people: [], total: 0 };
    }
  }

  async searchPeopleMultiPage(params = {}, maxResults = 25) {
    const perPage = Math.min(maxResults, 100);
    const { people: firstPage, total } = await this.searchPeople({ ...params, perPage }, 1);

    if (firstPage.length >= maxResults || firstPage.length >= total) {
      return { people: firstPage.slice(0, maxResults), total };
    }

    const allPeople = [...firstPage];
    let page = 2;
    while (allPeople.length < maxResults && page <= 2) {
      const { people } = await this.searchPeople({ ...params, perPage }, page);
      if (!people.length) break;
      allPeople.push(...people);
      page += 1;
    }

    return { people: allPeople.slice(0, maxResults), total };
  }
}

export default new ApolloService();
