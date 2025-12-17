import { Queue, Worker } from 'bullmq';
import fs from 'fs';
import path from 'path';
import csv from 'csv-parser';
import Candidate from '../models/Candidate.js';
import UploadJob from '../models/UploadJob.js';
import readline from 'readline';
import logger from './logger.js';
import { downloadFromS3 } from './s3Service.js';

// Redis connection configuration
const getRedisConnection = () => {
  // Try REDIS_URL first (for cloud Redis services)
  if (process.env.REDIS_URL) {
    return process.env.REDIS_URL;
  }
  
  // Try individual Redis config
  if (process.env.REDIS_HOST && process.env.REDIS_PORT) {
    return {
      host: process.env.REDIS_HOST,
      port: parseInt(process.env.REDIS_PORT),
      password: process.env.REDIS_PASSWORD,
    };
  }
  
  // Fallback to localhost (for development)
  return 'redis://localhost:6379';
};

const connection = getRedisConnection();

// Create queue with error handling
let importQueue;
try {
  importQueue = new Queue('csv-import', { connection });
  logger.info('✅ Redis queue initialized');
} catch (error) {
  logger.error('❌ Failed to initialize Redis queue:', error);
  logger.warn('⚠️ Queue processing will not work without Redis. Please set REDIS_URL in environment variables.');
  // Create a dummy queue that will fail gracefully
  importQueue = {
    add: async (name, data) => {
      logger.error('❌ Cannot add job to queue: Redis not available');
      throw new Error('Redis connection not available. Please configure REDIS_URL.');
    }
  };
}

// Helper to get file stream (from S3 or local)
const getFileStream = async (filePath) => {
  // Check if it's an S3 key (starts with 'uploads/') or local path
  const isS3Key = filePath.startsWith('uploads/') || !filePath.includes(path.sep);
  
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
    const expectedHeaders = Object.values(mapping).filter(v => v && v.trim() !== '');
    
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
            const containsHeader = expectedHeaders.some(header => {
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

// Create worker with error handling
let worker;
try {
  worker = new Worker('csv-import', async (job) => {
  const { filePath, mapping, jobId } = job.data;
  logger.info(`🚀 Processing UploadJob ID: ${jobId}, File: ${filePath}`);

  try {
    await UploadJob.findByIdAndUpdate(jobId, { status: 'PROCESSING', startedAt: new Date() });

    // 1. Auto-Detect where the headers are
    const skipLinesCount = await findHeaderRowIndex(filePath, mapping);

    const batchSize = 5000;
    let candidates = [];
    let successCount = 0;
    let rowCounter = 0;

    // Helper to parse CSV line with proper quote handling
    const parseCSVLine = (csvLine) => {
      const result = [];
      let current = '';
      let inQuotes = false;
      
      for (let i = 0; i < csvLine.length; i++) {
        const char = csvLine[i];
        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
          result.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }
      result.push(current.trim()); // Add last field
      return result;
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
            headerRl = readline.createInterface({ input: headerStream, crlfDelay: Infinity });
            let headerLineNumber = 0;
            
            headerRl.on('line', (line) => {
              if (resolved) return; // Prevent multiple resolutions
              
              if (headerLineNumber === skipLinesCount && line && line.trim()) {
                const headers = parseCSVLine(line).map((h, idx) => {
                  // Remove quotes if present
                  let header = h.replace(/^["']|["']$/g, '');
                  return header && header.trim() ? header.trim() : `Column_${idx + 1}`;
                });
                
                logger.info(`📋 Actual headers found (${headers.length} columns):`, headers.slice(0, 10).join(', '), '...');
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
                    logger.warn('⚠️ Could not read header line manually, using CSV parser');
                    resolveHeaders(null);
                  }
                }
              }
            });
            
            headerRl.on('close', () => {
              if (!resolved) {
                resolved = true;
                resolveHeaders(null);
              }
            });
            
            headerRl.on('error', (err) => {
              if (!resolved) {
                resolved = true;
                logger.error('❌ Error reading headers:', err);
                if (headerRl) headerRl.close();
                if (headerStream) headerStream.destroy();
                rejectHeaders(err);
              }
            });
            
            headerStream.on('error', (err) => {
              if (!resolved) {
                resolved = true;
                logger.error('❌ Stream error reading headers:', err);
                if (headerRl) headerRl.close();
                if (headerStream) headerStream.destroy();
                rejectHeaders(err);
              }
            });
          } catch (error) {
            if (!resolved) {
              resolved = true;
              logger.error('❌ Failed to get file stream for headers:', error);
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
        logger.error('❌ Could not read headers from file');
        await UploadJob.findByIdAndUpdate(jobId, { status: 'FAILED' });
        reject(new Error('Could not read headers from file'));
        return;
      }
      
      logger.info(`✅ Using ${actualHeaders.length} headers for processing`);
      logger.debug(`📝 First 5 headers:`, actualHeaders.slice(0, 5).join(', '));
      
      // Now process the file with correct headers
      // When headers is an array, csv-parser:
      // 1. Uses those headers directly (doesn't read from file)
      // 2. Automatically skips the first line (assuming it's the header row)
      // 3. Starts processing data from the second line
      // So we need to: skip garbage rows + skip header row = skipLinesCount + 1
      const fileStream = await getFileStream(filePath);
      
      // Add error handler to fileStream
      fileStream.on('error', (err) => {
        logger.error('❌ File stream error during processing:', err);
      });
      
    const stream = fileStream
      .pipe(csv({
        skipLines: skipLinesCount + 1, // Skip garbage rows + header row (since we provide headers as array)
        headers: actualHeaders, // Provide headers as array - parser will use these and skip first data line
        strict: false,
        skipEmptyLines: false, // Don't skip empty lines - we want to preserve empty cells
      }))
      .on('data', (row) => {
        rowCounter++;

        // --- DEBUGGING FIRST ROW ---
        if (rowCounter === 1) {
            logger.debug("🔍 --- DEBUGGING FIRST ROW ---");
            logger.debug("Row keys detected:", Object.keys(row).slice(0, 10));
            logger.debug(`Expected header for 'Full Name': '${mapping.fullName}'`);
            logger.debug(`Row has '${mapping.fullName}':`, row[mapping.fullName] !== undefined);
            logger.debug(`Mapping 'Full Name' to '${mapping.fullName}' -> Found: "${row[mapping.fullName]}"`);
            console.log("Sample row data (first 5 fields):", JSON.stringify(Object.fromEntries(Object.entries(row).slice(0, 5))));
            console.log("All available keys in row:", Object.keys(row).slice(0, 20).join(', '));
            console.log("-----------------------------");
        }

        const getVal = (targetHeader) => {
            if (!targetHeader) return '';
            // Check exact match first
            if (row[targetHeader] !== undefined) {
                // Preserve empty strings - don't convert to empty if it's already empty
                const value = row[targetHeader];
                return value === null || value === undefined ? '' : String(value).trim();
            }
            // Loose match for case-insensitive header matching
            const looseKey = Object.keys(row).find(k => k.toLowerCase().trim() === targetHeader.toLowerCase().trim());
            if (looseKey !== undefined) {
                const value = row[looseKey];
                return value === null || value === undefined ? '' : String(value).trim();
            }
            return '';
        };

        const candidateData = {
          fullName: getVal(mapping.fullName),
          email: getVal(mapping.email),
          phone: getVal(mapping.phone),
          company: getVal(mapping.company),
          industry: getVal(mapping.industry),
          jobTitle: getVal(mapping.jobTitle),
          skills: getVal(mapping.skills),
          country: getVal(mapping.country),
          locality: getVal(mapping.locality),
          location: getVal(mapping.location),
          linkedinUrl: getVal(mapping.linkedinUrl),
          githubUrl: getVal(mapping.githubUrl),
          birthYear: getVal(mapping.birthYear),
          summary: getVal(mapping.summary),
          
          sourceFile: filePath,
          uploadJobId: jobId,
          isDeleted: false
        };

        candidates.push(candidateData);

        if (candidates.length >= batchSize) {
           Candidate.insertMany(candidates, { ordered: false })
             .then(docs => { 
               successCount += docs.length;
               // Update job progress every batch
               UploadJob.findByIdAndUpdate(jobId, { 
                 successRows: successCount,
                 totalRows: rowCounter
               }).catch(() => {});
             })
             .catch(() => {});
           candidates = [];
        }
        
        // Update progress every 1000 rows for live updates
        if (rowCounter % 1000 === 0) {
          UploadJob.findByIdAndUpdate(jobId, { 
            successRows: successCount,
            totalRows: rowCounter
          }).catch(() => {});
        }
      })
      .on('end', async () => {
        // Clean up stream
        if (fileStream) {
          fileStream.destroy();
        }
        
        if (candidates.length > 0) {
           const docs = await Candidate.insertMany(candidates, { ordered: false }).catch(() => []);
           successCount += docs.length || 0;
        }

        await UploadJob.findByIdAndUpdate(jobId, { 
            status: 'COMPLETED', 
            completedAt: new Date(),
            successRows: successCount,
            totalRows: successCount
        });

        logger.info(`✅ Job ${jobId} Completed. Rows Imported: ${successCount}`);
        resolve();
      })
      .on('error', async (err) => {
          // Clean up stream on error
          if (fileStream) {
            fileStream.destroy();
          }
          
          logger.error("❌ CSV Parsing Error:", err);
          logger.error("Error details:", {
            message: err.message,
            stack: err.stack,
            filePath,
            jobId
          });
          await UploadJob.findByIdAndUpdate(jobId, { 
            status: 'FAILED',
            error: err.message 
          });
          reject(err);
      });
  }).catch(async (err) => {
    logger.error(`❌ Job ${jobId} failed with error:`, err);
    logger.error("Error details:", {
      message: err.message,
      stack: err.stack,
      filePath,
      jobId
    });
    await UploadJob.findByIdAndUpdate(jobId, { 
      status: 'FAILED',
      error: err.message 
    });
    throw err;
  });
  } catch (error) {
    logger.error(`❌ Fatal error processing job ${jobId}:`, error);
    logger.error("Error details:", {
      message: error.message,
      stack: error.stack,
      filePath,
      jobId
    });
    await UploadJob.findByIdAndUpdate(jobId, { 
      status: 'FAILED',
      error: error.message 
    });
    throw error;
  }
  }, { 
    connection,
    concurrency: 1, // Process one job at a time
    limiter: {
      max: 1,
      duration: 1000,
    },
  });
  
  logger.info('✅ Redis worker initialized');
} catch (error) {
  logger.error('❌ Failed to initialize Redis worker:', error);
  logger.warn('⚠️ File processing will not work without Redis. Please set REDIS_URL in environment variables.');
  // Worker will be undefined, but queue.add() will already handle the error
}

export default importQueue;