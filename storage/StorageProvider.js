/**
 * Base Storage Provider Interface
 * Defines the contract that all storage providers must implement
 */
class StorageProvider {
  constructor(config) {
    if (new.target === StorageProvider) {
      throw new Error('StorageProvider is an abstract class and cannot be instantiated directly');
    }
    this.config = config;
  }

  /**
   * Upload a file from multer (with file.path or file.buffer)
   * @param {Object} file - Multer file object
   * @param {Object} metadata - Additional metadata (mimetype, projectId, etc.)
   * @returns {Promise<Object>} - { path, url, size }
   */
  async uploadFile(file, metadata) {
    throw new Error('uploadFile() must be implemented by subclass');
  }

  /**
   * Upload a buffer directly
   * @param {Buffer} buffer - File buffer
   * @param {string} filename - Original filename
   * @param {Object} metadata - Additional metadata
   * @returns {Promise<Object>} - { path, url, size }
   */
  async uploadBuffer(buffer, filename, metadata) {
    throw new Error('uploadBuffer() must be implemented by subclass');
  }

  /**
   * Download a file as a buffer
   * @param {string} path - Storage path/key
   * @returns {Promise<Buffer>} - File buffer
   */
  async downloadFile(path) {
    throw new Error('downloadFile() must be implemented by subclass');
  }

  /**
   * Get a readable stream for a file
   * @param {string} path - Storage path/key
   * @returns {Promise<Stream>} - Readable stream
   */
  async getFileStream(path) {
    throw new Error('getFileStream() must be implemented by subclass');
  }

  /**
   * Generate a signed URL for temporary access
   * @param {string} path - Storage path/key
   * @param {number} expiresIn - Expiry time in seconds (default: 3600)
   * @returns {Promise<string>} - Signed URL
   */
  async getSignedUrl(path, expiresIn = 3600) {
    throw new Error('getSignedUrl() must be implemented by subclass');
  }

  /**
   * Delete a single file
   * @param {string} path - Storage path/key
   * @returns {Promise<boolean>} - Success status
   */
  async deleteFile(path) {
    throw new Error('deleteFile() must be implemented by subclass');
  }

  /**
   * Delete multiple files
   * @param {Array<string>} paths - Array of storage paths/keys
   * @returns {Promise<Object>} - { successful: [], failed: [] }
   */
  async deleteFiles(paths) {
    const results = { successful: [], failed: [] };

    for (const path of paths) {
      try {
        await this.deleteFile(path);
        results.successful.push(path);
      } catch (error) {
        results.failed.push({ path, error: error.message });
      }
    }

    return results;
  }

  /**
   * Check if a file exists
   * @param {string} path - Storage path/key
   * @returns {Promise<boolean>} - Exists status
   */
  async fileExists(path) {
    throw new Error('fileExists() must be implemented by subclass');
  }

  /**
   * Health check for storage connectivity
   * @returns {Promise<boolean>} - Health status
   */
  async healthCheck() {
    throw new Error('healthCheck() must be implemented by subclass');
  }
}

module.exports = StorageProvider;
