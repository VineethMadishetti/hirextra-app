import { processCsvJob } from "../utils/queue.js";
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
	HeadingLevel,
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
	res.status(400).json({ message: "Pause functionality has been disabled for performance." });
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
			lastCreatedAt, // For Seek Pagination (Speed Optimization)
			lastId         // For Seek Pagination (Speed Optimization)
		} = req.query;

		const limitNum = Math.min(Number(limit) || 20, 100); // Max 100 per page
		const pageNum = Math.max(1, Number(page) || 1);
		const skip = (pageNum - 1) * limitNum;

		let query = { isDeleted: false }; // Hide soft deleted items
		const andConditions = [];

		// 1. Keyword Search (Regex replacement for Text Search)
		if (q && q.trim()) {
			const safeQ = q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

			// Performance Optimization: Detect specific formats to avoid scanning all fields
			const isEmail = safeQ.includes('@');
			const isPhone = /^[0-9+\-\s()]+$/.test(safeQ) && safeQ.replace(/\D/g, '').length > 5;

			if (isEmail) {
				andConditions.push({ email: new RegExp(`^${safeQ}`, "i") }); // Start-of-string optimization
			} else if (isPhone) {
				andConditions.push({ phone: new RegExp(safeQ.replace(/\s+/g, ''), "i") });
			} else {
				// Use Regex $or instead of $text for better compatibility and substring search
				const regex = new RegExp(safeQ, "i");
				andConditions.push({
					$or: [
						{ fullName: regex },
						{ jobTitle: regex },
						{ skills: regex },
						{ company: regex },
						{ location: regex },
						{ locality: regex },
						{ summary: regex }
					]
				});
			}
		}

		// 2. Specific Filters
		const locFilter = locality || location;
		if (locFilter) {
			// Support multiple locations separated by comma (OR logic)
			const locations = locFilter.split(',').map(l => l.trim()).filter(Boolean);
			if (locations.length > 0) {
				const locConditions = locations.map(loc => {
					const safeLoc = loc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
					const locRegex = new RegExp(`^${safeLoc}`, "i");
					return {
						$or: [
							{ locality: locRegex },
							{ location: locRegex },
							{ country: locRegex },
						],
					};
				});
				andConditions.push({ $or: locConditions });
			}
		}

		if (andConditions.length > 0) {
			query.$and = andConditions;
		}

		if (jobTitle) {
			// Support multiple job titles separated by comma (OR logic)
			const titles = jobTitle.split(',').map(t => t.trim()).filter(Boolean);
			if (titles.length > 0) {
				const titleConditions = titles.map(title => {
					const safeJob = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
					return { jobTitle: new RegExp(`^${safeJob}`, "i") };
				});
				andConditions.push({ $or: titleConditions });
				if (!query.$and) query.$and = andConditions;
			}
		}
		if (skills) {
			const safeSkills = skills.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
			query.skills = new RegExp(safeSkills, "i");
		}

		// 3. Toggles
		if (hasEmail === "true") query.email = { $exists: true, $ne: "" };
		if (hasPhone === "true") query.phone = { $exists: true, $ne: "" };
		if (hasLinkedin === "true") query.linkedinUrl = { $exists: true, $ne: "" };

		// Optimized: Use lean() for faster queries and parallel execution
		let candidates;
		let totalCount = 0;

		let findQuery = Candidate.find(query)
			.select("fullName jobTitle skills company experience phone email linkedinUrl locality location country industry summary createdAt score")
			.sort({ createdAt: -1 })
			.lean() // Use lean() for faster queries (returns plain JS objects, not Mongoose docs)
			.maxTimeMS(60000); // Increased timeout to 60s

		// OPTIMIZATION: Seek Pagination vs Offset Pagination
		if (lastCreatedAt && lastId) {
			// Fast: Use index to "seek" to the next page
			findQuery = findQuery.where({
				$or: [
					{ createdAt: { $lt: new Date(lastCreatedAt) } },
					{ createdAt: new Date(lastCreatedAt), _id: { $lt: lastId } }
				]
			});
		} else {
			// Slow (Legacy): Use skip()
			findQuery = findQuery.skip(skip);
		}

		// PERFORMANCE FIX: Fetch limit + 1 to check for next page without counting all docs
		findQuery = findQuery.limit(limitNum + 1);

		candidates = await findQuery.exec();

		const hasMore = candidates.length > limitNum;
		if (hasMore) {
			candidates.pop(); // Remove the extra item used for check
		}

		// If we have fewer items than limit, we know the exact total (skip + current).
		// If we have more, we return -1 (unknown total) to avoid slow counting.
		if (!hasMore) {
			totalCount = skip + candidates.length;
		} else {
			totalCount = -1;
		}

		res.json({
			candidates,
			hasMore,
			totalPages: 0, // Deprecated in favor of hasMore
			currentPage: pageNum,
			totalCount,
		});
	} catch (err) {
		console.error("Search Error:", err); // Log error to terminal
		res.status(500).json({ message: "Search failed on server" });
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

		const clean = (v) =>
			v
				? String(v)
					.replace(/[\r\n]+/g, " ")
					.trim()
				: "";

		// Prepare skills for 2-column layout
		const skillList = clean(candidate.skills)
			.split(",")
			.map((s) => s.trim())
			.map((s) => s.replace(/\b\w/g, (c) => c.toUpperCase()))
			.filter(Boolean);
		const col1 = skillList.filter((_, i) => i % 3 === 0);
		const col2 = skillList.filter((_, i) => i % 3 === 1);
		const col3 = skillList.filter((_, i) => i % 3 === 2);

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
					children: [
						// ===== NAME =====
						new Paragraph({
							alignment: AlignmentType.CENTER,
							spacing: { after: 0 },
							children: [
								new TextRun({
									text: clean(candidate.fullName).toUpperCase(),
									font: "Tahoma",
									bold: true,
									size: 36, // 18pt
								}),
							],
						}),

						// ===== JOB TITLE (NO PARAGRAPH SPACE ABOVE, LINE GAP BELOW) =====
						new Paragraph({
							alignment: AlignmentType.CENTER,
							spacing: { after: 240 },
							children: [
								new TextRun({
									text: clean(candidate.jobTitle),
									font: "Tahoma",
									size: 28, // 14pt
								}),
							],
						}),

						// ===== LOCATION =====
						new Paragraph({
							text: formatLocationText(
								candidate.locality,
								candidate.location,
								candidate.country,
							),
							alignment: AlignmentType.LEFT,
							spacing: { after: 0 },
						}),

						// ===== EMAIL | MOBILE =====
						new Paragraph({
							alignment: AlignmentType.LEFT,
							spacing: { after: 0 },
							children: [
								new TextRun({
									text: [clean(candidate.email), clean(candidate.phone)]
										.filter(Boolean)
										.join(" | "),
									font: "Calibri",
									size: 24,
								}),
							],
						}),

						// ===== LINKEDIN =====
						new Paragraph({
							alignment: AlignmentType.LEFT,
							spacing: { after: 300 },
							border: {
								bottom: {
									color: "auto",
									space: 1,
									style: BorderStyle.SINGLE,
									size: 6,
								},
							},
							children: [
								new TextRun({
									text: candidate.linkedinUrl
										? clean(candidate.linkedinUrl)
										: "",
									font: "Calibri",
									size: 24,
								}),
							],
						}),

						// ===== PROFESSIONAL SUMMARY =====
						...(candidate.summary
							? [
								new Paragraph({
									text: "PROFESSIONAL SUMMARY:",
									style: "SectionHeader",
								}),
								new Paragraph({
									text: clean(candidate.summary),
									indent: { left: 400 },
								}),
							]
							: []),

						// ===== SKILLS =====
						...(candidate.skills
							? [
								new Paragraph({
									text: "SKILLS:",
									style: "SectionHeader",
								}),

								new Table({
									indent: { size: 400, type: WidthType.DXA },
									width: { size: 100, type: WidthType.PERCENTAGE },
									borders: {
										top: { style: BorderStyle.NONE, size: 0, color: "auto" },
										bottom: {
											style: BorderStyle.NONE,
											size: 0,
											color: "auto",
										},
										left: { style: BorderStyle.NONE, size: 0, color: "auto" },
										right: {
											style: BorderStyle.NONE,
											size: 0,
											color: "auto",
										},
										insideHorizontal: {
											style: BorderStyle.NONE,
											size: 0,
											color: "auto",
										},
										insideVertical: {
											style: BorderStyle.NONE,
											size: 0,
											color: "auto",
										},
									},
									rows: [
										new TableRow({
											children: [col1, col2, col3].map(
												(column) =>
													new TableCell({
														width: { size: 33, type: WidthType.PERCENTAGE },
														children: column.map(
															(skill) =>
																new Paragraph({
																	children: [
																		new TextRun({
																			text: skill,
																			font: "Calibri",
																			size: 24, // 12pt
																		}),
																	],
																	bullet: { level: 0 },
																}),
														),
													}),
											),
										}),
									],
								}),
							]
							: []),

						// ===== WORK EXPERIENCE =====
						...(candidate.jobTitle || candidate.company
							? [
								new Paragraph({
									text: "WORK EXPERIENCE:",
									style: "SectionHeader",
								}),
								new Paragraph({
									children: [
										new TextRun({
											text: clean(candidate.jobTitle),
											bold: true,
										}),
									],
									spacing: { after: 40 },
									indent: { left: 400 },
								}),
								new Paragraph({
									text: clean(candidate.company),
									spacing: { after: 0 },
									indent: { left: 400 },
								}),

								...(candidate.experience
									? [
										new Paragraph({
											text: `Experience: ${clean(candidate.experience)}`,
											indent: { left: 400 },
										}),
									]
									: []),
							]
							: []),

						// ===== FOOTER =====
						new Paragraph({
							alignment: AlignmentType.CENTER,
							spacing: { before: 360 },
							children: [
								new TextRun({
									text: "Profile generated by PeopleFinder",
									font: "Arial",
									size: 18, // 9pt
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

		const firstName = (clean(candidate.fullName) || "Candidate").split(" ")[0];
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
