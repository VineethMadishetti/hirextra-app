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
	const isS3Key =
		filePath.startsWith("uploads/") || !filePath.includes(path.sep);

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

const parseResumeWithAI = async (contentPart) => {
	let apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
	if (!apiKey) throw new Error("GEMINI_API_KEY_MISSING: API key is not set in environment variables (checked GEMINI_API_KEY and VITE_GEMINI_API_KEY)");
	apiKey = apiKey.trim(); // Remove potential whitespace from copy-paste

	const systemPrompt = `
		You are an expert Resume Parser. Analyze the provided document (text or PDF) and extract candidate details into a JSON object.

		Strictly follow this JSON structure:
		{
			"fullName": "Full Name",
			"email": "Email Address",
			"phone": "Phone Number",
			"location": "City, Country",
			"jobTitle": "Current or Last Job Title",
			"company": "Current or Last Company",
			"skills": "Skill1, Skill2, Skill3 (comma separated string)",
			"experience": "Total years of experience (e.g. '5 Years')",
			"summary": "Brief professional summary",
			"linkedinUrl": "LinkedIn Profile URL"
		}

		Rules:
		1. Return ONLY valid JSON. No Markdown code blocks (\`\`\`json).
		2. If a value is missing, use an empty string "".
		3. For "experience", calculate total years if possible, otherwise extract the string.
	`;

	try {
		// Construct payload: System instruction + User Content
		const response = await fetch(
			`https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					system_instruction: { parts: [{ text: systemPrompt }] },
					contents: [{ parts: [contentPart] }]
				})
			}
		);

		if (!response.ok) {
			const errText = await response.text();
			throw new Error(`GEMINI_API_ERROR: ${response.status} ${response.statusText} - ${errText}`);
		}

		const data = await response.json();
		const resultText = data.candidates?.[0]?.content?.parts?.[0]?.text;
		if (!resultText) throw new Error("GEMINI_EMPTY_RESPONSE: Model returned no content");

		// Clean markdown code blocks if present
		let jsonStr = resultText.replace(/```json|```/g, "").trim();
		// Attempt to find JSON object if there's extra text
		const firstBrace = jsonStr.indexOf('{');
		const lastBrace = jsonStr.lastIndexOf('}');
		if (firstBrace !== -1 && lastBrace !== -1) {
			jsonStr = jsonStr.substring(firstBrace, lastBrace + 1);
		}

		try {
			return JSON.parse(jsonStr);
		} catch (parseErr) {
			throw new Error(`AI_JSON_PARSE_ERROR: Failed to parse AI response as JSON. Content: ${jsonStr.substring(0, 100)}...`);
		}
	} catch (error) {
		logger.error("AI Parsing Error:", error);
		throw error; // Rethrow so processResumeJob catches the specific error
	}
};

export const processResumeJob = async ({ jobId, s3Key }) => {
	let success = false;
	let reason = 'UNKNOWN_ERROR';

	try {
		const fileExt = s3Key.split('.').pop().toLowerCase();

		// 1. Download
		const fileStream = await downloadFromS3(s3Key);
		const buffer = await streamToBuffer(fileStream);


		// 2. Prepare content for AI (Multimodal or Text)
		let aiContentPart;

		if (fileExt === 'pdf') {
			// OPTIMIZATION: Send PDF directly to Gemini (handles scanned docs/images)
			const base64Data = buffer.toString('base64');
			aiContentPart = {
				inline_data: {
					mime_type: "application/pdf",
					data: base64Data
				}
			};
		} else {
			// For DOCX (or others), extract text first
			const text = await extractTextFromFile(buffer, fileExt);
			if (!text || text.length < 50) {
				// If text extraction yielded nothing, it might be an image-only DOCX, which is hard.
				// But usually Mammoth is good for DOCX.
				throw new Error("TEXT_EXTRACTION_FAILED: Could not extract sufficient text from file.");
			}
			aiContentPart = { text: text };
		}

		// 3. AI Parse
		const candidateData = await parseResumeWithAI(aiContentPart);
		if (!candidateData) {
			throw new Error("AI_PARSE_FAILED: The AI model could not understand the resume text.");
		}

		// 4. Clean & Validate
		candidateData.sourceFile = s3Key;
		candidateData.uploadJobId = jobId;

		const validation = cleanAndValidateCandidate(candidateData);

		if (validation.valid) {
			await Candidate.create(validation.data);
			success = true;
		} else {
			reason = validation.reason || 'VALIDATION_FAILED';
			success = false;
		}

	} catch (error) {
		success = false;
		// Determine reason from the specific error message we threw
		if (error.message.startsWith('TEXT_EXTRACTION_FAILED') || error.message.startsWith('DOCX_EXTRACT') || error.message.startsWith('PDF_EXTRACT')) {
			reason = 'TEXT_EXTRACTION_FAILED';
		} else if (error.message.startsWith('AI_PARSE_FAILED') || error.message.startsWith('GEMINI_API_ERROR') || error.message.startsWith('AI_JSON')) {
			reason = 'AI_PARSE_FAILED';
		} else if (error.message.startsWith('GEMINI_API_KEY_MISSING')) {
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
	} finally {
		// This block is the single source of truth for updating job progress.
		try {
			// Define the update operation based on success or failure
			const update = success
				? { $inc: { successRows: 1 } }
				: {
					$inc: { failedRows: 1, [`failureReasons.${reason}`]: 1 },
					// Save the specific error message for debugging (only over-writes last error of this type)
					$set: { [`failureReasonSample.${reason}`]: error.message.substring(0, 500) }
				};

			// Perform one atomic update and get the new document state
			const updatedJob = await UploadJob.findByIdAndUpdate(jobId, update, { new: true });

			// Check if the job is complete using the returned document
			if (updatedJob && (updatedJob.successRows + updatedJob.failedRows >= updatedJob.totalRows)) {
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
export const processCsvJob = async ({ jobId, resumeFrom: explicitResumeFrom, initialSuccess: explicitSuccess, initialFailed: explicitFailed }) => {
	logger.info(`🚀 Processing UploadJob ID: ${jobId}`);

	try {
		// ✅ SINGLE SOURCE OF TRUTH: Fetch all job parameters from the database.
		const job = await UploadJob.findById(jobId).lean();
		if (!job) {
			logger.error(`❌ Job ${jobId} not found. Aborting.`);
			return;
		}

		// --- AUTO-RESUME LOGIC ---
		// If a job is picked up in 'PROCESSING' state, it means it was interrupted.
		// We derive the starting point from its last saved progress, making the
		// process resilient to server restarts, crashes, or deployments.
		const isResuming = (explicitResumeFrom !== undefined) || (job.status === "PROCESSING" && (job.totalRows || 0) > 0);
		const resumeFrom = explicitResumeFrom !== undefined ? explicitResumeFrom : (isResuming ? job.totalRows : 0);
		const initialSuccess = explicitSuccess !== undefined ? explicitSuccess : (isResuming ? job.successRows : 0);
		const initialFailed = explicitFailed !== undefined ? explicitFailed : (isResuming ? job.failedRows : 0);

		if (isResuming) {
			logger.info(`🔄 Resuming job ${jobId} from row ${resumeFrom}. Initial counts: Success=${initialSuccess}, Failed=${initialFailed}`);
		}

		const { fileName: filePath, mapping, headers: actualHeaders, originalName } = job;

		if (!actualHeaders || actualHeaders.length === 0) {
			logger.error(`❌ Job ${jobId} is missing stored headers. Cannot process.`);
			await UploadJob.findByIdAndUpdate(jobId, {
				status: "FAILED",
				error: "Processing failed: Header information was not saved with the job.",
			});
			return;
		}

		// Ensure source file exists in S3 before doing any heavy work
		const exists = await waitForFileInS3(filePath);
		if (!exists) {
			logger.error(`❌ Source file missing in S3 for job ${jobId}: ${filePath}`);
			await UploadJob.findByIdAndUpdate(jobId, {
				status: "FAILED",
				error: "Source file not found in storage. Please re-upload the file.",
			});
			return;
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
					await Candidate.insertMany(batchToInsert, { ordered: false });
					successCount += batchToInsert.length;

					const now = Date.now();
					if (now - lastProgressUpdate > PROGRESS_UPDATE_INTERVAL) {
						await UploadJob.findByIdAndUpdate(jobId, {
							successRows: successCount,
							failedRows: failedCount,
							totalRows: rowCounter,
							failureReasons: Object.fromEntries(failureReasonCounts),
							excessFailureCount: excessFailures,
						});
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
					// This is much more performant than `skipLines` for large offsets.
					// We read every line but do minimal work until we reach the resume point.
					streamRowCounter++;
					if (streamRowCounter <= resumeFrom) {
						// Log progress during the fast-forward to show it's not stuck
						if (streamRowCounter % 500000 === 0) {
							// ✅ FIX: Removed DB update here to prevent overwriting totalRows with a smaller number
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
							isPaused = true;

							const batch = [...candidates];
							candidates = [];

							try {
								await insertBatch(batch);
							} catch (e) {
								logger.error("Error in batch insert:", e);
							} finally {
								// RESUME STREAM
								isPaused = false;
								stream.resume();
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
							completedAt: finalStatus === 'COMPLETED' ? new Date() : job.completedAt,
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
					await processCsvJob({ jobId, resumeFrom, initialSuccess, initialFailed });
				}
			},
			{
				connection,
				concurrency: 1, // Process one job at a time
				limiter: {
					max: 1,
					duration: 5000, // PROCESS 1 FILE EVERY 5 SECONDS (12 per minute) to stay under Gemini Free Tier limits (15 RPM)
				},
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
