const StorageProvider = require('./StorageProvider');
const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, DeleteObjectsCommand, HeadObjectCommand, HeadBucketCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

/**
 * AWS S3 Storage Provider
 * Stores files in Amazon S3 for persistent, scalable storage
 */
class S3StorageProvider extends StorageProvider {
  constructor(config) {
    super(config);
    this.s3Client = new S3Client({
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey
      }
    });
  }

  /**
   * Generate a unique S3 key for a file
   * @param {string} filename - Original filename
   * @returns {string} - S3 key
   */
  generateS3Key(filename) {
    const timestamp = Date.now();
    const uuid = uuidv4();
    const ext = path.extname(filename);
    return `uploads/${timestamp}-${uuid}${ext}`;
  }

  /**
   * Upload a file from multer (using buffer from memoryStorage)
   * @param {Object} file - Multer file object with file.buffer
   * @param {Object} metadata - Additional metadata
   * @returns {Promise<Object>} - { path, url, size }
   */
  async uploadFile(file, metadata) {
    return await this.uploadBuffer(file.buffer, file.originalname, metadata);
  }

  /**
   * Upload a buffer to S3
   * @param {Buffer} buffer - File buffer
   * @param {string} filename - Original filename
   * @param {Object} metadata - Additional metadata (mimetype, etc.)
   * @returns {Promise<Object>} - { path, url, size }
   */
  async uploadBuffer(buffer, filename, metadata = {}) {
    const key = this.generateS3Key(filename);

    const command = new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: key,
      Body: buffer,
      ContentType: metadata.mimetype || 'application/octet-stream',
      Metadata: {
        originalName: filename,
        uploadedAt: new Date().toISOString(),
        ...(metadata.projectId && { projectId: String(metadata.projectId) })
      }
    });

    try {
      await this.s3Client.send(command);

      return {
        path: key,
        url: `https://${this.config.bucket}.s3.${this.config.region}.amazonaws.com/${key}`,
        size: buffer.length
      };
    } catch (error) {
      console.error('S3 upload error:', error.message);
      throw new Error(`Failed to upload file to S3: ${error.message}`);
    }
  }

  /**
   * Download a file from S3 as a buffer
   * @param {string} key - S3 key
   * @returns {Promise<Buffer>} - File buffer
   */
  async downloadFile(key) {
    const command = new GetObjectCommand({
      Bucket: this.config.bucket,
      Key: key
    });

    try {
      const response = await this.s3Client.send(command);

      // Convert stream to buffer
      const chunks = [];
      for await (const chunk of response.Body) {
        chunks.push(chunk);
      }
      return Buffer.concat(chunks);
    } catch (error) {
      console.error('S3 download error:', error.message);
      throw new Error(`Failed to download file from S3: ${error.message}`);
    }
  }

  /**
   * Get a readable stream for a file from S3
   * @param {string} key - S3 key
   * @returns {Promise<Stream>} - Readable stream
   */
  async getFileStream(key) {
    const command = new GetObjectCommand({
      Bucket: this.config.bucket,
      Key: key
    });

    try {
      const response = await this.s3Client.send(command);
      return response.Body;
    } catch (error) {
      console.error('S3 stream error:', error.message);
      throw new Error(`Failed to get file stream from S3: ${error.message}`);
    }
  }

  /**
   * Generate a signed URL for temporary access
   * @param {string} key - S3 key
   * @param {number} expiresIn - Expiry time in seconds
   * @returns {Promise<string>} - Signed URL
   */
  async getSignedUrl(key, expiresIn = null) {
    const expiry = expiresIn || this.config.signedUrlExpiry;

    const command = new GetObjectCommand({
      Bucket: this.config.bucket,
      Key: key
    });

    try {
      const signedUrl = await getSignedUrl(this.s3Client, command, { expiresIn: expiry });
      return signedUrl;
    } catch (error) {
      console.error('S3 signed URL error:', error.message);
      throw new Error(`Failed to generate signed URL: ${error.message}`);
    }
  }

  /**
   * Delete a single file from S3
   * @param {string} key - S3 key to delete
   * @returns {Promise<boolean>} - Success status
   */
  async deleteFile(key) {
    const command = new DeleteObjectCommand({
      Bucket: this.config.bucket,
      Key: key
    });

    try {
      await this.s3Client.send(command);
      return true;
    } catch (error) {
      console.error(`Error deleting file ${key} from S3:`, error.message);
      throw error;
    }
  }

  /**
   * Delete multiple files from S3 (optimized batch deletion)
   * @param {Array<string>} keys - Array of S3 keys
   * @returns {Promise<Object>} - { successful: [], failed: [] }
   */
  async deleteFiles(keys) {
    if (keys.length === 0) {
      return { successful: [], failed: [] };
    }

    // S3 allows deleting up to 1000 objects at once
    const batchSize = 1000;
    const results = { successful: [], failed: [] };

    for (let i = 0; i < keys.length; i += batchSize) {
      const batch = keys.slice(i, i + batchSize);

      const command = new DeleteObjectsCommand({
        Bucket: this.config.bucket,
        Delete: {
          Objects: batch.map(key => ({ Key: key })),
          Quiet: false
        }
      });

      try {
        const response = await this.s3Client.send(command);

        // Track successful deletions
        if (response.Deleted) {
          results.successful.push(...response.Deleted.map(obj => obj.Key));
        }

        // Track failed deletions
        if (response.Errors) {
          results.failed.push(...response.Errors.map(err => ({
            path: err.Key,
            error: `${err.Code}: ${err.Message}`
          })));
        }
      } catch (error) {
        console.error('S3 batch delete error:', error.message);
        // If batch fails entirely, mark all in batch as failed
        results.failed.push(...batch.map(key => ({
          path: key,
          error: error.message
        })));
      }
    }

    return results;
  }

  /**
   * Check if a file exists in S3
   * @param {string} key - S3 key to check
   * @returns {Promise<boolean>} - Exists status
   */
  async fileExists(key) {
    const command = new HeadObjectCommand({
      Bucket: this.config.bucket,
      Key: key
    });

    try {
      await this.s3Client.send(command);
      return true;
    } catch (error) {
      if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Health check for S3 connectivity
   * @returns {Promise<boolean>} - Health status
   */
  async healthCheck() {
    const command = new HeadBucketCommand({
      Bucket: this.config.bucket
    });

    try {
      await this.s3Client.send(command);
      return true;
    } catch (error) {
      console.error('S3 health check failed:', error.message);
      return false;
    }
  }
}

module.exports = S3StorageProvider;
