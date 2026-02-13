import { Queue, Worker } from "bullmq";
import fs from "fs";
import path from "path";
import xlsx from "xlsx";
import csv from "csv-parser";
import mammoth from "mammoth";
import Candidate from "../models/Candidate.js";
import UploadJob from "../models/UploadJob.js";
import readline from "readline";
import logger from "./logger.js";
import { downloadFromS3, fileExistsInS3 } from "./s3Service.js";
import { cleanAndValidateCandidate } from "./dataCleaner.js";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const pdf = require("pdf-parse");

// Helper to convert a stream to a buffer
const streamToBuffer = (stream) =>
	new Promise((resolve, reject) => {
		const chunks = [];
		stream.on("data", (chunk) => chunks.push(chunk));
		stream.on("error", reject);
		stream.on("end", () => resolve(Buffer.concat(chunks)));
	});

// ---------------------------------------------------
// Redis connection configuration
// -------------------------------------------------
const getRedisConnection = () => {
	// Prefer REDIS_URL (Upstash / cloud Redis)
	if (process.env.REDIS_URL) {
		// FIX: Cloud Redis providers (Upstash, Render) often only support DB 0.
		// A URL from another service might contain a different DB number, causing connection errors.
		// This parses the URL and explicitly forces it to use database 0.
		try {
			const redisUrl = new URL(process.env.REDIS_URL);
			// bullmq/ioredis can be more reliable when passed a connection object
			// instead of a URL string, especially for TLS (rediss://).
			const connectionOptions = {
				host: redisUrl.hostname,
				port: Number(redisUrl.port) || 6379,
				password: redisUrl.password,
				// ioredis uses the 'db' option, not the URL pathname.
				db: redisUrl.pathname ? Number(redisUrl.pathname.slice(1) || 0) : 0,
				...(redisUrl.protocol === 'rediss:' ? { tls: {} } : {})
			};
			return connectionOptions;
		} catch (error) {
			logger.error(`❌ Invalid REDIS_URL: ${process.env.REDIS_URL}. Error: ${error.message}`);
			return null;
		}
	}

	// Optional: explicit host/port config
	// if (process.env.REDIS_HOST && process.env.REDIS_PORT) {
	//   return {
	//     host: process.env.REDIS_HOST,
	//     port: parseInt(process.env.REDIS_PORT, 10),
	//     password: process.env.REDIS_PASSWORD,
	//   };
	// }

	// In production on Render/Vercel we do NOT want to
	// silently fall back to localhost:6379, because there
	// is no local Redis → ECONNREFUSED spam.
	logger.warn(
		"⚠️ Redis not configured (no REDIS_URL / REDIS_HOST). Queue & worker will be disabled.",
	);
	return null;
};

const connection = getRedisConnection();

// ---------------------------------------------------
// Queue setup (csv-import)
// ---------------------------------------------------
let importQueue = null;

if (connection) {
	try {
		// IMPORTANT: queue name must match Worker name ('csv-import')
		importQueue = new Queue("csv-import", { connection });
		logger.info("✅ Redis queue initialized");
	} catch (error) {
		logger.error("❌ Failed to initialize Redis queue:", error);
		logger.warn(
			"⚠️ Queue processing will not work without Redis. Please set REDIS_URL in environment variables.",
		);
		importQueue = null;
	}
} else {
	// No Redis → keep importQueue null so callers can decide how to fallback
	logger.warn("⚠️ importQueue disabled because Redis connection is missing.");
}

// Helper to get file stream (from S3 or local)
const getFileStream = async (filePath) => {
	// Check if it's an S3 key (starts with 'uploads/') or local path
	// FIX: Allow S3 keys in subfolders (e.g. "USA/file.csv") by checking if it's NOT an absolute path
	const isS3Key = !path.isAbsolute(filePath);

	if (isS3Key) {
		logger.info(`📥 Downloading file from S3: ${filePath}`);
		return await downloadFromS3(filePath);
	} else {
		// Legacy local file support
		return fs.createReadStream(filePath);
	}
};

// Helper to find which line the headers are on
const findHeaderRowIndex = async (filePath, mapping) => {
	const isXlsx = filePath.toLowerCase().endsWith(".xlsx");
	// Get a list of expected headers from the user's mapping
	// e.g. ["Full Name", "Email", "Job Title"]
	const expectedHeaders = Object.values(mapping).filter(
		(v) => v && v.trim() !== "",
	);

	if (expectedHeaders.length === 0) return 0; // Fallback

	let fileStream;
	let rl;

	try {
		fileStream = await getFileStream(filePath);

		if (isXlsx) {
			try {
				const buffer = await streamToBuffer(fileStream);
				const workbook = xlsx.read(buffer, { type: "buffer", sheetRows: 21 });
				const sheetName = workbook.SheetNames[0];
				const worksheet = workbook.Sheets[sheetName];
				const data = xlsx.utils.sheet_to_json(worksheet, { header: 1 });

				let lineNumber = 0;
				let headerLineIndex = 0;
				let found = false;

				for (const row of data) {
					if (lineNumber > 20) break; // Search limit
					const line = row
						.map((cell) => `"${String(cell || "").replace(/"/g, '""')}"`)
						.join(",");

					const containsHeader = expectedHeaders.some((header) => {
						return line.includes(header) || line.includes(`"${header}"`);
					});

					if (containsHeader) {
						headerLineIndex = lineNumber;
						found = true;
						break;
					}
					lineNumber++;
				}

				logger.info(found ? `🔎 Detected Headers on Line: ${headerLineIndex}` : "⚠️ Could not auto-detect header line. Defaulting to 0.");
				return headerLineIndex;
			} finally {
				if (fileStream) fileStream.destroy();
			}
		}


		rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

		let lineNumber = 0;
		let headerLineIndex = 0;
		let found = false;

		for await (const line of rl) {
			// Check if this line contains the expected headers
			// We check if at least ONE important header exists in this line
			const containsHeader = expectedHeaders.some((header) => {
				// Check exact string or quoted string
				return line.includes(header) || line.includes(`"${header}"`);
			});

			if (containsHeader) {
				headerLineIndex = lineNumber;
				found = true;
				break;
			}
			lineNumber++;
			if (lineNumber > 20) break; // Don't search too deep, headers should be at top
		}

		if (found) {
			logger.info(`🔎 Detected Headers on Line: ${headerLineIndex}`);
		} else {
			logger.warn("⚠️ Could not auto-detect header line. Defaulting to 0.");
		}

		return headerLineIndex;
	} catch (error) {
		logger.error(`❌ Error finding header row index for ${filePath}:`, error);
		return 0; // Fallback to first line
	} finally {
		// Ensure cleanup
		if (rl) {
			rl.close();
		}
		if (fileStream) {
			fileStream.destroy();
		}
	}
};

// Helper to wait for file to appear in S3 (handling background upload race condition)
const waitForFileInS3 = async (filePath, maxRetries = 30, delayMs = 2000) => {
	for (let i = 0; i < maxRetries; i++) {
		if (await fileExistsInS3(filePath)) {
			return true;
		}
		if (i % 5 === 0) {
			logger.info(`⏳ Waiting for file ${filePath} to appear in S3... (Attempt ${i + 1}/${maxRetries})`);
		}
		await new Promise((resolve) => setTimeout(resolve, delayMs));
	}
	return false;
};

// ---------------------------------------------------
// Resume Processing Logic (AI Powered)
// ---------------------------------------------------

const extractTextFromFile = async (buffer, fileExt) => {
	try {
		if (fileExt === 'docx') {
			try {
				const result = await mammoth.extractRawText({ buffer });
				return result.value;
			} catch (e) {
				throw new Error(`DOCX_EXTRACT_ERROR: ${e.message}`);
			}
		}
		if (fileExt === 'pdf') {
			// Add a timeout for pdf-parse as it can hang on corrupted or large files
			const parsePromise = pdf(buffer);
			const timeoutPromise = new Promise((_, reject) =>
				setTimeout(() => reject(new Error('PDF_TIMEOUT: PDF parsing timed out after 15 seconds')), 15000)
			);
			try {
				const data = await Promise.race([parsePromise, timeoutPromise]);
				return data.text;
			} catch (e) {
				if (e.message.includes('PDF_TIMEOUT')) throw e;
				throw new Error(`PDF_EXTRACT_ERROR: ${e.message}`);
			}
		}
		if (fileExt === 'doc') {
			logger.warn('Skipping .doc file. Only .docx format is supported for Word documents.');
			throw new Error("UNSUPPORTED_FORMAT: .doc files are not supported, convert to .docx or .pdf");
		}
	} catch (error) {
		// If we already wrapped it, just rethrow
		if (error.message.includes('_EXTRACT_ERROR') || error.message.includes('UNSUPPORTED_FORMAT') || error.message.includes('PDF_TIMEOUT')) {
			throw error;
		}
		logger.error(`Text extraction failed for extension '${fileExt}': ${error.message}`);
		throw new Error(`TEXT_EXTRACTION_FAILED: ${error.message}`);
	}
	return "";
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const resumeParseConcurrency = Math.max(
	1,
	Number(process.env.RESUME_PARSE_CONCURRENCY || process.env.RESUME_AI_CONCURRENCY || 4),
);
const runWithResumeParseLimit = (() => {
	let active = 0;
	const waitQueue = [];

	const acquire = () =>
		new Promise((resolve) => {
			if (active < resumeParseConcurrency) {
				active += 1;
				resolve();
				return;
			}
			waitQueue.push(resolve);
		});

	const release = () => {
		if (waitQueue.length > 0) {
			const next = waitQueue.shift();
			next();
			return;
		}
		active = Math.max(0, active - 1);
	};

	return async (taskFn) => {
		await acquire();
		try {
			return await taskFn();
		} finally {
			release();
		}
	};
})();

const normalizeResumeText = (text) =>
	String(text || "")
		.replace(/\u0000/g, "")
		.replace(/\r/g, "\n")
		.replace(/[ \t]+/g, " ")
		.replace(/\n{3,}/g, "\n\n")
		.trim();

const fileNameToCandidateName = (s3Key) => {
	const base = path.basename(String(s3Key || ""), path.extname(String(s3Key || "")));
	const normalized = base
		.replace(/[_\-]+/g, " ")
		.replace(/[^a-zA-Z\s]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
	if (!normalized) return "Unknown Candidate";
	return normalized
		.toLowerCase()
		.replace(/\b[a-z]/g, (m) => m.toUpperCase())
		.slice(0, 80);
};

const splitLocation = (location) => {
	const raw = String(location || "").trim();
	if (!raw) return { locality: "", country: "" };
	const parts = raw
		.split(",")
		.map((p) => p.trim())
		.filter(Boolean);
	if (parts.length === 0) return { locality: "", country: "" };
	if (parts.length === 1) return { locality: parts[0], country: "" };
	return { locality: parts[0], country: parts[parts.length - 1] };
};

const normalizeSkills = (skills) => {
	const list = Array.isArray(skills)
		? skills
		: String(skills || "")
			.split(/[;,]/g)
			.map((s) => s.trim());
	const unique = [];
	const seen = new Set();
	for (const skill of list) {
		if (!skill) continue;
		const key = skill.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		unique.push(skill);
	}
	return unique.join(", ");
};

const extractFallbackFields = (resumeText, s3Key) => {
	const text = normalizeResumeText(resumeText);
	const lines = text
		.split("\n")
		.map((l) => l.trim())
		.filter(Boolean);

	const emailMatch = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
	const linkedinMatch = text.match(/(?:https?:\/\/)?(?:www\.)?linkedin\.com\/[^\s)]+/i);
	const phoneCandidates = text.match(/(?:\+?\d[\d\s().-]{7,}\d)/g) || [];
	const phone = phoneCandidates
		.map((p) => p.replace(/[^\d+]/g, ""))
		.find((p) => p.length >= 7 && p.length <= 15) || "";

	let fullName = "";
	for (const line of lines.slice(0, 8)) {
		const clean = line.replace(/[^a-zA-Z\s.'-]/g, "").replace(/\s+/g, " ").trim();
		if (!clean) continue;
		const words = clean.split(" ").filter(Boolean);
		if (words.length >= 2 && words.length <= 6) {
			const hasLikelyNoise = /(resume|curriculum|vitae|profile|email|phone|linkedin|address)/i.test(clean);
			if (!hasLikelyNoise) {
				fullName = clean;
				break;
			}
		}
	}
	if (!fullName) fullName = fileNameToCandidateName(s3Key);

	let location = "";
	const locationLine = lines.find((line) => /\b(location|address|city)\b/i.test(line));
	if (locationLine) {
		const candidate = locationLine.split(":").slice(1).join(":").trim() || locationLine;
		location = candidate.slice(0, 120);
	} else {
		const cityCountryLike = lines.find((line) => /^[A-Za-z .'-]+,\s*[A-Za-z .'-]+$/.test(line));
		if (cityCountryLike) location = cityCountryLike.slice(0, 120);
	}

	let experience = "";
	const expMatch = text.match(/(\d+(?:\.\d+)?)\+?\s*(?:years|yrs?)/i);
	if (expMatch) experience = `${expMatch[1]} Years`;

	const summary = lines.slice(0, 10).join(" ").slice(0, 700);

	return {
		fullName,
		email: emailMatch ? emailMatch[0] : "",
		phone,
		linkedinUrl: linkedinMatch ? linkedinMatch[0] : "",
		location,
		experience,
		summary,
	};
};

const getValueAtPath = (obj, pathStr) => {
	if (!obj || !pathStr) return undefined;
	const parts = String(pathStr).split(".");
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
		if (v !== undefined && v !== null && String(v).trim() !== "") return v;
	}
	return "";
};

const toStringArray = (value) => {
	if (!value) return [];
	if (Array.isArray(value)) return value;
	return [value];
};

const extractRChilliStructuredData = (payload, fallbackData = {}) => {
	const root = payload || {};
	const data = pickFirstValue(root, [
		"ResumeParserData",
		"resumeParserData",
		"Data",
		"data",
	]) || root;

	const warnings = [];

	const emailList = toStringArray(pickFirstValue(data, ["Email", "EmailAddresses", "Contact.Email"]));
	const firstEmail = emailList
		.map((entry) => (typeof entry === "string" ? entry : (entry?.EmailAddress || entry?.Email || "")))
		.find(Boolean) || "";

	const phoneList = toStringArray(pickFirstValue(data, ["PhoneNumber", "PhoneNumbers", "Contact.Phone"]));
	const firstPhone = phoneList
		.map((entry) => (typeof entry === "string" ? entry : (entry?.Number || entry?.PhoneNumber || "")))
		.find(Boolean) || "";

	const websiteList = toStringArray(pickFirstValue(data, ["WebSite", "Websites", "SocialProfiles"]));
	const linkedin = websiteList
		.map((entry) => {
			if (typeof entry === "string") return entry;
			return entry?.Url || entry?.URL || entry?.Link || "";
		})
		.find((url) => /linkedin\.com/i.test(String(url))) || "";

	const locality = pickFirstValue(data, [
		"Location.0.City",
		"Address.0.City",
		"Address.City",
		"PersonalInformation.City",
		"City",
	]);
	const country = pickFirstValue(data, [
		"Location.0.Country",
		"Address.0.Country",
		"Address.Country",
		"ResumeCountry.Country",
		"PersonalInformation.Country",
		"Country",
	]);
	const locationValue = pickFirstValue(data, [
		"Location.0.FormattedLocation",
		"Location.0.Location",
		"Address.0.FormattedAddress",
		"Location",
		"Address.CompleteAddress",
	]);
	const location = (typeof locationValue === "string" ? locationValue : "").trim() || [locality, country].filter(Boolean).join(", ");

	const firstExperienceTitle = pickFirstValue(data, [
		"Experience.0.JobProfile.Title",
		"SegregatedExperience.0.JobProfile.Title",
		"Experience.0.JobTitle",
		"WorkHistory.0.JobProfile.Title",
		"WorkHistory.0.JobTitle",
		"JobProfile",
	]);
	const firstExperienceCompany = pickFirstValue(data, [
		"Experience.0.JobProfile.CompanyName",
		"SegregatedExperience.0.Employer.EmployerName",
		"Experience.0.CompanyName",
		"WorkHistory.0.JobProfile.CompanyName",
		"WorkHistory.0.CompanyName",
		"CurrentEmployer",
	]);

	const rawSkills = pickFirstValue(data, ["SkillKeywords", "Skills", "SkillSet", "TechnicalSkills"]) || fallbackData.skills || "";
	const normalizedSkillInput = Array.isArray(rawSkills)
		? rawSkills.map((s) => (typeof s === "string" ? s : (s?.Skill || s?.SkillName || s?.Name || "")))
		: rawSkills;
	const skills = normalizeSkills(normalizedSkillInput);

	const totalExpYears = pickFirstValue(data, [
		"WorkedPeriod.TotalExperienceInYear",
		"TotalExperienceInYear",
		"TotalExperience.Years",
		"Summary.TotalExperienceInYears",
	]);
	const experience = totalExpYears
		? `${String(totalExpYears).replace(/[^\d.]/g, "")} Years`
		: (fallbackData.experience || "");

	const fullName = pickFirstValue(data, [
		"Name.FullName",
		"Name.FormattedName",
		"CandidateName",
		"FullName",
	]) || fallbackData.fullName;

	const summary = pickFirstValue(data, [
		"Summary",
		"ProfessionalSummary",
		"ExecutiveSummary",
	]) || fallbackData.summary || "";

	const industry = pickFirstValue(data, [
		"Category",
		"Industry",
		"CurrentIndustry",
		"Experience.0.JobProfile.Industry",
	]);

	if (!fullName) warnings.push("MISSING_NAME");
	if (!firstEmail && !firstPhone && !linkedin) warnings.push("MISSING_CONTACT");
	if (!skills) warnings.push("MISSING_SKILLS");
	if (!firstExperienceTitle) warnings.push("MISSING_JOB_TITLE");
	if (!location && !locality) warnings.push("MISSING_LOCATION");

	return {
		parsedData: {
			fullName,
			email: firstEmail || "",
			phone: firstPhone || "",
			linkedinUrl: linkedin || "",
			location: location || "",
			locality: locality || "",
			country: country || "",
			jobTitle: firstExperienceTitle || "",
			company: firstExperienceCompany || "",
			skills,
			experience,
			summary: String(summary || "").slice(0, 5000),
			industry: industry || "",
		},
		parseWarnings: warnings,
		rawPayload: root,
	};
};

const parseResumeWithRChilli = async (buffer, s3Key, fileExt, fallbackData = {}) => {
	const endpoint = (
		process.env.RCHILLI_ENDPOINT ||
		"https://rest.rchilli.com/RChilliParser/Rchilli/parseResumeBinary"
	).trim();
	const userKey = (process.env.RCHILLI_USER_KEY || "").trim();
	const version = (process.env.RCHILLI_VERSION || "8.0.0").trim();
	const subUserId = (process.env.RCHILLI_SUB_USER_ID || process.env.RCHILLI_SUB_USERID || "").trim();
	const requestMode = (process.env.RCHILLI_REQUEST_MODE || "auto").trim().toLowerCase();

	if (!userKey) throw new Error("RCHILLI_CONFIG_MISSING: RCHILLI_USER_KEY is not configured");

	let extraFields = {};
	if (process.env.RCHILLI_EXTRA_FIELDS) {
		try {
			extraFields = JSON.parse(process.env.RCHILLI_EXTRA_FIELDS);
		} catch {
			throw new Error("RCHILLI_CONFIG_MISSING: RCHILLI_EXTRA_FIELDS must be valid JSON");
		}
	}

	return runWithResumeParseLimit(async () => {
		const maxAttempts = 4;
		const strategies =
			requestMode === "json"
				? ["json"]
				: requestMode === "multipart"
					? ["multipart"]
					: ["json", "multipart"];

		const callRChilli = async ({ strategy, fileName, baseFields }) => {
			let response;
			if (strategy === "multipart") {
				const form = new FormData();
				form.append("file", new Blob([buffer]), fileName);
				form.append("filename", fileName);
				form.append("userkey", baseFields.userkey);
				form.append("version", baseFields.version);
				if (baseFields.subuserid) {
					form.append("subuserid", baseFields.subuserid);
					form.append("subUserId", baseFields.subuserid);
				}
				for (const [k, v] of Object.entries(extraFields || {})) {
					if (v !== undefined && v !== null) form.append(k, String(v));
				}
				response = await fetch(endpoint, {
					method: "POST",
					headers: { Accept: "application/json" },
					body: form,
				});
			} else {
				const requestPayload = { ...baseFields, ...(extraFields || {}) };
				response = await fetch(endpoint, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Accept: "application/json",
					},
					body: JSON.stringify(requestPayload),
				});
			}

			const rawBody = await response.text();
			let responseJson = null;
			try {
				responseJson = rawBody ? JSON.parse(rawBody) : null;
			} catch {
				responseJson = null;
			}

			if (!response.ok) {
				throw new Error(`RCHILLI_API_ERROR: ${response.status} - ${String(rawBody || "").slice(0, 1500)}`);
			}

			if (!responseJson || typeof responseJson !== "object") {
				throw new Error(`RCHILLI_INVALID_RESPONSE: non-JSON response (${strategy})`);
			}

			return responseJson;
		};

		for (let attempt = 1; attempt <= maxAttempts; attempt++) {
			try {
				const fileName = path.basename(String(s3Key || `resume.${fileExt || "pdf"}`));
				const baseFields = {
					filedata: buffer.toString("base64"),
					filename: fileName,
					userkey: userKey,
					version,
					...(subUserId ? { subuserid: subUserId } : {}),
				};
				let responseJson;
				let lastError = null;
				for (const strategy of strategies) {
					try {
						responseJson = await callRChilli({ strategy, fileName, baseFields });
						break;
					} catch (strategyErr) {
						lastError = strategyErr;
						const retriable = /RCHILLI_API_ERROR:\s*(429|5\d\d)/.test(String(strategyErr.message || ""));
						if (retriable) throw strategyErr;
					}
				}
				if (!responseJson) {
					throw lastError || new Error("RCHILLI_PARSE_FAILED: no response from parser");
				}

				const statusText = String(pickFirstValue(responseJson, [
					"status",
					"Status",
					"StatusCode",
					"Code",
					"code",
					"ResumeParserData.Status",
					"ResumeParserData.StatusCode",
				])).toLowerCase();
				const hasErrorFlag = Boolean(
					pickFirstValue(responseJson, ["isError", "error", "HasError", "hasError"]),
				);
				if (hasErrorFlag || statusText === "error" || statusText === "failed") {
					const msg = pickFirstValue(responseJson, [
						"Message",
						"message",
						"ErrorMessage",
						"ResumeParserData.ErrorMessage",
					]) || "RChilli parsing failed";
					throw new Error(`RCHILLI_PARSE_FAILED: ${msg}`);
				}

				const mapped = extractRChilliStructuredData(responseJson, fallbackData);
				return {
					parsedData: mapped.parsedData,
					parseWarnings: mapped.parseWarnings,
					rawPayload: mapped.rawPayload,
				};
			} catch (error) {
				const retriable = /RCHILLI_API_ERROR:\s*(429|5\d\d)/.test(String(error.message || ""));
				if (retriable && attempt < maxAttempts) {
					await sleep(1000 * attempt * attempt);
					continue;
				}
				throw error;
			}
		}
		throw new Error("RCHILLI_PARSE_FAILED: exhausted retry attempts");
	});
};

const mergeResumeData = ({ parsedData, fallbackData, s3Key, jobId, parseStatus, parseWarnings, rawParsedResume }) => {
	const parsed = parsedData || {};
	const fallback = fallbackData || {};
	const bestLocation = parsed.location || fallback.location || "";
	const split = splitLocation(bestLocation);

	return {
		fullName: parsed.fullName || fallback.fullName || fileNameToCandidateName(s3Key),
		email: parsed.email || fallback.email || "",
		phone: parsed.phone || fallback.phone || "",
		location: bestLocation,
		locality: parsed.locality || split.locality || "",
		country: parsed.country || split.country || "",
		jobTitle: parsed.jobTitle || "",
		company: parsed.company || "",
		skills: normalizeSkills(parsed.skills || fallback.skills || ""),
		experience: parsed.experience || fallback.experience || "",
		summary: parsed.summary || fallback.summary || "",
		linkedinUrl: parsed.linkedinUrl || fallback.linkedinUrl || "",
		industry: parsed.industry || "",
		sourceFile: s3Key,
		uploadJobId: jobId,
		isDeleted: false,
		parseStatus: parseStatus || "PARSED",
		parseWarnings: Array.isArray(parseWarnings) ? parseWarnings.filter(Boolean).slice(0, 10) : [],
		parsedResume: {
			version: "resume-parser-v3-rchilli",
			provider: "RCHILLI",
			processedAt: new Date().toISOString(),
			raw: rawParsedResume || null,
			heuristic: fallbackData || null,
			textPreview: normalizeResumeText(fallback.summary || "").slice(0, 1000)
		}
	};
};

export const processResumeJob = async ({ jobId, s3Key }) => {
	let success = false;
	let reason = 'UNKNOWN_ERROR';
	let errorMessage = "";
	let extractedText = "";
	let fallbackData = {};
	let insertedPartial = false;

	try {
		const fileExt = s3Key.split('.').pop().toLowerCase();

		// 1. Download
		const fileStream = await downloadFromS3(s3Key);
		const buffer = await streamToBuffer(fileStream);


		// 2. Text extraction is best-effort fallback (RChilli parses binary directly)
		try {
			extractedText = await extractTextFromFile(buffer, fileExt);
		} catch (extractErr) {
			logger.warn(`Fallback text extraction failed for ${s3Key}: ${extractErr.message}`);
			extractedText = "";
		}
		fallbackData = extractFallbackFields(extractedText, s3Key);

		// 3. RChilli Parse
		const rchilliResult = await parseResumeWithRChilli(buffer, s3Key, fileExt, fallbackData);
		if (!rchilliResult?.parsedData) {
			throw new Error("RCHILLI_PARSE_FAILED: RChilli did not return parsed data.");
		}

		const mergedCandidate = mergeResumeData({
			parsedData: rchilliResult.parsedData,
			fallbackData,
			s3Key,
			jobId,
			parseStatus: "PARSED",
			parseWarnings: rchilliResult.parseWarnings || [],
			rawParsedResume: rchilliResult.rawPayload || null,
		});

		const validation = cleanAndValidateCandidate(mergedCandidate, {
			requireName: false,
			requireContact: false,
			fallbackName: fileNameToCandidateName(s3Key)
		});
		if (!validation.valid) {
			throw new Error(`VALIDATION_FAILED: ${validation.reason || "unknown validation error"}`);
		}

		await Candidate.findOneAndUpdate(
			{ sourceFile: s3Key, isDeleted: false },
			{ $set: validation.data },
			{ upsert: true, new: true, setDefaultsOnInsert: true }
		);
		success = true;

	} catch (error) {
		success = false;
		errorMessage = error?.message || String(error);
		// Determine reason from the specific error message we threw
		if (error.message.startsWith('TEXT_EXTRACTION_FAILED') || error.message.startsWith('DOCX_EXTRACT') || error.message.startsWith('PDF_EXTRACT')) {
			reason = 'TEXT_EXTRACTION_FAILED';
		} else if (error.message.startsWith('RCHILLI_PARSE_FAILED') || error.message.startsWith('RCHILLI_API_ERROR') || error.message.startsWith('RCHILLI_INVALID_RESPONSE')) {
			reason = 'RCHILLI_PARSE_FAILED';
		} else if (error.message.startsWith('RCHILLI_CONFIG_MISSING')) {
			reason = 'CONFIGURATION_ERROR';
		} else if (error.message.includes('PDF_TIMEOUT')) {
			reason = 'PDF_TIMEOUT';
		} else if (error.message.includes('UNSUPPORTED_FORMAT')) {
			reason = 'INVALID_FORMAT';
		} else {
			reason = 'PROCESSING_ERROR';
		}

		// Capture more detail for debugging S3 or DB issues
		if (error.message.includes('S3') || error.message.includes('access denied') || error.message.includes('NoSuchKey')) {
			reason = 'S3_DOWNLOAD_ERROR';
		} else if (error.message.includes('buffering timed out')) {
			reason = 'DB_CONNECTION_ERROR';
		}

		// Log the EXACT error message to help user debug API limits/keys
		logger.error(`Resume processing failed for ${s3Key}: [${reason}] ${error.message}`);

		// Best-effort partial insert so resume is not silently dropped.
		try {
			if (!fallbackData || Object.keys(fallbackData).length === 0) {
				fallbackData = extractFallbackFields(extractedText || "", s3Key);
			}
			const partialCandidate = mergeResumeData({
				parsedData: {},
				fallbackData,
				s3Key,
				jobId,
				parseStatus: "PARTIAL",
				parseWarnings: [reason, errorMessage],
				rawParsedResume: {
					reason,
					error: String(errorMessage || "").slice(0, 2000),
				},
			});

			if (!partialCandidate.summary) {
				partialCandidate.summary = `Partial parse. Reason: ${reason}.`;
			}

			const fallbackValidation = cleanAndValidateCandidate(partialCandidate, {
				requireName: false,
				requireContact: false,
				fallbackName: fileNameToCandidateName(s3Key)
			});

			if (fallbackValidation.valid) {
				await Candidate.findOneAndUpdate(
					{ sourceFile: s3Key, isDeleted: false },
					{ $set: fallbackValidation.data },
					{ upsert: true, new: true, setDefaultsOnInsert: true }
				);
				insertedPartial = true;
				success = true;
			}
		} catch (partialErr) {
			logger.error(`Partial insert failed for ${s3Key}: ${partialErr.message}`);
		}
	} finally {
		// This block is the single source of truth for updating job progress.
		try {
			// Define the update operation based on success or failure
			const update = success
				? { $inc: { successRows: 1 } }
				: {
					$inc: { failedRows: 1, [`failureReasons.${reason}`]: 1 },
					// Save the specific error message for debugging (only over-writes last error of this type)
					$set: { [`failureReasonSample.${reason}`]: String(errorMessage || "").substring(0, 500) }
				};

			if (insertedPartial) {
				update.$set = {
					...(update.$set || {}),
					[`failureReasonSample.${reason}`]: `Stored as PARTIAL record. ${String(errorMessage || "").substring(0, 400)}`
				};
			}

			// Perform one atomic update and get the new document state
			const updatedJob = await UploadJob.findByIdAndUpdate(jobId, update, { new: true });

			// Check if the job is complete using the returned document
			// totalRows can briefly be 0 while enqueueing; avoid marking complete in that window.
			if (updatedJob && updatedJob.totalRows > 0 && (updatedJob.successRows + updatedJob.failedRows >= updatedJob.totalRows)) {
				const finalStatus = updatedJob.successRows > 0 ? "COMPLETED" : "FAILED";
				await UploadJob.findByIdAndUpdate(jobId, {
					status: finalStatus,
					completedAt: new Date()
				});
			}
		} catch (e) {
			logger.error(`Failed to update job progress for ${jobId}:`, e);
		}
	}
};

// ---------------------------------------------------
// Core CSV processing logic (shared between worker
// and direct-processing fallback)
// ---------------------------------------------------
export const processCsvJob = async ({ jobId, resumeFrom: explicitResumeFrom, initialSuccess: explicitSuccess, initialFailed: explicitFailed, job: queueJob }) => {
	logger.info(`🚀 Processing UploadJob ID: ${jobId}`);

	try {
		// ✅ SINGLE SOURCE OF TRUTH: Fetch all job parameters from the database.
		const jobDoc = await UploadJob.findById(jobId).lean();
		if (!jobDoc) {
			logger.error(`❌ Job ${jobId} not found. Aborting.`);
			return;
		}

		// --- AUTO-RESUME LOGIC ---
		// If a job is picked up in 'PROCESSING' state, it means it was interrupted.
		// We derive the starting point from its last saved progress, making the
		// process resilient to server restarts, crashes, or deployments.
		const isResuming = (explicitResumeFrom !== undefined) || (jobDoc.status === "PROCESSING" && (jobDoc.totalRows || 0) > 0);
		const resumeFrom = explicitResumeFrom !== undefined ? explicitResumeFrom : (isResuming ? jobDoc.totalRows : 0);
		const initialSuccess = explicitSuccess !== undefined ? explicitSuccess : (isResuming ? jobDoc.successRows : 0);
		const initialFailed = explicitFailed !== undefined ? explicitFailed : (isResuming ? jobDoc.failedRows : 0);

		if (isResuming) {
			logger.info(`🔄 Resuming job ${jobId} from row ${resumeFrom}. Initial counts: Success=${initialSuccess}, Failed=${initialFailed}`);
		}

		const { fileName: filePath, mapping, headers: actualHeaders, originalName } = jobDoc;

		if (!actualHeaders || actualHeaders.length === 0) {
			logger.error(`❌ Job ${jobId} is missing stored headers. Cannot process.`);
			await UploadJob.findByIdAndUpdate(jobId, {
				status: "FAILED",
				error: "Processing failed: Header information was not saved with the job.",
			});
			return;
		}

		// Ensure source file exists in S3 before doing any heavy work
		// FIX: Don't block on HeadObject check (waitForFileInS3). 
		// If HeadObject fails (e.g. permissions), we should still try to download (GetObject).
		// getFileStream will throw a clear error if the file is truly missing.
		const exists = await waitForFileInS3(filePath, 5, 1000).catch(() => false);
		if (!exists) {
			logger.warn(`⚠️ Source file check (HeadObject) failed for ${filePath}. Proceeding to download attempt...`);
		}

		// ✅ FIX: Update totalRows to resumeFrom immediately.
		// This fixes the "4.5M" corrupted count in the UI and ensures the progress bar
		// starts at the correct position (e.g., 13.7M) instead of 0 or a wrong number.
		await UploadJob.findByIdAndUpdate(jobId, { status: "PROCESSING", totalRows: resumeFrom });
		const isXlsx = (filePath.toLowerCase().endsWith(".xlsx") || (originalName && originalName.toLowerCase().endsWith(".xlsx")));

		// 1. Auto-Detect where the headers are
		const skipLinesCount = await findHeaderRowIndex(filePath, mapping);

		// Optimized batch size for large files (14 GB+)
		// Larger batches = fewer DB round trips = faster processing
		const batchSize = 2000; // Increased from 1000 for better throughput on large files
		let candidates = []; // Batch of candidates to be inserted into DB
		let successCount = initialSuccess;
		let failedCount = initialFailed;
		let excessFailures = 0;
		let rowCounter = resumeFrom;
		const failureReasonCounts = new Map();
		let lastProgressUpdate = Date.now();
		const PROGRESS_UPDATE_INTERVAL = 2000; // Update progress every 2 seconds max

		// --- PERFORMANCE OPTIMIZATION: Pre-calculate Header Indices ---
		// Instead of searching for headers in every row (O(N)), we map them once (O(1) lookup).
		const headerIndexMap = new Map();
		actualHeaders.forEach((h, i) => {
			headerIndexMap.set(h, i); // Exact match
			const lower = h.toLowerCase().trim();
			if (!headerIndexMap.has(lower)) {
				headerIndexMap.set(lower, i); // Loose match fallback
			}
		});

		return await new Promise(async (resolve, reject) => {
			try {
				// We now use the `actualHeaders` from the job document.
				logger.info(
					`✅ Using ${actualHeaders.length} stored headers for processing`,
				);
				logger.debug(`📝 First 5 headers:`, actualHeaders.slice(0, 5).join(", "));

				const incrementFailure = (reason) => {
					failedCount++;
					if (failureReasonCounts.size < 500) {
						failureReasonCounts.set(reason, (failureReasonCounts.get(reason) || 0) + 1);
					} else if (failureReasonCounts.has(reason)) {
						failureReasonCounts.set(reason, (failureReasonCounts.get(reason) || 0) + 1);
					} else {
						excessFailures++;
					}
				};

				const insertBatch = async (batchToInsert) => {
					if (batchToInsert.length === 0) return;
					try {
						// 1. Check for PAUSE signal from DB (every batch ~2000 rows)
						// Add timeout to prevent hanging if DB is slow
						const checkPausePromise = UploadJob.findById(jobId).select('status').lean();
						const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('DB_CHECK_TIMEOUT')), 5000));

						const currentJob = await Promise.race([checkPausePromise, timeoutPromise]).catch(() => null);

						if (currentJob && currentJob.status === 'PAUSED') {
							logger.info(`⏸️ Pause signal detected for job ${jobId}`);
							isPaused = true; // Set flag to stop the loop
							if (sourceStream) sourceStream.destroy(); // Stop reading file
							if (fileStream) fileStream.destroy();
							return; // Exit insert
						}

						// 2. Insert with Timeout (prevent infinite hang)
						await Promise.race([
							Candidate.insertMany(batchToInsert, { ordered: false }),
							new Promise((_, reject) => setTimeout(() => reject(new Error('DB_INSERT_TIMEOUT')), 60000))
						]);

						successCount += batchToInsert.length;

						const now = Date.now();
						if (now - lastProgressUpdate > PROGRESS_UPDATE_INTERVAL) {
							await UploadJob.findByIdAndUpdate(jobId, {
								successRows: successCount,
								failedRows: failedCount,
								totalRows: rowCounter, // ✅ ENABLED: Update totalRows so UI shows progress (e.g. "5.4M / 5.4M")
								failureReasons: Object.fromEntries(failureReasonCounts),
								excessFailureCount: excessFailures,
							});
							if (queueJob) {
								await queueJob.updateProgress({ count: rowCounter, success: successCount, failed: failedCount });
							}
							lastProgressUpdate = now;
						}
					} catch (err) {
						// Duplicate key error - count as failed but continue
						// If ordered: false, err.insertedDocs contains successful ones
						// We'll approximate failed count for now
						failedCount += batchToInsert.length;
						logger.warn(`Batch insert warning: ${err.message}`);
					}
				};

				let sourceStream;
				const fileStream = await getFileStream(filePath);

				if (isXlsx) {
					const buffer = await streamToBuffer(fileStream);
					const workbook = xlsx.read(buffer, { type: "buffer" });
					const sheetName = workbook.SheetNames[0];
					const worksheet = workbook.Sheets[sheetName];
					sourceStream = xlsx.stream.to_csv(worksheet);
				} else {
					sourceStream = fileStream;
				}

				// We will handle skipping manually as it's much faster for large files
				// than using the library's built-in `skipLines`.
				const csvParser = csv({
					skipLines: skipLinesCount + 1, // Skip garbage lines + the header row itself
					headers: false, // ✅ RAW MODE: Get raw arrays to validate column count manually
					strict: false,
					skipEmptyLines: false, // Don't skip empty lines - we want to preserve empty cells
				});

				// Handle CSV parser errors without stopping the stream
				csvParser.on("error", (csvErr) => {
					logger.error(
						`❌ CSV parser error at row ${rowCounter}:`,
						csvErr.message,
					);
					failedCount++;
					// Don't throw - let stream continue processing
				});

				// This counter tracks rows coming directly from the stream
				let streamRowCounter = 0;
				let isPaused = false;

				const stream = sourceStream
					.pipe(csvParser)
					.on("data", async (row) => {
						// --- MANUAL RESUME LOGIC (FAST FORWARD) ---

						// Safety check: If paused during insertBatch, stop processing immediately
						if (isPaused) {
							if (sourceStream && !sourceStream.destroyed) sourceStream.destroy();
							return;
						}

						// This is much more performant than `skipLines` for large offsets.
						// We read every line but do minimal work until we reach the resume point.
						streamRowCounter++;
						if (streamRowCounter <= resumeFrom) {
							// Log progress during the fast-forward to show it's not stuck
							if (streamRowCounter % 100000 === 0) {
								if (queueJob) {
									// Keep job active in Redis to prevent stalling during long resumes
									await queueJob.updateProgress({ count: streamRowCounter, status: 'resuming' });
								}
								logger.info(`Fast-forwarding... at row ${streamRowCounter.toLocaleString()}`);
							}
							return; // Skip this already-processed row
						}
						// --- END MANUAL RESUME LOGIC ---

						// --- SAFETY CHECK: STOP IF PAUSED OR JOB DELETED ---
						if (isPaused) return;

						try {
							rowCounter++; // This will now continue from resumeFrom + 1

							// Convert raw row to array (csv-parser with headers:false emits arrays)
							const rowValues = Object.values(row);

							// --- MANUAL STRICT VALIDATION ---
							// Check if row has the correct number of columns to prevent data shifting.
							// FIX: Relaxed strict equality. CSVs often have trailing empty columns or missing trailing commas.
							// We only warn if the mismatch is significant, but we attempt to process anyway.
							if (rowValues.length !== actualHeaders.length) {
								// Just log a warning for debugging, but DO NOT SKIP the row.
								// getVal() handles out-of-bounds access safely.
								if (failedCount < 5) {
									logger.warn(`⚠️ Row ${rowCounter} column mismatch: Expected ${actualHeaders.length}, got ${rowValues.length}. Processing anyway.`);
								}
							}

							// --- DEBUGGING FIRST ROW ---
							if (rowCounter === resumeFrom + 1) {
								logger.info("🔍 Processing first row...");
								logger.debug("Row values detected:", rowValues.slice(0, 5));
							}

							const getVal = (targetHeader) => {
								if (!targetHeader) return "";

								// O(1) Lookup instead of O(N) search
								let idx = headerIndexMap.get(targetHeader);
								if (idx === undefined) {
									idx = headerIndexMap.get(targetHeader.toLowerCase().trim());
								}

								if (idx === undefined) return "";

								const value = rowValues[idx];
								return value === null || value === undefined ? "" : String(value).trim();
							};

							// --- SMART NAME RESOLUTION ---
							// Handles cases where name is split into First/Last columns
							// and prevents "John Doe John Doe" duplication if mapped incorrectly.
							let finalFullName = getVal(mapping.fullName);
							const fName = getVal(mapping.firstName);
							const lName = getVal(mapping.lastName);

							if (fName || lName) {
								if (!finalFullName) {
									finalFullName = [fName, lName].filter(Boolean).join(" ");
								} else {
									// Heuristic: If "Full Name" is mapped but equals "First Name", append "Last Name"
									const normFull = finalFullName.trim().toLowerCase();
									const normFirst = fName ? fName.trim().toLowerCase() : "";
									const normLast = lName ? lName.trim().toLowerCase() : "";

									if (normFirst && normFull === normFirst && lName) {
										finalFullName = `${finalFullName} ${lName}`;
									} else if (normLast && normFull === normLast && fName) {
										finalFullName = `${fName} ${finalFullName}`;
									}
								}
							}

							const candidateData = {
								fullName: finalFullName,
								email: getVal(mapping.email),
								phone: getVal(mapping.phone),
								company: getVal(mapping.company),
								industry: getVal(mapping.industry),
								jobTitle: getVal(mapping.jobTitle),
								skills: getVal(mapping.skills),
								experience: getVal(mapping.experience),
								country: getVal(mapping.country),
								locality: getVal(mapping.locality),
								location: getVal(mapping.location),
								linkedinUrl: getVal(mapping.linkedinUrl),
								githubUrl: getVal(mapping.githubUrl),
								birthYear: getVal(mapping.birthYear),
								summary: getVal(mapping.summary),

								sourceFile: filePath,
								uploadJobId: jobId,
								isDeleted: false,
							};

							// Validate and Clean Data (ETL)
							const validationResult = cleanAndValidateCandidate(candidateData);

							if (validationResult.valid) {
								candidates.push(validationResult.data);
							} else {
								if (failedCount < 5) {
									logger.warn(`⚠️ Row rejected (${validationResult.reason}): Email=${candidateData.email}, Phone=${candidateData.phone}`);
								}
								incrementFailure(validationResult.reason || 'INVALID_DATA');
							}

							// Process batch when it reaches batchSize
							if (candidates.length >= batchSize && !isPaused) {
								// PAUSE STREAM: Backpressure handling for large files
								stream.pause();

								const batch = [...candidates];
								candidates = [];

								try {
									await insertBatch(batch);

									// If paused during insert, ensure we stop the stream here too
									if (isPaused) {
										stream.destroy();
										return;
									}
								} catch (e) {
									logger.error("Error in batch insert:", e);
								} finally {
									// RESUME STREAM
									if (!isPaused) {
										stream.resume();
									}
								}
							}
						} catch (rowError) {
							// Don't let individual row errors stop the entire stream
							logger.error(
								`❌ Error processing row ${rowCounter}:`,
								rowError.message,
							);
							failedCount++;
							// Continue processing next row
						}
					})
					.on("end", async () => {
						try {
							// If paused, don't mark as completed
							if (isPaused) {
								logger.info(`⏸️ Job ${jobId} paused successfully.`);
								resolve();
								return;
							}

							// Insert remaining candidates
							if (candidates.length > 0) {
								await insertBatch(candidates);
							}

							// Clean up stream
							if (fileStream) {
								fileStream.destroy();
							}

							// Fetch the LATEST job status before finalizing
							const finalJobState = await UploadJob.findById(jobId).lean().select("status");
							const finalStatus = finalJobState?.status === 'PAUSED' ? 'PAUSED' : 'COMPLETED';

							// Final progress update before marking as completed
							await UploadJob.findByIdAndUpdate(jobId, {
								status: finalStatus,
								completedAt: finalStatus === 'COMPLETED' ? new Date() : jobDoc.completedAt,
								successRows: successCount,
								totalRows: rowCounter,
								failedRows: failedCount,
								failureReasons: Object.fromEntries(failureReasonCounts),
								excessFailureCount: excessFailures,
							});

							if (finalStatus === 'COMPLETED') {
								logger.info(
									`✅ Job ${jobId} Completed. Total Rows: ${rowCounter.toLocaleString()}, Success: ${successCount.toLocaleString()}, Failed: ${failedCount.toLocaleString()}`,
								);
							} else {
								logger.info(`⏸️ Job ${jobId} Paused. Progress saved.`);
							}
							resolve();
						} catch (err) {
							logger.error(`❌ Error in end handler for job ${jobId}:`, err);
							await UploadJob.findByIdAndUpdate(jobId, {
								status: "FAILED",
								error: err.message,
								successRows: successCount,
								totalRows: rowCounter,
								failedRows: failedCount,
								failureReasons: Object.fromEntries(failureReasonCounts),
								excessFailureCount: excessFailures,
							});
							reject(err);
						}
					})
					.on("error", async (err) => {
						// If we intentionally destroyed the stream due to pause, ignore the error
						if (isPaused) {
							resolve();
							return;
						}

						// Log error but try to continue if possible
						logger.error("❌ CSV Stream Error:", err);
						logger.error("Error details:", {
							message: err.message,
							stack: err.stack,
							filePath,
							jobId,
							rowsProcessed: rowCounter,
							successCount,
							failedCount,
						});

						// Update job with current progress before marking as failed
						await UploadJob.findByIdAndUpdate(jobId, {
							status: "FAILED",
							error: `Stream error: ${err.message}. Processed ${rowCounter} rows, inserted ${successCount}`,
							successRows: successCount,
							totalRows: rowCounter,
							failedRows: failedCount,
							failureReasons: Object.fromEntries(failureReasonCounts),
							excessFailureCount: excessFailures,
						}).catch((updateErr) => {
							logger.error("Error updating job status:", updateErr);
						});

						// Clean up stream
						if (fileStream) {
							fileStream.destroy();
						}

						reject(err);
					});
			} catch (err) {
				reject(err);
			}
		}).catch(async (err) => {
			logger.error(`❌ Job ${jobId} failed with error:`, err);
			logger.error("Error details:", {
				message: err.message,
				stack: err.stack,
				filePath,
				jobId,
			});
			await UploadJob.findByIdAndUpdate(jobId, {
				status: "FAILED",
				error: err.message,
			});
			throw err;
		});
	} catch (error) {
		logger.error(`❌ Fatal error processing job ${jobId}:`, error);
		logger.error("Error details:", {
			message: error.message,
			stack: error.stack,
			filePath,
			jobId,
		});
		await UploadJob.findByIdAndUpdate(jobId, {
			status: "FAILED",
			error: error.message,
		});
		throw error;
	}
};

// ---------------------------------------------------
// Delete Job Processing
// ---------------------------------------------------
export const processDeleteJob = async ({ jobId }) => {
	logger.info(`🗑️ Deleting candidates for UploadJob ID: ${jobId}`);
	try {
		const result = await Candidate.deleteMany({ uploadJobId: jobId });
		logger.info(`✅ Deleted ${result.deletedCount} candidates for job ${jobId}`);
	} catch (error) {
		logger.error(`❌ Failed to delete candidates for job ${jobId}:`, error);
		throw error;
	}
};

// ---------------------------------------------------
// Worker setup (csv-import)
// ---------------------------------------------------
let worker;
const workerConcurrency = Number(process.env.QUEUE_WORKER_CONCURRENCY || 20);

// Only start worker if we have a valid Redis connection
if (connection) {
	try {
		worker = new Worker(
			"csv-import",
			async (job) => {
				if (job.name === "delete-file") {
					const { jobId } = job.data;
					await processDeleteJob({ jobId });
				} else if (job.name === "resume-import") {
					// Process a single resume file
					await processResumeJob(job.data);
				} else {
					// The worker now only needs the jobId and resume info.
					// The processCsvJob function is now self-sufficient and will
					// determine if it needs to resume based on DB state.
					// FIX: Pass all job data (including resume params) to processCsvJob
					const { jobId, resumeFrom, initialSuccess, initialFailed } = job.data;
					await processCsvJob({ jobId, resumeFrom, initialSuccess, initialFailed, job });
				}
			},
			{
				connection,
				concurrency: workerConcurrency,
				lockDuration: 300000, // Increase lock duration to 5 mins to prevent stalling on large files
				removeOnComplete: {
					age: 24 * 3600, // Keep completed jobs for 24 hours
					count: 1000, // Keep max 1000 completed jobs
				},
				removeOnFail: {
					age: 7 * 24 * 3600, // Keep failed jobs for 7 days
				},
			},
		);

		logger.info("✅ Redis worker initialized");
	} catch (error) {
		logger.error("❌ Failed to initialize Redis worker:", error);
		logger.warn(
			"⚠️ File processing will not work without Redis. Please set REDIS_URL in environment variables.",
		);
		// Worker will be undefined, but queue.add() will already handle the error
	}
} else {
	logger.warn("⚠️ Redis connection missing. CSV worker not started.");
}

export default importQueue;
