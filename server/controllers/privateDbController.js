import multer from 'multer';
import PrivateDatabase from '../models/PrivateDatabase.js';
import Candidate from '../models/Candidate.js';
import logger from '../utils/logger.js';

// ── Multer: in-memory storage, 20 MB limit ─────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
    ];
    if (allowed.includes(file.mimetype) || file.originalname.match(/\.(pdf|doc|docx|txt)$/i)) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF, DOC, DOCX, and TXT files are allowed'));
    }
  },
});

export const uploadResumeMiddleware = upload.single('resume');

// ── Path resolver: handles dot-notation with array indices ─────────────────
const getValueAtPath = (obj, pathStr) => {
  if (!obj || !pathStr) return undefined;
  const parts = String(pathStr).split('.');
  let cur = obj;
  for (const part of parts) {
    if (cur === null || cur === undefined) return undefined;
    if (/^\d+$/.test(part)) {
      const idx = Number(part);
      cur = Array.isArray(cur) ? cur[idx] : undefined;
    } else {
      cur = cur[part];
    }
  }
  return cur;
};

const pickFirstValue = (obj, paths = []) => {
  for (const p of paths) {
    const v = getValueAtPath(obj, p);
    if (v !== undefined && v !== null && String(v).trim() !== '') return v;
  }
  return '';
};

const toStringArray = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  return [value];
};

const normalizeSkills = (skills) => {
  const list = Array.isArray(skills)
    ? skills
    : String(skills || '').split(/[;,]/g).map((s) => s.trim());
  const unique = [];
  const seen = new Set();
  for (const skill of list) {
    if (!skill) continue;
    const key = skill.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(skill);
  }
  return unique.join(', ');
};

// ── Extract fields from RChilli response (mirrors queue.js extractRChilliStructuredData) ──
const extractRChilliFields = (payload) => {
  const root = payload || {};
  const data = pickFirstValue(root, ['ResumeParserData', 'resumeParserData', 'Data', 'data']) || root;

  const emailList = toStringArray(pickFirstValue(data, ['Email', 'EmailAddresses', 'Contact.Email']));
  const firstEmail = emailList
    .map((e) => (typeof e === 'string' ? e : (e?.EmailAddress || e?.Email || '')))
    .find(Boolean) || '';

  const phoneList = toStringArray(pickFirstValue(data, ['PhoneNumber', 'PhoneNumbers', 'Contact.Phone']));
  const firstPhone = phoneList
    .map((p) => (typeof p === 'string' ? p : (p?.Number || p?.PhoneNumber || '')))
    .find(Boolean) || '';

  const websiteList = toStringArray(pickFirstValue(data, ['WebSite', 'Websites', 'SocialProfiles']));
  const linkedin = websiteList
    .map((w) => (typeof w === 'string' ? w : (w?.Url || w?.URL || w?.Link || '')))
    .find((url) => /linkedin\.com/i.test(String(url))) || '';

  const locality = pickFirstValue(data, [
    'Location.0.City', 'Address.0.City', 'Address.City', 'PersonalInformation.City', 'City',
  ]);
  const country = pickFirstValue(data, [
    'Location.0.Country', 'Address.0.Country', 'Address.Country',
    'ResumeCountry.Country', 'PersonalInformation.Country', 'Country',
  ]);
  const locationValue = pickFirstValue(data, [
    'Location.0.FormattedLocation', 'Location.0.Location',
    'Address.0.FormattedAddress', 'Address.CompleteAddress',
  ]);
  const location = (typeof locationValue === 'string' ? locationValue : '').trim()
    || [locality, country].filter(Boolean).join(', ');

  const jobTitle = pickFirstValue(data, [
    'Experience.0.JobProfile.Title',
    'SegregatedExperience.0.JobProfile.Title',
    'Experience.0.JobTitle',
    'WorkHistory.0.JobProfile.Title',
    'WorkHistory.0.JobTitle',
    'JobProfile',
  ]);

  const company = pickFirstValue(data, [
    'Experience.0.JobProfile.CompanyName',
    'SegregatedExperience.0.Employer.EmployerName',
    'Experience.0.CompanyName',
    'WorkHistory.0.JobProfile.CompanyName',
    'WorkHistory.0.CompanyName',
    'CurrentEmployer',
  ]);

  const rawSkills = pickFirstValue(data, ['SkillKeywords', 'Skills', 'SkillSet', 'TechnicalSkills']) || '';
  const normalizedSkillInput = Array.isArray(rawSkills)
    ? rawSkills.map((s) => (typeof s === 'string' ? s : (s?.Skill || s?.SkillName || s?.Name || '')))
    : rawSkills;
  const skills = normalizeSkills(normalizedSkillInput);

  const totalExpYears = pickFirstValue(data, [
    'WorkedPeriod.TotalExperienceInYear', 'TotalExperienceInYear',
    'TotalExperience.Years', 'Summary.TotalExperienceInYears',
  ]);
  const experience = totalExpYears
    ? `${String(totalExpYears).replace(/[^\d.]/g, '')} Years`
    : '';

  const fullName = pickFirstValue(data, [
    'Name.FullName', 'Name.FormattedName', 'CandidateName', 'FullName',
  ]);

  const summary = String(
    pickFirstValue(data, ['Summary', 'ProfessionalSummary', 'ExecutiveSummary']) || ''
  ).slice(0, 5000);

  const industry = pickFirstValue(data, [
    'Category', 'Industry', 'CurrentIndustry', 'Experience.0.JobProfile.Industry',
  ]);

  return {
    fullName: fullName || '',
    email: firstEmail,
    phone: firstPhone,
    linkedinUrl: linkedin,
    location: location || '',
    locality: locality || '',
    country: country || '',
    jobTitle: jobTitle || '',
    company: company || '',
    skills,
    experience,
    summary,
    industry: industry || '',
  };
};

// ── RChilli: parse a resume buffer (mirrors queue.js parseResumeWithRChilli) ─
const rchilliRequestTimeoutMs = Math.max(15000, Number(process.env.RCHILLI_REQUEST_TIMEOUT_MS || 120000));

const fetchWithTimeout = async (url, options = {}, timeoutMs = rchilliRequestTimeoutMs) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error(`RCHILLI_TIMEOUT: request exceeded ${timeoutMs}ms`);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
};

const parseResumeBuffer = async (buffer, originalName) => {
  const endpoint = (
    process.env.RCHILLI_ENDPOINT ||
    'https://rest.rchilli.com/RChilliParser/Rchilli/parseResumeBinary'
  ).trim();
  const userKey = (process.env.RCHILLI_USER_KEY || '').trim();
  const version = (process.env.RCHILLI_VERSION || '8.0.0').trim();
  const subUserId = (process.env.RCHILLI_SUB_USER_ID || process.env.RCHILLI_SUB_USERID || '').trim();

  if (!userKey) throw new Error('RCHILLI_CONFIG_MISSING: RCHILLI_USER_KEY is not configured');

  const commonFields = {
    userkey: userKey,
    version,
    ...(subUserId ? { subuserid: subUserId } : {}),
  };

  // Try multipart first, then JSON base64 fallback
  const strategies = ['multipart', 'json'];

  for (const strategy of strategies) {
    try {
      let response;
      if (strategy === 'multipart') {
        const form = new FormData();
        form.append('file', new Blob([buffer]), originalName);
        form.append('filename', originalName);
        form.append('userkey', commonFields.userkey);
        form.append('version', commonFields.version);
        if (subUserId) {
          form.append('subuserid', subUserId);
          form.append('subUserId', subUserId);
        }
        response = await fetchWithTimeout(endpoint, {
          method: 'POST',
          headers: { Accept: 'application/json' },
          body: form,
        });
      } else {
        const payload = { ...commonFields, filename: originalName, filedata: buffer.toString('base64') };
        response = await fetchWithTimeout(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(payload),
        });
      }

      const rawBody = await response.text();
      let responseJson = null;
      try { responseJson = rawBody ? JSON.parse(rawBody) : null; } catch { responseJson = null; }

      if (!response.ok) {
        throw new Error(`RCHILLI_API_ERROR: ${response.status} - ${String(rawBody || '').slice(0, 500)}`);
      }

      if (!responseJson || typeof responseJson !== 'object') {
        throw new Error(`RCHILLI_INVALID_RESPONSE: non-JSON response (${strategy})`);
      }

      // Check for RChilli error flags in response body
      const statusText = String(pickFirstValue(responseJson, [
        'status', 'Status', 'StatusCode', 'Code', 'code',
        'ResumeParserData.Status', 'ResumeParserData.StatusCode',
      ])).toLowerCase();
      const hasErrorFlag = Boolean(pickFirstValue(responseJson, ['isError', 'error', 'HasError', 'hasError']));
      const rchilliErrorCode = pickFirstValue(responseJson, [
        'error.errorcode', 'error.ErrorCode', 'error.code',
        'ResumeParserData.ErrorCode', 'ErrorCode',
      ]);
      const isNumericErrorCode = rchilliErrorCode && !isNaN(Number(rchilliErrorCode)) && Number(rchilliErrorCode) > 0;

      if (hasErrorFlag || isNumericErrorCode || statusText === 'error' || statusText === 'failed') {
        const msg = pickFirstValue(responseJson, [
          'error.errormessage', 'error.ErrorMessage', 'error.message',
          'Message', 'message', 'ErrorMessage', 'ResumeParserData.ErrorMessage',
        ]) || 'RChilli parsing failed';
        throw new Error(`RCHILLI_PARSE_FAILED: ${msg}`);
      }

      return responseJson;
    } catch (err) {
      // On network/timeout errors, don't try next strategy
      if (err.message.includes('RCHILLI_TIMEOUT') || err.message.includes('RCHILLI_CONFIG_MISSING')) throw err;
      // On server errors (5xx), don't try next strategy
      if (/RCHILLI_API_ERROR:\s*5\d\d/.test(err.message)) throw err;
      // On parse failed (auth/key errors), throw immediately
      if (err.message.includes('RCHILLI_PARSE_FAILED')) throw err;
      // Otherwise try next strategy
      if (strategy === 'json') throw err; // last strategy, give up
      logger.warn(`[PrivateDB] RChilli ${strategy} strategy failed, trying json: ${err.message}`);
    }
  }

  throw new Error('RCHILLI_PARSE_FAILED: all strategies exhausted');
};

// ────────────────────────────────────────────────────────────────────────────
// CRUD: Databases
// ────────────────────────────────────────────────────────────────────────────

export const createDatabase = async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ message: 'Database name is required' });
    if (name.trim().length > 25) return res.status(400).json({ message: 'Name must be 25 characters or fewer' });

    const db = await PrivateDatabase.create({ name: name.trim(), owner: req.user._id });
    res.status(201).json(db);
  } catch (err) {
    logger.error('[PrivateDB] createDatabase:', err.message);
    res.status(500).json({ message: 'Failed to create database' });
  }
};

export const listDatabases = async (req, res) => {
  try {
    const dbs = await PrivateDatabase.find({ owner: req.user._id, isDeleted: false }).sort({ createdAt: -1 });
    res.json(dbs);
  } catch (err) {
    logger.error('[PrivateDB] listDatabases:', err.message);
    res.status(500).json({ message: 'Failed to list databases' });
  }
};

export const deleteDatabase = async (req, res) => {
  try {
    const db = await PrivateDatabase.findOne({ _id: req.params.id, owner: req.user._id, isDeleted: false });
    if (!db) return res.status(404).json({ message: 'Database not found' });

    await Candidate.updateMany({ privateDbId: db._id }, { isDeleted: true });
    db.isDeleted = true;
    await db.save();

    res.json({ message: 'Database deleted' });
  } catch (err) {
    logger.error('[PrivateDB] deleteDatabase:', err.message);
    res.status(500).json({ message: 'Failed to delete database' });
  }
};

// ────────────────────────────────────────────────────────────────────────────
// Upload & parse a single resume into a private database
// ────────────────────────────────────────────────────────────────────────────
export const uploadResume = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });

    const db = await PrivateDatabase.findOne({ _id: req.params.id, owner: req.user._id, isDeleted: false });
    if (!db) return res.status(404).json({ message: 'Database not found' });

    const { buffer, originalname } = req.file;

    let parsedFields = {};
    let parseStatus = 'PARTIAL';
    let rawParsed = null;

    try {
      const rchilliResponse = await parseResumeBuffer(buffer, originalname);
      rawParsed = rchilliResponse;
      parsedFields = extractRChilliFields(rchilliResponse);
      parseStatus = parsedFields.fullName ? 'PARSED' : 'PARTIAL';
      logger.info(`[PrivateDB] Parsed resume: ${parsedFields.fullName || 'Unknown'} (${parseStatus})`);
    } catch (parseErr) {
      logger.warn('[PrivateDB] RChilli parse failed:', parseErr.message);
      parseStatus = 'FAILED';
    }

    const candidate = await Candidate.create({
      ...parsedFields,
      source: 'UPLOAD',
      parseStatus,
      privateDbId: db._id,
      createdBy: req.user._id,
      sourceFile: originalname,
      parsedResume: rawParsed
        ? { version: 'resume-parser-v3-rchilli', provider: 'RCHILLI', processedAt: new Date().toISOString(), raw: rawParsed }
        : null,
    });

    await PrivateDatabase.findByIdAndUpdate(db._id, { $inc: { candidateCount: 1 } });

    res.status(201).json({
      message: 'Resume uploaded and parsed successfully',
      candidate: {
        _id: candidate._id,
        fullName: candidate.fullName,
        jobTitle: candidate.jobTitle,
        email: candidate.email,
        parseStatus: candidate.parseStatus,
      },
    });
  } catch (err) {
    logger.error('[PrivateDB] uploadResume:', err.message);
    res.status(500).json({ message: 'Failed to process resume' });
  }
};

// ────────────────────────────────────────────────────────────────────────────
// Search within a private database
// ────────────────────────────────────────────────────────────────────────────
export const searchPrivateDb = async (req, res) => {
  try {
    const db = await PrivateDatabase.findOne({ _id: req.params.id, owner: req.user._id, isDeleted: false });
    if (!db) return res.status(404).json({ message: 'Database not found' });

    const { q, page = 1, limit = 50 } = req.query;
    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.min(200, Number(limit) || 50);
    const skip = (pageNum - 1) * limitNum;

    const baseQuery = { privateDbId: db._id, isDeleted: false };

    if (q && q.trim()) {
      const safeQ = q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(safeQ, 'i');
      baseQuery.$or = [
        { fullName: regex },
        { jobTitle: regex },
        { skills: regex },
        { company: regex },
        { location: regex },
      ];
    }

    const [candidates, totalCount] = await Promise.all([
      Candidate.find(baseQuery)
        .select('fullName jobTitle company location email phone skills experience linkedinUrl parseStatus createdAt')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Candidate.countDocuments(baseQuery),
    ]);

    res.json({ candidates, totalCount, page: pageNum, limit: limitNum });
  } catch (err) {
    logger.error('[PrivateDB] searchPrivateDb:', err.message);
    res.status(500).json({ message: 'Search failed' });
  }
};

// Get candidates count for a database
export const getDatabaseStats = async (req, res) => {
  try {
    const db = await PrivateDatabase.findOne({ _id: req.params.id, owner: req.user._id, isDeleted: false });
    if (!db) return res.status(404).json({ message: 'Database not found' });

    const count = await Candidate.countDocuments({ privateDbId: db._id, isDeleted: false });
    res.json({ count, db });
  } catch (err) {
    logger.error('[PrivateDB] getDatabaseStats:', err.message);
    res.status(500).json({ message: 'Failed to get stats' });
  }
};
