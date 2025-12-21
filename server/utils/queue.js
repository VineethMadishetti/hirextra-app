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
// ---------------------------------------------------
const getRedisConnection = () => {
	// Prefer REDIS_URL (Upstash / cloud Redis)
	if (process.env.REDIS_URL) {
		return { url: process.env.REDIS_URL };
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
export const processCsvJob = async ({ filePath, mapping, jobId }) => {
	logger.info(`🚀 Processing UploadJob ID: ${jobId}, File: ${filePath}`);

	try {
		// Ensure source file exists in S3 before doing any heavy work
		const exists = await fileExistsInS3(filePath);
		if (!exists) {
			logger.error(
				`❌ Source file missing in S3 for job ${jobId}: ${filePath}`,
			);
			await UploadJob.findByIdAndUpdate(jobId, {
				status: "FAILED",
				error: "Source file not found in storage. Please re-upload the file.",
			});
			return;
		}

		await UploadJob.findByIdAndUpdate(jobId, {
			status: "PROCESSING",
			startedAt: new Date(),
		});

		// 1. Auto-Detect where the headers are
		const skipLinesCount = await findHeaderRowIndex(filePath, mapping);

		// Optimized batch size for large files (14 GB+)
		// Larger batches = fewer DB round trips = faster processing
		const batchSize = 2000; // Increased from 1000 for better throughput on large files
		let candidates = [];
		let successCount = 0;
		let failedCount = 0;
		let rowCounter = 0;
		let lastProgressUpdate = Date.now();
		const PROGRESS_UPDATE_INTERVAL = 2000; // Update progress every 2 seconds max

		// Helper to parse CSV line with proper quote handling
		const parseCSVLine = (csvLine) => {
			if (!csvLine) return [];
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

		// First, read the actual headers from the file
		const readHeaders = async () => {
			return new Promise((resolveHeaders, rejectHeaders) => {
				let headerStream;
				let headerRl;
				let resolved = false;

				// Wrap async operation
				(async () => {
					try {
						headerStream = await getFileStream(filePath);
						headerRl = readline.createInterface({
							input: headerStream,
							crlfDelay: Infinity,
						});
						let headerLineNumber = 0;

						headerRl.on("line", (line) => {
							if (resolved) return; // Prevent multiple resolutions

							if (headerLineNumber === skipLinesCount && line && line.trim()) {
								const headers = parseCSVLine(line);

								logger.info(
									`📋 Actual headers found (${headers.length} columns):`,
									headers.slice(0, 10).join(", "),
									"...",
								);
								resolved = true;
								if (headerRl) headerRl.close();
								if (headerStream) headerStream.destroy();
								resolveHeaders(headers);
							} else {
								headerLineNumber++;
								if (headerLineNumber > skipLinesCount + 5) {
									// Fallback: use CSV parser default
									if (!resolved) {
										resolved = true;
										if (headerRl) headerRl.close();
										if (headerStream) headerStream.destroy();
										logger.warn(
											"⚠️ Could not read header line manually, using CSV parser",
										);
										resolveHeaders(null);
									}
								}
							}
						});

						headerRl.on("close", () => {
							if (!resolved) {
								resolved = true;
								resolveHeaders(null);
							}
						});

						headerRl.on("error", (err) => {
							if (!resolved) {
								resolved = true;
								logger.error("❌ Error reading headers:", err);
								if (headerRl) headerRl.close();
								if (headerStream) headerStream.destroy();
								rejectHeaders(err);
							}
						});

						headerStream.on("error", (err) => {
							if (!resolved) {
								resolved = true;
								logger.error("❌ Stream error reading headers:", err);
								if (headerRl) headerRl.close();
								if (headerStream) headerStream.destroy();
								rejectHeaders(err);
							}
						});
					} catch (error) {
						if (!resolved) {
							resolved = true;
							logger.error("❌ Failed to get file stream for headers:", error);
							if (headerRl) headerRl.close();
							if (headerStream) headerStream.destroy();
							rejectHeaders(error);
						}
					}
				})();
			});
		};
		return await new Promise(async (resolve, reject) => {
			// Read headers first
			const actualHeaders = await readHeaders();

			if (!actualHeaders || actualHeaders.length === 0) {
				logger.error("❌ Could not read headers from file");
				await UploadJob.findByIdAndUpdate(jobId, { status: "FAILED" });
				reject(new Error("Could not read headers from file"));
				return;
			}

			logger.info(`✅ Using ${actualHeaders.length} headers for processing`);
			logger.debug(`📝 First 5 headers:`, actualHeaders.slice(0, 5).join(", "));

			// Helper to insert a batch of candidates (extracted for reuse)
			const insertBatch = async (batchToInsert) => {
				if (batchToInsert.length === 0) return;

				let retries = 3;
				let lastError = null;

				while (retries > 0) {
					try {
						const docs = await Candidate.insertMany(batchToInsert, {
							ordered: false, // Continue inserting even if some fail
							lean: false,
							rawResult: false, // Return inserted documents, not raw result
						});

						const inserted = docs.length;
						successCount += inserted;

						// Log progress for large files every 10k rows
						if (successCount % 10000 === 0) {
							logger.info(
								`📊 Progress: ${successCount.toLocaleString()} rows processed for job ${jobId}`,
							);
						}

						// Update job progress every batch (throttled to avoid DB overload)
						const now = Date.now();
						if (now - lastProgressUpdate >= PROGRESS_UPDATE_INTERVAL) {
							await UploadJob.findByIdAndUpdate(
								jobId,
								{
									successRows: successCount,
									totalRows: rowCounter,
									failedRows: failedCount,
								},
								{ new: true },
							).catch((err) => {
								logger.error("Error updating job progress:", err);
							});
							lastProgressUpdate = now;
						}

						return; // Success, exit retry loop
					} catch (err) {
						lastError = err;
						retries--;

						// If some documents were inserted, count them
						if (err.insertedCount > 0) {
							successCount += err.insertedCount;
						}

						// Check if it's a connection error or duplicate key error
						if (
							err.name === "MongoNetworkError" ||
							err.message.includes("connection")
						) {
							logger.warn(
								`⚠️ Connection error, retrying... (${retries} attempts left)`,
							);
							await new Promise((resolve) =>
								setTimeout(resolve, 1000 * (4 - retries)),
							); // Exponential backoff
						} else if (
							err.code === 11000 ||
							err.message.includes("duplicate")
						) {
							// Duplicate key error - count as failed but continue
							failedCount += batchToInsert.length - (err.insertedCount || 0);
							return; // Continue processing, don't retry duplicates
						} else {
							// Other errors - log and continue with next batch
							logger.error(`❌ Non-retryable error: ${err.message}`);
							failedCount += batchToInsert.length - (err.insertedCount || 0);
							return; // Don't retry, continue with next batch
						}
					}
				}

				// All retries failed
				const actuallyFailed =
					batchToInsert.length - (lastError?.insertedCount || 0);
				failedCount += actuallyFailed;
				logger.error(
					`❌ Batch insert failed after all retries (${actuallyFailed} rows failed):`,
					lastError?.message,
				);
			};

			// Now process the file with correct headers
			// When headers is an array, csv-parser:
			// 1. Uses those headers directly (doesn't read from file)
			// 2. Automatically skips the first line (assuming it's the header row)
			// 3. Starts processing data from the second line
			// So we need to: skip garbage rows + skip header row = skipLinesCount + 1
			const fileStream = await getFileStream(filePath);

			// Add error handler to fileStream
			fileStream.on("error", (err) => {
				logger.error("❌ File stream error during processing:", err);
			});

			const csvParser = csv({
				skipLines: skipLinesCount + 1, // Skip garbage rows + header row (since we provide headers as array)
				headers: actualHeaders, // Provide headers as array - parser will use these and skip first data line
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

			let isPaused = false;

			const stream = fileStream
				.pipe(csvParser)
				.on("data", async (row) => {
					try {
						rowCounter++;

						// --- DEBUGGING FIRST ROW ---
						if (rowCounter === 1) {
							logger.info("🔍 Processing first row...");
							logger.debug("Row keys detected:", Object.keys(row).slice(0, 10));
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
							if (row[targetHeader] !== undefined) {
								// Preserve empty strings - don't convert to empty if it's already empty
								const value = row[targetHeader];
								return value === null || value === undefined
									? ""
									: String(value).trim();
							}
							// Loose match for case-insensitive header matching
							const looseKey = Object.keys(row).find(
								(k) =>
									k.toLowerCase().trim() === targetHeader.toLowerCase().trim(),
							);
							if (looseKey !== undefined) {
								const value = row[looseKey];
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
						const validData = cleanAndValidateCandidate(candidateData);

						if (validData) {
							candidates.push(validData);
						} else {
							if (failedCount < 5) {
								logger.warn(`⚠️ Row rejected (No Contact Info): Email=${candidateData.email}, Phone=${candidateData.phone}, LinkedIn=${candidateData.linkedinUrl}`);
							}
							failedCount++; // Count invalid rows as failed (Garbage Data)
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

						// Final progress update before marking as completed
						await UploadJob.findByIdAndUpdate(jobId, {
							status: "COMPLETED",
							completedAt: new Date(),
							successRows: successCount,
							totalRows: rowCounter,
							failedRows: failedCount,
						});

						logger.info(
							`✅ Job ${jobId} Completed. Total Rows: ${rowCounter.toLocaleString()}, Success: ${successCount.toLocaleString()}, Failed: ${failedCount.toLocaleString()}`,
						);
						resolve();
					} catch (err) {
						logger.error(`❌ Error in end handler for job ${jobId}:`, err);
						await UploadJob.findByIdAndUpdate(jobId, {
							status: "FAILED",
							error: err.message,
							successRows: successCount,
							totalRows: rowCounter,
							failedRows: failedCount,
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
					const { filePath, mapping, jobId } = job.data;
					await processCsvJob({ filePath, mapping, jobId });
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
