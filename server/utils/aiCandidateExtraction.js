/**
 * OpenAI-based candidate enrichment for AI Sourcing Agent.
 * Processes raw Serper search results in parallel batches to extract:
 * Full Name, Job Title, Company, Location, Education, Skills, Total Experience.
 */

import OpenAI from 'openai';
import logger from './logger.js';

let openai = null;

function getOpenAIClient() {
  if (!openai) {
    if (!process.env.OPENAI_API_KEY) return null;
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openai;
}

function normalizeUrl(url) {
  if (!url) return '';
  return url.split('?')[0].replace(/\/$/, '').toLowerCase();
}

/**
 * Process one batch of Serper results through OpenAI.
 * @param {OpenAI} client
 * @param {Array}  batch  — [{title, snippet, link}]
 * @returns {Array} structured candidate objects
 */
async function processBatch(client, batch) {
  const input = batch.map((r, i) => ({
    i,
    url: r.link || '',
    title: r.title || '',
    snippet: r.snippet || '',
  }));

  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: `You are an expert at extracting structured candidate information from LinkedIn Google search results.
LinkedIn snippets often follow this format: "Role, City · Experience: Company Name · Education: School · Location: City"
Always return valid JSON. Be precise — do not infer or guess fields not present in the text.`,
      },
      {
        role: 'user',
        content: `Extract structured candidate info from these ${batch.length} LinkedIn search results.

For EACH result return:
- url: copy the exact url from input (do not modify)
- name: full name (typically before " - " in the title, e.g. "Shravan Kumar")
- jobTitle: current job title / role (e.g. "Python Developer", "Senior Software Engineer")
- company: current company/employer name (from "Experience:" label or "at Company" pattern)
- location: city or region (e.g. "Hyderabad", "Bangalore, India"). If Location field is a pin code, use city from the role hint instead.
- education: degree + institution (e.g. "B.Tech, IIT Bombay", "CVR College of Engineering, Hyderabad", "MBA"). Prioritise "Education:" label.
- skills: array of up to 8 technical/professional skills found in title or snippet (e.g. ["Python", "Django", "AWS"])
- totalExperience: years of experience as string (e.g. "5+ years", "3 years") or null if not mentioned
- about: a 2-4 sentence professional summary paragraph written in third person. Use ALL information available in the snippet (name, role, company, experience years, skills, education, location). Expand abbreviated or cut-off text into complete sentences. Example: "Sairam Konda is a Software Developer with 6+ years of experience specialising in Java and Spring Boot. He has worked at Infosys and holds a B.Tech from JNTU Hyderabad."

Rules:
- For jobTitle: strip trailing city names (e.g. "Python developer, Hyderabad" → "Python developer")
- For company: do NOT include city names in company (e.g. "Arcus Infotech Hyderabad" → "Arcus Infotech")
- For about: never end with "…" — always write complete sentences. If information is limited, keep it short but complete.
- Return {"candidates": [...array of ${batch.length} objects in same order as input...]}
- Use null for any field that cannot be determined with confidence

Input:
${JSON.stringify(input)}`,
      },
    ],
    temperature: 0,
    max_tokens: 4000,
    response_format: { type: 'json_object' },
  });

  const raw = response.choices[0]?.message?.content || '{}';
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed.candidates) ? parsed.candidates : [];
}

/**
 * Enrich raw Serper search results with OpenAI-extracted structured fields.
 *
 * @param   {Array}      rawResults  — Serper results: [{link, title, snippet, ...}]
 * @returns {Map|null}   normalizedUrl → {name, jobTitle, company, location, education, skills, totalExperience}
 *                       Returns null when OPENAI_API_KEY is not configured.
 */
export async function aiEnrichCandidates(rawResults) {
  const client = getOpenAIClient();
  if (!client) {
    logger.info('OPENAI_API_KEY not set — skipping AI candidate enrichment (regex extraction only)');
    return null;
  }

  // Only process results that are LinkedIn profile pages
  const validResults = (rawResults || []).filter(
    (r) => r.link && r.link.includes('linkedin.com/in/')
  );

  if (validResults.length === 0) return null;
  logger.info(`AI enriching ${validResults.length} LinkedIn results in batches...`);

  const BATCH_SIZE = 8;
  const PARALLEL = 3;
  const batches = [];
  for (let i = 0; i < validResults.length; i += BATCH_SIZE) {
    batches.push(validResults.slice(i, i + BATCH_SIZE));
  }

  const enriched = [];

  for (let i = 0; i < batches.length; i += PARALLEL) {
    const group = batches.slice(i, i + PARALLEL);
    const settled = await Promise.allSettled(
      group.map((b) => processBatch(client, b))
    );
    for (const result of settled) {
      if (result.status === 'fulfilled' && Array.isArray(result.value)) {
        enriched.push(...result.value);
      } else if (result.status === 'rejected') {
        logger.warn(`AI enrichment batch failed: ${result.reason?.message}`);
      }
    }
  }

  logger.info(`AI enrichment complete: ${enriched.length} candidates processed`);

  // Build lookup map: normalizedUrl → enriched data
  const map = new Map();
  for (const item of enriched) {
    if (!item?.url) continue;
    const key = normalizeUrl(item.url);
    if (key) map.set(key, item);
  }

  return map.size > 0 ? map : null;
}
