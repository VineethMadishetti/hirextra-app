import axios from 'axios';
import logger from './logger.js';

/**
 * Stucrow original CSE IDs (grandfathered — created before "Search entire web" deprecation).
 * These search the full Google index, not just a restricted domain.
 * For unmapped countries, falls back to FALLBACK_CX.
 */
const FALLBACK_CX = '017007144926744970718:auveiwtwlu4'; // India — broadest coverage

const COUNTRY_CSES = {
  india:          '017007144926744970718:auveiwtwlu4',
  uk:             '7856acfbbbfa9e1fc',
  germany:        '017007144926744970718:-aagbo27gso',
  austria:        '017007144926744970718:atq64kyfupy',
  belgium:        '017007144926744970718:rnu7nffzls4',
  czech_republic: '017007144926744970718:ndhk0eeqp74',
  denmark:        '052a82679c22147de',
  estonia:        '017007144926744970718:qclk5bzomcw',
  finland:        '017007144926744970718:bu_nzan44yw',
  greece:         '017007144926744970718:g0-jiitr250',
  hungary:        '017007144926744970718:8_z_ntpgxp4',
  iceland:        '017007144926744970718:zaectnah11s',
  italy:          'd1cb148e17ddae2ef',
  latvia:         '017007144926744970718:9sdb2mziooc',
  lithuania:      '017007144926744970718:d9_51lvnppc',
  luxembourg:     '72c5005461a103be7',
  malta:          '017007144926744970718:ze40dycyqji',
  netherlands:    '017007144926744970718:3_w50grmndy',
  norway:         '017007144926744970718:opzf_kqniws',
  poland:         'c3e4d3b4defe045b9',
  portugal:       '017007144926744970718:hghyo91e4_s',
  romania:        '017007144926744970718:_7qjp3uvcoa',
  slovakia:       '017007144926744970718:tdsf_on64vq',
  slovenia:       '017007144926744970718:mwp19bsrstm',
  spain:          '017007144926744970718:7yb1n4skdyy',
  sweden:         '017007144926744970718:_z-o1j8afeu',
  switzerland:    '017007144926744970718:lgyf-6ghtvu',
  // Remaining countries fall back to FALLBACK_CX
  france:         FALLBACK_CX,
  singapore:      FALLBACK_CX,
  australia:      FALLBACK_CX,
  canada:         FALLBACK_CX,
  us:             FALLBACK_CX,
  japan:          FALLBACK_CX,
  south_korea:    FALLBACK_CX,
  thailand:       FALLBACK_CX,
  vietnam:        FALLBACK_CX,
  philippines:    FALLBACK_CX,
  indonesia:      FALLBACK_CX,
  malaysia:       FALLBACK_CX,
  pakistan:       FALLBACK_CX,
  bangladesh:     FALLBACK_CX,
  sri_lanka:      FALLBACK_CX,
  uae:            FALLBACK_CX,
  saudi_arabia:   FALLBACK_CX,
  mexico:         FALLBACK_CX,
  brazil:         FALLBACK_CX,
  argentina:      FALLBACK_CX,
  chile:          FALLBACK_CX,
  south_africa:   FALLBACK_CX,
  egypt:          FALLBACK_CX,
  new_zealand:    FALLBACK_CX,
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
