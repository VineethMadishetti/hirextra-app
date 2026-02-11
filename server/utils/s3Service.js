import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import logger from './logger.js';
import { Readable } from 'stream';

// Initialize S3 Client
const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const BUCKET_NAME = process.env.AWS_S3_BUCKET || process.env.AWS_S3_BUCKET_NAME;

// Validate BUCKET_NAME is set
if (!BUCKET_NAME) {
  logger.error('❌ AWS_S3_BUCKET or AWS_S3_BUCKET_NAME environment variable is not set');
  throw new Error('S3 bucket name is not configured. Please set AWS_S3_BUCKET or AWS_S3_BUCKET_NAME environment variable.');
}

/**
 * Upload a file to S3
 * @param {Buffer|Stream} fileData - File data to upload
 * @param {string} key - S3 object key (file path in bucket)
 * @param {string} contentType - MIME type of the file
 * @returns {Promise<string>} - S3 key/path
 */
export const uploadToS3 = async (fileData, key, contentType = 'application/octet-stream') => {
  try {
    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      Body: fileData,
      ContentType: contentType,
    });

    await s3Client.send(command);
    logger.info(`✅ File uploaded to S3: ${key}`);
    return key;
  } catch (error) {
    logger.error(`❌ S3 upload failed for ${key}:`, error);
    throw new Error(`Failed to upload file to S3: ${error.message}`);
  }
};

/**
 * Upload file chunk to S3 (for multipart uploads)
 * @param {Buffer} chunkData - Chunk data
 * @param {string} key - S3 object key
 * @param {boolean} isAppend - Whether to append to existing file
 * @returns {Promise<void>}
 */
export const uploadChunkToS3 = async (chunkData, key, isAppend = false) => {
  try {
    if (isAppend) {
      // For appending, we need to download existing file, append chunk, and re-upload
      // This is not ideal for large files, but works for chunked uploads
      let existingData = Buffer.alloc(0);
      
      try {
        const getCommand = new GetObjectCommand({
          Bucket: BUCKET_NAME,
          Key: key,
        });
        const response = await s3Client.send(getCommand);
        const chunks = [];
        for await (const chunk of response.Body) {
          chunks.push(chunk);
        }
        existingData = Buffer.concat(chunks);
      } catch (err) {
        // File doesn't exist yet, that's okay
        if (err.name !== 'NoSuchKey') {
          throw err;
        }
      }

      const combinedData = Buffer.concat([existingData, chunkData]);
      
      const putCommand = new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
        Body: combinedData,
        ContentType: 'text/csv',
      });

      await s3Client.send(putCommand);
    } else {
      // First chunk - just upload
      const putCommand = new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
        Body: chunkData,
        ContentType: 'text/csv',
      });

      await s3Client.send(putCommand);
    }
  } catch (error) {
    logger.error(`❌ S3 chunk upload failed for ${key}:`, error);
    throw new Error(`Failed to upload chunk to S3: ${error.message}`);
  }
};

/**
 * Download file from S3 as stream
 * @param {string} key - S3 object key
 * @param {object} options - Optional parameters
 * @param {number} options.rangeStart - Start byte for range request
 * @param {number} options.rangeEnd - End byte for range request
 * @returns {Promise<Readable>} - Readable stream
 */
export const downloadFromS3 = async (key, options = {}) => {
  try {
    const commandParams = {
      Bucket: BUCKET_NAME,
      Key: key,
    };

    // Add Range header if specified (for reading only first few KB)
    if (options.rangeStart !== undefined || options.rangeEnd !== undefined) {
      const rangeStart = options.rangeStart || 0;
      const rangeEnd = options.rangeEnd || '';
      commandParams.Range = `bytes=${rangeStart}-${rangeEnd}`;
    }

    const command = new GetObjectCommand(commandParams);
    const response = await s3Client.send(command);

    /**
     * In Node.js runtimes (including Render), AWS SDK v3 returns
     * `response.Body` as a Node.js Readable stream (e.g. ChecksumStream),
     * NOT a Web ReadableStream. Our previous use of Readable.fromWeb()
     * caused the \"ChecksumStream\" type error in production.
     *
     * So we:
     * - If Body is already a Node Readable → return it directly.
     * - Only ever use Readable.fromWeb / manual getReader() when Body
     *   is actually a Web ReadableStream (has getReader function).
     */

    const body = response.Body;

    // Case 1: Node.js Readable stream (most common in Node 18+ with AWS SDK v3)
    if (body instanceof Readable || (body && typeof body.pipe === 'function')) {
      return body;
    }

    // Case 2: Web ReadableStream (browser-like envs)
    if (body && typeof body.getReader === 'function') {
      // Prefer native adapter if available
      if (typeof Readable.fromWeb === 'function') {
        return Readable.fromWeb(body);
      }

      // Manual adapter: Web ReadableStream → Node Readable
      const nodeStream = new Readable({
        read() {}, // no-op, we'll push asynchronously
      });

      (async () => {
        try {
          const reader = body.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              nodeStream.push(null);
              break;
            }
            nodeStream.push(Buffer.from(value));
          }
        } catch (err) {
          logger.error(`❌ Error reading S3 web stream for ${key}:`, err);
          nodeStream.destroy(err);
        }
      })();

      return nodeStream;
    }

    // Fallback: unexpected type
    throw new Error(`Unsupported S3 Body stream type for key ${key}`);
  } catch (error) {
    logger.error(`❌ S3 download failed for ${key}:`, error);
    throw new Error(`Failed to download file from S3: ${error.message}`);
  }
};

/**
 * Download file from S3 to buffer
 * @param {string} key - S3 object key
 * @returns {Promise<Buffer>} - File buffer
 */
export const downloadBufferFromS3 = async (key) => {
  try {
    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    });

    const response = await s3Client.send(command);
    const chunks = [];
    
    for await (const chunk of response.Body) {
      chunks.push(chunk);
    }
    
    return Buffer.concat(chunks);
  } catch (error) {
    logger.error(`❌ S3 buffer download failed for ${key}:`, error);
    throw new Error(`Failed to download file from S3: ${error.message}`);
  }
};

/**
 * Check if file exists in S3
 * @param {string} key - S3 object key
 * @returns {Promise<boolean>}
 */
export const fileExistsInS3 = async (key) => {
  try {
    const command = new HeadObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    });

    await s3Client.send(command);
    return true;
  } catch (error) {
    if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
      return false;
    }
    logger.warn(`⚠️ fileExistsInS3 (HeadObject) failed for ${key}: ${error.message}`);
    throw error;
  }
};

/**
 * Delete file from S3
 * @param {string} key - S3 object key
 * @returns {Promise<void>}
 */
export const deleteFromS3 = async (key) => {
  try {
    const command = new DeleteObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    });

    await s3Client.send(command);
    logger.info(`✅ File deleted from S3: ${key}`);
  } catch (error) {
    logger.error(`❌ S3 delete failed for ${key}:`, error);
    throw new Error(`Failed to delete file from S3: ${error.message}`);
  }
};

/**
 * Get presigned URL for file access
 * @param {string} key - S3 object key
 * @param {number} expiresIn - URL expiration time in seconds (default: 3600)
 * @returns {Promise<string>} - Presigned URL
 */
export const getPresignedUrl = async (key, expiresIn = 3600) => {
  try {
    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    });

    const url = await getSignedUrl(s3Client, command, { expiresIn });
    return url;
  } catch (error) {
    logger.error(`❌ Failed to generate presigned URL for ${key}:`, error);
    throw new Error(`Failed to generate presigned URL: ${error.message}`);
  }
};

/**
 * Generate S3 key for uploaded file
 * @param {string} fileName - Original file name
 * @param {string} userId - User ID who uploaded
 * @returns {string} - S3 key
 */
export const generateS3Key = (fileName, userId) => {
  const timestamp = Date.now();
  const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
  return `uploads/${userId}/${timestamp}_${sanitizedFileName}`;
};

/**
 * List files in an S3 folder
 * @param {string} folderPath - S3 folder path (prefix)
 * @returns {Promise<Array>} - List of file objects
 */
export const listS3Files = async (folderPath) => {
  try {
    let files = [];
    let continuationToken = undefined;

    do {
      const command = new ListObjectsV2Command({
        Bucket: BUCKET_NAME,
        Prefix: folderPath,
        ContinuationToken: continuationToken,
      });
      const response = await s3Client.send(command);
      if (response.Contents) files.push(...response.Contents);
      continuationToken = response.NextContinuationToken;
    } while (continuationToken);

    return files;
  } catch (error) {
    logger.error(`❌ Failed to list files in S3 folder ${folderPath}:`, error);
    throw new Error(`Failed to list files from S3: ${error.message}`);
  }
};
