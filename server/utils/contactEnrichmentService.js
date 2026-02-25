import axios from 'axios';
import logger from './logger.js';

/**
 * Contact Enrichment Service
 * Cascade order: Skrapp (LinkedIn) → PDL (name+company) → Lusha (phone)
 */

class ContactEnricher {
  constructor() {
    this.skrappKey = process.env.SKRAPP_API_KEY;
    this.pdlKey = process.env.PDL_API_KEY;
    this.lushaKey = process.env.LUSHA_API_KEY;

    // API endpoints
    this.skrappEndpoint = 'https://api.skrapp.io/api/v2/accounts/find';
    this.pdlEndpoint = 'https://api.peopledatalabs.com/v5/person/enrich';
    this.lushaEndpoint = 'https://api.lusha.co/prospecting/social/linkedin';

    // Cost tracking (approximate)
    this.costs = {
      skrapp: 0.049,
      pdl: 0.040,
      lusha: 0.156,
    };
  }

  /**
   * Main enrichment method with cascade logic
   * Tries sources in order of cost/speed
   */
  async enrichCandidate(candidate) {
    if (!candidate) {
      throw new Error('Candidate object required');
    }

    const candidateId = candidate._id || candidate.id;
    const linkedinUrl = candidate.linkedinUrl || candidate.linkedin_url;
    const fullName = candidate.fullName || candidate.name;
    const company = candidate.company || candidate.company_name;

    logger.info(`🔍 Starting enrichment cascade for candidate ${candidateId}`);

    try {
      // 1. Try Skrapp if LinkedIn URL exists (fastest, cheapest for LinkedIn)
      if (linkedinUrl && this._isValidLinkedInUrl(linkedinUrl)) {
        logger.debug(`  → Step 1/3: Trying Skrapp for ${linkedinUrl}`);
        const skrappResult = await this._skrappLookup(linkedinUrl);
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
        error: 'All enrichment sources failed',
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
  async _skrappLookup(linkedinUrl) {
    if (!this.skrappKey) {
      logger.debug('Skrapp API key not configured, skipping');
      return null;
    }

    try {
      const response = await axios.post(
        this.skrappEndpoint,
        { linkedin_url: linkedinUrl },
        {
          headers: {
            'X-Access-Token': this.skrappKey,
            'Content-Type': 'application/json',
          },
          timeout: 10000,
        }
      );

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
}

export default new ContactEnricher();
