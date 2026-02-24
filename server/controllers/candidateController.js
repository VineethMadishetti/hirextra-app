import importQueue, { processCsvJob, processResumeJob, processFolderJob } from "../utils/queue.js";
import Candidate from "../models/Candidate.js";
import UploadJob from "../models/UploadJob.js";
import User from "../models/User.js";
import EnrichmentLog from "../models/EnrichmentLog.js";
import logger from "../utils/logger.js";
import fs from "fs";
import DeleteLog from "../models/DeleteLog.js";
import csv from "csv-parser";
import path from "path";
import os from "os";
import readline from "readline";
import { fileURLToPath } from "url";
import {
	Document,
	Packer,
	Paragraph,
	TextRun,
	AlignmentType,
	Header,
	ImageRun,
	Table,
	TableRow,
	TableCell,
	WidthType,
	BorderStyle,
} from "docx";
import xlsx from "xlsx";
import {
	uploadToS3,
	generateS3Key,
	downloadFromS3,
	listS3FilesByPage,
} from "../utils/s3Service.js";
import {
	computeCandidateEnrichmentMeta,
	enrichCandidateProfile,
	getAllowedEnrichmentFields,
	sanitizeUpdateValue,
} from "../utils/enrichmentService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
const runDirectResumeImport = async ({ jobId, s3Prefix, skipExisting = true }) => {
	const s3ListPageSize = Math.max(100, Number(process.env.S3_LIST_PAGE_SIZE || 1000));
	const scanBatchSize = Math.max(100, Number(process.env.RESUME_IMPORT_SCAN_BATCH || 1000));
	const directConcurrency = Math.max(
		1,
		Number(
			process.env.RESUME_IMPORT_DIRECT_CONCURRENCY ||
			process.env.RESUME_PARSE_CONCURRENCY ||
			1,
		),
	);

	let discoveredCount = 0;
	let queuedCount = 0;
	let skippedExistingCount = 0;
	let sawAnyResumeFile = false;

	const running = new Set();
	const schedule = async (s3Key) => {
		const task = (async () => {
			try {
				await processResumeJob({
					jobId,
					s3Key,
					skipAutoFinalize: true,
					skipIfExists: !!skipExisting,
				});
			} catch (error) {
				console.error(`Direct resume processing failed for ${s3Key}:`, error?.message || error);
			}
		})().finally(() => running.delete(task));

		running.add(task);
		if (running.size >= directConcurrency) {
			await Promise.race(running);
		}
	};

	for await (const filesPage of listS3FilesByPage(s3Prefix, s3ListPageSize)) {
		const resumeFilesPage = filesPage.filter((f) =>
			f?.Key &&
			(
				f.Key.toLowerCase().endsWith(".pdf") ||
				f.Key.toLowerCase().endsWith(".docx") ||
				f.Key.toLowerCase().endsWith(".doc")
			),
		);

		if (resumeFilesPage.length === 0) continue;
		sawAnyResumeFile = true;
		discoveredCount += resumeFilesPage.length;

		for (let i = 0; i < resumeFilesPage.length; i += scanBatchSize) {
			const chunk = resumeFilesPage.slice(i, i + scanBatchSize).filter((f) => f?.Key);
			if (chunk.length === 0) continue;

			let filesToProcess = chunk;
			if (skipExisting) {
				const chunkKeys = chunk.map((f) => f.Key);
				const existingRows = await Candidate.find({
					sourceFile: { $in: chunkKeys },
					isDeleted: false,
				})
					.select("sourceFile -_id")
					.lean();

				const existingKeys = new Set(existingRows.map((row) => row.sourceFile));
				filesToProcess = chunk.filter((f) => !existingKeys.has(f.Key));
				skippedExistingCount += chunk.length - filesToProcess.length;
			}

			if (filesToProcess.length === 0) continue;

			queuedCount += filesToProcess.length;
			await UploadJob.findByIdAndUpdate(jobId, { totalRows: queuedCount, status: "PROCESSING" });

			for (const file of filesToProcess) {
				await schedule(file.Key);
			}
		}
	}

	await Promise.allSettled([...running]);

	if (!sawAnyResumeFile) {
		await UploadJob.findByIdAndUpdate(jobId, {
			status: "FAILED",
			error: "No PDF, DOCX, or DOC files found in that folder.",
		});
		return {
			fileCount: 0,
			queuedCount: 0,
			skippedExistingCount: 0,
			status: "FAILED",
		};
	}

	if (queuedCount === 0) {
		await UploadJob.findByIdAndUpdate(jobId, {
			status: "COMPLETED",
			totalRows: 0,
			successRows: 0,
			failedRows: 0,
			completedAt: new Date(),
		});
		return {
			fileCount: discoveredCount,
			queuedCount: 0,
			skippedExistingCount,
			status: "COMPLETED",
		};
	}

	const updatedJob = await UploadJob.findById(jobId).select("successRows failedRows").lean();
	const finalStatus = (updatedJob?.successRows || 0) > 0 ? "COMPLETED" : "FAILED";

	await UploadJob.findByIdAndUpdate(jobId, {
		status: finalStatus,
		completedAt: new Date(),
	});

	return {
		fileCount: discoveredCount,
		queuedCount,
		skippedExistingCount,
		status: finalStatus,
	};
};

export const importResumes = async (req, res) => {
	let createdJobId = null;
	try {
		const { folderPath, skipExisting, forceReparse = false } = req.body || {};
		if (!folderPath) return res.status(400).json({ message: "Folder path is required" });
		const allowReparse = String(process.env.RESUME_IMPORT_ALLOW_REPARSE || "false").toLowerCase() === "true";
		const safeSkipExisting = forceReparse && allowReparse ? false : skipExisting !== false;
		// Default to direct mode for resume imports to avoid Redis request caps on bulk folders.
		// Set RESUME_IMPORT_USE_QUEUE=true only when you explicitly want BullMQ queueing.
		const queueEnabledByEnv = String(process.env.RESUME_IMPORT_USE_QUEUE || "false").toLowerCase() === "true";
		const useQueueMode = queueEnabledByEnv && !!importQueue;

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

		// Queue mode (BullMQ + Redis)
		if (useQueueMode) {
			const s3ListPageSize = Math.max(100, Number(process.env.S3_LIST_PAGE_SIZE || 1000));
			const enqueueBatchSize = Math.max(100, Number(process.env.RESUME_IMPORT_ENQUEUE_BATCH || 1000));
			const resumeJobAttempts = Math.max(1, Number(process.env.RESUME_IMPORT_JOB_ATTEMPTS || 1));
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
					),
				);

				if (resumeFilesPage.length === 0) continue;
				sawAnyResumeFile = true;
				discoveredCount += resumeFilesPage.length;

				for (let i = 0; i < resumeFilesPage.length; i += enqueueBatchSize) {
					const chunk = resumeFilesPage.slice(i, i + enqueueBatchSize).filter((f) => f?.Key);
					if (chunk.length === 0) continue;

					let filesToQueue = chunk;
					if (safeSkipExisting) {
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
						data: { jobId: job._id, s3Key: file.Key, skipIfExists: !!safeSkipExisting },
						opts: {
							attempts: resumeJobAttempts,
							backoff: { type: "exponential", delay: 3000 },
							removeOnComplete: { age: 24 * 3600, count: 2000 },
							removeOnFail: { age: 7 * 24 * 3600, count: 5000 },
						},
					}));

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
					mode: "queue",
					jobId: job._id,
					fileCount: discoveredCount,
					queuedCount: 0,
					skippedExistingCount,
					skipExisting: !!safeSkipExisting,
				});
			}

			return res.json({
				message: "Import started",
				mode: "queue",
				jobId: job._id,
				fileCount: discoveredCount,
				queuedCount,
				skippedExistingCount,
				skipExisting: !!safeSkipExisting,
			});
		}

		// Direct mode (no Redis queue traffic)
		setImmediate(async () => {
			try {
				await runDirectResumeImport({
					jobId: job._id,
					s3Prefix,
					skipExisting: !!safeSkipExisting,
				});
			} catch (error) {
				console.error("Direct resume import failed:", error);
				await UploadJob.findByIdAndUpdate(job._id, {
					status: "FAILED",
					error: String(error?.message || error).slice(0, 1000),
				}).catch(() => {});
			}
		});

		return res.json({
			message: "Import started",
			mode: "direct",
			jobId: job._id,
			skipExisting: !!safeSkipExisting,
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
			logger.info(`🔄 Resuming job ${job._id} from row ${resumeFrom} via processFile endpoint`);

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
			}).catch(err => logger.error("Resume background error:", err));

			return res.json({ message: "Job resumed successfully", resumeFrom, jobId: job._id });
		}

		const { filePath, mapping, headers } = req.body;

		if (!filePath) {
			return res.status(400).json({ message: "File path is required" });
		}

		const normalizedPath = String(filePath).trim();
		const isFolderPath = normalizedPath.endsWith("/");

		logger.info(`📂 File/folder detection: "${filePath}" → normalized: "${normalizedPath}" → isFolder: ${isFolderPath}`);

		// For folder imports, we don't require headers (we'll use folder scanning instead)
		if (!isFolderPath && (!headers || headers.length === 0)) {
			return res
				.status(400)
				.json({ message: "Header information is required for file uploads" });
		}

		const fileName = path.basename(normalizedPath.replace(/\/$/, '')); // Remove trailing slash for display

		// ✅ FIX: Detect and route folder paths to folder processing
		if (isFolderPath) {
			logger.info(`📁 Folder import detected: ${normalizedPath}`);

			// 1. Create a DB Record for this Folder Job
			const newJob = await UploadJob.create({
				fileName: normalizedPath, // Keep the trailing slash for S3 prefix matching
				originalName: `Bulk Import: ${fileName}`,
				uploadedBy: req.user._id,
				status: "PROCESSING",
				totalRows: 0,
				successRows: 0,
				failedRows: 0,
				headers: ["Resume Import"], // Placeholder header for folder imports
				mapping: {}, // No mapping needed for folder imports
			});

			logger.info(`✅ Created folder job: ${newJob._id}. Starting background processing...`);

			// 2. Start folder processing in the background
			processFolderJob({ jobId: newJob._id, skipIfExists: req.body.skipIfExists })
				.then(() => logger.info(`✅ Folder job ${newJob._id} processing completed`))
				.catch(async (processingError) => {
					logger.error("Background folder processing failed:", processingError?.message || processingError);
					await UploadJob.findByIdAndUpdate(newJob._id, {
						status: "FAILED",
						error: (processingError?.message || String(processingError) || "Background folder processing failed").substring(0, 500),
					}).catch((e) => logger.error("Failed to update job on error:", e));
				});

			// Respond immediately; frontend can poll /job/:id/status for live updates
			return res.json({ message: "Folder processing started", jobId: newJob._id, type: "folder" });
		}

		// ===== ORIGINAL CSV FILE PROCESSING LOGIC =====
		logger.info(`📄 CSV file import detected: ${normalizedPath}`);

		// 1. Create a DB Record for this Job
		const newJob = await UploadJob.create({
			fileName: normalizedPath,
			originalName: fileName,
			uploadedBy: req.user._id,
			status: "MAPPING_PENDING",
			mapping,
			headers, // ✅ Save headers to the database
		});

		// 2. Start processing immediately in the background (no Redis required)
		//    We do NOT await here so the HTTP response returns quickly.
		processCsvJob({ jobId: newJob._id }).catch(async (processingError) => {
			logger.error("Background CSV processing failed:", processingError?.message || processingError);
			await UploadJob.findByIdAndUpdate(newJob._id, {
				status: "FAILED",
				error: processingError?.message || "Background processing failed",
			});
		});

		// Respond immediately; frontend can poll /job/:id/status for live updates
		return res.json({ message: "Processing started", jobId: newJob._id, type: "file" });
	} catch (error) {
		logger.error("Error in processFile:", error);
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
        let useTextSearch = false;
        let keywordRegexFallbackClause = null;
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
            const searchFields = ["fullName", "jobTitle", "skills", "company", "location", "locality"];

            const isEmail = safeQ.includes('@');
            const isPhone = /^[0-9+\-\s()]+$/.test(safeQ) && safeQ.replace(/\D/g, '').length > 5;

            if (isEmail) {
                andConditions.push({ email: new RegExp(`^${safeQ}`, "i") });
            } else if (isPhone) {
                andConditions.push({ phone: new RegExp(safeQ.replace(/\s+/g, ''), "i") });
            } else {
                const normalizedQ = String(searchQ || "").trim().replace(/\s+/g, " ");
                const hasCommaSeparatedTerms = normalizedQ.includes(",");

                if (hasCommaSeparatedTerms) {
                    const terms = parseCsvFilter(normalizedQ, 20)
                        .map((term) => String(term).trim().slice(0, 64))
                        .filter(Boolean);

                    const escapedTerms = terms.map((term) =>
                        term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
                    );
                    const keywordPattern = escapedTerms.join("|");
                    const keywordRegex = new RegExp(keywordPattern, "i");

                    keywordRegexFallbackClause = {
                        $or: searchFields.map((field) => ({ [field]: keywordRegex })),
                    };

                    const textSearch = terms
                        .join(" ")
                        .replace(/[^a-zA-Z0-9\s]/g, " ")
                        .replace(/\s+/g, " ")
                        .trim();

                    if (textSearch.length >= 2) {
                        andConditions.push({ $text: { $search: textSearch } });
                        useTextSearch = true;
                    } else {
                        andConditions.push(keywordRegexFallbackClause);
                    }
                } else {
                    const phrase = normalizedQ;
                    const safePhrase = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                    const phraseRegex = new RegExp(safePhrase, "i");
                    keywordRegexFallbackClause = {
                        $or: searchFields.map((field) => ({ [field]: phraseRegex })),
                    };

                    const textPhrase = phrase
                        .replace(/"/g, " ")
                        .replace(/[^a-zA-Z0-9\s]/g, " ")
                        .replace(/\s+/g, " ")
                        .trim();

                    if (textPhrase.length >= 2) {
                        andConditions.push({ $text: { $search: `"${textPhrase}"` } });
                        useTextSearch = true;
                    } else {
                        andConditions.push(keywordRegexFallbackClause);
                    }
                }
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
            const baseSelect =
                "fullName jobTitle skills company experience phone email linkedinUrl locality location country industry summary parseStatus parseWarnings createdAt score";
            const buildFindQuery = ({ withHint = true, customQuery = query } = {}) => {
                let findQuery = Candidate.find(customQuery)
                    .select(baseSelect)
                    .sort({ createdAt: -1 })
                    .skip(skip)
                    .limit(limitNum + 1)
                    .lean()
                    .maxTimeMS(20000);

                if (withHint && locationHintIndex) {
                    findQuery = findQuery.hint(locationHintIndex);
                }
                return findQuery;
            };

            try {
                candidates = await buildFindQuery({ withHint: true });
            } catch (dbError) {
                const msg = String(dbError?.message || "");
                const hintError =
                    !!locationHintIndex &&
                    /hint|failed to use index hint|bad hint/i.test(msg);
                const textIndexMissing =
                    useTextSearch &&
                    /text index|required for \$text|index not found for text query/i.test(msg);

                if (!hintError && !textIndexMissing) {
                    throw dbError;
                }

                let fallbackQuery = query;
                if (textIndexMissing && keywordRegexFallbackClause) {
                    const andWithoutText = (query.$and || []).filter((c) => !(c && c.$text));
                    fallbackQuery = {
                        ...query,
                        $and: [...andWithoutText, keywordRegexFallbackClause],
                    };
                }

                candidates = await buildFindQuery({
                    withHint: false,
                    customQuery: fallbackQuery,
                });
            }

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

// --- GET SINGLE CANDIDATE (DETAIL VIEW) ---
export const getCandidateById = async (req, res) => {
	try {
		const candidate = await Candidate.findOne({
			_id: req.params.id,
			isDeleted: false,
		})
			.select(
				"fullName jobTitle skills company experience phone email linkedinUrl locality location country industry summary availability candidateStatus internalTags recruiterNotes parseStatus parseWarnings createdAt sourceFile parsedResume",
			)
			.lean();

		if (!candidate) {
			return res.status(404).json({ message: "Candidate not found" });
		}

		return res.json(candidate);
	} catch (error) {
		if (error?.name === "CastError") {
			return res.status(400).json({ message: "Invalid candidate id" });
		}
		console.error("Get Candidate Error:", error);
		return res.status(500).json({ message: "Failed to fetch candidate details" });
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
		const normalizeUrlForDedup = (value) =>
			cleanInline(value)
				.toLowerCase()
				.replace(/^https?:\/\//, "")
				.replace(/^www\./, "")
				.replace(/[?#].*$/, "")
				.replace(/\/+$/, "");

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
			(x) => normalizeUrlForDedup(x.url),
		).map((x) => x.url);

		const otherWebsites = dedupeBy(
			rawWebsites.filter((w) => !/linkedin/i.test(w.url) && !/linkedin/i.test(w.type)),
			(w) => normalizeUrlForDedup(w.url),
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
		const workedPeriod = parserData?.WorkedPeriod || {};
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
			children.push(
				new Paragraph({
					text,
					style: "SectionHeader",
					border: {
						bottom: { color: "D1D5DB", space: 1, style: BorderStyle.SINGLE, size: 6 },
					},
					spacing: { before: 240, after: 120 },
				}),
			);
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
		const addMultiline = (text, { indent = 360, bullets = false, autoDetectBullets = true } = {}) => {
			for (const line of normalizeMultiline(text)) {
				const isBulletLike = /^[\u2022\-*]/.test(line);
				const normalizedLine = line.replace(/^[\u2022\-*\s]+/, "").trim();
				if (bullets || (autoDetectBullets && isBulletLike)) {
					addBullet(normalizedLine, indent);
				} else {
					addLine(normalizedLine, { indent });
				}
			}
		};
		const formatProfileOverviewLines = (text) => {
			const compact = cleanInline(text);
			if (!compact) return [];

			const withEntryBreaks = compact.replace(
				/\s+([A-Z][A-Za-z0-9&'()./+_-]{1,70}\s+[A-Za-z0-9-]+\.(?:com|net|org|io|ai|dev|app|in|co|edu|gov|vercel\.app|netlify\.app)\s*-\s*)/g,
				"\n$1",
			);

			const splitLines = withEntryBreaks
				.split(/\n+/)
				.flatMap((chunk) =>
					String(chunk || "")
						.split(/(?<=[.!?])\s+(?=[A-Z])/)
						.map((part) => part.trim()),
				)
				.map((line) => line.replace(/^[\u2022\-*\s]+/, "").replace(/\s+/g, " ").trim())
				.filter(Boolean);

			const merged = [];
			for (const line of splitLines) {
				if (
					merged.length > 0 &&
					line.length <= 24 &&
					!/[.!?]$/.test(merged[merged.length - 1])
				) {
					merged[merged.length - 1] = `${merged[merged.length - 1]} ${line}`
						.replace(/\s+/g, " ")
						.trim();
					continue;
				}
				merged.push(line);
			}

			return merged.length > 0 ? merged : [compact];
		};
		const addKeyValue = (label, value, indent = 360, options = {}) => {
			const v = cleanInline(value);
			if (!v) return;
			const { labelBold = false } = options;
			children.push(
				new Paragraph({
					indent: { left: indent },
					spacing: { after: 40 },
					children: [
						new TextRun({ text: `${label}: `, bold: labelBold }),
						new TextRun({ text: v }),
					],
				}),
			);
		};
		const addExperienceBullets = (text, indent = 720) => {
			const lines = normalizeMultiline(text);
			const merged = [];
			let current = "";

			const pushCurrent = () => {
				const cleaned = current.replace(/\s+/g, " ").trim();
				if (cleaned) merged.push(cleaned);
				current = "";
			};

			for (const line of lines) {
				const hadMarker = /^[\u2022\-*]/.test(line);
				const normalized = line.replace(/^[\u2022\-*\s]+/, "").trim();
				if (!normalized) continue;

				const shortFragment = normalized.length <= 35;
				const lowerStart = /^[a-z]/.test(normalized);
				const connectorStart = /^(and|or|with|to|by|for|in|on|of|as|at)\b/i.test(normalized);
				const currentLooksComplete = /[.!?:;]$/.test(current) || current.length > 120;

				if (!current) {
					current = normalized;
					continue;
				}

				if (hadMarker && !shortFragment && !lowerStart && !connectorStart && currentLooksComplete) {
					pushCurrent();
					current = normalized;
					continue;
				}

				current = `${current} ${normalized}`.replace(/\s+/g, " ").trim();
			}

			pushCurrent();

			const splitByLabelColon = (input) => {
				const normalized = input.replace(/\s+:\s+/g, ": ").replace(/\s+/g, " ").trim();
				const labelRegex = /\b([A-Za-z][A-Za-z0-9/&()\-]*(?:\s+[A-Za-z][A-Za-z0-9/&()\-]*){0,3}):\s*/g;
				const starts = [];
				let match;

				while ((match = labelRegex.exec(normalized)) !== null) {
					const label = String(match[1] || "").toLowerCase();
					if (label === "http" || label === "https") continue;
					starts.push(match.index);
				}

				if (starts.length === 0) return [normalized];

				const segments = [];
				let startIdx = 0;

				for (const idx of starts) {
					if (idx === 0) continue;
					const part = normalized.slice(startIdx, idx).trim();
					if (part) segments.push(part);
					startIdx = idx;
				}

				const tail = normalized.slice(startIdx).trim();
				if (tail) segments.push(tail);
				return segments.length > 0 ? segments : [normalized];
			};

			for (const item of merged) {
				for (const part of splitByLabelColon(item)) {
					const cleaned = part.trim();
					if (cleaned.length <= 2) continue;
					addBullet(cleaned, indent);
				}
			}
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

		const contactDetails = [
			{ label: "Email", value: uniqueEmails[0] || "" },
			{ label: "Phone", value: uniquePhones[0] || "" },
			{ label: "Location", value: headerLocation || "" },
			{ label: "LinkedIn", value: linkedinLinks[0] || "" },
			{ label: "Website", value: otherWebsites[0] || "" },
		].filter((item) => item.value);

		const professionalMetrics = [
			{
				label: "Total Experience",
				value: cleanInline(workedPeriod?.TotalExperienceInYear)
					? `${cleanInline(workedPeriod.TotalExperienceInYear)} years`
					: cleanInline(candidate.experience),
			},
			{
				label: "Average Stay",
				value: cleanInline(parserData?.AverageStay)
					? `${cleanInline(parserData.AverageStay)} months`
					: "",
			},
			{
				label: "Longest Stay",
				value: cleanInline(parserData?.LongestStay)
					? `${cleanInline(parserData.LongestStay)} months`
					: "",
			},
			{ label: "Current Employer", value: cleanInline(parserData?.CurrentEmployer || candidate.company) },
			{ label: "Current Role", value: cleanInline(parserData?.JobProfile || candidate.jobTitle) },
			{ label: "Industry", value: cleanInline(candidate.industry || parserData?.Category) },
		].filter((item) => item.value);

		children.push(
			new Table({
				indent: { size: 120, type: WidthType.DXA },
				width: { size: 100, type: WidthType.PERCENTAGE },
				borders: {
					top: { style: BorderStyle.NONE, size: 0, color: "auto" },
					bottom: { style: BorderStyle.NONE, size: 0, color: "auto" },
					left: { style: BorderStyle.NONE, size: 0, color: "auto" },
					right: { style: BorderStyle.NONE, size: 0, color: "auto" },
					insideHorizontal: { style: BorderStyle.NONE, size: 0, color: "auto" },
					insideVertical: { style: BorderStyle.NONE, size: 0, color: "auto" },
				},
				rows: [
					new TableRow({
						children: [
							new TableCell({
								width: { size: 50, type: WidthType.PERCENTAGE },
								children: [
									new Paragraph({
										spacing: { after: 80 },
										children: [new TextRun({ text: "CONTACT INFORMATION", bold: true })],
									}),
									...contactDetails.map(
										(item) =>
											new Paragraph({
												spacing: { after: 40 },
												children: [
													new TextRun({ text: `${item.label}: `, bold: true }),
													new TextRun({ text: item.value }),
												],
											}),
									),
								],
							}),
							new TableCell({
								width: { size: 50, type: WidthType.PERCENTAGE },
								children: [
									new Paragraph({
										spacing: { after: 80 },
										children: [new TextRun({ text: "PROFESSIONAL DETAILS", bold: true })],
									}),
									...professionalMetrics.map(
										(item) =>
											new Paragraph({
												spacing: { after: 40 },
												children: [
													new TextRun({ text: `${item.label}: `, bold: true }),
													new TextRun({ text: item.value }),
												],
											}),
									),
								],
							}),
						],
					}),
				],
			}),
		);

		children.push(
			new Paragraph({
				spacing: { after: 220 },
				border: {
					bottom: { color: "auto", space: 1, style: BorderStyle.SINGLE, size: 6 },
				},
			}),
		);

		const profileOverview = cleanInline(parserData.Summary) || cleanInline(candidate.summary);
		const summarySections = [
			{ label: "Executive Summary", value: cleanInline(parserData.ExecutiveSummary) },
			{ label: "Management Summary", value: cleanInline(parserData.ManagementSummary) },
		].filter((entry) => entry.value);

		if (profileOverview) {
			addSectionHeader("PROFILE OVERVIEW");
			const overviewLines = formatProfileOverviewLines(profileOverview);
			for (const line of overviewLines) {
				addLine(line, { indent: 360, spacing: { after: 80 } });
			}
		}

		if (orderedSkills.length > 0) {
			addSectionHeader("SKILLS");
			const splitAtOne = Math.ceil(orderedSkills.length / 3);
			const splitAtTwo = Math.ceil((orderedSkills.length * 2) / 3);
			const firstCol = orderedSkills.slice(0, splitAtOne);
			const secondCol = orderedSkills.slice(splitAtOne, splitAtTwo);
			const thirdCol = orderedSkills.slice(splitAtTwo);
			children.push(
				new Table({
					indent: { size: 360, type: WidthType.DXA },
					width: { size: 100, type: WidthType.PERCENTAGE },
					borders: {
						top: { style: BorderStyle.NONE, size: 0, color: "auto" },
						bottom: { style: BorderStyle.NONE, size: 0, color: "auto" },
						left: { style: BorderStyle.NONE, size: 0, color: "auto" },
						right: { style: BorderStyle.NONE, size: 0, color: "auto" },
						insideHorizontal: { style: BorderStyle.NONE, size: 0, color: "auto" },
						insideVertical: { style: BorderStyle.NONE, size: 0, color: "auto" },
					},
					rows: [
						new TableRow({
							children: [firstCol, secondCol, thirdCol].map(
								(col) =>
									new TableCell({
										width: { size: 33, type: WidthType.PERCENTAGE },
										children:
											col.length > 0
												? col.map(
														(skill) =>
															new Paragraph({
																bullet: { level: 0 },
																spacing: { after: 40 },
																children: [new TextRun({ text: skill })],
															}),
												  )
												: [new Paragraph({ text: "" })],
									}),
							),
						}),
					],
				}),
			);
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
								spacing: { before: 120, after: 80 },
								children: [
									new TextRun({ text: role || "Role", bold: true }),
									...(employer ? [new TextRun({ text: ` | ${employer}` })] : []),
								],
							}),
						);
					}
						addKeyValue("Period", period, 720, { labelBold: true });
						addKeyValue("Location", location, 720, { labelBold: true });

						if (cleanInline(exp?.JobDescription)) {
							addExperienceBullets(exp.JobDescription, 720);
						}
					}
				} else {
				if (cleanInline(candidate.jobTitle) || cleanInline(candidate.company)) {
					addBullet([cleanInline(candidate.jobTitle), cleanInline(candidate.company)].filter(Boolean).join(" | "));
					addKeyValue("Experience", cleanInline(candidate.experience), 720);
					}
					if (cleanInline(parserData.Experience)) {
						addExperienceBullets(parserData.Experience, 720);
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
						children: [new TextRun({ text: project.projectName })],
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
					addKeyValue("Period", period, 720, { labelBold: true });
					addKeyValue("Location", location, 720, { labelBold: true });
					if (edu?.Degree?.Specialization?.length) {
						addKeyValue("Specialization", edu.Degree.Specialization.join(", "), 720, { labelBold: true });
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

		if (summarySections.length > 0) {
			addSectionHeader("ADDITIONAL SUMMARY");
			for (const section of summarySections) {
				children.push(
					new Paragraph({
						indent: { left: 360 },
						spacing: { after: 60 },
						children: [new TextRun({ text: `${section.label}: ` }), new TextRun({ text: section.value })],
					}),
				);
			}
		}

		const logoNameFromEnv = cleanInline(process.env.RESUME_LOGO_FILE);
		const logoPathFromEnv = cleanInline(process.env.RESUME_LOGO_PATH);
		const logoCandidates = [
			// Absolute/relative explicit path override
			logoPathFromEnv
				? (path.isAbsolute(logoPathFromEnv)
					? logoPathFromEnv
					: path.resolve(__dirname, "..", logoPathFromEnv))
				: "",
			// Explicit override first
			logoNameFromEnv ? path.resolve(__dirname, "..", "public", logoNameFromEnv) : "",
			logoNameFromEnv ? path.join(process.cwd(), "server", "public", logoNameFromEnv) : "",
			logoNameFromEnv ? path.join(process.cwd(), "public", logoNameFromEnv) : "",
			// Preferred company branding names
			path.resolve(__dirname, "..", "public", "company-logo.png"),
			path.resolve(__dirname, "..", "public", "company-logo.jpg"),
			path.resolve(__dirname, "..", "public", "company-logo.jpeg"),
			path.resolve(__dirname, "..", "public", "logo.png"),
			path.resolve(__dirname, "..", "public", "logo.jpg"),
			path.resolve(__dirname, "..", "public", "logo.jpeg"),
			// Existing favicon fallbacks
			path.resolve(__dirname, "..", "public", "favicon-96x96.png"),
			path.resolve(__dirname, "..", "public", "favicon.png"),
			path.resolve(__dirname, "..", "public", "favicon.jpg"),
			path.resolve(__dirname, "..", "public", "favicon.jpeg"),
			// Runtime cwd fallbacks
			path.join(process.cwd(), "server", "public", "company-logo.png"),
			path.join(process.cwd(), "server", "public", "logo.png"),
			path.join(process.cwd(), "server", "public", "favicon-96x96.png"),
			path.join(process.cwd(), "server", "public", "favicon.png"),
			path.join(process.cwd(), "public", "company-logo.png"),
			path.join(process.cwd(), "public", "logo.png"),
			path.join(process.cwd(), "public", "favicon-96x96.png"),
			path.join(process.cwd(), "public", "favicon.png"),
			// SVG fallback at the end
			path.resolve(__dirname, "..", "public", "company-logo.svg"),
			path.resolve(__dirname, "..", "public", "logo.svg"),
			path.resolve(__dirname, "..", "public", "favicon.svg"),
			path.join(process.cwd(), "server", "public", "company-logo.svg"),
			path.join(process.cwd(), "server", "public", "logo.svg"),
			path.join(process.cwd(), "server", "public", "favicon.svg"),
			path.join(process.cwd(), "public", "company-logo.svg"),
			path.join(process.cwd(), "public", "logo.svg"),
			path.join(process.cwd(), "public", "favicon.svg"),
		].filter(Boolean);
		let logoImage = null;
		let logoSourcePath = "";
		for (const p of logoCandidates) {
			if (!fs.existsSync(p)) continue;
			const ext = path.extname(p).toLowerCase();
			const type =
				ext === ".png"
					? "png"
					: ext === ".jpg" || ext === ".jpeg"
						? "jpg"
						: ext === ".svg"
							? "svg"
							: undefined;
			if (!type) continue;
			logoImage = {
				data: fs.readFileSync(p),
				type,
			};
			logoSourcePath = p;
			break;
		}
		if (logoImage) {
			console.log(`[RESUME_LOGO] Using logo: ${logoSourcePath}`);
			children.unshift(
				new Paragraph({
					alignment: AlignmentType.RIGHT,
					spacing: { after: 120 },
					children: [
							new ImageRun({
								data: logoImage.data,
								type: logoImage.type,
								transformation: { width: 72, height: 72 },
							}),
					],
				}),
			);
		} else {
			console.warn("[RESUME_LOGO] No logo file found. Checked common public paths and env overrides.");
		}
		const buildLogoParagraph = () =>
			new Paragraph({
				alignment: AlignmentType.RIGHT,
				spacing: { after: 60 },
				children: logoImage
					? [
							new ImageRun({
								data: logoImage.data,
								type: logoImage.type,
								transformation: { width: 32, height: 32 },
							}),
					  ]
					: [],
			});

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
					headers: logoImage
						? {
							default: new Header({ children: [buildLogoParagraph()] }),
							first: new Header({ children: [buildLogoParagraph()] }),
							even: new Header({ children: [buildLogoParagraph()] }),
						  }
						: undefined,
					children: [
						...children,
						...(logoImage
							? [
									new Paragraph({
										alignment: AlignmentType.RIGHT,
										spacing: { before: 260, after: 40 },
										children: [
											new ImageRun({
												data: logoImage.data,
												type: logoImage.type,
												transformation: { width: 32, height: 32 },
											}),
										],
									}),
							  ]
							: []),
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

const getMissingStringFieldCondition = (field) => ({
	$or: [{ [field]: { $exists: false } }, { [field]: null }, { [field]: "" }],
});

const getMissingLocationCondition = () => ({
	$and: [getMissingStringFieldCondition("location"), getMissingStringFieldCondition("locality")],
});

const buildNeedsEnrichmentQuery = (staleCutoffDate) => ({
	$or: [
		getMissingStringFieldCondition("email"),
		getMissingStringFieldCondition("phone"),
		getMissingStringFieldCondition("linkedinUrl"),
		getMissingStringFieldCondition("jobTitle"),
		getMissingStringFieldCondition("company"),
		getMissingStringFieldCondition("skills"),
		getMissingLocationCondition(),
		{ updatedAt: { $lte: staleCutoffDate } },
	],
});

const mapEnrichmentQueueCandidate = (candidateDoc) => {
	const candidate =
		typeof candidateDoc?.toObject === "function" ? candidateDoc.toObject() : candidateDoc;
	const meta = computeCandidateEnrichmentMeta(candidate);
	const suggestionStatus = candidate?.enrichment?.suggestionStatus || "NONE";
	const verificationStatus =
		candidate?.enrichment?.verificationStatus || "NEEDS_REVIEW";
	return {
		_id: candidate._id,
		fullName: candidate.fullName || "Unknown Candidate",
		jobTitle: candidate.jobTitle || "",
		company: candidate.company || "",
		email: candidate.email || "",
		phone: candidate.phone || "",
		linkedinUrl: candidate.linkedinUrl || "",
		location: candidate.location || "",
		locality: candidate.locality || "",
		country: candidate.country || "",
		skills: candidate.skills || "",
		availability: candidate.availability || "UNKNOWN",
		candidateStatus: candidate.candidateStatus || "ACTIVE",
		updatedAt: candidate.updatedAt,
		parseStatus: candidate.parseStatus || "",
		completenessScore: meta.completenessScore,
		missingFields: meta.missingFields,
		staleDays: meta.staleDays,
		needsEnrichment: meta.needsEnrichment,
		suggestionStatus,
		verificationStatus,
		lastEnrichedAt: candidate?.enrichment?.lastEnrichedAt || null,
		provider: candidate?.enrichment?.provider || "",
	};
};

const enrichCandidateSelect =
	"fullName jobTitle company email phone linkedinUrl location locality country skills summary industry experience availability candidateStatus internalTags recruiterNotes sourceFile parsedResume parseStatus enrichment updatedAt createdAt isDeleted";
const MANUAL_ENRICH_UPDATE_FIELDS = new Set(getAllowedEnrichmentFields());
const VERIFICATION_STATUSES = new Set([
	"NEEDS_REVIEW",
	"VERIFIED",
	"NOT_VERIFIED",
]);
const AVAILABILITY_STATUSES = new Set([
	"IMMEDIATE",
	"15_DAYS",
	"30_DAYS",
	"UNKNOWN",
]);
const CANDIDATE_STATUSES = new Set(["ACTIVE", "PASSIVE", "NOT_AVAILABLE"]);

const toArray = (value) => (Array.isArray(value) ? value : value ? [value] : []);

const cleanInlineText = (value) =>
	String(value || "")
		.replace(/\s+/g, " ")
		.trim();

const extractTimelineBullets = (experienceItem) => {
	const bullets = [];
	const addFromText = (value) => {
		const lines = String(value || "")
			.replace(/\r\n/g, "\n")
			.replace(/\r/g, "\n")
			.split(/\n+/g)
			.map((line) => line.replace(/^[\u2022\-*\s]+/, "").trim())
			.filter(Boolean);
		for (const line of lines) bullets.push(line);
	};

	addFromText(experienceItem?.JobDescription);
	addFromText(experienceItem?.Responsibilities);
	addFromText(experienceItem?.Responsibility);
	addFromText(experienceItem?.Summary);

	for (const project of toArray(experienceItem?.Projects)) {
		const projectName = cleanInlineText(project?.ProjectName);
		const projectDescription = cleanInlineText(project?.ProjectDescription);
		const usedSkills = cleanInlineText(project?.UsedSkills);
		if (projectDescription) addFromText(projectDescription);
		if (projectName && usedSkills) {
			bullets.push(`${projectName} (${usedSkills})`);
		} else if (projectName) {
			bullets.push(projectName);
		}
	}

	const deduped = [];
	const seen = new Set();
	for (const bullet of bullets) {
		const normalized = cleanInlineText(bullet);
		if (!normalized) continue;
		const key = normalized.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		deduped.push(normalized);
	}
	return deduped.slice(0, 4);
};

const extractExperienceTimeline = (candidate) => {
	const parserData = candidate?.parsedResume?.raw?.ResumeParserData || {};
	const segregatedExperience = toArray(parserData?.SegregatedExperience);
	if (segregatedExperience.length === 0) return [];

	return segregatedExperience
		.map((item) => {
			const company = cleanInlineText(
				item?.Employer?.EmployerName || item?.CompanyName || item?.EmployerName,
			);
			const role = cleanInlineText(
				item?.JobProfile?.Title || item?.JobProfile?.FormattedName || item?.JobTitle,
			);
			const period = cleanInlineText(
				item?.FormattedJobPeriod ||
					[item?.StartDate, item?.EndDate].filter(Boolean).join(" - "),
			);
			const highlights = extractTimelineBullets(item);

			if (!company && !role && !period && highlights.length === 0) return null;
			return {
				company,
				role,
				period,
				highlights,
			};
		})
		.filter(Boolean);
};

export const getEnrichmentQueue = async (req, res) => {
	try {
		res.setHeader("Cache-Control", "no-store");
		const pageNum = Math.max(1, Number(req.query.page) || 1);
		const limitNum = Math.min(100, Math.max(5, Number(req.query.limit) || 25));
		const skip = (pageNum - 1) * limitNum;
		const q = String(req.query.q || "").trim();
		const needsOnly = String(req.query.needsOnly || "true").toLowerCase() === "true";
		const staleCutoffDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

		const filterClauses = [{ isDeleted: false }];
		if (q) {
			const safeQ = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
			const regex = new RegExp(safeQ, "i");
			filterClauses.push({
				$or: [
					{ fullName: regex },
					{ jobTitle: regex },
					{ company: regex },
					{ skills: regex },
					{ location: regex },
					{ locality: regex },
				],
			});
		}
		if (needsOnly) {
			filterClauses.push(buildNeedsEnrichmentQuery(staleCutoffDate));
		}

		const query =
			filterClauses.length === 1 ? filterClauses[0] : { $and: filterClauses };

		const [totalCount, candidates, summaryCounts] = await Promise.all([
			Candidate.countDocuments(query),
			Candidate.find(query)
				.select(enrichCandidateSelect)
				.sort({ updatedAt: 1, createdAt: 1 })
				.skip(skip)
				.limit(limitNum)
				.lean()
				.maxTimeMS(20000),
			Promise.all([
				Candidate.countDocuments({ isDeleted: false }),
				Candidate.countDocuments({
					isDeleted: false,
					$or: [
						getMissingStringFieldCondition("email"),
						getMissingStringFieldCondition("phone"),
						getMissingStringFieldCondition("linkedinUrl"),
					],
				}),
				Candidate.countDocuments({
					isDeleted: false,
					$and: [
						{ email: { $exists: true, $ne: "" } },
						{ phone: { $exists: true, $ne: "" } },
						{ linkedinUrl: { $exists: true, $ne: "" } },
						{ jobTitle: { $exists: true, $ne: "" } },
						{ company: { $exists: true, $ne: "" } },
						{ skills: { $exists: true, $ne: "" } },
						{
							$or: [
								{ location: { $exists: true, $ne: "" } },
								{ locality: { $exists: true, $ne: "" } },
							],
						},
					],
				}),
				Candidate.countDocuments({
					isDeleted: false,
					updatedAt: { $lte: staleCutoffDate },
				}),
			]),
		]);

		const queueItems = candidates
			.map(mapEnrichmentQueueCandidate)
			.sort((a, b) => {
				if (a.needsEnrichment !== b.needsEnrichment) {
					return a.needsEnrichment ? -1 : 1;
				}
				if (a.completenessScore !== b.completenessScore) {
					return a.completenessScore - b.completenessScore;
				}
				if (a.staleDays !== b.staleDays) {
					return b.staleDays - a.staleDays;
				}
				return String(a.fullName || "").localeCompare(String(b.fullName || ""));
			});

		const pageAverageCompleteness =
			queueItems.length > 0
				? Math.round(
						queueItems.reduce((sum, item) => sum + (item.completenessScore || 0), 0) /
							queueItems.length,
				  )
				: 0;

		const [allActiveCount, missingContactCount, readyToSubmitCount, staleCount] =
			summaryCounts;

		return res.json({
			items: queueItems,
			page: pageNum,
			limit: limitNum,
			totalCount,
			hasMore: skip + queueItems.length < totalCount,
			summary: {
				needEnrichment: Math.max(0, allActiveCount - readyToSubmitCount),
				readyToSubmit: readyToSubmitCount,
				missingContact: missingContactCount,
				staleProfiles: staleCount,
				avgCompleteness: pageAverageCompleteness,
				totalActive: allActiveCount,
			},
		});
	} catch (error) {
		console.error("Enrichment Queue Error:", error);
		return res.status(500).json({ message: "Failed to load enrichment queue" });
	}
};

export const runCandidateEnrichment = async (req, res) => {
	try {
		const candidateIds = Array.isArray(req.body?.candidateIds)
			? req.body.candidateIds.map((id) => String(id)).filter(Boolean)
			: [];

		if (candidateIds.length === 0) {
			return res.status(400).json({ message: "candidateIds are required" });
		}
		if (candidateIds.length > 50) {
			return res
				.status(400)
				.json({ message: "Maximum 50 candidates per enrichment run" });
		}

		const candidates = await Candidate.find({
			_id: { $in: candidateIds },
			isDeleted: false,
		}).select(enrichCandidateSelect);

		if (!candidates.length) {
			return res.status(404).json({ message: "No candidates found for enrichment" });
		}

		const results = [];

		for (const candidate of candidates) {
			try {
				const enrichmentResult = await enrichCandidateProfile(candidate);
				const metaBefore = enrichmentResult.metaBefore;
				const now = new Date();

				candidate.enrichment = {
					...(candidate.enrichment || {}),
					completenessScore: metaBefore.completenessScore,
					missingFields: metaBefore.missingFields,
					staleDays: metaBefore.staleDays,
					needsEnrichment: metaBefore.needsEnrichment,
					suggestionStatus:
						enrichmentResult.suggestions.length > 0 ? "PENDING" : "NONE",
					lastEnrichedAt: now,
					provider: enrichmentResult.provider,
					suggestedUpdates:
						enrichmentResult.suggestions.length > 0
							? {
									items: enrichmentResult.suggestions,
									provider: enrichmentResult.provider,
									generatedAt: now.toISOString(),
							  }
							: null,
				};
				await candidate.save();

				if (enrichmentResult.suggestions.length > 0) {
					await EnrichmentLog.create({
						candidateId: candidate._id,
						action: "RUN",
						provider: enrichmentResult.provider,
						performedBy: req.user._id,
						changes: enrichmentResult.suggestions.map((item) => ({
							field: item.field,
							oldValue: item.currentValue || "",
							newValue: item.suggestedValue || "",
							confidence: item.confidence || 0,
							source: item.source || "",
						})),
						metadata: {
							missingFields: metaBefore.missingFields,
							completenessScore: metaBefore.completenessScore,
						},
					});
				}

				results.push({
					candidateId: String(candidate._id),
					status: "ENRICHED",
					suggestionsCount: enrichmentResult.suggestions.length,
					provider: enrichmentResult.provider,
				});
			} catch (err) {
				results.push({
					candidateId: String(candidate._id),
					status: "FAILED",
					error: err?.message || "Unknown enrichment error",
				});
			}
		}

		const successCount = results.filter((r) => r.status === "ENRICHED").length;
		const failedCount = results.length - successCount;

		return res.json({
			message: `Enrichment completed for ${successCount}/${results.length} candidates`,
			processed: results.length,
			successCount,
			failedCount,
			results,
		});
	} catch (error) {
		console.error("Run Enrichment Error:", error);
		return res.status(500).json({ message: "Failed to run enrichment" });
	}
};

export const getCandidateEnrichmentDetail = async (req, res) => {
	try {
		const candidate = await Candidate.findOne({
			_id: req.params.id,
			isDeleted: false,
		})
			.select(enrichCandidateSelect)
			.lean();

		if (!candidate) {
			return res.status(404).json({ message: "Candidate not found" });
		}

		const meta = computeCandidateEnrichmentMeta(candidate);
		const suggestions = Array.isArray(
			candidate?.enrichment?.suggestedUpdates?.items,
		)
			? candidate.enrichment.suggestedUpdates.items
			: [];

		return res.json({
			candidate: {
				_id: candidate._id,
				fullName: candidate.fullName || "",
				email: candidate.email || "",
				phone: candidate.phone || "",
				linkedinUrl: candidate.linkedinUrl || "",
				jobTitle: candidate.jobTitle || "",
				company: candidate.company || "",
				location: candidate.location || "",
				locality: candidate.locality || "",
				country: candidate.country || "",
				skills: candidate.skills || "",
				summary: candidate.summary || "",
				availability: candidate.availability || "UNKNOWN",
				candidateStatus: candidate.candidateStatus || "ACTIVE",
				internalTags: candidate.internalTags || "",
				recruiterNotes: candidate.recruiterNotes || "",
				industry: candidate.industry || "",
				experience: candidate.experience || "",
				sourceFile: candidate.sourceFile || "",
				experienceTimeline: extractExperienceTimeline(candidate),
				hasResume: !!candidate.sourceFile || !!candidate.parsedResume,
				updatedAt: candidate.updatedAt,
				parseStatus: candidate.parseStatus || "",
			},
			meta: {
				...meta,
				suggestionStatus: candidate?.enrichment?.suggestionStatus || "NONE",
				verificationStatus:
					candidate?.enrichment?.verificationStatus || "NEEDS_REVIEW",
				lastEnrichedAt: candidate?.enrichment?.lastEnrichedAt || null,
				lastReviewedAt: candidate?.enrichment?.lastReviewedAt || null,
				lastVerifiedAt: candidate?.enrichment?.lastVerifiedAt || null,
				lastVerifiedBy: candidate?.enrichment?.lastVerifiedBy || null,
				provider: candidate?.enrichment?.provider || "",
			},
			suggestions,
		});
	} catch (error) {
		console.error("Enrichment Detail Error:", error);
		return res.status(500).json({ message: "Failed to fetch enrichment detail" });
	}
};

export const reviewCandidateEnrichment = async (req, res) => {
	try {
		const { action, selectedFields = [], manualUpdates = {} } = req.body || {};
		const normalizedAction = String(action || "").toUpperCase();
		if (!["APPROVE", "REJECT", "EDIT"].includes(normalizedAction)) {
			return res
				.status(400)
				.json({ message: "action must be APPROVE, REJECT or EDIT" });
		}

		const candidate = await Candidate.findOne({
			_id: req.params.id,
			isDeleted: false,
		}).select(enrichCandidateSelect);
		if (!candidate) {
			return res.status(404).json({ message: "Candidate not found" });
		}

		const existingSuggestions = Array.isArray(
			candidate?.enrichment?.suggestedUpdates?.items,
		)
			? candidate.enrichment.suggestedUpdates.items
			: [];

		const appliedChanges = [];
		const now = new Date();

		if (normalizedAction === "APPROVE") {
			const selectedSet = new Set(
				Array.isArray(selectedFields) && selectedFields.length > 0
					? selectedFields.map((f) => String(f).trim())
					: existingSuggestions.map((s) => s.field),
			);

			for (const suggestion of existingSuggestions) {
				if (!selectedSet.has(String(suggestion.field))) continue;
				const field = String(suggestion.field || "").trim();
				const sanitizedValue = sanitizeUpdateValue(field, suggestion.suggestedValue);
				if (!sanitizedValue) continue;

				const previousValue = String(candidate[field] || "").trim();
				if (previousValue.toLowerCase() === sanitizedValue.toLowerCase()) continue;

				candidate[field] = sanitizedValue;
				appliedChanges.push({
					field,
					oldValue: previousValue,
					newValue: sanitizedValue,
					confidence: Number(suggestion.confidence || 0),
					source: suggestion.source || "enrichment",
				});
			}
		} else if (normalizedAction === "EDIT") {
			const entries = Object.entries(manualUpdates || {});
			for (const [field, nextValue] of entries) {
				const sanitizedValue = sanitizeUpdateValue(field, nextValue);
				if (!sanitizedValue) continue;
				const previousValue = String(candidate[field] || "").trim();
				if (previousValue.toLowerCase() === sanitizedValue.toLowerCase()) continue;
				candidate[field] = sanitizedValue;
				appliedChanges.push({
					field,
					oldValue: previousValue,
					newValue: sanitizedValue,
					confidence: 100,
					source: "manual",
				});
			}
		}

		const metaAfter =
			normalizedAction === "REJECT" && appliedChanges.length === 0
				? computeCandidateEnrichmentMeta(candidate)
				: computeCandidateEnrichmentMeta(candidate);

		candidate.enrichment = {
			...(candidate.enrichment || {}),
			completenessScore: metaAfter.completenessScore,
			missingFields: metaAfter.missingFields,
			staleDays: metaAfter.staleDays,
			needsEnrichment: metaAfter.needsEnrichment,
			suggestionStatus:
				normalizedAction === "REJECT"
					? "REJECTED"
					: appliedChanges.length > 0
						? "APPLIED"
						: "REJECTED",
			lastReviewedAt: now,
			lastReviewedBy: req.user._id,
			suggestedUpdates: null,
		};
		await candidate.save();

		await EnrichmentLog.create({
			candidateId: candidate._id,
			action: normalizedAction,
			provider: candidate?.enrichment?.provider || "",
			performedBy: req.user._id,
			changes: appliedChanges,
			metadata: {
				selectionCount: Array.isArray(selectedFields) ? selectedFields.length : 0,
			},
		});

		const actionLabel = {
			APPROVE: "approved",
			REJECT: "rejected",
			EDIT: "saved",
		}[normalizedAction];

		return res.json({
			message: `Enrichment ${actionLabel || "updated"} successfully`,
			appliedCount: appliedChanges.length,
			candidate: mapEnrichmentQueueCandidate(candidate.toObject()),
		});
	} catch (error) {
		console.error("Review Enrichment Error:", error);
		return res.status(500).json({ message: "Failed to review enrichment" });
	}
};

export const saveCandidateEnrichmentManual = async (req, res) => {
	try {
		const { updates = {}, verificationStatus = "" } = req.body || {};
		const normalizedVerification = String(verificationStatus || "")
			.trim()
			.toUpperCase();

		if (updates && typeof updates !== "object") {
			return res
				.status(400)
				.json({ message: "updates must be an object of field-value pairs" });
		}
		if (
			normalizedVerification &&
			!VERIFICATION_STATUSES.has(normalizedVerification)
		) {
			return res.status(400).json({
				message:
					"verificationStatus must be VERIFIED, NOT_VERIFIED, or NEEDS_REVIEW",
			});
		}

		const candidate = await Candidate.findOne({
			_id: req.params.id,
			isDeleted: false,
		}).select(enrichCandidateSelect);
		if (!candidate) {
			return res.status(404).json({ message: "Candidate not found" });
		}

		const now = new Date();
		const editChanges = [];
		for (const [rawField, nextValueRaw] of Object.entries(updates || {})) {
			const field = String(rawField || "").trim();
			if (!MANUAL_ENRICH_UPDATE_FIELDS.has(field)) continue;

			const sanitizedValue = sanitizeUpdateValue(field, nextValueRaw);
			if (field === "availability" && !AVAILABILITY_STATUSES.has(sanitizedValue)) {
				return res.status(400).json({
					message: "availability must be IMMEDIATE, 15_DAYS, 30_DAYS or UNKNOWN",
				});
			}
			if (field === "candidateStatus" && !CANDIDATE_STATUSES.has(sanitizedValue)) {
				return res.status(400).json({
					message: "candidateStatus must be ACTIVE, PASSIVE or NOT_AVAILABLE",
				});
			}
			const previousValue = String(candidate[field] || "").trim();
			if (previousValue.toLowerCase() === sanitizedValue.toLowerCase()) continue;

			candidate[field] = sanitizedValue;
			editChanges.push({
				field,
				oldValue: previousValue,
				newValue: sanitizedValue,
				confidence: 100,
				source: "manual",
			});
		}

		const previousVerification =
			candidate?.enrichment?.verificationStatus || "NEEDS_REVIEW";
		let verificationChanged = false;
		if (
			normalizedVerification &&
			normalizedVerification !== String(previousVerification).toUpperCase()
		) {
			verificationChanged = true;
		}

		const metaAfter = computeCandidateEnrichmentMeta(candidate);
		candidate.enrichment = {
			...(candidate.enrichment || {}),
			completenessScore: metaAfter.completenessScore,
			missingFields: metaAfter.missingFields,
			staleDays: metaAfter.staleDays,
			needsEnrichment: metaAfter.needsEnrichment,
			lastReviewedAt: now,
			lastReviewedBy: req.user._id,
			...(normalizedVerification
				? {
						verificationStatus: normalizedVerification,
						lastVerifiedAt:
							normalizedVerification === "VERIFIED" ? now : null,
						lastVerifiedBy:
							normalizedVerification === "VERIFIED" ? req.user._id : null,
				  }
				: {}),
		};
		await candidate.save();

		if (editChanges.length > 0) {
			await EnrichmentLog.create({
				candidateId: candidate._id,
				action: "EDIT",
				provider: "manual",
				performedBy: req.user._id,
				changes: editChanges,
				metadata: {
					editCount: editChanges.length,
				},
			});
		}

		if (verificationChanged) {
			await EnrichmentLog.create({
				candidateId: candidate._id,
				action: "VERIFY",
				provider: "manual",
				performedBy: req.user._id,
				changes: [
					{
						field: "verificationStatus",
						oldValue: String(previousVerification || ""),
						newValue: normalizedVerification,
						confidence: 100,
						source: "manual",
					},
				],
				metadata: null,
			});
		}

		return res.json({
			message: "Candidate updates saved",
			updatedCount: editChanges.length,
			verificationChanged,
			candidate: mapEnrichmentQueueCandidate(candidate.toObject()),
		});
	} catch (error) {
		console.error("Save Manual Enrichment Error:", error);
		return res.status(500).json({ message: "Failed to save candidate updates" });
	}
};

export const getCandidateEnrichmentActivity = async (req, res) => {
	try {
		const pageNum = Math.max(1, Number(req.query.page) || 1);
		const limitNum = Math.min(100, Math.max(5, Number(req.query.limit) || 20));
		const skip = (pageNum - 1) * limitNum;

		const candidateId = req.params.id;
		const [totalCount, logs] = await Promise.all([
			EnrichmentLog.countDocuments({ candidateId }),
			EnrichmentLog.find({ candidateId })
				.sort({ createdAt: -1 })
				.skip(skip)
				.limit(limitNum)
				.populate("performedBy", "name email")
				.lean(),
		]);

		return res.json({
			items: logs.map((log) => ({
				_id: log._id,
				action: log.action,
				provider: log.provider || "",
				changes: Array.isArray(log.changes) ? log.changes : [],
				metadata: log.metadata || null,
				createdAt: log.createdAt,
				performedBy: log.performedBy || null,
			})),
			page: pageNum,
			limit: limitNum,
			totalCount,
			hasMore: skip + logs.length < totalCount,
		});
	} catch (error) {
		console.error("Candidate Enrichment Activity Error:", error);
		return res
			.status(500)
			.json({ message: "Failed to fetch candidate enrichment activity" });
	}
};

export const getEnrichmentAuditLogs = async (req, res) => {
	try {
		const pageNum = Math.max(1, Number(req.query.page) || 1);
		const limitNum = Math.min(100, Math.max(10, Number(req.query.limit) || 20));
		const skip = (pageNum - 1) * limitNum;

		const [totalCount, logs] = await Promise.all([
			EnrichmentLog.countDocuments({}),
			EnrichmentLog.find({})
				.sort({ createdAt: -1 })
				.skip(skip)
				.limit(limitNum)
				.populate("performedBy", "name email")
				.populate("candidateId", "fullName jobTitle")
				.lean(),
		]);

		return res.json({
			items: logs.map((log) => ({
				_id: log._id,
				action: log.action,
				provider: log.provider || "",
				changes: Array.isArray(log.changes) ? log.changes : [],
				createdAt: log.createdAt,
				performedBy: log.performedBy || null,
				candidate: log.candidateId || null,
			})),
			page: pageNum,
			limit: limitNum,
			totalCount,
			hasMore: skip + logs.length < totalCount,
		});
	} catch (error) {
		console.error("Enrichment Audit Error:", error);
		return res.status(500).json({ message: "Failed to fetch enrichment audit logs" });
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
