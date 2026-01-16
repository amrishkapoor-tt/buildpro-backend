const StorageProvider = require('./StorageProvider');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const { v4: uuidv4 } = require('uuid');

const unlinkAsync = promisify(fs.unlink);
const existsAsync = promisify(fs.exists);
const accessAsync = promisify(fs.access);
const mkdirAsync = promisify(fs.mkdir);

/**
 * Local Disk Storage Provider
 * Stores files on the local filesystem (current behavior)
 */
class LocalStorageProvider extends StorageProvider {
  constructor(config) {
    super(config);
    this.ensureUploadDirectory();
  }

  /**
   * Ensure the upload directory exists
   */
  ensureUploadDirectory() {
    if (!fs.existsSync(this.config.path)) {
      fs.mkdirSync(this.config.path, { recursive: true });
      console.log(`Created upload directory: ${this.config.path}`);
    }
  }

  /**
   * Upload a file (already saved by multer diskStorage)
   * @param {Object} file - Multer file object with file.path
   * @param {Object} metadata - Additional metadata
   * @returns {Promise<Object>} - { path, url, size }
   */
  async uploadFile(file, metadata) {
    // For local storage with diskStorage, the file is already saved
    // file.path contains the full path
    const relativePath = path.relative(process.cwd(), file.path);
    const filename = path.basename(file.path);

    return {
      path: relativePath,
      url: `${this.config.baseUrl}/${filename}`,
      size: file.size
    };
  }

  /**
   * Upload a buffer (for cloud storage compatibility when using memoryStorage)
   * @param {Buffer} buffer - File buffer
   * @param {string} filename - Original filename
   * @param {Object} metadata - Additional metadata
   * @returns {Promise<Object>} - { path, url, size }
   */
  async uploadBuffer(buffer, filename, metadata) {
    const uniqueName = `${Date.now()}-${uuidv4()}${path.extname(filename)}`;
    const filePath = path.join(this.config.path, uniqueName);
    const relativePath = path.relative(process.cwd(), filePath);

    // Write buffer to disk
    await fs.promises.writeFile(filePath, buffer);

    return {
      path: relativePath,
      url: `${this.config.baseUrl}/${uniqueName}`,
      size: buffer.length
    };
  }

  /**
   * Download a file as a buffer
   * @param {string} filePath - File path
   * @returns {Promise<Buffer>} - File buffer
   */
  async downloadFile(filePath) {
    const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
    return await fs.promises.readFile(absolutePath);
  }

  /**
   * Get a readable stream for a file
   * @param {string} filePath - File path
   * @returns {Promise<Stream>} - Readable stream
   */
  async getFileStream(filePath) {
    const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
    return fs.createReadStream(absolutePath);
  }

  /**
   * Generate a signed URL (not applicable for local storage, returns local path)
   * @param {string} filePath - File path
   * @param {number} expiresIn - Not used for local storage
   * @returns {Promise<string>} - Local URL
   */
  async getSignedUrl(filePath, expiresIn = 3600) {
    // For local storage, just return the local URL path
    // No signed URLs needed since access is controlled by express.static
    const filename = path.basename(filePath);
    return `${this.config.baseUrl}/${filename}`;
  }

  /**
   * Delete a single file
   * @param {string} filePath - File path to delete
   * @returns {Promise<boolean>} - Success status
   */
  async deleteFile(filePath) {
    try {
      const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);

      // Check if file exists before attempting to delete
      if (fs.existsSync(absolutePath)) {
        await unlinkAsync(absolutePath);
        return true;
      } else {
        console.warn(`File not found, skipping deletion: ${absolutePath}`);
        return false;
      }
    } catch (error) {
      console.error(`Error deleting file ${filePath}:`, error.message);
      throw error;
    }
  }

  /**
   * Check if a file exists
   * @param {string} filePath - File path to check
   * @returns {Promise<boolean>} - Exists status
   */
  async fileExists(filePath) {
    try {
      const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
      await accessAsync(absolutePath, fs.constants.F_OK);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Health check for local storage
   * @returns {Promise<boolean>} - Health status
   */
  async healthCheck() {
    try {
      // Check if directory exists and is writable
      const testFile = path.join(this.config.path, `.health-check-${Date.now()}`);

      // Try to write a test file
      await fs.promises.writeFile(testFile, 'health check');

      // Try to read it back
      await fs.promises.readFile(testFile);

      // Clean up test file
      await unlinkAsync(testFile);

      return true;
    } catch (error) {
      console.error('Local storage health check failed:', error.message);
      return false;
    }
  }
}

module.exports = LocalStorageProvider;
