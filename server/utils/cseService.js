import axios from 'axios';
import logger from './logger.js';

/**
 * Country name → Serper.dev gl (geolocation) code.
 * Serper searches real Google results, no CSE/PSE restrictions.
 */
const COUNTRY_GL = {
  india:          'in',
  uk:             'gb',
  germany:        'de',
  austria:        'at',
  belgium:        'be',
  czech_republic: 'cz',
  denmark:        'dk',
  estonia:        'ee',
  finland:        'fi',
  france:         'fr',
  greece:         'gr',
  hungary:        'hu',
  iceland:        'is',
  italy:          'it',
  latvia:         'lv',
  lithuania:      'lt',
  luxembourg:     'lu',
  malta:          'mt',
  netherlands:    'nl',
  norway:         'no',
  poland:         'pl',
  portugal:       'pt',
  romania:        'ro',
  slovakia:       'sk',
  slovenia:       'si',
  spain:          'es',
  sweden:         'se',
  switzerland:    'ch',
  singapore:      'sg',
  australia:      'au',
  canada:         'ca',
  us:             'us',
  japan:          'jp',
  south_korea:    'kr',
  thailand:       'th',
  vietnam:        'vn',
  philippines:    'ph',
  indonesia:      'id',
  malaysia:       'my',
  pakistan:       'pk',
  bangladesh:     'bd',
  sri_lanka:      'lk',
  uae:            'ae',
  saudi_arabia:   'sa',
  mexico:         'mx',
  brazil:         'br',
  argentina:      'ar',
  chile:          'cl',
  south_africa:   'za',
  egypt:          'eg',
  new_zealand:    'nz',
};

class CSEService {
  constructor() {
    this.baseUrl = 'https://google.serper.dev/search';
  }

  getApiKey() {
    return String(process.env.SERPER_API_KEY || '').trim();
  }

  isConfigured() {
    return Boolean(this.getApiKey());
  }

  async searchCountry(query, country, maxResults = 10) {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      logger.warn('SERPER_API_KEY not configured, skipping search');
      return [];
    }

    const countryKey = String(country || '').toLowerCase();
    const gl = COUNTRY_GL[countryKey] || 'us';

    logger.info(`[Serper] country=${country} gl=${gl} query="${String(query).slice(0, 80)}"`);

    try {
      const response = await axios.post(
        this.baseUrl,
        { q: query, num: Math.min(maxResults, 10), gl },
        {
          headers: {
            'X-API-KEY': apiKey,
            'Content-Type': 'application/json',
          },
          timeout: 15000,
        }
      );

      const items = response?.data?.organic;
      if (!Array.isArray(items) || items.length === 0) {
        logger.info(`[Serper] 0 results for country=${country}`);
        return [];
      }

      return items.map((item) => ({
        title:       item.title,
        link:        item.link,
        snippet:     item.snippet,
        displayLink: item.displayLink || '',
        country,
      }));
    } catch (error) {
      const status = error.response?.status;
      const errMsg = error.response?.data?.message || error.message;
      if (status === 429) {
        logger.warn(`[Serper] Quota exceeded for country=${country}`);
      } else if (status === 403) {
        logger.error(`[Serper] 403 for country=${country} — ${errMsg}`);
      } else if (status) {
        logger.warn(`[Serper] HTTP ${status} for country=${country} — ${errMsg}`);
      } else {
        logger.warn(`[Serper] Request failed for country=${country}: ${error.message}`);
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

    logger.info(`Serper search complete: ${flattened.length} results across ${countries.length} countries`);
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
    return Object.keys(COUNTRY_GL);
  }

  getCseId(country) {
    return COUNTRY_GL[String(country || '').toLowerCase()] || 'us';
  }
}

export default new CSEService();
