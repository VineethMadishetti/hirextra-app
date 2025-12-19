import importQueue from '../utils/queue.js';
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
      // Download from S3
      try {
        const s3Stream = await downloadFromS3(filePath);
        let headersReceived = false;
        
        const csvStream = s3Stream.pipe(csv({
          headers: true,
          skipEmptyLines: false,
          mapHeaders: ({ header, index }) => header && header.trim() ? header.trim() : `Column_${index + 1}`
        }));
        
        csvStream.on('headers', (csvHeaders) => {
          if (!headersReceived) {
            headersReceived = true;
            res.json({ headers: csvHeaders, filePath });
            s3Stream.destroy();
            csvStream.destroy();
          }
        });
        
        csvStream.on('error', (err) => {
          if (!headersReceived) {
            headersReceived = true;
            console.error('Error reading headers from S3:', err);
            res.status(500).json({ message: 'Failed to read file headers from S3', error: err.message });
            s3Stream.destroy();
          }
        });
        
        s3Stream.on('error', (err) => {
          if (!headersReceived) {
            headersReceived = true;
            console.error('S3 stream error:', err);
            res.status(500).json({ message: 'Failed to download file from S3', error: err.message });
          }
        });
        
        // Timeout after 30 seconds
        setTimeout(() => {
          if (!headersReceived) {
            headersReceived = true;
            res.status(500).json({ message: 'Timeout reading file headers from S3' });
            s3Stream.destroy();
            csvStream.destroy();
          }
        }, 30000);
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
      } catch (s3Error) {
        console.error('❌ S3 upload failed:', s3Error);
        // Still send response but log error
      }
      
      res.json({
        status: 'done',
        message: 'Upload complete',
        filePath: s3Key, // Return S3 key instead of local path
        headers,
      });
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

          return line
            .split(',')
            .map((h, i) => {
              let header = h.trim();
              if (
                (header.startsWith('"') && header.endsWith('"')) ||
                (header.startsWith("'") && header.endsWith("'"))
              ) {
                header = header.slice(1, -1);
              }
              return header || `Column_${i + 1}`;
            });
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

    // 2. Add to Queue with immediate processing priority
    try {
      await importQueue.add('import-job', { 
          filePath, 
          mapping, 
          jobId: newJob._id 
      }, {
        priority: 1, // High priority for immediate processing
        attempts: 3, // Retry up to 3 times on failure
        backoff: {
          type: 'exponential',
          delay: 2000, // Start with 2 second delay
        },
        removeOnComplete: true, // Remove completed jobs to save memory
        removeOnFail: false, // Keep failed jobs for debugging
      });
    } catch (queueError) {
      // If queue fails, update job status to FAILED
      await UploadJob.findByIdAndUpdate(newJob._id, { 
        status: 'FAILED',
        error: queueError.message || 'Failed to add job to processing queue'
      });
      return res.status(500).json({ 
        message: 'Failed to start processing. Queue service unavailable.',
        error: queueError.message 
      });
    }
    
    res.json({ message: 'Processing started', jobId: newJob._id });
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
        const jobs = await UploadJob.find().sort({ createdAt: -1 }).populate('uploadedBy', 'name email');
        res.json(jobs);
    } catch (error) {
        res.status(500).json({ message: error.message });
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

    const [candidates, totalCount] = await Promise.all([
      Candidate.find(query)
        .limit(limitNum)
        .skip(skip)
        .select('-sourceFile -uploadJobId')
        .sort({ createdAt: -1 })
        .exec(),
      Candidate.countDocuments(query)
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
    }).select('-sourceFile -uploadJobId -__v');

    if (candidates.length === 0) {
      return res.status(404).json({ message: "No candidates found" });
    }

    // Convert to CSV
    const csvHeaders = [
      'Full Name', 'Email', 'Phone', 'Company', 'Industry', 'Job Title', 'Skills',
      'Country', 'Locality', 'Location', 'LinkedIn URL', 'GitHub URL', 'Birth Year', 'Summary'
    ];

    const csvRows = candidates.map(candidate => [
      candidate.fullName || '',
      candidate.email || '',
      candidate.phone || '',
      candidate.company || '',
      candidate.industry || '',
      candidate.jobTitle || '',
      candidate.skills || '',
      candidate.experience || '',
      candidate.country || '',
      candidate.locality || '',
      candidate.location || '',
      candidate.linkedinUrl || '',
      candidate.githubUrl || '',
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
        await UploadJob.findByIdAndDelete(id);
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

    // Create the Word Document with improved formatting
    const doc = new Document({
      styles: {
        paragraphStyles: [
          {
            id: "normalPara",
            name: "Normal Para",
            basedOn: "Normal",
            next: "Normal",
            quickFormat: true,
            run: {
              font: "Calibri",
              size: 24, // 12pt
            },
            paragraph: {
              spacing: {
                line: 276, // 1.15 line spacing
                before: 0,
                after: 120, // 6pt after
              },
            },
          },
          {
            id: "heading1",
            name: "Heading 1",
            basedOn: "Normal",
            next: "Normal",
            quickFormat: true,
            run: {
              font: "Calibri",
              size: 32, // 16pt
              bold: true,
              color: "2E75B6",
            },
            paragraph: {
              spacing: {
                before: 240, // 12pt
                after: 120, // 6pt
              },
            },
          },
          {
            id: "heading2",
            name: "Heading 2",
            basedOn: "Normal",
            next: "Normal",
            quickFormat: true,
            run: {
              font: "Calibri",
              size: 28, // 14pt
              bold: true,
              color: "2E75B6",
            },
            paragraph: {
              spacing: {
                before: 200, // 10pt
                after: 100, // 5pt
              },
            },
          },
        ],
      },
      sections: [{
        properties: {},
        children: [
          // Header with Name
          new Paragraph({
            text: candidate.fullName || "Candidate Profile",
            style: "heading1",
            alignment: AlignmentType.CENTER,
            spacing: { after: 200 },
          }),

          // Job Title and Location
          new Paragraph({
            children: [
              new TextRun({
                text: candidate.jobTitle || "Position Not Specified",
                font: "Calibri",
                size: 26, // 13pt
                bold: true,
              }),
              new TextRun({
                text: candidate.locality || candidate.country || candidate.location ? ` • ${[candidate.locality, candidate.country, candidate.location].filter(Boolean).join(', ')}` : "",
                font: "Calibri",
                size: 24,
                color: "666666",
              }),
            ],
            alignment: AlignmentType.CENTER,
            spacing: { after: 400 },
          }),

          // Contact Information Section
          new Paragraph({
            text: "Contact Information",
            style: "heading2",
          }),

          // Contact Details
          new Paragraph({
            children: [
              new TextRun({ text: "Email: ", bold: true, font: "Calibri", size: 24 }),
              new TextRun({
                text: candidate.email || "Not provided",
                font: "Calibri",
                size: 24,
                color: candidate.email ? "000000" : "888888"
              }),
            ],
            spacing: { after: 100 },
          }),

          new Paragraph({
            children: [
              new TextRun({ text: "Phone: ", bold: true, font: "Calibri", size: 24 }),
              new TextRun({
                text: candidate.phone || "Not provided",
                font: "Calibri",
                size: 24,
                color: candidate.phone ? "000000" : "888888"
              }),
            ],
            spacing: { after: 100 },
          }),

          candidate.linkedinUrl && new Paragraph({
            children: [
              new TextRun({ text: "LinkedIn: ", bold: true, font: "Calibri", size: 24 }),
              new TextRun({
                text: candidate.linkedinUrl,
                font: "Calibri",
                size: 24,
                color: "0077B5",
                underline: {}
              }),
            ],
            spacing: { after: 100 },
          }),

          candidate.githubUrl && new Paragraph({
            children: [
              new TextRun({ text: "GitHub: ", bold: true, font: "Calibri", size: 24 }),
              new TextRun({
                text: candidate.githubUrl,
                font: "Calibri",
                size: 24,
                color: "333333",
                underline: {}
              }),
            ],
            spacing: { after: 200 },
          }),

          // Professional Details Section
          new Paragraph({
            text: "Professional Details",
            style: "heading2",
          }),

          candidate.jobTitle && new Paragraph({
            children: [
              new TextRun({ text: "Current Position: ", bold: true, font: "Calibri", size: 24 }),
              new TextRun({ text: candidate.jobTitle, font: "Calibri", size: 24 }),
            ],
            spacing: { after: 100 },
          }),

          candidate.company && new Paragraph({
            children: [
              new TextRun({ text: "Company: ", bold: true, font: "Calibri", size: 24 }),
              new TextRun({ text: candidate.company, font: "Calibri", size: 24 }),
            ],
            spacing: { after: 100 },
          }),

          candidate.industry && new Paragraph({
            children: [
              new TextRun({ text: "Industry: ", bold: true, font: "Calibri", size: 24 }),
              new TextRun({ text: candidate.industry, font: "Calibri", size: 24 }),
            ],
            spacing: { after: 100 },
          }),

          candidate.experience && new Paragraph({
            children: [
              new TextRun({ text: "Experience: ", bold: true, font: "Calibri", size: 24 }),
              new TextRun({ text: candidate.experience, font: "Calibri", size: 24 }),
            ],
            spacing: { after: 100 },
          }),

          candidate.birthYear && new Paragraph({
            children: [
              new TextRun({ text: "Birth Year: ", bold: true, font: "Calibri", size: 24 }),
              new TextRun({ text: candidate.birthYear, font: "Calibri", size: 24 }),
            ],
            spacing: { after: 200 },
          }),

          // Skills Section
          new Paragraph({
            text: "Skills & Expertise",
            style: "heading2",
          }),

          new Paragraph({
            text: candidate.skills ? candidate.skills.split(",").map(skill => skill.trim()).join(" • ") : "No specific skills listed.",
            font: "Calibri",
            size: 24,
            spacing: { after: 200 },
          }),

          // Summary Section (if available)
          candidate.summary && new Paragraph({
            text: "Professional Summary",
            style: "heading2",
          }),

          candidate.summary && new Paragraph({
            text: candidate.summary,
            font: "Calibri",
            size: 24,
            spacing: { after: 300 },
          }),

          // Footer
          new Paragraph({
            text: "─".repeat(50),
            alignment: AlignmentType.CENTER,
            spacing: { before: 300, after: 100 },
            font: "Calibri",
            size: 20,
            color: "CCCCCC",
          }),

          new Paragraph({
            text: "Profile generated by Hirextra",
            alignment: AlignmentType.CENTER,
            font: "Calibri",
            size: 20,
            color: "888888",
            italics: true,
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