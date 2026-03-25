import axios from 'axios';
import logger from './logger.js';

/**
 * Contact Enrichment Service
 * Order: Apollo enrichment -> Skrapp fallback
 */

class ContactEnricher {
  constructor() {
    this.apolloKey = null;
    this.apolloEndpoint = 'https://api.apollo.io/api/v1/people/match';
    this.skrappKey = null;
    this.skrappEndpoint = 'https://api.skrapp.io/api/v2/find';
    this.skrappLegacyEndpoint = 'https://api.skrapp.io/api/v2/accounts/find';
  }

  _readEnvKey(...names) {
    for (const name of names) {
      const raw = process.env[name];
      if (typeof raw !== 'string') continue;
      const value = raw.trim();
      if (!value) continue;
      const lower = value.toLowerCase();
      if (['undefined', 'null', 'your-api-key', 'your_api_key', 'your-key-here'].includes(lower)) continue;
      return value;
    }
    return null;
  }

  _refreshApiKeys() {
    this.apolloKey = this._readEnvKey(
      'APOLLO_API_KEY', 'APOLLO_KEY', 'VITE_APOLLO_API_KEY'
    );
    this.skrappKey = this._readEnvKey(
      'SKRAPP_API_KEY', 'SKRAPP_KEY', 'SKRAPP_API_LEY', 'SKRAPP_API_TOKEN', 'VITE_SKRAPP_API_KEY'
    );
  }

  async enrichCandidate(candidate) {
    if (!candidate) throw new Error('Candidate object required');

    this._refreshApiKeys();

    const candidateId = candidate._id || candidate.id;
    const linkedinUrl = candidate.linkedinUrl || candidate.linkedInUrl || candidate.linkedin_url;
    const fullName = candidate.fullName || candidate.name;
    const company = candidate.company || candidate.company_name;

    if (!this.apolloKey && !this.skrappKey) {
      const errorMessage = 'Contact enrichment not configured. Add APOLLO_API_KEY or SKRAPP_API_KEY to server .env.';
      logger.error(errorMessage);
      return { email: null, phone: null, source: 'error', confidence: 0, error: errorMessage };
    }

    logger.info(`Contact lookup for candidate ${candidateId}`);

    try {
      if (this.apolloKey) {
        const apolloResult = await this._apolloLookup({ linkedinUrl, fullName, company });
        if (apolloResult && (apolloResult.email || apolloResult.phone)) {
          logger.info(`  Apollo found contact for ${candidateId}`);
          return { ...apolloResult, source: 'apollo', confidence: apolloResult.confidence || 0.9 };
        }
      }

      if (!this.skrappKey) {
        return {
          email: null,
          phone: null,
          source: 'failed',
          confidence: 0,
          error: 'No contact found from Apollo and SKRAPP_API_KEY is not configured for fallback.',
        };
      }

      const result = await this._skrappLookup({ linkedinUrl, fullName, company });
      if (result && result.email) {
        logger.info(`  Skrapp found contact for ${candidateId}`);
        return { ...result, source: 'skrapp', confidence: 0.85 };
      }

      logger.warn(`  No contact found for ${candidateId}`);
      return {
        email: null, phone: null, source: 'failed', confidence: 0,
        error: 'No contact found. Apollo and Skrapp both require a valid name plus company/domain or LinkedIn URL.',
      };
    } catch (error) {
      logger.error(`Enrichment error for ${candidateId}:`, error.message);
      return { email: null, phone: null, source: 'error', confidence: 0, error: error.message };
    }
  }

  async _apolloLookup({ linkedinUrl, fullName, company }) {
    if (!this.apolloKey) return null;

    const parsedName = this._splitName(fullName);
    const domain = this._extractDomain(company);

    try {
      const response = await axios.post(
        this.apolloEndpoint,
        null,
        {
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache',
            'X-Api-Key': this.apolloKey,
            accept: 'application/json',
          },
          params: {
            linkedin_url: this._isValidLinkedInUrl(linkedinUrl) ? linkedinUrl : undefined,
            name: fullName || undefined,
            first_name: parsedName.firstName || undefined,
            last_name: parsedName.lastName || undefined,
            domain: domain || undefined,
            reveal_personal_emails: true,
            reveal_phone_number: true,
          },
          timeout: 10000,
        }
      );

      const person = response?.data?.person || response?.data || null;
      if (!person) return null;

      const email =
        person.email ||
        person.personal_email ||
        person.email_address ||
        (Array.isArray(person.email_addresses) ? person.email_addresses.find(Boolean) : null) ||
        null;

      const phone =
        person.phone ||
        person.mobile_phone ||
        person.direct_dial ||
        (Array.isArray(person.phone_numbers)
          ? person.phone_numbers.find((entry) => entry?.sanitized_number || entry?.raw_number)?.sanitized_number ||
            person.phone_numbers.find((entry) => entry?.sanitized_number || entry?.raw_number)?.raw_number
          : null) ||
        null;

      if (!email && !phone) return null;

      return {
        email: email || null,
        phone: phone || null,
        linkedinUrl: linkedinUrl || person.linkedin_url || null,
        verifiedAt: new Date(),
        confidence: person.email_status === 'verified' ? 0.95 : 0.8,
      };
    } catch (error) {
      logger.warn(`Apollo enrichment error: ${error.response?.status || error.message}`);
      return null;
    }
  }

  async _skrappLookup({ linkedinUrl, fullName, company }) {
    if (!this.skrappKey) return null;

    const headers = {
      'X-Access-Key': this.skrappKey,
      'X-Access-Token': this.skrappKey,
      'Content-Type': 'application/json',
    };

    const parsedName = this._splitName(fullName);
    const companyDomain = this._extractDomain(company);

    try {
      const canUsePrimary = parsedName.firstName && parsedName.lastName && (company || companyDomain);
      if (canUsePrimary) {
        const response = await axios.get(this.skrappEndpoint, {
          headers,
          params: {
            firstName: parsedName.firstName,
            lastName: parsedName.lastName,
            company: company || undefined,
            domain: companyDomain || undefined,
          },
          timeout: 5000,
        });

        const email =
          response?.data?.email ||
          response?.data?.data?.email ||
          response?.data?.result?.email ||
          null;

        if (email) {
          return { email, phone: null, linkedinUrl: linkedinUrl || null, verifiedAt: new Date() };
        }
      }

      if (linkedinUrl && this._isValidLinkedInUrl(linkedinUrl)) {
        const legacyResponse = await axios.post(
          this.skrappLegacyEndpoint,
          { linkedin_url: linkedinUrl },
          { headers, timeout: 5000 }
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
            linkedinUrl,
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

  _isValidLinkedInUrl(url) {
    if (!url) return false;
    return url.includes('linkedin.com/in/') || url.includes('linkedin.com/company/');
  }

  _splitName(fullName) {
    const clean = String(fullName || '').replace(/\s+/g, ' ').trim();
    if (!clean) return { fullName: '', firstName: '', lastName: '' };
    const parts = clean.split(' ');
    return { fullName: clean, firstName: parts[0] || '', lastName: parts.length > 1 ? parts.slice(1).join(' ') : '' };
  }

  _extractDomain(companyValue) {
    const input = String(companyValue || '').trim().toLowerCase();
    if (!input) return '';
    const cleaned = input.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].trim();
    if (/^[a-z0-9.-]+\.[a-z]{2,}$/.test(cleaned)) return cleaned;
    return '';
  }
}

export default new ContactEnricher();
