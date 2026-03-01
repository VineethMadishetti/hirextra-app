import axios from 'axios';
import logger from './logger.js';

/**
 * Contact Enrichment Service
 * Cascade order: Skrapp (LinkedIn) → PDL (name+company) → Lusha (phone)
 */

class ContactEnricher {
  constructor() {
    this.skrappKey = null;
    this.pdlKey = null;
    this.lushaKey = null;

    // API endpoints
    this.skrappEndpoint = 'https://api.skrapp.io/api/v2/find';
    this.skrappLegacyEndpoint = 'https://api.skrapp.io/api/v2/accounts/find';
    this.pdlEndpoint = 'https://api.peopledatalabs.com/v5/person/enrich';
    this.lushaEndpoint = 'https://api.lusha.co/prospecting/social/linkedin';

    // Cost tracking (approximate)
    this.costs = {
      skrapp: 0.049,
      pdl: 0.040,
      lusha: 0.156,
    };
  }

  _readEnvKey(...names) {
    for (const name of names) {
      const raw = process.env[name];
      if (typeof raw !== 'string') continue;
      const value = raw.trim();
      if (!value) continue;

      // Skip placeholder-like values frequently left in env files
      const lower = value.toLowerCase();
      if (
        lower === 'undefined' ||
        lower === 'null' ||
        lower === 'your-api-key' ||
        lower === 'your_api_key' ||
        lower === 'your-key-here'
      ) {
        continue;
      }
      return value;
    }
    return null;
  }

  _refreshApiKeys() {
    // Accept common fallback names to reduce misconfiguration failures.
    this.skrappKey = this._readEnvKey(
      'SKRAPP_API_KEY',
      'SKRAPP_KEY',
      'SKRAPP_API_LEY',
      'SKRAPP_API_TOKEN',
      'VITE_SKRAPP_API_KEY'
    );
    this.pdlKey = this._readEnvKey('PDL_API_KEY', 'PDL_KEY', 'VITE_PDL_API_KEY');
    this.lushaKey = this._readEnvKey('LUSHA_API_KEY', 'LUSHA_KEY', 'VITE_LUSHA_API_KEY');
  }

  /**
   * Main enrichment method with cascade logic
   * Tries sources in order of cost/speed
   */
  async enrichCandidate(candidate) {
    if (!candidate) {
      throw new Error('Candidate object required');
    }

    this._refreshApiKeys();

    const candidateId = candidate._id || candidate.id;
    const linkedinUrl = candidate.linkedinUrl || candidate.linkedInUrl || candidate.linkedin_url;
    const fullName = candidate.fullName || candidate.name;
    const company = candidate.company || candidate.company_name;
    const hasAnyProvider = Boolean(this.skrappKey || this.pdlKey || this.lushaKey);

    logger.info(`🔍 Starting enrichment cascade for candidate ${candidateId}`);

    try {
      if (!hasAnyProvider) {
        const errorMessage =
          'No contact enrichment providers configured on backend runtime. Checked SKRAPP_API_KEY/SKRAPP_KEY/SKRAPP_API_LEY, PDL_API_KEY/PDL_KEY, LUSHA_API_KEY/LUSHA_KEY.';
        logger.error(errorMessage);
        return {
          email: null,
          phone: null,
          source: 'error',
          confidence: 0,
          error: errorMessage,
        };
      }

      // 1. Try Skrapp first (current API: name+company/domain, with legacy LinkedIn fallback)
      if (fullName || linkedinUrl) {
        logger.debug(`  → Step 1/3: Trying Skrapp enrichment`);
        const skrappResult = await this._skrappLookup({
          linkedinUrl,
          fullName,
          company,
        });
        if (skrappResult && skrappResult.email) {
          logger.info(`  ✅ Skrapp found email for ${candidateId}`);
          return {
            ...skrappResult,
            source: 'skrapp',
            confidence: 0.85,
          };
        }
      }

      // 2. Fallback to PDL (name + company match)
      if (fullName && company) {
        logger.debug(`  → Step 2/3: Trying PDL for ${fullName} at ${company}`);
        const pdlResult = await this._pdlLookup(fullName, company);
        if (pdlResult && pdlResult.email) {
          logger.info(`  ✅ PDL found email for ${candidateId}`);
          return {
            ...pdlResult,
            source: 'pdl',
            confidence: 0.75,
          };
        }
      }

      // 3. Last resort: Lusha for phone numbers
      if (linkedinUrl && this._isValidLinkedInUrl(linkedinUrl)) {
        logger.debug(`  → Step 3/3: Trying Lusha for ${linkedinUrl}`);
        const lushaResult = await this._lushaLookup(linkedinUrl);
        if (lushaResult && (lushaResult.phone || lushaResult.email)) {
          logger.info(`  ✅ Lusha found contact for ${candidateId}`);
          return {
            ...lushaResult,
            source: 'lusha',
            confidence: lushaResult.phone ? 0.80 : 0.60,
          };
        }
      }

      // All failed
      logger.warn(`  ❌ All enrichment sources failed for ${candidateId}`);
      return {
        email: null,
        phone: null,
        source: 'failed',
        confidence: 0,
        error:
          'No contact found. Skrapp requires a valid name + company/domain (or a supported LinkedIn match).',
      };
    } catch (error) {
      logger.error(`❌ Enrichment cascade error for ${candidateId}:`, error.message);
      return {
        email: null,
        phone: null,
        source: 'error',
        confidence: 0,
        error: error.message,
      };
    }
  }

  /**
   * Skrapp.io API - LinkedIn email finder
   * Cost: ~$0.049 per lookup
   * Accuracy: 85-90%
   */
  async _skrappLookup({ linkedinUrl, fullName, company }) {
    if (!this.skrappKey) {
      logger.debug('Skrapp API key not configured, skipping');
      return null;
    }

    const headers = {
      'X-Access-Key': this.skrappKey,
      'X-Access-Token': this.skrappKey, // legacy compatibility
      'Content-Type': 'application/json',
    };

    const parsedName = this._splitName(fullName);
    const companyDomain = this._extractDomain(company);

    try {
      // Preferred/current endpoint: /api/v2/find using fullName + company/domain
      if (parsedName.fullName && (company || companyDomain)) {
        const response = await axios.get(this.skrappEndpoint, {
          headers,
          params: {
            fullName: parsedName.fullName,
            company: company || undefined,
            domain: companyDomain || undefined,
          },
          timeout: 10000,
        });

        const email =
          response?.data?.email ||
          response?.data?.data?.email ||
          response?.data?.result?.email ||
          null;

        if (email) {
          return {
            email,
            phone: null,
            linkedinUrl: linkedinUrl || null,
            verifiedAt: new Date(),
          };
        }
      }

      // Legacy fallback: /api/v2/accounts/find with linkedin_url
      if (linkedinUrl && this._isValidLinkedInUrl(linkedinUrl)) {
        const legacyResponse = await axios.post(
          this.skrappLegacyEndpoint,
          { linkedin_url: linkedinUrl },
          {
            headers,
            timeout: 10000,
          }
        );

        const legacyEmail =
          legacyResponse?.data?.email ||
          legacyResponse?.data?.data?.email ||
          legacyResponse?.data?.result?.email ||
          (Array.isArray(legacyResponse?.data) ? legacyResponse.data[0]?.email : null) ||
          null;

        if (legacyEmail) {
          return {
            email: legacyEmail,
            phone: legacyResponse?.data?.phone || null,
            linkedinUrl: linkedinUrl,
            verifiedAt: new Date(),
          };
        }
      }

      return null;
    } catch (error) {
      if (error.response?.status === 429) {
        logger.warn('Skrapp rate limit hit');
      } else if (error.response?.status === 404) {
        logger.debug('Skrapp: No email found');
      } else {
        logger.error(`Skrapp API error: ${error.response?.status || error.message}`);
      }
      return null;
    }
  }

  /**
   * People Data Labs API - Name + Company enrichment
   * Cost: ~$0.040 per lookup
   * Accuracy: 80-85%
   */
  async _pdlLookup(fullName, company) {
    if (!this.pdlKey) {
      logger.debug('PDL API key not configured, skipping');
      return null;
    }

    try {
      const response = await axios.get(this.pdlEndpoint, {
        headers: {
          Authorization: `Bearer ${this.pdlKey}`,
        },
        params: {
          name: fullName,
          company: company,
        },
        timeout: 10000,
      });

      if (response.status === 200 && response.data) {
        const emails = response.data.emails || [];
        const phones = response.data.phone_numbers || [];

        // Get highest confidence email
        let bestEmail = null;
        if (emails.length > 0) {
          const sorted = emails.sort(
            (a, b) => (b.confidence || 0) - (a.confidence || 0)
          );
          bestEmail = sorted[0].address;
        }

        // Get first phone
        const bestPhone = phones.length > 0 ? phones[0].number : null;

        return {
          email: bestEmail,
          phone: bestPhone,
          linkedinUrl: response.data.linkedin_url || null,
          verifiedAt: new Date(),
        };
      }

      return null;
    } catch (error) {
      if (error.response?.status === 429) {
        logger.warn('PDL rate limit hit');
      } else if (error.response?.status === 404) {
        logger.debug('PDL: Person not found');
      } else {
        logger.error(`PDL API error: ${error.response?.status || error.message}`);
      }
      return null;
    }
  }

  /**
   * Lusha API - Phone number finder
   * Cost: ~$0.156 per lookup
   * Accuracy: 85-90% for phones
   */
  async _lushaLookup(linkedinUrl) {
    if (!this.lushaKey) {
      logger.debug('Lusha API key not configured, skipping');
      return null;
    }

    try {
      const response = await axios.get(this.lushaEndpoint, {
        headers: {
          Authorization: `Bearer ${this.lushaKey}`,
          'Content-Type': 'application/json',
        },
        params: {
          linkedinUrl: linkedinUrl,
        },
        timeout: 10000,
      });

      if (response.status === 200 && response.data) {
        return {
          email: response.data.email || null,
          phone: response.data.phone || null,
          linkedinUrl: linkedinUrl,
          verifiedAt: new Date(),
        };
      }

      return null;
    } catch (error) {
      if (error.response?.status === 429) {
        logger.warn('Lusha rate limit hit');
      } else if (error.response?.status === 404) {
        logger.debug('Lusha: Contact not found');
      } else {
        logger.error(`Lusha API error: ${error.response?.status || error.message}`);
      }
      return null;
    }
  }

  /**
   * Validate LinkedIn URL format
   */
  _isValidLinkedInUrl(url) {
    if (!url) return false;
    return (
      url.includes('linkedin.com/in/') ||
      url.includes('linkedin.com/company/')
    );
  }

  _splitName(fullName) {
    const clean = String(fullName || '').replace(/\s+/g, ' ').trim();
    if (!clean) {
      return { fullName: '', firstName: '', lastName: '' };
    }
    const parts = clean.split(' ');
    return {
      fullName: clean,
      firstName: parts[0] || '',
      lastName: parts.length > 1 ? parts.slice(1).join(' ') : '',
    };
  }

  _extractDomain(companyValue) {
    const input = String(companyValue || '').trim().toLowerCase();
    if (!input) return '';

    const cleaned = input
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .split('/')[0]
      .trim();

    if (/^[a-z0-9.-]+\.[a-z]{2,}$/.test(cleaned)) return cleaned;
    return '';
  }
}

export default new ContactEnricher();
