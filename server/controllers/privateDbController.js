import multer from 'multer';
import axios from 'axios';
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

// ── RChilli: parse a resume buffer ─────────────────────────────────────────
const parseResumeBuffer = async (buffer, originalName) => {
  const endpoint = (
    process.env.RCHILLI_ENDPOINT ||
    'https://rest.rchilli.com/RChilliParser/Rchilli/parseResumeBinary'
  ).trim();
  const userKey = (process.env.RCHILLI_USER_KEY || '').trim();
  const version = (process.env.RCHILLI_VERSION || '8.0.0').trim();

  const payload = {
    filedata: buffer.toString('base64'),
    filename: originalName,
    userkey: userKey,
    version,
    subuserid: '',
  };

  const response = await axios.post(endpoint, payload, {
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    timeout: 120000,
  });

  return response.data;
};

// ── Extract key fields from RChilli response ───────────────────────────────
const pickFirst = (obj, keys) => {
  for (const key of keys) {
    const parts = key.split('.');
    let val = obj;
    for (const p of parts) {
      if (val == null) break;
      // handle array access like "Experience.0.JobTitle"
      val = Array.isArray(val) ? val[Number(p)] : val[p];
    }
    if (val !== undefined && val !== null && val !== '') return val;
  }
  return undefined;
};

const extractCandidateFields = (raw) => {
  const root = raw?.ResumeParserData || raw?.resumeParserData || raw?.Data || raw?.data || raw || {};

  const emailList = root.Email || root.EmailAddresses || [];
  const firstEmail = Array.isArray(emailList)
    ? (emailList[0]?.EmailAddress || emailList[0]?.Email || emailList[0] || '')
    : (typeof emailList === 'string' ? emailList : '');

  const phoneList = root.PhoneNumber || root.PhoneNumbers || [];
  const firstPhone = Array.isArray(phoneList)
    ? (phoneList[0]?.Number || phoneList[0]?.PhoneNumber || phoneList[0] || '')
    : (typeof phoneList === 'string' ? phoneList : '');

  const websites = root.WebSite || root.Websites || root.SocialProfiles || [];
  const linkedin = Array.isArray(websites)
    ? (websites.find((w) => /linkedin\.com/i.test(w?.Url || w?.URL || w?.Link || ''))?.Url ||
       websites.find((w) => /linkedin\.com/i.test(w?.Url || w?.URL || w?.Link || ''))?.URL ||
       '')
    : '';

  const locality =
    pickFirst(root, ['Location.0.City', 'Address.0.City', 'Address.City', 'City']) || '';
  const country =
    pickFirst(root, ['Location.0.Country', 'Address.0.Country', 'ResumeCountry.Country', 'Country']) || '';
  const location =
    pickFirst(root, ['Location.0.FormattedLocation', 'Location.0.Location', 'Address.0.FormattedAddress']) ||
    [locality, country].filter(Boolean).join(', ');

  const jobTitle =
    pickFirst(root, [
      'Experience.0.JobProfile.Title',
      'SegregatedExperience.0.JobProfile.Title',
      'Experience.0.JobTitle',
      'WorkHistory.0.JobTitle',
    ]) || '';

  const company =
    pickFirst(root, [
      'Experience.0.JobProfile.CompanyName',
      'SegregatedExperience.0.Employer.EmployerName',
      'Experience.0.CompanyName',
    ]) || '';

  const rawSkills = root.SkillKeywords || root.Skills || root.SkillSet || '';
  const skills = Array.isArray(rawSkills)
    ? rawSkills.map((s) => (typeof s === 'string' ? s : s?.Skill || s?.SkillName || '')).filter(Boolean).join(', ')
    : String(rawSkills || '');

  const expYears =
    pickFirst(root, ['WorkedPeriod.TotalExperienceInYear', 'TotalExperienceInYear']) || '';
  const experience = expYears ? `${String(expYears).replace(/[^\d.]/g, '')} Years` : '';

  const fullName =
    pickFirst(root, ['Name.FullName', 'Name.FormattedName', 'CandidateName', 'FullName']) || '';

  const summary = String(
    pickFirst(root, ['Summary', 'ProfessionalSummary', 'ExecutiveSummary']) || ''
  ).slice(0, 5000);

  const industry =
    pickFirst(root, ['Category', 'Industry', 'CurrentIndustry']) || '';

  return { fullName, email: firstEmail, phone: firstPhone, linkedinUrl: linkedin, location, locality, country, jobTitle, company, skills, experience, summary, industry };
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

    // Soft-delete all candidates in this DB
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

    const { buffer, originalname, mimetype } = req.file;

    // Parse with RChilli
    let parsedFields = {};
    let parseStatus = 'PARTIAL';
    let rawParsed = null;

    try {
      const rchilliResponse = await parseResumeBuffer(buffer, originalname);
      rawParsed = rchilliResponse;
      parsedFields = extractCandidateFields(rchilliResponse);
      parseStatus = parsedFields.fullName ? 'PARSED' : 'PARTIAL';
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

    // Increment count on the private DB
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
