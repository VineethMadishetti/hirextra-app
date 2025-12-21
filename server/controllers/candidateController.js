import { processCsvJob } from '../utils/queue.js';
import Candidate from '../models/Candidate.js';
import UploadJob from '../models/UploadJob.js';
import User from '../models/User.js';
import fs from 'fs';
import csv from 'csv-parser';
import path from 'path';
import os from 'os';
import readline from 'readline';
import { Document, Packer, Paragraph, TextRun, AlignmentType, HeadingLevel } from "docx";
import { uploadToS3, generateS3Key, downloadFromS3 } from '../utils/s3Service.js';

// --- HELPER: Robust CSV Line Parser (ETL) ---
// Handles quoted fields correctly (e.g. "Manager, Sales" is one column)
const parseCsvLine = (line) => {
  if (!line) return [];
  const result = [];
  let current = "";
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  
  return result.map((h, idx) => h && h.trim() ? h.trim() : `Column_${idx + 1}`);
};

// --- HELPER: ETL Data Cleaning & Validation ---
export const cleanAndValidateCandidate = (data) => {
  if (!data) return null;
  const cleaned = { ...data };

  // 1. Clean Phone: Remove all non-digit/non-plus characters
  if (cleaned.phone) {
    cleaned.phone = cleaned.phone.replace(/[^0-9+]/g, '');
    
    // Relaxed: If phone is invalid, just clear it. Don't reject the row.
    const phoneRegex = /^\+?[0-9]{7,15}$/;
    if (!phoneRegex.test(cleaned.phone)) {
        cleaned.phone = ''; 
    }
  }

  // 2. Validate Email (Relaxed)
  if (cleaned.email) {
      cleaned.email = cleaned.email.trim();
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(cleaned.email)) {
          cleaned.email = ''; // Invalid email -> Clear it, don't reject row yet
      }
  }

  // 3. Check for at least ONE contact method (Email OR Phone OR LinkedIn)
  const hasEmail = !!cleaned.email;
  const hasPhone = !!cleaned.phone;
  const hasLinkedIn = cleaned.linkedinUrl && cleaned.linkedinUrl.trim().length > 0;

  if (!hasEmail && !hasPhone && !hasLinkedIn) return null; // No contact info -> Reject Row

  // 4. Validate Name (Relaxed)
  if (cleaned.fullName) {
      cleaned.fullName = cleaned.fullName.trim();
      if (cleaned.fullName.length > 100) cleaned.fullName = cleaned.fullName.substring(0, 100);
  }

  return cleaned;
};

// Helper to clean up temp chunk files
const deleteFile = (filePath) => {
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
};

// 2. DELETE SINGLE CANDIDATE (Row Delete)
export const deleteCandidate = async (req, res) => {
  try {
    await Candidate.findByIdAndDelete(req.params.id);
    res.json({ message: 'Candidate deleted' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// 3. GET HEADERS FROM EXISTING FILE (For Reprocessing)
export const getFileHeaders = async (req, res) => {
  const { filePath } = req.body; // filePath is now S3 key

  if (!filePath) {
    return res.status(400).json({ message: 'File path (S3 key) is required' });
  }

  try {
    // Check if it's an S3 key (starts with 'uploads/') or local path
    const isS3Key = filePath.startsWith('uploads/') || !filePath.includes(path.sep);
    
    if (isS3Key) {
      // For large files, use readline to read just the first line (fastest method)
      // This avoids downloading/parsing the entire file
      try {
        let headersReceived = false;
        let timeoutId;
        
        // Use Range request to only fetch first 50KB (headers are always at top)
        const s3Stream = await downloadFromS3(filePath, { 
          rangeStart: 0, 
          rangeEnd: 51200 // First 50 KB is more than enough for headers
        });
        
        const rl = readline.createInterface({
          input: s3Stream,
          crlfDelay: Infinity
        });
        
        // Read only the first non-empty line (header row)
        rl.on('line', (line) => {
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
        
        rl.on('close', () => {
          if (!headersReceived) {
            headersReceived = true;
            clearTimeout(timeoutId);
            if (!res.headersSent) {
              res.status(500).json({ message: 'Could not read header line from file' });
            }
            s3Stream.destroy();
          }
        });
        
        rl.on('error', (err) => {
          if (!headersReceived) {
            headersReceived = true;
            clearTimeout(timeoutId);
            console.error('Error reading headers from S3:', err);
            if (!res.headersSent) {
              res.status(500).json({ message: 'Failed to read file headers from S3', error: err.message });
            }
            rl.close();
            s3Stream.destroy();
          }
        });
        
        s3Stream.on('error', (err) => {
          if (!headersReceived) {
            headersReceived = true;
            clearTimeout(timeoutId);
            console.error('S3 stream error:', err);
            if (!res.headersSent) {
              res.status(500).json({ message: 'Failed to download file from S3', error: err.message });
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
              res.status(500).json({ message: 'Timeout reading file headers from S3. Please check if the file exists and try again.' });
            }
            rl.close();
            s3Stream.destroy();
          }
        }, 60000); // 60 seconds timeout
      } catch (s3Error) {
        console.error('S3 download error:', s3Error);
        return res.status(500).json({ message: 'Failed to download file from S3', error: s3Error.message });
      }
    } else {
      // Legacy local file support
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ message: 'Original file not found on server' });
      }

      let headersReceived = false;
      const stream = fs.createReadStream(filePath)
        .pipe(csv({
          headers: true,
          skipEmptyLines: false,
          mapHeaders: ({ header, index }) => header && header.trim() ? header.trim() : `Column_${index + 1}`
        }));
      
      stream.on('headers', (csvHeaders) => {
        if (!headersReceived) {
          headersReceived = true;
          res.json({ headers: csvHeaders, filePath });
          stream.destroy();
        }
      });
      
      stream.on('error', (err) => {
        if (!headersReceived) {
          headersReceived = true;
          console.error('Error reading headers:', err);
          res.status(500).json({ message: 'Failed to read file headers', error: err.message });
        }
      });
    }
  } catch (error) {
    console.error('Error getting file headers:', error);
    if (!res.headersSent) {
      res.status(500).json({ message: 'Failed to read file headers', error: error.message });
    }
  }
};

// 1. Handle Chunk Uploads (Render-safe, large files supported)
export const uploadChunk = async (req, res) => {
  const { fileName, chunkIndex, totalChunks } = req.body;
  const chunk = req.file;

  if (!chunk) {
    return res.status(400).json({ message: 'No chunk data' });
  }

  // ✅ ONLY writable location on Render
  const uploadDir = path.join(os.tmpdir(), 'uploads');

  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }

  const finalFilePath = path.join(uploadDir, fileName);

  /* ---------------------------------------------------
     APPEND CHUNK (STREAMING – SAFE FOR LARGE FILES)
  --------------------------------------------------- */
  try {
    const chunkStream = fs.createReadStream(chunk.path);
    const appendStream = fs.createWriteStream(finalFilePath, { flags: 'a' });

    await new Promise((resolve, reject) => {
      chunkStream.pipe(appendStream);

      chunkStream.on('error', reject);
      appendStream.on('error', reject);

      appendStream.on('finish', () => {
        // Cleanup temp chunk
        if (fs.existsSync(chunk.path)) {
          fs.unlinkSync(chunk.path);
        }
        resolve();
      });
    });
  } catch (error) {
    console.error('❌ Stream append failed, trying fallback:', error);

    // Fallback for smaller chunks
    try {
      const chunkBuffer = fs.readFileSync(chunk.path);
      fs.appendFileSync(finalFilePath, chunkBuffer);

      if (fs.existsSync(chunk.path)) {
        fs.unlinkSync(chunk.path);
      }
    } catch (fallbackError) {
      console.error('❌ Fallback append also failed:', fallbackError);
      return res.status(500).json({ message: 'Failed to save chunk' });
    }
  }

  /* ---------------------------------------------------
     CHUNK PROGRESS
  --------------------------------------------------- */
  const currentChunk = Number(chunkIndex) + 1;
  const total = Number(totalChunks);

  if (currentChunk !== total) {
    return res.json({
      status: 'chunk_received',
      progress: Math.round((currentChunk / total) * 100),
    });
  }

  /* ---------------------------------------------------
     FINAL CHUNK → READ HEADERS FIRST, THEN UPLOAD TO S3
  --------------------------------------------------- */
  console.log(`✅ File ${fileName} fully assembled at ${finalFilePath}`);

  let headersReceived = false;
  let responseSent = false;
  let s3Key = null;

  // Generate S3 key
  s3Key = generateS3Key(fileName, req.user._id.toString());

  const sendResponse = async (headers = []) => {
    if (!responseSent) {
      responseSent = true;

      // Upload to S3 after reading headers
      try {
        const fileBuffer = fs.readFileSync(finalFilePath);
        await uploadToS3(fileBuffer, s3Key, 'text/csv');
        console.log(`✅ File uploaded to S3: ${s3Key}`);

        // Clean up local temp file
        if (fs.existsSync(finalFilePath)) {
          fs.unlinkSync(finalFilePath);
        }

        // Only on successful upload, tell frontend upload is complete
        res.json({
          status: 'done',
          message: 'Upload complete',
          filePath: s3Key, // Return S3 key instead of local path
          headers,
        });
      } catch (s3Error) {
        console.error('❌ S3 upload failed:', s3Error);

        // If upload fails, do NOT allow mapping/processing with a bad key
        if (fs.existsSync(finalFilePath)) {
          fs.unlinkSync(finalFilePath);
        }

        return res.status(500).json({
          status: 'error',
          message: 'Failed to upload file to storage. Please try again.',
          error: s3Error.message,
        });
      }
    }
  };

  /* ---------- Manual header reader (fallback) ---------- */
  const readHeadersManually = async () => {
    try {
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
    } catch (err) {
      console.error('❌ Manual header read failed:', err);
      return [];
    }
  };

  /* ---------- CSV parser (primary) ---------- */
  try {
    const stream = fs
      .createReadStream(finalFilePath)
      .pipe(
        csv({
          headers: true,
          skipEmptyLines: false,
          mapHeaders: ({ header, index }) =>
            header && header.trim()
              ? header.trim()
              : `Column_${index + 1}`,
        })
      )
      .on('headers', (csvHeaders) => {
        if (!headersReceived) {
          headersReceived = true;
          console.log(`📋 Headers read via CSV parser (${csvHeaders.length})`);
          sendResponse(csvHeaders);
          stream.destroy();
        }
      })
      .on('error', async (err) => {
        if (!headersReceived) {
          console.warn(
            `⚠️ CSV parser error, falling back to manual read: ${err.message}`
          );
          headersReceived = true;
          const manualHeaders = await readHeadersManually();
          sendResponse(manualHeaders);
        }
      });

    // Timeout safety net
    setTimeout(async () => {
      if (!headersReceived) {
        console.warn('⚠️ CSV parser timeout, using manual header read');
        headersReceived = true;
        const manualHeaders = await readHeadersManually();
        sendResponse(manualHeaders);
      }
    }, 3000);
  } catch (err) {
    console.warn('⚠️ Stream creation failed, manual header read');
    const manualHeaders = await readHeadersManually();
    sendResponse(manualHeaders);
  }
};


// --- START PROCESSING (Creates History Record) ---
export const processFile = async (req, res) => {
  try {
    const { filePath, mapping } = req.body;
    
    if (!filePath) {
      return res.status(400).json({ message: 'File path is required' });
    }

    const fileName = path.basename(filePath);

    // 1. Create a DB Record for this Job
    const newJob = await UploadJob.create({
        fileName: filePath, // Use full path
        originalName: fileName,
        uploadedBy: req.user._id, // Requires authMiddleware
        status: 'MAPPING_PENDING',
        mapping
    });

    // 2. Start processing immediately in the background (no Redis required)
    //    We do NOT await here so the HTTP response returns quickly.
    processCsvJob({ filePath, mapping, jobId: newJob._id })
      .catch(async (processingError) => {
        console.error('Background CSV processing failed:', processingError);
        await UploadJob.findByIdAndUpdate(newJob._id, { 
          status: 'FAILED',
          error: processingError.message || 'Background processing failed'
        });
      });

    // Respond immediately; frontend can poll /job/:id/status for live updates
    return res.json({ message: 'Processing started', jobId: newJob._id });
  } catch (error) {
    console.error('Error in processFile:', error);
    res.status(500).json({ 
      message: 'Failed to start file processing',
      error: error.message 
    });
  }
};

// --- GET UPLOAD HISTORY (For Admin Page) ---
export const getUploadHistory = async (req, res) => {
    try {
        // Optimized query: only fetch essential fields, limit to recent 100 jobs
        const jobs = await UploadJob.find()
            .select('fileName originalName uploadedBy status totalRows successRows failedRows mapping createdAt updatedAt completedAt')
            .sort({ createdAt: -1 })
            .limit(100) // Limit to recent 100 jobs for faster loading
            .populate('uploadedBy', 'name email')
            .lean() // Use lean() for faster queries (returns plain JS objects)
            .maxTimeMS(10000); // 10 second timeout to prevent hanging
        
        res.json(jobs);
    } catch (error) {
        console.error('Error fetching upload history:', error);
        res.status(500).json({ message: error.message || 'Failed to load history' });
    }
};

// --- GET JOB STATUS (For Live Updates) ---
export const getJobStatus = async (req, res) => {
    try {
        const job = await UploadJob.findById(req.params.id).populate('uploadedBy', 'name email');
        if (!job) return res.status(404).json({ message: 'Job not found' });
        res.json(job);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// --- SEARCH (Updated for Soft Delete) ---
export const searchCandidates = async (req, res) => {
  try {
    const { 
      q, locality, jobTitle, skills, 
      hasEmail, hasPhone, hasLinkedin, 
      page = 1, limit = 20
    } = req.query;

    const limitNum = Math.min(Number(limit) || 20, 100); // Max 100 per page
    const pageNum = Math.max(1, Number(page) || 1);
    const skip = (pageNum - 1) * limitNum;
    
    let query = { isDeleted: false }; // Hide soft deleted items

    // 1. Text Search
    if (q) query.$text = { $search: q };

    // 2. Specific Filters
    if (locality) {
      query.$or = [
        { locality: new RegExp(locality, 'i') },
        { location: new RegExp(locality, 'i') },
        { country: new RegExp(locality, 'i') }
      ];
    }
    if (jobTitle) query.jobTitle = new RegExp(jobTitle, 'i');
    if (skills) query.skills = new RegExp(skills, 'i');

    // 3. Toggles
    if (hasEmail === 'true') query.email = { $exists: true, $ne: '' };
    if (hasPhone === 'true') query.phone = { $exists: true, $ne: '' };
    if (hasLinkedin === 'true') query.linkedinUrl = { $exists: true, $ne: '' };

    // Optimized: Use lean() for faster queries and parallel execution
    const [candidates, totalCount] = await Promise.all([
      Candidate.find(query)
        .limit(limitNum)
        .skip(skip)
        .select('-sourceFile -uploadJobId -__v') // Exclude unnecessary fields
        .sort({ createdAt: -1 })
        .lean() // Use lean() for faster queries (returns plain JS objects, not Mongoose docs)
        .exec(),
      Candidate.countDocuments(query).exec()
    ]);

    res.json({
      candidates,
      totalPages: Math.ceil(totalCount / limitNum),
      currentPage: pageNum,
      totalCount
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
      isDeleted: false 
    }).select('-sourceFile -uploadJobId -__v').lean();

    if (candidates.length === 0) {
      return res.status(404).json({ message: "No candidates found" });
    }

    // Convert to CSV
    const csvHeaders = [
      'Full Name', 'Job Title', 'Skills', 'Experience', 'Company Name', 'Location', 'Email', 'Phone', 'LinkedIn URL',
      'Industry', 'Country', 'Locality', 'Birth Year', 'Summary'
    ];

    const csvRows = candidates
      .map(c => cleanAndValidateCandidate(c)) // ETL: Clean & Validate
      .filter(Boolean) // Remove invalid rows (Garbage data)
      .map(candidate => [
      candidate.fullName || '',
      candidate.jobTitle || '',
      candidate.skills || '',
      candidate.experience || '',
      candidate.company || '',
      candidate.location || candidate.locality || candidate.country || '',
      candidate.email || '',
      candidate.phone || '',
      candidate.linkedinUrl || '',
      candidate.industry || '',
      candidate.country || '',
      candidate.locality || '',
      candidate.birthYear || '',
      candidate.summary || ''
    ]);

    const csvContent = [csvHeaders, ...csvRows]
      .map(row => row.map(field => `"${String(field).replace(/"/g, '""')}"`).join(','))
      .join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="candidates_export_${new Date().toISOString().split('T')[0]}.csv"`);
    res.send(csvContent);

  } catch (err) {
    console.error("Export Error:", err);
    res.status(500).json({ message: "Export failed" });
  }
};

// --- PASSWORD VERIFICATION HELPER ---
const verifyAdminPassword = async (userId, password) => {
    const user = await User.findById(userId).select('+password');
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
        res.json({ message: 'Moved to trash' });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// --- UNDO DELETE ---
export const undoDeleteCandidate = async (req, res) => {
    try {
        await Candidate.findByIdAndUpdate(req.params.id, { isDeleted: false });
        res.json({ message: 'Restored' });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// --- SECURE NUKE (With Password) ---
export const nukeDatabase = async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) {
      return res.status(400).json({ message: 'Password is required' });
    }
    await verifyAdminPassword(req.user._id, password);
    await Candidate.deleteMany({});
    await UploadJob.deleteMany({});
    res.json({ message: 'Database reset successfully' });
  } catch (error) {
    res.status(401).json({ message: error.message });
  }
};

// --- SECURE JOB DELETE (With Password) ---
export const deleteUploadJob = async (req, res) => {
    try {
        const { password } = req.body;
        if (!password) {
            return res.status(400).json({ message: 'Password is required' });
        }
        await verifyAdminPassword(req.user._id, password);

        const { id } = req.params;
        await Candidate.deleteMany({ uploadJobId: id });
        await UploadJob.findByIdAndUpdate(id, { 
            status: 'DELETED',
            successRows: 0,
            failedRows: 0
        });
        res.json({ message: 'Job deleted successfully' });
    } catch (error) {
        res.status(401).json({ message: error.message });
    }
};

// --- NEW WORD DOC GENERATOR ---
export const downloadProfile = async (req, res) => {
  try {
    const candidate = await Candidate.findById(req.params.id);
    if (!candidate) return res.status(404).json({ message: 'Candidate not found' });

    // Helper to clean text
    const clean = (text) => text ? text.replace(/[\r\n]+/g, " ").trim() : "";

    // --- ATS FRIENDLY RESUME GENERATOR ---
    const doc = new Document({
      styles: {
        default: {
            document: {
                run: {
                    font: "Calibri",
                    size: 22, // 11pt (Standard for ATS)
                    color: "000000",
                },
                paragraph: {
                    spacing: { line: 276, after: 120 }, // 1.15 line spacing
                },
            },
        },
        paragraphStyles: [
          {
            id: "SectionHeader",
            name: "Section Header",
            run: {
                font: "Calibri",
                size: 24, // 12pt
                bold: true,
                allCaps: true,
            },
            paragraph: {
                spacing: { before: 240, after: 120 },
                border: {
                    bottom: { color: "000000", space: 1, value: "single", size: 6 }
                }
            }
          },
        ],
      },
      sections: [{
        properties: {},
        children: [
          // 1. NAME (Header)
          new Paragraph({
            text: (candidate.fullName || "Candidate Profile").toUpperCase(),
            heading: HeadingLevel.HEADING_1,
            alignment: AlignmentType.CENTER,
            spacing: { after: 120 },
          }),

          // 2. CONTACT INFO (Pipe Separated - ATS Friendly)
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 400 },
            children: [
              new TextRun({
                text: [
                    clean(candidate.email),
                    clean(candidate.phone).replace(/[^0-9+]/g, ''), // Ensure clean phone in Resume
                    clean(candidate.location || candidate.locality || candidate.country),
                    candidate.linkedinUrl ? "LinkedIn Profile" : null
                ].filter(Boolean).join(" | "),
                size: 22,
              })
            ]
          }),

          // 3. PROFESSIONAL SUMMARY
          ...(candidate.summary ? [
            new Paragraph({ text: "PROFESSIONAL SUMMARY", style: "SectionHeader" }),
            new Paragraph({ text: clean(candidate.summary) })
          ] : []),

          // 4. EXPERIENCE (Formatted cleanly)
          new Paragraph({ text: "EXPERIENCE", style: "SectionHeader" }),
          
          // Job 1 (Current/Most Recent)
          new Paragraph({
            children: [
                new TextRun({ 
                    text: clean(candidate.jobTitle) || "Position Not Specified", 
                    bold: true,
                    size: 24 
                }),
            ]
          }),
          new Paragraph({
            children: [
                new TextRun({ 
                    text: clean(candidate.company) || "Company Not Specified", 
                    italics: true 
                }),
                new TextRun({ 
                    text: candidate.industry ? `  |  ${clean(candidate.industry)}` : "" 
                }),
            ],
            spacing: { after: 200 }
          }),
          
          // Additional Experience Details (if stored in 'experience' field)
          ...(candidate.experience ? [
             new Paragraph({ text: clean(candidate.experience) })
          ] : []),

          // 5. SKILLS
          ...(candidate.skills ? [
            new Paragraph({ text: "SKILLS", style: "SectionHeader" }),
            new Paragraph({ 
                text: clean(candidate.skills).split(',').map(s => s.trim()).join(" • "),
                spacing: { after: 200 }
            })
          ] : []),

          // 6. LINKS (If available)
          ...((candidate.linkedinUrl || candidate.githubUrl) ? [
            new Paragraph({ text: "LINKS", style: "SectionHeader" }),
            candidate.linkedinUrl ? new Paragraph({ text: `LinkedIn: ${clean(candidate.linkedinUrl)}` }) : null,
            candidate.githubUrl ? new Paragraph({ text: `GitHub: ${clean(candidate.githubUrl)}` }) : null,
          ] : []),

          // Footer (Invisible for ATS, but good for humans)
          new Paragraph({
            text: "Generated by Hirextra",
            alignment: AlignmentType.CENTER,
            spacing: { before: 400 },
            color: "888888",
            size: 16
          }),
        ].filter(Boolean), // Remove null paragraphs
      }],
    });

    // Generate Buffer
    const buffer = await Packer.toBuffer(doc);

    // Send File-
    const safeName = (candidate.fullName || "Candidate").replace(/[^a-zA-Z0-9\s-]/g, '').replace(/\s+/g, '_');
    res.setHeader('Content-Disposition', `attachment; filename=${safeName}_Profile.docx`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.send(buffer);

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error generating document' });
  }
};