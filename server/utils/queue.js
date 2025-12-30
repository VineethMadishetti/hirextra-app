import { Queue, Worker } from "bullmq";
import fs from "fs";
import path from "path";
import csv from "csv-parser";
import Candidate from "../models/Candidate.js";
import UploadJob from "../models/UploadJob.js";
import readline from "readline";
import logger from "./logger.js";
import { downloadFromS3, fileExistsInS3 } from "./s3Service.js";
import { cleanAndValidateCandidate } from "./dataCleaner.js";

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
			if (redisUrl.pathname && redisUrl.pathname !== "/" && redisUrl.pathname !== "/0") {
				logger.warn(`Redis URL contains a non-zero database (${redisUrl.pathname}). Forcing DB 0 for compatibility.`);
				redisUrl.pathname = "/0";
			}
			return { url: redisUrl.toString() };
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

		const { fileName: filePath, mapping, headers: actualHeaders } = job;

		if (!actualHeaders || actualHeaders.length === 0) {
			logger.error(`❌ Job ${jobId} is missing stored headers. Cannot process.`);
			await UploadJob.findByIdAndUpdate(jobId, {
				status: "FAILED",
				error: "Processing failed: Header information was not saved with the job.",
			});
			return;
		}

		// Ensure source file exists in S3 before doing any heavy work
		const exists = await fileExistsInS3(filePath);
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
		let lastJobCheck = Date.now();
		const JOB_CHECK_INTERVAL = 5000; // Check every 5 seconds if job still exists

		// Helper to parse CSV line with proper quote handling
		// Optimized to reduce string allocations
		const parseCSVLine = (csvLine) => {
			if (!csvLine) return [];
			// FIX: Strip BOM (Byte Order Mark) if present to prevent header mismatch
			if (csvLine.charCodeAt(0) === 0xFEFF) {
				csvLine = csvLine.slice(1);
			}
			const columns = [];
			let currentField = '';
			let inQuotes = false;
	
			for (let i = 0; i < csvLine.length; i++) {
				const char = csvLine[i];
	
				if (char === '"') {
					// Handle escaped quotes ("")
					if (inQuotes && csvLine[i + 1] === '"') {
						currentField += '"';
						i++; // Skip the next quote
					} else {
						inQuotes = !inQuotes;
					}
				} else if (char === ',' && !inQuotes) {
					columns.push(currentField);
					currentField = '';
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

			const fileStream = await getFileStream(filePath);

			// We will handle skipping manually as it's much faster for large files
			// than using the library's built-in `skipLines`.
			const csvParser = csv({
				skipLines: skipLinesCount + 1, // ONLY skip garbage lines + the header row
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

			const stream = fileStream
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
						// --- ABORT IF JOB IS DELETED (PERIODIC CHECK) ---
						// To prevent orphaned jobs from running indefinitely if they are
						// deleted mid-process, we check for the job's existence periodically.
						const now = Date.now();
						if (now - lastJobCheck > JOB_CHECK_INTERVAL) {
							lastJobCheck = now;
							const currentJobState = await UploadJob.findById(jobId).lean().select("status");
							if (!currentJobState) {
								logger.warn(`⚠️ Job ${jobId} was deleted. Aborting processing.`);
								stream.destroy();
								return; // Stop processing this row and subsequent rows
							}
							if (currentJobState.status === 'PAUSED') {
								logger.info(`⏸️ Job ${jobId} has been paused. Stopping stream and saving progress.`);
								stream.destroy(); // This will trigger the 'end' handler
								return;
							}
						}

						rowCounter++; // This will now continue from resumeFrom + 1

						// Convert raw row to array (csv-parser with headers:false emits arrays)
						const rowValues = Object.values(row);

						// --- MANUAL STRICT VALIDATION ---
						// Check if row has the correct number of columns to prevent data shifting.
						if (rowValues.length !== actualHeaders.length) {
							logger.warn(`⚠️ Row ${rowCounter} skipped: Column count mismatch (Expected ${actualHeaders.length}, got ${rowValues.length})`);
							incrementFailure('COLUMN_MISMATCH'); // ✅ Now defined!
							return;
						}

						// Manually map headers to values since we disabled auto-mapping
						const mappedRow = {};
						actualHeaders.forEach((header, index) => {
							mappedRow[header] = rowValues[index];
						});
						// --------------------------------

						// --- DEBUGGING FIRST ROW ---
						if (rowCounter === resumeFrom + 1) {
							logger.info("🔍 Processing first row...");
							logger.debug("Row values detected:", rowValues.slice(0, 5));
						}

						// Log progress every 10k rows
						if (rowCounter % 10000 === 0) {
							logger.info(
								`📊 Stream progress: ${rowCounter.toLocaleString()} rows read from file`,
							);
						}

						const getVal = (targetHeader) => {
							if (!targetHeader) return "";
							// Check exact match first
							if (mappedRow[targetHeader] !== undefined) {
								// Preserve empty strings - don't convert to empty if it's already empty
								const value = mappedRow[targetHeader];
								return value === null || value === undefined
									? ""
									: String(value).trim();
							}
							// Loose match for case-insensitive header matching
							const looseKey = Object.keys(mappedRow).find(
								(k) =>
									k.toLowerCase().trim() === targetHeader.toLowerCase().trim(),
							);
							if (looseKey !== undefined) {
								const value = mappedRow[looseKey];
								return value === null || value === undefined
									? ""
									: String(value).trim();
							}
							return "";
						};

						const candidateData = {
							fullName: getVal(mapping.fullName),
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
					duration: 1000,
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
