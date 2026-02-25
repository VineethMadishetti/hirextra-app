import axios from 'axios';
import logger from './logger.js';

/**
 * Google Custom Search Engine (CSE) Service
 * Searches across 50-country network for LinkedIn profiles
 */

// CSE IDs from existing Stucrow configuration (50 countries)
const COUNTRY_CSES = {
  india: '017007144926744970718:auveiwtwlu4',
  uk: '7856acfbbbfa9e1fc',
  germany: '017007144926744970718:-aagbo27gso',
  austria: '017007144926744970718:atq64kyfupy',
  belgium: '017007144926744970718:rnu7nffzls4',
  czech_republic: '017007144926744970718:ndhk0eeqp74',
  denmark: '052a82679c22147de',
  estonia: '017007144926744970718:qclk5bzomcw',
  finland: '017007144926744970718:bu_nzan44yw',
  greece: '017007144926744970718:g0-jiitr250',
  hungary: '017007144926744970718:8_z_ntpgxp4',
  iceland: '017007144926744970718:zaectnah11s',
  italy: 'd1cb148e17ddae2ef',
  latvia: '017007144926744970718:9sdb2mziooc',
  lithuania: '017007144926744970718:d9_51lvnppc',
  luxembourg: '72c5005461a103be7',
  malta: '017007144926744970718:ze40dycyqji',
  netherlands: '017007144926744970718:3_w50grmndy',
  norway: '017007144926744970718:opzf_kqniws',
  poland: 'c3e4d3b4defe045b9',
  portugal: '017007144926744970718:hghyo91e4_s',
  romania: '017007144926744970718:_7qjp3uvcoa',
  slovakia: '017007144926744970718:tdsf_on64vq',
  slovenia: '017007144926744970718:mwp19bsrstm',
  spain: '017007144926744970718:7yb1n4skdyy',
  sweden: '017007144926744970718:_z-o1j8afeu',
  switzerland: '017007144926744970718:lgyf-6ghtvu',
  france: '017007144926744970718:7yb1n4skdyy',
  singapore: '017007144926744970718:mmxkvzia178',
  australia: '017007144926744970718:jei0f9zdakm',
  canada: '017007144926744970718:ihlly5ilxxq',
  us: '017007144926744970718:ih8i99z9hdg',
  japan: '017007144926744970718:z5ch_7nv8fq',
  south_korea: '017007144926744970718:3ekk8yq3fru',
  thailand: '017007144926744970718:rk-u0l5xwbm',
  vietnam: '017007144926744970718:wxwlr9wy1kk',
  philippines: '017007144926744970718:ux6pq3g-a5s',
  indonesia: '017007144926744970718:-7cxm5tdzym',
  malaysia: '017007144926744970718:e0qpx-i5lvy',
  pakistan: '017007144926744970718:w5xm9-ky-io',
  bangladesh: '017007144926744970718:z-yzpcf_jvi',
  sri_lanka: '017007144926744970718:4oyyzmfg-0c',
  uae: '017007144926744970718:hhilnq_vbza',
  saudi_arabia: '017007144926744970718:1y-k8jfq8yw',
  mexico: '017007144926744970718:crrg7ijmw8w',
  brazil: '017007144926744970718:cul_hn7xzno',
  argentina: '017007144926744970718:d6nfcdq0bvw',
  chile: '017007144926744970718:yqnl0swxapu',
  south_africa: '017007144926744970718:vdm8lpxtmsy',
  egypt: '017007144926744970718:q5exgzffzxg',
  new_zealand: '017007144926744970718:3n5u0mf-tyy',
};

class CSEService {
  constructor() {
    this.googleApiKey = process.env.GOOGLE_CSE_API_KEY;
    this.baseUrl = 'https://www.googleapis.com/customsearch/v1';
  }

  /**
   * Check if API key is configured
   */
  isConfigured() {
    return !!this.googleApiKey;
  }

  /**
   * Search a single country CSE
   */
  async searchCountry(query, country, maxResults = 10) {
    if (!this.googleApiKey) {
      logger.warn(`Google CSE API key not configured, skipping search`);
      return [];
    }

    const cseId = COUNTRY_CSES[country.toLowerCase()];
    if (!cseId) {
      logger.warn(`No CSE configured for country: ${country}`);
      return [];
    }

    try {
      const response = await axios.get(this.baseUrl, {
        params: {
          key: this.googleApiKey,
          cx: cseId,
          q: query,
          num: Math.min(maxResults, 10), // Max 10 per API call
        },
        timeout: 15000,
      });

      if (!response.data.items) {
        return [];
      }

      return response.data.items.map((item) => ({
        title: item.title,
        link: item.link,
        snippet: item.snippet,
        displayLink: item.displayLink,
        country,
      }));
    } catch (error) {
      if (error.response?.status === 429) {
        logger.warn(`Google CSE rate limit hit for ${country}`);
      } else if (error.response?.status === 403) {
        logger.error(`Google CSE quota exceeded or API key invalid`);
      } else {
        logger.debug(`CSE search failed for ${country}: ${error.message}`);
      }
      return [];
    }
  }

  /**
   * Search multiple countries in parallel
   * Returns flattened array of results
   */
  async searchCountries(query, countries, resultsPerCountry = 5) {
    logger.info(
      `🔍 Searching ${countries.length} countries for: "${query.substring(0, 50)}..."`
    );

    // Create tasks for each country
    const tasks = countries.map((country) => this.searchCountry(query, country, resultsPerCountry));

    // Execute with concurrency limit (5 simultaneous)
    const results = await this._executeConcurrent(tasks, 5);

    // Flatten results
    const flattened = results.flat().filter(Boolean);
    logger.info(`✅ Search complete: ${flattened.length} results from ${countries.length} countries`);

    return flattened;
  }

  /**
   * Execute tasks with concurrency limit
   */
  async _executeConcurrent(tasks, limit) {
    const results = [];
    for (let i = 0; i < tasks.length; i += limit) {
      const batch = tasks.slice(i, i + limit);
      const batchResults = await Promise.allSettled(batch);
      results.push(
        ...batchResults.map((r) => (r.status === 'fulfilled' ? r.value : []))
      );
    }
    return results;
  }

  /**
   * Get list of all configured countries
   */
  getConfiguredCountries() {
    return Object.keys(COUNTRY_CSES);
  }

  /**
   * Get CSE ID for a country
   */
  getCseId(country) {
    return COUNTRY_CSES[country.toLowerCase()] || null;
  }
}

export default new CSEService();
