import axios from 'axios';
import logger from './logger.js';

/**
 * Using a single user-owned CSE that is confirmed to return 200 OK
 * with the current GOOGLE_CSE_API_KEY. Searches the entire web.
 */
const USER_CSE = '906f22435e83c4b53';
const FALLBACK_CX = USER_CSE;

const COUNTRY_CSES = {
  india:          USER_CSE,
  uk:             USER_CSE,
  germany:        USER_CSE,
  austria:        USER_CSE,
  belgium:        USER_CSE,
  czech_republic: USER_CSE,
  denmark:        USER_CSE,
  estonia:        USER_CSE,
  finland:        USER_CSE,
  greece:         USER_CSE,
  hungary:        USER_CSE,
  iceland:        USER_CSE,
  italy:          USER_CSE,
  latvia:         USER_CSE,
  lithuania:      USER_CSE,
  luxembourg:     USER_CSE,
  malta:          USER_CSE,
  netherlands:    USER_CSE,
  norway:         USER_CSE,
  poland:         USER_CSE,
  portugal:       USER_CSE,
  romania:        USER_CSE,
  slovakia:       USER_CSE,
  slovenia:       USER_CSE,
  spain:          USER_CSE,
  sweden:         USER_CSE,
  switzerland:    USER_CSE,
  france:         USER_CSE,
  singapore:      USER_CSE,
  australia:      USER_CSE,
  canada:         USER_CSE,
  us:             USER_CSE,
  japan:          USER_CSE,
  south_korea:    USER_CSE,
  thailand:       USER_CSE,
  vietnam:        USER_CSE,
  philippines:    USER_CSE,
  indonesia:      USER_CSE,
  malaysia:       USER_CSE,
  pakistan:       USER_CSE,
  bangladesh:     USER_CSE,
  sri_lanka:      USER_CSE,
  uae:            USER_CSE,
  saudi_arabia:   USER_CSE,
  mexico:         USER_CSE,
  brazil:         USER_CSE,
  argentina:      USER_CSE,
  chile:          USER_CSE,
  south_africa:   USER_CSE,
  egypt:          USER_CSE,
  new_zealand:    USER_CSE,
};

class CSEService {
  constructor() {
    this.baseUrl = 'https://www.googleapis.com/customsearch/v1';
  }

  getApiKey() {
    return String(process.env.GOOGLE_CSE_API_KEY || '').trim();
  }

  isConfigured() {
    return Boolean(this.getApiKey());
  }

  async searchCountry(query, country, maxResults = 10) {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      logger.warn('GOOGLE_CSE_API_KEY not configured, skipping search');
      return [];
    }

    const countryKey = String(country || '').toLowerCase();
    const cseId = COUNTRY_CSES[countryKey] || FALLBACK_CX;

    logger.info(`[CSE] country=${country} cx=${cseId.slice(-8)} query="${String(query).slice(0, 80)}"`);

    try {
      const response = await axios.get(this.baseUrl, {
        params: {
          key: apiKey,
          cx: cseId,
          q: query,
          num: Math.min(maxResults, 10), // Google CSE max is 10
        },
        timeout: 15000,
      });

      const items = response?.data?.items;
      if (!Array.isArray(items) || items.length === 0) {
        logger.info(`[CSE] 0 results for country=${country}`);
        return [];
      }

      return items.map((item) => ({
        title:       item.title,
        link:        item.link,
        snippet:     item.snippet,
        displayLink: item.displayLink,
        country,
      }));
    } catch (error) {
      const status = error.response?.status;
      const errMsg = error.response?.data?.error?.message || error.message;
      if (status === 429) {
        logger.warn(`[CSE] Quota exceeded for country=${country}`);
      } else if (status === 403) {
        logger.error(`[CSE] 403 for country=${country} — ${errMsg}`);
      } else if (status) {
        logger.warn(`[CSE] HTTP ${status} for country=${country} — ${errMsg}`);
      } else {
        logger.warn(`[CSE] Request failed for country=${country}: ${error.message}`);
      }
      return [];
    }
  }

  async searchCountries(query, countries, resultsPerCountry = 5) {
    logger.info(`Searching ${countries.length} countries: "${String(query).slice(0, 80)}"`);

    const taskFns = countries.map(
      (country) => () => this.searchCountry(query, country, resultsPerCountry)
    );
    const results = await this.executeConcurrent(taskFns, 5);
    const flattened = results.flat().filter(Boolean);

    logger.info(`CSE search complete: ${flattened.length} results across ${countries.length} countries`);
    return flattened;
  }

  async executeConcurrent(taskFns, limit) {
    const results = [];
    for (let i = 0; i < taskFns.length; i += limit) {
      const batch = taskFns.slice(i, i + limit);
      const batchResults = await Promise.allSettled(batch.map((fn) => fn()));
      results.push(...batchResults.map((r) => (r.status === 'fulfilled' ? r.value : [])));
    }
    return results;
  }

  getConfiguredCountries() {
    return Object.keys(COUNTRY_CSES);
  }

  getCseId(country) {
    return COUNTRY_CSES[String(country || '').toLowerCase()] || FALLBACK_CX;
  }
}

export default new CSEService();
