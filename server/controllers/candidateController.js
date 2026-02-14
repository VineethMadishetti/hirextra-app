import importQueue, { processCsvJob } from "../utils/queue.js";
import Candidate from "../models/Candidate.js";
import UploadJob from "../models/UploadJob.js";
import User from "../models/User.js";
import fs from "fs";
import DeleteLog from "../models/DeleteLog.js";
import csv from "csv-parser";
import path from "path";
import os from "os";
import readline from "readline";
import {
	Document,
	Packer,
	Paragraph,
	TextRun,
	AlignmentType,
	Header,
	ImageRun,
	BorderStyle,
} from "docx";
import xlsx from "xlsx";
import {
	uploadToS3,
	generateS3Key,
	downloadFromS3,
	listS3FilesByPage,
} from "../utils/s3Service.js";

// --- HELPER: Robust CSV Line Parser (ETL) ---
// Handles quoted fields correctly (e.g. "Manager, Sales" is one column)
const parseCsvLine = (line) => {
	if (!line) return [];
	// FIX: Strip BOM (Byte Order Mark) if present
	if (line.charCodeAt(0) === 0xfeff) {
		line = line.slice(1);
	}
	const columns = [];
	let currentField = "";
	let inQuotes = false;

	for (let i = 0; i < line.length; i++) {
		const char = line[i];

		if (char === '"') {
			if (inQuotes && line[i + 1] === '"') {
				currentField += '"';
				i++;
			} else {
				inQuotes = !inQuotes;
			}
		} else if (char === "," && !inQuotes) {
			columns.push(currentField);
			currentField = "";
		} else {
			currentField += char;
		}
	}
	columns.push(currentField);

	// Unquote and trim each field
	return columns.map((field, idx) => {
		let f = field.trim();
		if (f.startsWith('"') && f.endsWith('"')) {
			f = f.slice(1, -1).replace(/""/g, '"');
		}
		return f.trim() ? f.trim() : `Column_${idx + 1}`;
	});
};

// --- HELPER: ETL Data Cleaning & Validation ---
import { cleanAndValidateCandidate } from "../utils/dataCleaner.js";

// Helper to clean up temp chunk files
const deleteFile = (filePath) => {
	if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
};

// 2. DELETE SINGLE CANDIDATE (Row Delete)
export const deleteCandidate = async (req, res) => {
	try {
		await Candidate.findByIdAndDelete(req.params.id);
		res.json({ message: "Candidate deleted" });
	} catch (error) {
		res.status(500).json({ message: error.message });
	}
};

const streamToBuffer = (stream) =>
	new Promise((resolve, reject) => {
		const chunks = [];
		stream.on("data", (chunk) => chunks.push(chunk));
		stream.on("error", reject);
		stream.on("end", () => resolve(Buffer.concat(chunks)));
	});

// 3. GET HEADERS FROM EXISTING FILE (For Reprocessing)
export const getFileHeaders = async (req, res) => {
	const { filePath } = req.body; // filePath is now S3 key

	if (!filePath) {
		return res.status(400).json({ message: "File path (S3 key) is required" });
	}

	try {
		// Check if it's an S3 key (starts with 'uploads/') or local path
		// FIX: Allow S3 keys in subfolders (e.g. "USA/file.csv") by checking if it's NOT an absolute path
		const isS3Key = !path.isAbsolute(filePath);
		const isXlsx = filePath.toLowerCase().endsWith(".xlsx");

		if (isS3Key) {
			try {
				if (isXlsx) {
					const s3Stream = await downloadFromS3(filePath);
					const buffer = await streamToBuffer(s3Stream);
					const workbook = xlsx.read(buffer, { type: "buffer", sheetRows: 1 });
					const sheetName = workbook.SheetNames[0];
					const worksheet = workbook.Sheets[sheetName];
					const json = xlsx.utils.sheet_to_json(worksheet, { header: 1 });
					const headers = json.length > 0 ? json[0].map(String) : [];
					return res.json({ headers, filePath });
				}

				// For CSV files, use readline to read just the first line (fastest method)
				// This avoids downloading/parsing the entire file
				let headersReceived = false;
				let timeoutId;

				// Use Range request to only fetch first 50KB (headers are always at top)
				const s3Stream = await downloadFromS3(filePath, {
					rangeStart: 0,
					rangeEnd: 51200, // First 50 KB is more than enough for CSV headers
				});

				const rl = readline.createInterface({
					input: s3Stream,
					crlfDelay: Infinity,
				});

				// Read only the first non-empty line (header row)
				rl.on("line", (line) => {
					if (!headersReceived && line && line.trim()) {
						headersReceived = true;
						clearTimeout(timeoutId);

						// Parse CSV header line manually (faster than csv-parser for single line)
						const headers = parseCsvLine(line);

						rl.close();
						s3Stream.destroy();

						res.json({ headers, filePath });
					}
				});

				rl.on("close", () => {
					if (!headersReceived) {
						headersReceived = true;
						clearTimeout(timeoutId);
						if (!res.headersSent) {
							res
								.status(500)
								.json({ message: "Could not read header line from file" });
						}
						s3Stream.destroy();
					}
				});

				rl.on("error", (err) => {
					if (!headersReceived) {
						headersReceived = true;
						clearTimeout(timeoutId);
						console.error("Error reading headers from S3:", err);
						if (!res.headersSent) {
							res.status(500).json({
								message: "Failed to read file headers from S3",
								error: err.message,
							});
						}
						rl.close();
						s3Stream.destroy();
					}
				});

				s3Stream.on("error", (err) => {
					if (!headersReceived) {
						headersReceived = true;
						clearTimeout(timeoutId);
						console.error("S3 stream error:", err);
						if (!res.headersSent) {
							res.status(500).json({
								message: "Failed to download file from S3",
								error: err.message,
							});
						}
						rl.close();
						s3Stream.destroy();
					}
				});

				// Timeout after 60 seconds for large files
				timeoutId = setTimeout(() => {
					if (!headersReceived) {
						headersReceived = true;
						if (!res.headersSent) {
							res.status(500).json({
								message:
									"Timeout reading file headers from S3. Please check if the file exists and try again.",
							});
						}
						rl.close();
						s3Stream.destroy();
					}
				}, 60000); // 60 seconds timeout
			} catch (s3Error) {
				console.error("S3 download error:", s3Error);
				return res.status(500).json({
					message: "Failed to download file from S3",
					error: s3Error.message,
				});
			}
		} else {
			// Legacy local file support
			if (!fs.existsSync(filePath)) {
				return res
					.status(404)
					.json({ message: "Original file not found on server" });
			}

			if (isXlsx) {
				const workbook = xlsx.readFile(filePath, { sheetRows: 1 });
				const sheetName = workbook.SheetNames[0];
				const worksheet = workbook.Sheets[sheetName];
				const json = xlsx.utils.sheet_to_json(worksheet, { header: 1 });
				const headers = json.length > 0 ? json[0].map(String) : [];
				return res.json({ headers, filePath });
			}

			// Optimization: Read headers using readline (fastest for large files)
			const fileStream = fs.createReadStream(filePath);
			const rl = readline.createInterface({
				input: fileStream,
				crlfDelay: Infinity,
			});

			for await (const line of rl) {
				if (line && line.trim()) {
					rl.close();
					fileStream.destroy();
					const headers = parseCsvLine(line);
					return res.json({ headers, filePath });
				}
			}

			rl.close();
			fileStream.destroy();
			return res.json({ headers: [], filePath });
		}
	} catch (error) {
		console.error("Error getting file headers:", error);
		if (!res.headersSent) {
			res
				.status(500)
				.json({ message: "Failed to read file headers", error: error.message });
		}
	}
};

// 1. Handle Chunk Uploads (Render-safe, large files supported)
export const uploadChunk = async (req, res) => {
	const { fileName, chunkIndex, totalChunks } = req.body;
	const chunk = req.file;

	if (!chunk) {
		return res.status(400).json({ message: "No chunk data" });
	}

	// ✅ ONLY writable location on Render
	const uploadDir = path.join(os.tmpdir(), "uploads");

	if (!fs.existsSync(uploadDir)) {
		fs.mkdirSync(uploadDir, { recursive: true });
	}

	const finalFilePath = path.join(uploadDir, fileName);

	/* ---------------------------------------------------
	 APPEND CHUNK (OPTIMIZED)
  --------------------------------------------------- */
	try {
		// Optimization: Read buffer directly (faster than streams for chunks)
		const buffer = await fs.promises.readFile(chunk.path);
		await fs.promises.appendFile(finalFilePath, buffer);
		await fs.promises.unlink(chunk.path);
	} catch (error) {
		console.error("❌ Chunk append failed:", error);
		return res.status(500).json({ message: "Failed to save chunk" });
	}

	/* ---------------------------------------------------
	 CHUNK PROGRESS
  --------------------------------------------------- */
	const currentChunk = Number(chunkIndex) + 1;
	const total = Number(totalChunks);

	if (currentChunk !== total) {
		return res.json({
			status: "chunk_received",
			progress: Math.round((currentChunk / total) * 100),
		});
	}

	/* ---------------------------------------------------
	 FINAL CHUNK → READ HEADERS FIRST, THEN UPLOAD TO S3
  --------------------------------------------------- */
	console.log(`✅ File ${fileName} fully assembled at ${finalFilePath}`);

	// Generate S3 key
	const isXlsx = fileName.toLowerCase().endsWith(".xlsx");
	const s3Key = generateS3Key(fileName, req.user._id.toString());

	// Read headers from the fully assembled file
	const getHeaders = async () => {
		try {
			if (isXlsx) {
				const workbook = xlsx.readFile(finalFilePath, { sheetRows: 1 });
				const sheetName = workbook.SheetNames[0];
				const worksheet = workbook.Sheets[sheetName];
				const json = xlsx.utils.sheet_to_json(worksheet, { header: 1 });
				return json.length > 0 ? json[0].map(String) : [];
			} else {
				// For CSV, read headers using readline (fastest for large files)
				const fileStream = fs.createReadStream(finalFilePath);
				const rl = readline.createInterface({
					input: fileStream,
					crlfDelay: Infinity,
				});

				for await (const line of rl) {
					if (line && line.trim()) {
						rl.close();
						fileStream.destroy();
						return parseCsvLine(line);
					}
				}

				rl.close();
				fileStream.destroy();
				return [];
			}
		} catch (err) {
			console.error("❌ Manual header read failed:", err);
			return [];
		}
	};

	const headers = await getHeaders();

	// Upload to S3 in background to prevent UI blocking
	const fileStream = fs.createReadStream(finalFilePath);
	const contentType = isXlsx
		? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
		: "text/csv";

	uploadToS3(fileStream, s3Key, contentType)
		.then(() => {
			console.log(`✅ File uploaded to S3: ${s3Key}`);
			deleteFile(finalFilePath);
		})
		.catch((err) => {
			console.error("❌ S3 upload failed:", err);
			deleteFile(finalFilePath);
		});

	res.status(200).json({
		status: "done",
		message: "Upload complete",
		filePath: s3Key,
		headers,
	});
};

// --- BULK RESUME IMPORT (S3 Folder) ---
export const importResumes = async (req, res) => {
	let createdJobId = null;
	try {
		const { folderPath, skipExisting = false } = req.body || {};
		if (!folderPath) return res.status(400).json({ message: "Folder path is required" });
		if (!importQueue) {
			return res.status(503).json({
				message: "Resume import queue is not available. Configure REDIS_URL and restart worker."
			});
		}

		const normalizedFolderPath = String(folderPath).trim().replace(/^\/+/, "");
		if (!normalizedFolderPath) {
			return res.status(400).json({ message: "Folder path is required" });
		}

		// Keep trailing slash behavior predictable for prefix filtering
		const s3Prefix = normalizedFolderPath.endsWith("/")
			? normalizedFolderPath
			: `${normalizedFolderPath}/`;

		// 2. Create Master Job
		const job = await UploadJob.create({
			fileName: s3Prefix,
			originalName: `Bulk Import: ${path.basename(normalizedFolderPath)}`,
			uploadedBy: req.user._id,
			status: "PROCESSING",
			totalRows: 0,
			successRows: 0,
			failedRows: 0,
			headers: ["Resume Import"],
			mapping: {},
		});
		createdJobId = job._id;

		// 3. Read S3 page-by-page, enqueue in chunks, and skip already-imported source files
		const s3ListPageSize = Math.max(100, Number(process.env.S3_LIST_PAGE_SIZE || 1000));
		const enqueueBatchSize = Math.max(100, Number(process.env.RESUME_IMPORT_ENQUEUE_BATCH || 1000));
		let discoveredCount = 0;
		let queuedCount = 0;
		let skippedExistingCount = 0;
		let sawAnyResumeFile = false;

		for await (const filesPage of listS3FilesByPage(s3Prefix, s3ListPageSize)) {
			const resumeFilesPage = filesPage.filter((f) =>
				f?.Key &&
				(
					f.Key.toLowerCase().endsWith(".pdf") ||
					f.Key.toLowerCase().endsWith(".docx") ||
					f.Key.toLowerCase().endsWith(".doc")
				)
			);

			if (resumeFilesPage.length === 0) continue;
			sawAnyResumeFile = true;
			discoveredCount += resumeFilesPage.length;

			for (let i = 0; i < resumeFilesPage.length; i += enqueueBatchSize) {
				const chunk = resumeFilesPage.slice(i, i + enqueueBatchSize).filter((f) => f?.Key);
				if (chunk.length === 0) continue;

				let filesToQueue = chunk;
				if (skipExisting) {
					const chunkKeys = chunk.map((f) => f.Key);
					const existingRows = await Candidate.find({
						sourceFile: { $in: chunkKeys },
						isDeleted: false,
					})
						.select("sourceFile -_id")
						.lean();

					const existingKeys = new Set(existingRows.map((row) => row.sourceFile));
					filesToQueue = chunk.filter((f) => !existingKeys.has(f.Key));
					skippedExistingCount += chunk.length - filesToQueue.length;
				}

				if (filesToQueue.length === 0) continue;

				const jobsData = filesToQueue.map((file) => ({
					name: "resume-import",
					data: { jobId: job._id, s3Key: file.Key },
					opts: {
						attempts: 5,
						backoff: { type: "exponential", delay: 3000 },
						removeOnComplete: { age: 24 * 3600, count: 2000 },
						removeOnFail: { age: 7 * 24 * 3600, count: 5000 },
					},
				}));

				// Prevent race with workers by increasing totalRows before jobs start completing.
				const nextQueuedCount = queuedCount + jobsData.length;
				await UploadJob.findByIdAndUpdate(job._id, { totalRows: nextQueuedCount });
				await importQueue.addBulk(jobsData);
				queuedCount = nextQueuedCount;
			}
		}

		if (!sawAnyResumeFile) {
			await UploadJob.findByIdAndUpdate(job._id, {
				status: "FAILED",
				error: "No PDF, DOCX, or DOC files found in that folder.",
			});
			return res.status(404).json({ message: "No PDF, DOCX, or DOC files found in that folder." });
		}

		if (queuedCount === 0) {
			await UploadJob.findByIdAndUpdate(job._id, {
				status: "COMPLETED",
				totalRows: 0,
				completedAt: new Date(),
			});
			return res.json({
				message: "No new resumes to import. All files are already present.",
				jobId: job._id,
				fileCount: discoveredCount,
				queuedCount: 0,
				skippedExistingCount,
				skipExisting: !!skipExisting,
			});
		}

		res.json({
			message: "Import started",
			jobId: job._id,
			fileCount: discoveredCount,
			queuedCount,
			skippedExistingCount,
			skipExisting: !!skipExisting,
		});
	} catch (error) {
		console.error("Import Error:", error);
		if (createdJobId) {
			await UploadJob.findByIdAndUpdate(createdJobId, {
				status: "FAILED",
				error: String(error.message || error).slice(0, 1000),
			}).catch(() => {});
		}
		res.status(500).json({ message: error.message });
	}
};

// --- START PROCESSING (Creates History Record) ---
export const processFile = async (req, res) => {
	try {
		// ✅ FIX: Handle Resume Request via this existing route to avoid 404 "Route not found"
		if (req.body.resumeJobId) {
			const job = await UploadJob.findById(req.body.resumeJobId);
			if (!job) return res.status(404).json({ message: "Job not found" });

			// Calculate resume point from actual processed rows
			const resumeFrom = job.successRows + job.failedRows;
			console.log(`🔄 Resuming job ${job._id} from row ${resumeFrom} via processFile endpoint`);

			// Update status to PROCESSING
			await UploadJob.findByIdAndUpdate(job._id, {
				status: "PROCESSING",
				error: null
			});

			// Trigger processing in background
			processCsvJob({
				jobId: job._id,
				resumeFrom: resumeFrom,
				initialSuccess: job.successRows,
				initialFailed: job.failedRows
			}).catch(err => console.error("Resume background error:", err));

			return res.json({ message: "Job resumed successfully", resumeFrom, jobId: job._id });
		}

		const { filePath, mapping, headers } = req.body;

		if (!filePath) {
			return res.status(400).json({ message: "File path is required" });
		}
		if (!headers || headers.length === 0) {
			return res
				.status(400)
				.json({ message: "Header information is required" });
		}

		const fileName = path.basename(filePath);

		// 1. Create a DB Record for this Job
		const newJob = await UploadJob.create({
			fileName: filePath,
			originalName: fileName,
			uploadedBy: req.user._id,
			status: "MAPPING_PENDING",
			mapping,
			headers, // ✅ Save headers to the database
		});

		// 2. Start processing immediately in the background (no Redis required)
		//    We do NOT await here so the HTTP response returns quickly.
		processCsvJob({ jobId: newJob._id }).catch(async (processingError) => {
			console.error("Background CSV processing failed:", processingError);
			await UploadJob.findByIdAndUpdate(newJob._id, {
				status: "FAILED",
				error: processingError.message || "Background processing failed",
			});
		});

		// Respond immediately; frontend can poll /job/:id/status for live updates
		return res.json({ message: "Processing started", jobId: newJob._id });
	} catch (error) {
		console.error("Error in processFile:", error);
		res.status(500).json({
			message: "Failed to start file processing",
			error: error.message,
		});
	}
};

// --- RESUME STUCK JOB ---
export const resumeUploadJob = async (req, res) => {
	try {
		const { id } = req.params;
		const job = await UploadJob.findById(id);

		if (!job) {
			return res.status(404).json({ message: "Job not found" });
		}

		// Resume from the last recorded totalRows (which acts as the processed count)
		// ✅ FIX: Calculate resume point from actual processed rows (Success + Failed)
		// This fixes issues where totalRows was incorrectly overwritten or is the target total.
		let resumeFrom = job.successRows + job.failedRows;

		console.log(`🔄 Resuming job ${id} from row ${resumeFrom}`);

		// Update status to PROCESSING
		await UploadJob.findByIdAndUpdate(id, {
			status: "PROCESSING",
			error: null,
			// totalRows: resumeFrom // ❌ Don't overwrite totalRows here
		});

		// Trigger processing
		processCsvJob({
			jobId: job._id,
			resumeFrom: resumeFrom,
			initialSuccess: job.successRows,
			initialFailed: job.failedRows
		}).catch(async (err) => {
			const errorMsg = err.message || String(err) || "Resume failed";
			console.error(`❌ Resume failed for job ${id}:`, err);
			await UploadJob.findByIdAndUpdate(id, {
				status: "FAILED",
				error: "Resume failed: " + err.message,
				error: "Resume failed: " + errorMsg
			});
		});

		res.json({ message: "Job resumed successfully", resumeFrom });
	} catch (error) {
		console.error("Error resuming job:", error);
		res.status(500).json({ message: error.message });
	}
};

// --- PAUSE STUCK JOB ---
export const pauseUploadJob = async (req, res) => {
	try {
		const { id } = req.params;
		const job = await UploadJob.findById(id);

		if (!job) {
			return res.status(404).json({ message: "Job not found" });
		}

		// Update status to PAUSED. The worker will detect this and stop gracefully.
		await UploadJob.findByIdAndUpdate(id, { status: "PAUSED" });

		res.json({ message: "Job pause requested. It will stop shortly." });
	} catch (error) {
		console.error("Error pausing job:", error);
		res.status(500).json({ message: error.message });
	}
};

// --- GET DELETE HISTORY ---
export const getDeleteHistory = async (req, res) => {
	try {
		const logs = await DeleteLog.find()
			.sort({ deletedAt: -1 })
			.limit(100)
			.populate('deletedBy', 'name email')
			.lean();
		res.json(logs);
	} catch (error) {
		res.status(500).json({ message: error.message || "Failed to load delete history" });
	}
};

// --- GET UPLOAD HISTORY (For Admin Page) ---
export const getUploadHistory = async (req, res) => {
	try {
		// Optimized query: only fetch essential fields, limit to recent 100 jobs
		const jobs = await UploadJob.find()
			.select(
				"fileName originalName uploadedBy status totalRows successRows failedRows error mapping createdAt updatedAt completedAt",
			)
			.sort({ createdAt: -1 })
			.limit(100) // Limit to recent 100 jobs for faster loading
			.populate("uploadedBy", "name email")
			.lean() // Use lean() for faster queries (returns plain JS objects)
			.maxTimeMS(10000); // 10 second timeout to prevent hanging

		res.json(jobs);
	} catch (error) {
		console.error("Error fetching upload history:", error);
		res
			.status(500)
			.json({ message: error.message || "Failed to load history" });
	}
};

// --- GET JOB STATUS (For Live Updates) ---
export const getJobStatus = async (req, res) => {
	try {
		const job = await UploadJob.findById(req.params.id).populate(
			"uploadedBy",
			"name email",
		);
		if (!job) return res.status(404).json({ message: "Job not found" });
		res.json(job);
	} catch (error) {
		res.status(500).json({ message: error.message });
	}
};

// --- SEARCH (Updated for Soft Delete) ---
export const searchCandidates = async (req, res) => {
    try {
        res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
        res.setHeader("Pragma", "no-cache");
        res.setHeader("Expires", "0");
        res.setHeader("Surrogate-Control", "no-store");
        
        const {
            q,
            locality,
            location,
            jobTitle,
            skills,
            hasEmail,
            hasPhone,
            hasLinkedin,
            page = 1,
            limit = 20,
            lastCreatedAt,
            lastId
        } = req.query;

        // Allow larger limits (up to 5000) to support "View All"
        // Handle case-insensitive 'all' and trim whitespace
        const limitStr = String(limit).toLowerCase().trim();
        let limitNum = (limitStr === 'all') ? 5000 : (Number(limit) || 20);
        if (limitNum > 5000) limitNum = 5000;

        const pageNum = Math.max(1, Number(page) || 1);
        const skip = (pageNum - 1) * limitNum;

        let query = { isDeleted: false };
        const andConditions = [];
        let locationHintIndex = null;
        const parseCsvFilter = (value, maxItems = 20) => {
            if (value === undefined || value === null) return [];

            const raw = Array.isArray(value) ? value.join(",") : String(value);
            return raw
                .split(",")
                .map((item) => item.trim())
                .filter(Boolean)
                .slice(0, maxItems);
        };
        const parseLocationTerms = (localityValue, locationValue) => {
            const localityTerms = parseCsvFilter(localityValue, 30);
            const locationTerms = parseCsvFilter(locationValue, 30);
            const merged = localityTerms.length > 0 ? localityTerms : locationTerms;

            const dedup = new Set();
            const normalized = [];

            for (const rawTerm of merged) {
                const term = String(rawTerm).trim().slice(0, 64);
                if (term.length < 2) continue; // Avoid 1-char broad scans like "P"

                const key = term.toLowerCase();
                if (dedup.has(key)) continue;
                dedup.add(key);
                normalized.push(term);
            }

            return normalized;
        };
        const toTitleCaseLocation = (value) =>
            String(value)
                .toLowerCase()
                .replace(/\b[a-z]/g, (m) => m.toUpperCase());

        // 1. Keyword Search
        let searchQ = q;
        if (searchQ && typeof searchQ !== 'string' && !Array.isArray(searchQ)) searchQ = String(searchQ);
        if (Array.isArray(searchQ)) searchQ = searchQ.join(' ');

        if (searchQ && searchQ.trim()) {
            const safeQ = searchQ.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

            const isEmail = safeQ.includes('@');
            const isPhone = /^[0-9+\-\s()]+$/.test(safeQ) && safeQ.replace(/\D/g, '').length > 5;

            if (isEmail) {
                andConditions.push({ email: new RegExp(`^${safeQ}`, "i") });
            } else if (isPhone) {
                andConditions.push({ phone: new RegExp(safeQ.replace(/\s+/g, ''), "i") });
            } else {
                const regex = new RegExp(safeQ, "i");
                andConditions.push({
                    $or: [
                        { fullName: regex },
                        { jobTitle: regex },
                        { skills: regex },
                        { company: regex },
                        { location: regex },
                        { locality: regex }
                    ]
                });
            }
        }

        // 2. LOCATION FILTER
        try {
            const locationTerms = parseLocationTerms(locality, location);
            if (locationTerms.length > 0) {
                const hasLocalityInput = parseCsvFilter(locality, 1).length > 0;
                const primaryLocationField = hasLocalityInput ? "locality" : "location";
                locationHintIndex = hasLocalityInput
                    ? "locality_1_createdAt_-1"
                    : "location_1_createdAt_-1";
                const prefixClauses = [];
                const seenPrefixes = new Set();

                for (const term of locationTerms) {
                    const variants = [
                        term,
                        term.toLowerCase(),
                        term.toUpperCase(),
                        toTitleCaseLocation(term),
                    ];

                    for (const variant of variants) {
                        const cleanVariant = String(variant).trim();
                        if (!cleanVariant || seenPrefixes.has(cleanVariant)) continue;
                        seenPrefixes.add(cleanVariant);
                        const safeVariant = cleanVariant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                        prefixClauses.push({
                            [primaryLocationField]: { $regex: `^${safeVariant}` }
                        });
                    }
                }

                if (prefixClauses.length === 1) {
                    andConditions.push(prefixClauses[0]);
                } else if (prefixClauses.length > 1) {
                    andConditions.push({ $or: prefixClauses });
                }
            }
        } catch (error) {
            console.error("Location filter error:", error);
            // Continue without location filter
        }

        // 3. JOB TITLE FILTER
        try {
            if (jobTitle) {
                let titleStr = jobTitle;
                if (Array.isArray(titleStr)) titleStr = titleStr.join(',');
                titleStr = String(titleStr).trim();
                
                if (titleStr) {
                    const titles = titleStr.split(',').map(t => t.trim()).filter(Boolean);
                    if (titles.length > 0) {
                        const escapedTitles = titles.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
                        const titlePattern = escapedTitles.join('|');
                        andConditions.push({ 
                            jobTitle: { $regex: titlePattern, $options: 'i' } 
                        });
                    }
                }
            }
        } catch (error) {
            console.error("Job title filter error:", error);
        }

        // 4. SKILLS FILTER
        try {
            if (skills) {
                let skillsStr = skills;
                if (Array.isArray(skillsStr)) skillsStr = skillsStr.join(',');
                skillsStr = String(skillsStr).trim();
                
                if (skillsStr) {
                    const skillList = skillsStr.split(',').map(s => s.trim()).filter(Boolean);
                    if (skillList.length > 0) {
                        const escapedSkills = skillList.map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
                        const skillPattern = escapedSkills.join('|');
                        andConditions.push({ 
                            skills: { $regex: skillPattern, $options: 'i' } 
                        });
                    }
                }
            }
        } catch (error) {
            console.error("Skills filter error:", error);
        }

        // 5. Toggles
        if (hasEmail === "true") {
            andConditions.push({ email: { $exists: true, $ne: "" } });
        }
        if (hasPhone === "true") {
            andConditions.push({ phone: { $exists: true, $ne: "" } });
        }
        if (hasLinkedin === "true") {
            andConditions.push({ linkedinUrl: { $exists: true, $ne: "" } });
        }

        // Add all conditions to $and if any exist
        if (andConditions.length > 0) {
            query.$and = andConditions;
        }

        // FIX: Don't use seek pagination with complex regex queries
        // Use simple skip/limit pagination for reliability
        let candidates;
        let totalCount = 0;
        let hasMore = false;

        try {
            // Use simple pagination - more reliable with complex queries
            let findQuery = Candidate.find(query)
                .select("fullName jobTitle skills company experience phone email linkedinUrl locality location country industry summary parseStatus parseWarnings createdAt score")
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limitNum + 1)
                .lean()
                .maxTimeMS(60000); // Increased to 60s to prevent timeouts

            if (locationHintIndex) {
                findQuery = findQuery.hint(locationHintIndex);
            }

            candidates = await findQuery;

            hasMore = candidates.length > limitNum;
            if (hasMore) {
                candidates.pop();
            }

            // Only count if we need to (first page or when totalCount is needed)
            if (skip === 0 && !hasMore) {
                totalCount = candidates.length;
            } else {
                // Approximate count - you can also use estimatedDocumentCount() for better performance
                totalCount = -1; // Indicates unknown total
            }

        } catch (dbError) {
            console.error("Database query error:", dbError);
            throw dbError; // Throw error instead of returning wrong data (fallback)
        }

        res.json({
            candidates,
            hasMore,
            totalPages: 0,
            currentPage: pageNum,
            totalCount,
        });
        
    } catch (err) {
        console.error("Search Error:", err);
        console.error("Error stack:", err.stack);
        
        // Send a proper error response
        res.status(500).json({ 
            message: "Search failed", 
            error: err.message,
            details: "Please try simplifying your search criteria"
        });
    }
};

// --- EXPORT SELECTED CANDIDATES TO CSV ---
export const exportCandidates = async (req, res) => {
	try {
		const { ids } = req.body; // Array of candidate IDs

		if (!ids || !Array.isArray(ids) || ids.length === 0) {
			return res.status(400).json({ message: "No candidate IDs provided" });
		}

		// Fetch candidates
		const candidates = await Candidate.find({
			_id: { $in: ids },
			isDeleted: false,
		})
			.select("-sourceFile -uploadJobId -__v")
			.lean();

		if (candidates.length === 0) {
			return res.status(404).json({ message: "No candidates found" });
		}

		// Convert to CSV
		const csvHeaders = [
			"Full Name",
			"Job Title",
			"Skills",
			"Company Name",
			"Experience",
			"Phone",
			"Email",
			"LinkedIn URL",
			"Location",
			"Industry",
			"Summary",
		];

		const csvRows = candidates
			.map((c) => cleanAndValidateCandidate(c)) // ETL: Clean & Validate
			.filter((res) => res.valid) // Remove invalid rows (Garbage data)
			.map((res) => res.data) // Extract cleaned data
			.map((candidate) => [
				candidate.fullName || "",
				candidate.jobTitle || "",
				candidate.skills || "",
				candidate.company || "",
				candidate.experience || "",
				candidate.phone || "",
				candidate.email || "",
				candidate.linkedinUrl || "",
				candidate.location || candidate.locality || candidate.country || "",
				candidate.industry || "",
				candidate.summary || "",
			]);

		const csvContent = [csvHeaders, ...csvRows]
			.map((row) =>
				row.map((field) => `"${String(field).replace(/"/g, '""')}"`).join(","),
			)
			.join("\n");

		const today = new Date();
		const day = String(today.getDate()).padStart(2, "0");
		const month = String(today.getMonth() + 1).padStart(2, "0");
		const year = today.getFullYear();
		const dateString = `${day}-${month}-${year}`;

		res.setHeader("Content-Type", "text/csv");
		res.setHeader(
			"Content-Disposition",
			`attachment; filename="candidates_export_${dateString}.csv"`,
		);
		res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");
		res.send(csvContent);
	} catch (err) {
		console.error("Export Error:", err);
		res.status(500).json({ message: "Export failed" });
	}
};

// --- PASSWORD VERIFICATION HELPER ---
const verifyAdminPassword = async (userId, password) => {
	const user = await User.findById(userId).select("+password");
	if (!user) {
		throw new Error("User not found");
	}
	const isMatch = await user.matchPassword(password);
	if (!isMatch) {
		throw new Error("Incorrect password");
	}
	return true;
};

// --- SOFT DELETE ROW ---
export const softDeleteCandidate = async (req, res) => {
	try {
		await Candidate.findByIdAndUpdate(req.params.id, { isDeleted: true });
		res.json({ message: "Moved to trash" });
	} catch (error) {
		res.status(500).json({ message: error.message });
	}
};

// --- UNDO DELETE ---
export const undoDeleteCandidate = async (req, res) => {
	try {
		await Candidate.findByIdAndUpdate(req.params.id, { isDeleted: false });
		res.json({ message: "Restored" });
	} catch (error) {
		res.status(500).json({ message: error.message });
	}
};

// --- SECURE NUKE (With Password) ---
export const nukeDatabase = async (req, res) => {
	try {
		const { password } = req.body;
		if (!password) {
			return res.status(400).json({ message: "Password is required" });
		}
		await verifyAdminPassword(req.user._id, password);

		await Candidate.deleteMany({});
		await UploadJob.deleteMany({});

		await DeleteLog.create({
			entityType: 'DATABASE',
			entityName: 'Full Database Reset',
			deletedBy: req.user._id
		});

		res.json({ message: "Database reset successfully" });
	} catch (error) {
		res.status(401).json({ message: error.message });
	}
};

// --- SECURE JOB DELETE (With Password) ---
export const deleteUploadJob = async (req, res) => {
	try {
		const { password } = req.body;
		if (!password) {
			return res.status(400).json({ message: "Password is required" });
		}
		await verifyAdminPassword(req.user._id, password);

		const { id } = req.params;
		const job = await UploadJob.findById(id);

		await Candidate.deleteMany({ uploadJobId: id });
		await UploadJob.findByIdAndUpdate(id, {
			status: "DELETED",
			successRows: 0,
			failedRows: 0,
			deletedAt: new Date(),
			deletedBy: req.user._id
		});

		if (job) {
			await DeleteLog.create({
				entityType: 'FILE',
				entityName: job.originalName || job.fileName,
				deletedBy: req.user._id
			});
		}

		res.json({ message: "Job deleted successfully" });
	} catch (error) {
		res.status(401).json({ message: error.message });
	}
};

// --- HELPER: Format Location for Resume ---
const formatLocationText = (...parts) => {
	const seen = new Set();

	return parts
		.filter(Boolean)
		.flatMap((part) =>
			String(part)
				.split(",")
				.map((p) => p.trim()),
		)
		.map((word) => word.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()))
		.filter((word) => {
			const key = word.toLowerCase();
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		})
		.join(", ");
};

export const downloadProfile = async (req, res) => {
	try {
		const candidate = await Candidate.findById(req.params.id);
		if (!candidate) {
			return res.status(404).json({ message: "Candidate not found" });
		}

		const cleanInline = (v) =>
			v
				? String(v)
					.replace(/\t/g, " ")
					.replace(/[\r\n]+/g, " ")
					.replace(/\s+/g, " ")
					.trim()
				: "";
		const toArray = (v) => (Array.isArray(v) ? v : v ? [v] : []);
		const parserData = candidate?.parsedResume?.raw?.ResumeParserData || {};

		const normalizeMultiline = (v) =>
			String(v || "")
				.replace(/\r\n/g, "\n")
				.replace(/\r/g, "\n")
				.replace(/\u0000/g, "")
				.split("\n")
				.map((line) => line.replace(/\t/g, " ").replace(/\s+/g, " ").trim())
				.filter(Boolean);

		const dedupeBy = (arr, keyFn) => {
			const map = new Map();
			for (const item of arr) {
				const key = keyFn(item);
				if (!key || map.has(key)) continue;
				map.set(key, item);
			}
			return [...map.values()];
		};

		const parseRchilliDate = (value) => {
			const v = cleanInline(value);
			const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
			if (!m) return 0;
			const day = Number(m[1]);
			const month = Number(m[2]) - 1;
			const year = Number(m[3]);
			const ts = new Date(year, month, day).getTime();
			return Number.isFinite(ts) ? ts : 0;
		};

		const normalizePhone = (value) => cleanInline(value).replace(/[^\d+]/g, "");

		const rawWebsites = toArray(parserData.WebSite)
			.map((w) => ({
				type: cleanInline(w?.Type),
				url: cleanInline(w?.Url || w?.URL),
			}))
			.filter((w) => w.url);

		const uniqueEmails = dedupeBy(
			[
				{ value: cleanInline(candidate.email) },
				...toArray(parserData.Email).map((e) => ({ value: cleanInline(e?.EmailAddress || e?.Email) })),
			].filter((x) => x.value),
			(x) => x.value.toLowerCase(),
		).map((x) => x.value);

		const uniquePhones = dedupeBy(
			[
				{ value: cleanInline(candidate.phone) },
				...toArray(parserData.PhoneNumber).map((p) => ({ value: cleanInline(p?.FormattedNumber || p?.Number) })),
			].filter((x) => x.value),
			(x) => normalizePhone(x.value),
		).map((x) => x.value);

		const linkedinLinks = dedupeBy(
			[
				{ url: cleanInline(candidate.linkedinUrl) },
				...rawWebsites
					.filter((w) => /linkedin/i.test(w.url) || /linkedin/i.test(w.type))
					.map((w) => ({ url: w.url })),
			].filter((x) => x.url),
			(x) => x.url.toLowerCase(),
		).map((x) => x.url);

		const otherWebsites = dedupeBy(
			rawWebsites.filter((w) => !/linkedin/i.test(w.url) && !/linkedin/i.test(w.type)),
			(w) => w.url.toLowerCase(),
		).map((w) => w.url);

		const candidateSkills = cleanInline(candidate.skills)
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean);

		const segregatedSkills = toArray(parserData.SegregatedSkill)
			.map((s) => ({
				name: cleanInline(s?.FormattedName || s?.Skill),
				lastUsed: cleanInline(s?.LastUsed),
				lastUsedTs: parseRchilliDate(s?.LastUsed),
				expMonths: Number(s?.ExperienceInMonths || 0),
			}))
			.filter((s) => s.name);

		const orderedSkills =
			segregatedSkills.length > 0
				? dedupeBy(
					segregatedSkills.sort((a, b) => {
						if (b.lastUsedTs !== a.lastUsedTs) return b.lastUsedTs - a.lastUsedTs;
						if (b.expMonths !== a.expMonths) return b.expMonths - a.expMonths;
						return a.name.localeCompare(b.name);
					}),
					(s) => s.name.toLowerCase(),
				  ).map((s) => s.name)
				: dedupeBy(candidateSkills.map((s) => ({ name: s })), (s) => s.name.toLowerCase()).map((s) => s.name);

		const addresses = toArray(parserData.Address);
		const qualifications = toArray(parserData.SegregatedQualification);
		const experiences = toArray(parserData.SegregatedExperience);
		const certifications = toArray(parserData.SegregatedCertification);
		const achievements = toArray(parserData.SegregatedAchievement);
		const publications = toArray(parserData.SegregatedPublication);

		const projectEntries = [];
		for (const exp of experiences) {
			const expEmployer = cleanInline(exp?.Employer?.EmployerName);
			const expRole = cleanInline(exp?.JobProfile?.Title || exp?.JobProfile?.FormattedName);
			const expPeriod = cleanInline(exp?.FormattedJobPeriod || exp?.JobPeriod);
			for (const p of toArray(exp?.Projects)) {
				const projectName = cleanInline(p?.ProjectName);
				const usedSkills = cleanInline(p?.UsedSkills);
				const teamSize = cleanInline(p?.TeamSize);
				if (!projectName && !usedSkills && !teamSize) continue;
				projectEntries.push({
					projectName: projectName || "Project",
					usedSkills,
					teamSize,
					employer: expEmployer,
					role: expRole,
					period: expPeriod,
				});
			}
		}

		const children = [];
		const addSectionHeader = (text) => {
			children.push(new Paragraph({ text, style: "SectionHeader" }));
		};
		const addLine = (text, opts = {}) => {
			const t = cleanInline(text);
			if (!t) return;
			children.push(
				new Paragraph({
					text: t,
					indent: opts.indent ? { left: opts.indent } : undefined,
					spacing: opts.spacing || { after: 60 },
				}),
			);
		};
		const addBullet = (text, indent = 360) => {
			const t = cleanInline(text);
			if (!t) return;
			children.push(
				new Paragraph({
					text: t,
					bullet: { level: 0 },
					indent: { left: indent },
					spacing: { after: 40 },
				}),
			);
		};
		const addMultiline = (text, { indent = 360, bullets = false } = {}) => {
			for (const line of normalizeMultiline(text)) {
				const isBulletLike = /^[\u2022\-*]/.test(line);
				const normalizedLine = line.replace(/^[\u2022\-*\s]+/, "").trim();
				if (bullets || isBulletLike) {
					addBullet(normalizedLine, indent);
				} else {
					addLine(normalizedLine, { indent });
				}
			}
		};
		const addKeyValue = (label, value, indent = 360) => {
			const v = cleanInline(value);
			if (!v) return;
			children.push(
				new Paragraph({
					indent: { left: indent },
					spacing: { after: 40 },
					children: [
						new TextRun({ text: `${label}: `, bold: true }),
						new TextRun({ text: v }),
					],
				}),
			);
		};

		const headerName =
			cleanInline(parserData?.Name?.FormattedName) ||
			cleanInline(parserData?.Name?.FullName) ||
			cleanInline(candidate.fullName).toUpperCase();
		const headerJob = cleanInline(parserData.JobProfile) || cleanInline(candidate.jobTitle);
		const headerLocation =
			cleanInline(addresses[0]?.FormattedAddress) ||
			formatLocationText(candidate.locality, candidate.location, candidate.country);

		children.push(
			new Paragraph({
				alignment: AlignmentType.CENTER,
				spacing: { after: 0 },
				children: [
					new TextRun({
						text: headerName || "CANDIDATE PROFILE",
						font: "Tahoma",
						bold: true,
						size: 36,
					}),
				],
			}),
		);

		if (headerJob) {
			children.push(
				new Paragraph({
					alignment: AlignmentType.CENTER,
					spacing: { after: 180 },
					children: [new TextRun({ text: headerJob, font: "Tahoma", size: 28 })],
				}),
			);
		}

		addLine(headerLocation);
		if (uniqueEmails.length > 0) addLine(uniqueEmails.join(" | "));
		if (uniquePhones.length > 0) addLine(uniquePhones.join(" | "));
		if (linkedinLinks.length > 0) addLine(linkedinLinks[0]);
		if (otherWebsites.length > 0) addLine(otherWebsites.slice(0, 3).join(" | "));

		children.push(
			new Paragraph({
				spacing: { after: 220 },
				border: {
					bottom: { color: "auto", space: 1, style: BorderStyle.SINGLE, size: 6 },
				},
			}),
		);

		addSectionHeader("PROFILE OVERVIEW");
		addKeyValue("Industry", cleanInline(candidate.industry) || cleanInline(parserData.Category));
		addKeyValue("Sub Category", cleanInline(parserData.SubCategory));
		addKeyValue(
			"Total Experience",
			cleanInline(candidate.experience) ||
				(cleanInline(parserData?.WorkedPeriod?.TotalExperienceInYear)
					? `${cleanInline(parserData.WorkedPeriod.TotalExperienceInYear)} Years`
					: ""),
		);
		addKeyValue("Current Employer", cleanInline(parserData.CurrentEmployer) || cleanInline(candidate.company));

		if (
			cleanInline(candidate.summary) ||
			cleanInline(parserData.Summary) ||
			cleanInline(parserData.ExecutiveSummary)
		) {
			addSectionHeader("PROFESSIONAL SUMMARY");
			addMultiline(cleanInline(candidate.summary) || parserData.Summary, { indent: 360 });
			if (cleanInline(parserData.ExecutiveSummary)) addMultiline(parserData.ExecutiveSummary, { indent: 360 });
			if (cleanInline(parserData.ManagementSummary)) addMultiline(parserData.ManagementSummary, { indent: 360 });
		}

		if (orderedSkills.length > 0) {
			addSectionHeader("SKILLS");
			for (const skillName of orderedSkills) addBullet(skillName);
		}

		if (experiences.length > 0 || cleanInline(parserData.Experience) || cleanInline(candidate.jobTitle) || cleanInline(candidate.company)) {
			addSectionHeader("WORK EXPERIENCE");
			if (experiences.length > 0) {
				for (const exp of experiences) {
					const role = cleanInline(exp?.JobProfile?.Title || exp?.JobProfile?.FormattedName || candidate.jobTitle);
					const employer = cleanInline(exp?.Employer?.EmployerName || candidate.company);
					const period = cleanInline(exp?.FormattedJobPeriod || exp?.JobPeriod);
					const location = cleanInline(
						[
							exp?.Location?.City,
							exp?.Location?.State,
							exp?.Location?.Country,
						]
							.filter(Boolean)
							.join(", "),
					);
					if (role || employer) {
						children.push(
							new Paragraph({
								indent: { left: 360 },
								spacing: { after: 40 },
								children: [
									new TextRun({ text: role || "Role", bold: true }),
									...(employer ? [new TextRun({ text: ` | ${employer}` })] : []),
								],
							}),
						);
					}
					addKeyValue("Period", period, 720);
					addKeyValue("Location", location, 720);

					if (cleanInline(exp?.JobDescription)) {
						addMultiline(exp.JobDescription, { indent: 720, bullets: true });
					}
				}
			} else {
				if (cleanInline(candidate.jobTitle) || cleanInline(candidate.company)) {
					addBullet([cleanInline(candidate.jobTitle), cleanInline(candidate.company)].filter(Boolean).join(" | "));
					addKeyValue("Experience", cleanInline(candidate.experience), 720);
				}
				if (cleanInline(parserData.Experience)) {
					addMultiline(parserData.Experience, { indent: 720, bullets: true });
				}
			}
		}

		if (projectEntries.length > 0) {
			addSectionHeader("PROJECTS");
			for (const project of projectEntries) {
				children.push(
					new Paragraph({
						indent: { left: 360 },
						spacing: { after: 40 },
						children: [new TextRun({ text: project.projectName, bold: true })],
					}),
				);
				addKeyValue("Organization", project.employer, 720);
				addKeyValue("Role", project.role, 720);
				addKeyValue("Period", project.period, 720);
				addKeyValue("Skills", project.usedSkills, 720);
				addKeyValue("Team Size", project.teamSize, 720);
			}
		}

		if (qualifications.length > 0 || cleanInline(parserData.Qualification)) {
			addSectionHeader("EDUCATION");
			if (qualifications.length > 0) {
				for (const edu of qualifications) {
					const degree = cleanInline(edu?.Degree?.DegreeName || edu?.Degree?.NormalizeDegree);
					const inst = cleanInline(edu?.Institution?.Name);
					const period = cleanInline(
						edu?.FormattedDegreePeriod || [edu?.StartDate, edu?.EndDate].filter(Boolean).join(" - "),
					);
					const location = cleanInline(
						[
							edu?.Institution?.Location?.City,
							edu?.Institution?.Location?.State,
							edu?.Institution?.Location?.Country,
						]
							.filter(Boolean)
							.join(", "),
					);
					addBullet([degree, inst].filter(Boolean).join(" | "));
					addKeyValue("Period", period, 720);
					addKeyValue("Location", location, 720);
					if (edu?.Degree?.Specialization?.length) {
						addKeyValue("Specialization", edu.Degree.Specialization.join(", "), 720);
					}
				}
			} else {
				addMultiline(parserData.Qualification, { indent: 360 });
			}
		}

		if (certifications.length > 0 || cleanInline(parserData.Certification)) {
			addSectionHeader("CERTIFICATIONS");
			for (const cert of certifications) {
				addBullet(
					[
						cleanInline(cert?.Certification),
						cleanInline(cert?.Issuer),
						cleanInline(cert?.Date),
					]
						.filter(Boolean)
						.join(" | "),
				);
			}
			if (cleanInline(parserData.Certification)) addMultiline(parserData.Certification, { indent: 360 });
		}

		if (achievements.length > 0 || cleanInline(parserData.Achievements)) {
			addSectionHeader("ACHIEVEMENTS");
			for (const ach of achievements) {
				addBullet(cleanInline(ach?.Achievement || ach?.Description || JSON.stringify(ach)));
			}
			if (cleanInline(parserData.Achievements)) addMultiline(parserData.Achievements, { indent: 360 });
		}

		if (publications.length > 0 || cleanInline(parserData.Publication)) {
			addSectionHeader("PUBLICATIONS");
			for (const pub of publications) {
				addBullet(cleanInline(pub?.Title || pub?.Publication || pub?.Description || JSON.stringify(pub)));
			}
			if (cleanInline(parserData.Publication)) addMultiline(parserData.Publication, { indent: 360 });
		}

		const faviconCandidates = [
			path.join(process.cwd(), "client", "public", "favicon.svg"),
			path.join(process.cwd(), "client", "public", "favicon-96x96.png"),
		];
		let faviconImage = null;
		for (const p of faviconCandidates) {
			if (!fs.existsSync(p)) continue;
			const ext = path.extname(p).toLowerCase();
			faviconImage = {
				data: fs.readFileSync(p),
				type: ext === ".svg" ? "svg" : ext === ".png" ? "png" : undefined,
			};
			break;
		}

		const doc = new Document({
			styles: {
				default: {
					document: {
						run: {
							font: "Calibri",
							size: 24, // 12pt body
						},
						paragraph: {
							spacing: {
								line: 276,
								after: 120,
							},
						},
					},
				},
				paragraphStyles: [
					{
						id: "SectionHeader",
						name: "Section Header",
						run: {
							font: "Calibri",
							bold: true,
							size: 28, // 14pt
						},
						paragraph: {
							spacing: {
								before: 240,
								after: 120,
							},
						},
					},
				],
			},

			sections: [
				{
					properties: {
						page: {
							margin: {
								top: 720,
								bottom: 720,
								left: 720,
								right: 720,
							},
						},
					},
					headers: faviconImage
						? {
							default: new Header({
								children: [
									new Paragraph({
										alignment: AlignmentType.RIGHT,
										spacing: { after: 60 },
										children: [
											new ImageRun({
												data: faviconImage.data,
												type: faviconImage.type,
												transformation: { width: 16, height: 16 },
											}),
										],
									}),
								],
							}),
						  }
						: undefined,
					children: [
						...children,
						new Paragraph({
							alignment: AlignmentType.CENTER,
							spacing: { before: 360 },
							children: [
								new TextRun({
									text: "Profile Generated by PeopleFinder",
									font: "Arial",
									size: 18,
									color: "666666",
									italics: true,
								}),
							],
						}),
					],
				},
			],
		});

		const buffer = await Packer.toBuffer(doc);

		const firstName = (cleanInline(candidate.fullName) || "Candidate").split(" ")[0];
		const today = new Date();
		const day = String(today.getDate()).padStart(2, "0");
		const month = String(today.getMonth() + 1).padStart(2, "0");
		const year = today.getFullYear();
		const dateString = `${day}-${month}-${year}`;
		const fileName = `${firstName}_${dateString}.docx`;

		// Set both standard and custom headers for robustness
		res.setHeader("X-Filename", fileName);
		res.setHeader(
			"Content-Disposition",
			`attachment; filename="${fileName}"`,
		);

		res.setHeader(
			"Content-Type",
			"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
		);
		// Expose both headers to the client-side script
		res.setHeader("Access-Control-Expose-Headers", "Content-Disposition, X-Filename");
		res.send(buffer);
	} catch (error) {
		console.error(error);
		res.status(500).json({ message: "Error generating resume" });
	}
};

// --- AI SEARCH QUERY ANALYSIS ---
export const analyzeSearchQuery = async (req, res) => {
	try {
		const { query } = req.body;
		if (!query) return res.status(400).json({ message: "Query is required" });

		const apiKey = process.env.OPENAI_API_KEY || process.env.VITE_OPENAI_API_KEY;
		if (!apiKey) return res.status(500).json({ message: "OpenAI API key not configured" });

		const systemPrompt = `
			You are a recruitment search assistant. Analyze the following user query and extract search filters.
			
			Rules:
			1. Normalize "jobTitle" to singular form (e.g., "Developer" instead of "Developers").
			2. Extract skills from the query and job title (e.g., "Python Developer" -> skills: "Python").
			3. Extract years of experience as a number (e.g., "5 years experience" -> experience: 5).
			4. For "q", remove generic words like "experienced", "needed", and also remove the experience part that is now in its own field.

			Return ONLY a valid JSON object with the following keys:
			- q: (string) General keywords not covered by other filters
			- jobTitle: (string) Job title (singular)
			- location: (string) Location or city
			- skills: (string) Comma-separated skills
			- experience: (number) Minimum years of experience as a number. Default to 0 if not mentioned.
			- hasEmail: (boolean) true if email/contact info is requested
			- hasPhone: (boolean) true if phone number is requested
			- hasLinkedin: (boolean) true if LinkedIn profile is requested
			
			If a field is not mentioned, use empty string or false.
		`;

		const response = await fetch("https://api.openai.com/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"Authorization": `Bearer ${apiKey}`
			},
			body: JSON.stringify({
				model: "gpt-4o-mini",
				messages: [
					{ role: "system", content: systemPrompt },
					{ role: "user", content: query }
				],
				response_format: { type: "json_object" },
				temperature: 0.1
			})
		});

		if (!response.ok) {
			const errText = await response.text();
			throw new Error(`OpenAI API Error: ${response.status} - ${errText}`);
		}

		const data = await response.json();
		const content = data.choices?.[0]?.message?.content;

		const filters = JSON.parse(content || "{}");
		res.json(filters);
	} catch (error) {
		console.error("AI Search Error:", error);
		res.status(500).json({ message: error.message || "Failed to analyze search query" });
	}
};
