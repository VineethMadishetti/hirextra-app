/**
 * OpenAI-based candidate enrichment for AI Sourcing Agent.
 * Processes raw Serper search results in batches to extract structured fields
 * and generate a recruiter-friendly professional summary for each candidate.
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
        content: `You are a senior technical recruiter assistant. Your job is to parse LinkedIn Google search snippets and extract clean, accurate structured candidate data. LinkedIn snippets follow formats like:
- "Role · Company · Location: City · Education: Degree, School · Experience: X years"
- "Name - Title at Company | LinkedIn"
Always return valid JSON. Extract only what is present — never fabricate data.`,
      },
      {
        role: 'user',
        content: `Parse these ${batch.length} LinkedIn search results and return structured candidate profiles.

For EACH result return ALL of:
- url: exact url from input, unchanged
- name: full name — usually before " - " or " | " in the title (e.g. "Rahul Sharma")
- jobTitle: current role/title, clean (e.g. "Senior Java Developer"). Strip trailing city names.
- company: current employer from "Experience:" label or "at Company" or "@ Company" pattern. Strip city names (e.g. "Infosys" not "Infosys Hyderabad").
- location: city and/or state/country (e.g. "Hyderabad, Telangana", "Bangalore"). Use "Location:" label if present. If only a pin code appears, use the city from context.
- education: highest degree + institution (e.g. "B.Tech, JNTU Hyderabad", "MBA, IIM Ahmedabad"). Prioritise "Education:" label in snippet.
- skills: JSON array of up to 10 specific technical/domain skills extracted from title and snippet (e.g. ["Java", "Spring Boot", "Microservices", "AWS", "Hibernate"]). Be specific — prefer technology names over generic terms.
- totalExperience: years of experience as string (e.g. "6+ years", "3 years", "10 years"). Look for patterns like "X years of experience", "X+ years". Return null if not found.
- about: Write a complete, professional 3-5 sentence recruiter-facing summary in third person. Rules:
    • Use every piece of data available: name, role, company, years of experience, skills, education, location
    • Write complete sentences — never end with "…" or trail off
    • Mention key technical skills naturally within the narrative
    • Example: "Rahul Sharma is a Senior Java Developer based in Hyderabad with 8+ years of experience building enterprise applications. He specialises in Spring Boot, Microservices, and AWS, and has worked at Infosys and TCS. Rahul holds a B.Tech from JNTU Hyderabad and is known for his expertise in distributed systems and RESTful APIs."
    • If limited data is available, write 2 complete sentences that cover what is known.

Return: {"candidates": [...exactly ${batch.length} objects in the same order as input...]}
Use null only for fields genuinely absent from the source text.

Input:
${JSON.stringify(input)}`,
      },
    ],
    temperature: 0,
    max_tokens: 5000,
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
 * @returns {Map|null}   normalizedUrl → enriched candidate data
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

  const BATCH_SIZE = 6;
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
