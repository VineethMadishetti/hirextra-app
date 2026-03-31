/**
 * candidatePoolService.js
 *
 * Permanent local cache of LinkedIn profiles fetched from HarvestAPI.
 * - saveToPool()    — upsert raw Apify profiles after every successful fetch
 * - searchPool()    — query pool before calling Apify; returns normalised candidates
 */

import CandidatePool from '../models/CandidatePool.js';
import {
  normalizeLinkedInProfiles,
  deduplicateCandidates,
} from './candidateExtraction.js';
import logger from './logger.js';

/**
 * Persist an array of raw Apify profiles to the pool.
 * Uses upsert so existing records are refreshed with latest data.
 */
export async function saveToPool(rawProfiles) {
  if (!Array.isArray(rawProfiles) || rawProfiles.length === 0) return 0;

  let saved = 0;
  const ops = rawProfiles
    .filter(p => p.linkedinUrl && p.linkedinUrl.includes('linkedin.com/in/'))
    .map(p => {
      const normalized = normalizeLinkedInProfiles([p]);
      const c = normalized[0];
      if (!c) return null;

      return {
        updateOne: {
          filter: { linkedinUrl: c.linkedInUrl?.toLowerCase() },
          update: {
            $set: {
              publicIdentifier: p.publicIdentifier || null,
              name:              c.name || null,
              jobTitle:          c.jobTitle || null,
              company:           c.company || null,
              location:          c.location || null,
              headline:          c.headline || null,
              about:             c.about || null,
              skills:            Array.isArray(c.skills) ? c.skills : [],
              education:         c.education || null,
              educationGrade:    c.educationGrade || null,
              educationYear:     c.educationYear || null,
              totalExperience:   c.totalExperience || null,
              experienceYears:   c.experienceYears || null,
              experienceTimeline:Array.isArray(c.experienceTimeline) ? c.experienceTimeline : [],
              certifications:    Array.isArray(c.certifications) ? c.certifications : [],
              profilePic:        c.profilePic || null,
              connectionsCount:  c.connectionsCount ?? null,
              followerCount:     c.followerCount ?? null,
              premium:           c.premium === true,
              verified:          c.verified === true,
              openToWork:        c.openToWork === true,
              rawProfile:        p,
              fetchedAt:         new Date(),
            },
          },
          upsert: true,
        },
      };
    })
    .filter(Boolean);

  if (ops.length === 0) return 0;

  try {
    const result = await CandidatePool.bulkWrite(ops, { ordered: false });
    saved = (result.upsertedCount || 0) + (result.modifiedCount || 0);
    logger.info(`[CandidatePool] Saved/updated ${saved} profiles (${result.upsertedCount} new, ${result.modifiedCount} refreshed)`);
  } catch (err) {
    logger.warn(`[CandidatePool] bulkWrite error: ${err.message}`);
  }

  return saved;
}

/**
 * Search the local pool for candidates matching the parsed requirements.
 *
 * Matching logic:
 *   1. Job title: at least one title variant appears in jobTitle or headline (case-insensitive)
 *   2. Skills: at least one must-have or required skill appears in skills array
 *   3. Location (optional): city name appears in candidate location
 *
 * Returns an array of raw-profile-shaped objects ready to pass to
 * normalizeLinkedInProfiles() — or an empty array if pool has no matches.
 */
export async function searchPool(parsed, titleVariants) {
  try {
    const mustHave  = Array.isArray(parsed.must_have_skills)  ? parsed.must_have_skills  : [];
    const required  = Array.isArray(parsed.required_skills)   ? parsed.required_skills   : [];
    const allSkills = [...new Set([...mustHave, ...required])];
    const location  = String(parsed.location || '').trim();

    if (titleVariants.length === 0 && allSkills.length === 0) return [];

    // Build title regex conditions
    const titleConditions = titleVariants
      .filter(Boolean)
      .map(t => {
        const safe = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return {
          $or: [
            { jobTitle: { $regex: safe, $options: 'i' } },
            { headline: { $regex: safe, $options: 'i' } },
          ],
        };
      });

    // Skills condition — any overlap
    const skillConditions = allSkills
      .filter(Boolean)
      .map(s => ({
        skills: { $elemMatch: { $regex: s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } },
      }));

    // Must match title OR skills
    const matchClause = [];
    if (titleConditions.length) matchClause.push(...titleConditions);
    if (skillConditions.length) matchClause.push(...skillConditions);
    if (matchClause.length === 0) return [];

    const query = { $or: matchClause };

    // Optional location filter — match just the city/first segment
    if (location && !/unspecified|not specified|remote/i.test(location)) {
      const city = location.split(/[,/]/)[0].trim();
      if (city.length >= 3) {
        query.location = { $regex: city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
      }
    }

    const docs = await CandidatePool
      .find(query)
      .sort({ fetchedAt: -1 })
      .lean();

    if (docs.length === 0) return [];

    logger.info(`[CandidatePool] Pool hit — ${docs.length} cached profiles matched`);

    // Return raw profiles so they pass through normalizeLinkedInProfiles identically
    return docs
      .filter(d => d.rawProfile)
      .map(d => d.rawProfile);

  } catch (err) {
    logger.warn(`[CandidatePool] searchPool error: ${err.message}`);
    return [];
  }
}
