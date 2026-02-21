const ENRICH_REQUIRED_FIELDS = [
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
  { key: "linkedinUrl", label: "LinkedIn" },
  { key: "jobTitle", label: "Job Title" },
  { key: "company", label: "Current Company" },
  { key: "location", label: "Location" },
  { key: "skills", label: "Skills" },
];

const ENRICH_ALLOWED_UPDATE_FIELDS = new Set([
  "fullName",
  "jobTitle",
  "skills",
  "experience",
  "country",
  "locality",
  "location",
  "email",
  "phone",
  "company",
  "industry",
  "linkedinUrl",
  "githubUrl",
  "summary",
  "availability",
  "candidateStatus",
  "internalTags",
  "recruiterNotes",
]);

const hasValue = (value) => {
  if (value === undefined || value === null) return false;
  return String(value).trim() !== "";
};

const cleanInline = (value) =>
  String(value || "")
    .replace(/\s+/g, " ")
    .trim();

const dedupeCsv = (value) => {
  const items = String(value || "")
    .split(/[;,]/g)
    .map((s) => s.trim())
    .filter(Boolean);
  const unique = [];
  const seen = new Set();
  for (const item of items) {
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  return unique.join(", ");
};

const toTitleCase = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/\b[a-z]/g, (m) => m.toUpperCase())
    .trim();

const candidateToPlainObject = (candidate) => {
  if (!candidate) return {};
  if (typeof candidate.toObject === "function") return candidate.toObject();
  return candidate;
};

const buildSuggestion = ({ field, currentValue, suggestedValue, confidence, source, reason }) => ({
  field,
  currentValue: cleanInline(currentValue),
  suggestedValue: cleanInline(suggestedValue),
  confidence: Math.max(0, Math.min(100, Number(confidence) || 0)),
  source: cleanInline(source) || "heuristic",
  reason: cleanInline(reason),
});

export const computeCandidateEnrichmentMeta = (candidateInput) => {
  const candidate = candidateToPlainObject(candidateInput);
  const missingFields = [];

  for (const fieldDef of ENRICH_REQUIRED_FIELDS) {
    if (!hasValue(candidate[fieldDef.key])) {
      missingFields.push(fieldDef.label);
    }
  }

  const completedCount = ENRICH_REQUIRED_FIELDS.length - missingFields.length;
  const completenessScore = Math.round((completedCount / ENRICH_REQUIRED_FIELDS.length) * 100);
  const updatedAtTs = new Date(candidate.updatedAt || candidate.createdAt || Date.now()).getTime();
  const staleDays = Math.max(0, Math.floor((Date.now() - updatedAtTs) / (1000 * 60 * 60 * 24)));
  const needsEnrichment = missingFields.length > 0 || staleDays >= 90;

  return {
    completenessScore,
    missingFields,
    staleDays,
    needsEnrichment,
  };
};

const toRchilliArray = (value) => (Array.isArray(value) ? value : value ? [value] : []);

const pullRawValueFromRchilli = (candidateInput) => {
  const candidate = candidateToPlainObject(candidateInput);
  return candidate?.parsedResume?.raw?.ResumeParserData || {};
};

const callExternalEnrichmentProvider = async (candidateInput) => {
  const endpoint = cleanInline(process.env.ENRICHMENT_API_URL);
  if (!endpoint) return null;

  const candidate = candidateToPlainObject(candidateInput);
  const apiKey = cleanInline(process.env.ENRICHMENT_API_KEY);
  const providerName = cleanInline(process.env.ENRICHMENT_PROVIDER_NAME) || "external";
  const timeoutMs = Math.max(3000, Number(process.env.ENRICHMENT_API_TIMEOUT_MS || 9000));

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        candidate: {
          id: String(candidate._id || ""),
          fullName: cleanInline(candidate.fullName),
          email: cleanInline(candidate.email),
          phone: cleanInline(candidate.phone),
          linkedinUrl: cleanInline(candidate.linkedinUrl),
          jobTitle: cleanInline(candidate.jobTitle),
          company: cleanInline(candidate.company),
          location: cleanInline(candidate.location),
          locality: cleanInline(candidate.locality),
          country: cleanInline(candidate.country),
          skills: cleanInline(candidate.skills),
          summary: cleanInline(candidate.summary),
        },
      }),
      signal: controller.signal,
    });

    const body = await response.text();
    if (!response.ok) return null;

    let json = null;
    try {
      json = body ? JSON.parse(body) : null;
    } catch {
      json = null;
    }
    if (!json || typeof json !== "object") return null;

    const updates = json.updates && typeof json.updates === "object" ? json.updates : {};
    const confidenceMap =
      json.confidence && typeof json.confidence === "object" ? json.confidence : {};

    const suggestions = Object.entries(updates)
      .filter(([field, suggestedValue]) => ENRICH_ALLOWED_UPDATE_FIELDS.has(field) && hasValue(suggestedValue))
      .map(([field, suggestedValue]) =>
        buildSuggestion({
          field,
          currentValue: candidate[field],
          suggestedValue,
          confidence: confidenceMap[field] ?? 72,
          source: cleanInline(json.source) || providerName,
          reason: cleanInline(json.reason || "Enriched via configured provider"),
        })
      )
      .filter((item) => item.currentValue.toLowerCase() !== item.suggestedValue.toLowerCase());

    return {
      provider: cleanInline(json.provider) || providerName,
      suggestions,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
};

const buildHeuristicSuggestions = (candidateInput) => {
  const candidate = candidateToPlainObject(candidateInput);
  const parserData = pullRawValueFromRchilli(candidate);
  const suggestions = [];

  const normalizedSkills = dedupeCsv(candidate.skills);
  if (hasValue(normalizedSkills) && normalizedSkills !== cleanInline(candidate.skills)) {
    suggestions.push(
      buildSuggestion({
        field: "skills",
        currentValue: candidate.skills,
        suggestedValue: normalizedSkills,
        confidence: 78,
        source: "heuristic",
        reason: "Normalized duplicate skills and separators",
      })
    );
  }

  const normalizedTitle = toTitleCase(candidate.jobTitle);
  if (hasValue(normalizedTitle) && normalizedTitle !== cleanInline(candidate.jobTitle)) {
    suggestions.push(
      buildSuggestion({
        field: "jobTitle",
        currentValue: candidate.jobTitle,
        suggestedValue: normalizedTitle,
        confidence: 70,
        source: "heuristic",
        reason: "Standardized job title casing",
      })
    );
  }

  if (!hasValue(candidate.location)) {
    const derivedLocation = [candidate.locality, candidate.country].filter(hasValue).join(", ");
    if (hasValue(derivedLocation)) {
      suggestions.push(
        buildSuggestion({
          field: "location",
          currentValue: candidate.location,
          suggestedValue: derivedLocation,
          confidence: 74,
          source: "heuristic",
          reason: "Composed from locality and country",
        })
      );
    }
  }

  if (!hasValue(candidate.summary) && hasValue(parserData?.Summary)) {
    suggestions.push(
      buildSuggestion({
        field: "summary",
        currentValue: candidate.summary,
        suggestedValue: String(parserData.Summary).slice(0, 1200),
        confidence: 76,
        source: "rchilli",
        reason: "Added parser summary",
      })
    );
  }

  if (!hasValue(candidate.linkedinUrl)) {
    const linkedInFromWeb = toRchilliArray(parserData?.WebSite)
      .map((w) => cleanInline(w?.Url || w?.URL))
      .find((url) => /linkedin\.com/i.test(url));
    if (hasValue(linkedInFromWeb)) {
      suggestions.push(
        buildSuggestion({
          field: "linkedinUrl",
          currentValue: candidate.linkedinUrl,
          suggestedValue: linkedInFromWeb,
          confidence: 88,
          source: "rchilli",
          reason: "Recovered LinkedIn from parsed websites",
        })
      );
    }
  }

  if (!hasValue(candidate.email)) {
    const parsedEmail = toRchilliArray(parserData?.Email)
      .map((e) => cleanInline(e?.EmailAddress || e?.Email))
      .find(Boolean);
    if (hasValue(parsedEmail)) {
      suggestions.push(
        buildSuggestion({
          field: "email",
          currentValue: candidate.email,
          suggestedValue: parsedEmail,
          confidence: 90,
          source: "rchilli",
          reason: "Recovered email from parser output",
        })
      );
    }
  }

  if (!hasValue(candidate.phone)) {
    const parsedPhone = toRchilliArray(parserData?.PhoneNumber)
      .map((p) => cleanInline(p?.FormattedNumber || p?.Number))
      .find(Boolean);
    if (hasValue(parsedPhone)) {
      suggestions.push(
        buildSuggestion({
          field: "phone",
          currentValue: candidate.phone,
          suggestedValue: parsedPhone,
          confidence: 86,
          source: "rchilli",
          reason: "Recovered phone from parser output",
        })
      );
    }
  }

  if (!hasValue(candidate.company) && hasValue(parserData?.CurrentEmployer)) {
    suggestions.push(
      buildSuggestion({
        field: "company",
        currentValue: candidate.company,
        suggestedValue: parserData.CurrentEmployer,
        confidence: 80,
        source: "rchilli",
        reason: "Current employer from parser profile",
      })
    );
  }

  const dedupByField = new Map();
  for (const item of suggestions) {
    if (!item.suggestedValue) continue;
    if (!dedupByField.has(item.field) || (dedupByField.get(item.field).confidence < item.confidence)) {
      dedupByField.set(item.field, item);
    }
  }
  return [...dedupByField.values()];
};

export const enrichCandidateProfile = async (candidateInput) => {
  const candidate = candidateToPlainObject(candidateInput);
  const metaBefore = computeCandidateEnrichmentMeta(candidate);
  const externalResult = await callExternalEnrichmentProvider(candidate);
  const provider = externalResult?.provider || "heuristic";
  const suggestions = externalResult?.suggestions?.length
    ? externalResult.suggestions
    : buildHeuristicSuggestions(candidate);

  return {
    provider,
    suggestions,
    metaBefore,
  };
};

export const sanitizeUpdateValue = (field, value) => {
  if (!ENRICH_ALLOWED_UPDATE_FIELDS.has(field)) return "";
  if (field === "skills") return dedupeCsv(value);
  if (field === "internalTags") return dedupeCsv(value);
  if (field === "summary") return String(value || "").trim();
  if (field === "recruiterNotes") return String(value || "").trim();
  if (field === "availability") return cleanInline(value).toUpperCase();
  if (field === "candidateStatus") return cleanInline(value).toUpperCase();
  return cleanInline(value);
};

export const getAllowedEnrichmentFields = () => [...ENRICH_ALLOWED_UPDATE_FIELDS];
