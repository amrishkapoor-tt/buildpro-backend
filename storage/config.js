/**
 * Storage Configuration Module
 * Validates and provides configuration for different storage providers
 */

/**
 * Get configuration for a specific storage type
 * @param {string} type - Storage type (local, s3, etc.)
 * @param {Object} customConfig - Custom configuration overrides
 * @returns {Object} - Validated configuration
 */
function getConfig(type, customConfig = {}) {
  const configs = {
    local: {
      path: process.env.LOCAL_STORAGE_PATH || './uploads',
      baseUrl: process.env.LOCAL_STORAGE_BASE_URL || '/uploads'
    },
    s3: {
      bucket: process.env.AWS_S3_BUCKET,
      region: process.env.AWS_REGION || 'us-east-1',
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      signedUrlExpiry: parseInt(process.env.SIGNED_URL_EXPIRY || '3600', 10)
    }
  };

  const baseConfig = configs[type];
  if (!baseConfig) {
    throw new Error(`Unknown storage type: ${type}. Supported types: ${Object.keys(configs).join(', ')}`);
  }

  const finalConfig = { ...baseConfig, ...customConfig };
  validateConfig(type, finalConfig);
  return finalConfig;
}

/**
 * Validate configuration for a specific storage type
 * @param {string} type - Storage type
 * @param {Object} config - Configuration to validate
 * @throws {Error} - If configuration is invalid
 */
function validateConfig(type, config) {
  const validators = {
    local: (cfg) => {
      if (!cfg.path) {
        throw new Error('Local storage requires LOCAL_STORAGE_PATH to be configured');
      }
    },
    s3: (cfg) => {
      const missing = [];
      if (!cfg.bucket) missing.push('AWS_S3_BUCKET');
      if (!cfg.accessKeyId) missing.push('AWS_ACCESS_KEY_ID');
      if (!cfg.secretAccessKey) missing.push('AWS_SECRET_ACCESS_KEY');

      if (missing.length > 0) {
        throw new Error(
          `S3 storage requires the following environment variables: ${missing.join(', ')}`
        );
      }

      if (!cfg.region) {
        throw new Error('S3 storage requires AWS_REGION to be configured');
      }

      if (isNaN(cfg.signedUrlExpiry) || cfg.signedUrlExpiry <= 0) {
        throw new Error('SIGNED_URL_EXPIRY must be a positive number');
      }
    }
  };

  const validator = validators[type];
  if (validator) {
    validator(config);
  }
}

module.exports = {
  getConfig,
  validateConfig
};
