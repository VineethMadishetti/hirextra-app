/**
 * githubService.js
 *
 * Free GitHub REST API wrapper for candidate skill verification.
 * No API key required for public data (60 req/hour unauthenticated).
 * Set GITHUB_TOKEN in .env for 5000 req/hour.
 */

import axios from 'axios';
import logger from './logger.js';

class GitHubService {
  constructor() {
    this.base = 'https://api.github.com';
    this.headers = {
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'Hirextra-Sourcing-App',
    };
  }

  _getHeaders() {
    const token = String(process.env.GITHUB_TOKEN || '').trim();
    if (token) return { ...this.headers, Authorization: `token ${token}` };
    return this.headers;
  }

  _extractUsername(githubUrl) {
    if (!githubUrl) return null;
    const match = String(githubUrl).match(/github\.com\/([A-Za-z0-9_-]{1,39})/);
    return match ? match[1] : null;
  }

  /**
   * Fetch public stats for a GitHub user.
   * Returns null if user not found or rate-limited.
   */
  async getStats(githubUrl) {
    const username = this._extractUsername(githubUrl);
    if (!username) return null;

    try {
      const [userResp, reposResp] = await Promise.all([
        axios.get(`${this.base}/users/${username}`, {
          headers: this._getHeaders(),
          timeout: 5000,
        }),
        axios.get(`${this.base}/users/${username}/repos?sort=updated&per_page=10`, {
          headers: this._getHeaders(),
          timeout: 5000,
        }),
      ]);

      const user = userResp.data;
      const repos = Array.isArray(reposResp.data) ? reposResp.data : [];

      // Count languages across top repos
      const langCount = {};
      for (const repo of repos) {
        if (repo.language && !repo.fork) {
          langCount[repo.language] = (langCount[repo.language] || 0) + 1;
        }
      }
      const topLanguages = Object.entries(langCount)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([lang]) => lang);

      return {
        username,
        publicRepos: user.public_repos || 0,
        followers: user.followers || 0,
        bio: user.bio || null,
        topLanguages,
        accountCreatedYear: user.created_at
          ? new Date(user.created_at).getFullYear()
          : null,
      };
    } catch (err) {
      if (err.response?.status === 404) {
        logger.debug(`[GitHub] User not found: ${username}`);
      } else if (err.response?.status === 403) {
        logger.warn('[GitHub] Rate limit reached — add GITHUB_TOKEN to .env for higher limits');
      } else {
        logger.error(`[GitHub] API error for ${username}: ${err.message}`);
      }
      return null;
    }
  }

  /**
   * Enrich up to topN candidates that have githubUrl populated.
   * Adds githubStats: { username, publicRepos, followers, bio, topLanguages, accountCreatedYear }
   */
  async enrichCandidates(candidates, topN = 10) {
    const toEnrich = candidates.filter((c) => c.githubUrl).slice(0, topN);
    if (toEnrich.length === 0) return candidates;

    logger.info(`[GitHub] Fetching stats for ${toEnrich.length} candidates`);

    const statsMap = new Map();
    for (const c of toEnrich) {
      const stats = await this.getStats(c.githubUrl);
      if (stats) statsMap.set(c.githubUrl, stats);
      // Gentle delay to stay within unauthenticated rate limits
      await new Promise((r) => setTimeout(r, 250));
    }

    logger.info(`[GitHub] Stats fetched for ${statsMap.size}/${toEnrich.length} candidates`);

    return candidates.map((c) => {
      if (c.githubUrl && statsMap.has(c.githubUrl)) {
        return { ...c, githubStats: statsMap.get(c.githubUrl) };
      }
      return c;
    });
  }
}

export default new GitHubService();
