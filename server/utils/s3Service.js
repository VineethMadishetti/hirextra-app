import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
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
 * @returns {Promise<Readable>} - Readable stream
 */
export const downloadFromS3 = async (key) => {
  try {
    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    });

    const response = await s3Client.send(command);
    
    // AWS SDK v3 returns response.Body as a ReadableStream (web stream)
    // Convert it to Node.js Readable stream
    let nodeStream;
    
    // Try using Readable.fromWeb (Node.js 18.3+)
    if (typeof Readable.fromWeb === 'function') {
      nodeStream = Readable.fromWeb(response.Body);
    } else {
      // Fallback for older Node.js versions
      nodeStream = new Readable({
        read() {} // No-op, data will be pushed asynchronously
      });
      
      // Convert web stream to Node.js stream manually
      (async () => {
        try {
          const reader = response.Body.getReader();
          
          while (true) {
            const { done, value } = await reader.read();
            
            if (done) {
              nodeStream.push(null); // End the stream
              break;
            }
            
            // Push the chunk to the Node.js stream
            nodeStream.push(Buffer.from(value));
          }
        } catch (err) {
          logger.error(`❌ Error reading S3 stream for ${key}:`, err);
          nodeStream.destroy(err);
        }
      })();
    }
    
    return nodeStream;
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
