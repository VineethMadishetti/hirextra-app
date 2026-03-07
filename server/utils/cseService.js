import axios from 'axios';
import logger from './logger.js';

// Bing market codes per country for geo-targeted search results
const COUNTRY_MARKETS = {
  india:          'en-IN',
  uk:             'en-GB',
  germany:        'de-DE',
  austria:        'de-AT',
  belgium:        'fr-BE',
  czech_republic: 'cs-CZ',
  denmark:        'da-DK',
  estonia:        'et-EE',
  finland:        'fi-FI',
  greece:         'el-GR',
  hungary:        'hu-HU',
  iceland:        'is-IS',
  italy:          'it-IT',
  latvia:         'lv-LV',
  lithuania:      'lt-LT',
  luxembourg:     'fr-LU',
  malta:          'en-MT',
  netherlands:    'nl-NL',
  norway:         'nb-NO',
  poland:         'pl-PL',
  portugal:       'pt-PT',
  romania:        'ro-RO',
  slovakia:       'sk-SK',
  slovenia:       'sl-SI',
  spain:          'es-ES',
  sweden:         'sv-SE',
  switzerland:    'de-CH',
  france:         'fr-FR',
  singapore:      'en-SG',
  australia:      'en-AU',
  canada:         'en-CA',
  us:             'en-US',
  japan:          'ja-JP',
  south_korea:    'ko-KR',
  thailand:       'th-TH',
  vietnam:        'vi-VN',
  philippines:    'en-PH',
  indonesia:      'id-ID',
  malaysia:       'ms-MY',
  pakistan:       'en-PK',
  bangladesh:     'en-BD',
  sri_lanka:      'en-LK',
  uae:            'ar-AE',
  saudi_arabia:   'ar-SA',
  mexico:         'es-MX',
  brazil:         'pt-BR',
  argentina:      'es-AR',
  chile:          'es-CL',
  south_africa:   'en-ZA',
  egypt:          'ar-EG',
  new_zealand:    'en-NZ',
};

class CSEService {
  constructor() {
    this.baseUrl = 'https://api.bing.microsoft.com/v7.0/search';
  }

  getBingApiKey() {
    return String(process.env.BING_SEARCH_API_KEY || '').trim();
  }

  isConfigured() {
    return Boolean(this.getBingApiKey());
  }

  async searchCountry(query, country, maxResults = 10) {
    const apiKey = this.getBingApiKey();
    if (!apiKey) {
      logger.warn('Bing Search API key not configured, skipping search');
      return [];
    }

    const countryKey = String(country || '').toLowerCase();
    const mkt = COUNTRY_MARKETS[countryKey];
    if (!mkt) {
      logger.warn(`No market configured for country: ${country}`);
      return [];
    }

    logger.info(`[Bing] Searching country=${country} mkt=${mkt} query="${String(query).slice(0, 80)}"`);

    try {
      const response = await axios.get(this.baseUrl, {
        headers: {
          'Ocp-Apim-Subscription-Key': apiKey,
        },
        params: {
          q: query,
          count: Math.min(maxResults, 50),
          mkt,
          responseFilter: 'Webpages',
          safeSearch: 'Off',
        },
        timeout: 15000,
      });

      const items = response?.data?.webPages?.value;
      if (!Array.isArray(items)) return [];

      return items.map((item) => ({
        title: item.name,
        link: item.url,
        snippet: item.snippet,
        displayLink: item.displayUrl,
        country,
      }));
    } catch (error) {
      const status = error.response?.status;
      const errMsg = error.response?.data?.error?.message || error.message;
      if (status === 429) {
        logger.warn(`[Bing] Rate limit hit for country=${country}`);
      } else if (status === 401 || status === 403) {
        logger.error(`[Bing] Auth error for country=${country} — ${errMsg}`);
      } else if (status) {
        logger.warn(`[Bing] HTTP ${status} for country=${country} — ${errMsg}`);
      } else {
        logger.warn(`[Bing] Request failed for country=${country}: ${error.message}`);
      }
      return [];
    }
  }

  async searchCountries(query, countries, resultsPerCountry = 5) {
    logger.info(
      `Searching ${countries.length} countries for query: "${String(query).slice(0, 80)}"`
    );

    const taskFns = countries.map(
      (country) => () => this.searchCountry(query, country, resultsPerCountry)
    );
    const results = await this.executeConcurrent(taskFns, 5);
    const flattened = results.flat().filter(Boolean);

    logger.info(`Bing search complete: ${flattened.length} results`);
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
    return Object.keys(COUNTRY_MARKETS);
  }

  getCseId(country) {
    return COUNTRY_MARKETS[String(country || '').toLowerCase()] || null;
  }
}

export default new CSEService();
