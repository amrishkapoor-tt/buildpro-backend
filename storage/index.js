/**
 * Storage Factory
 * Creates and manages storage provider instances
 */

const LocalStorageProvider = require('./LocalStorageProvider');
const S3StorageProvider = require('./S3StorageProvider');
const config = require('./config');

/**
 * Storage Factory Class
 * Creates storage provider instances based on type
 */
class StorageFactory {
  /**
   * Create a storage provider instance
   * @param {string} type - Storage type (local, s3, etc.)
   * @param {Object} customConfig - Custom configuration overrides
   * @returns {StorageProvider} - Storage provider instance
   */
  static create(type, customConfig = {}) {
    const storageConfig = config.getConfig(type, customConfig);

    switch (type) {
      case 'local':
        return new LocalStorageProvider(storageConfig);
      case 's3':
        return new S3StorageProvider(storageConfig);
      default:
        throw new Error(`Unsupported storage type: ${type}. Supported types: local, s3`);
    }
  }
}

// Create singleton instance based on environment
let storageInstance = null;

/**
 * Get the singleton storage instance
 * @returns {StorageProvider} - Storage provider instance
 */
function getStorageInstance() {
  if (!storageInstance) {
    const storageType = process.env.STORAGE_TYPE || 'local';
    console.log(`Initializing storage provider: ${storageType}`);

    try {
      storageInstance = StorageFactory.create(storageType);
      console.log(`Storage provider initialized successfully: ${storageType}`);
    } catch (error) {
      console.error(`Failed to initialize storage provider (${storageType}):`, error.message);
      console.log('Falling back to local storage');
      storageInstance = StorageFactory.create('local');
    }
  }
  return storageInstance;
}

// Export the singleton instance and factory
module.exports = getStorageInstance();
module.exports.StorageFactory = StorageFactory;
module.exports.getStorageInstance = getStorageInstance;
