/**
 * Multer Upload Middleware
 * Configures multer based on storage type (local vs cloud)
 */

const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const storageType = process.env.STORAGE_TYPE || 'local';

/**
 * Get appropriate multer storage engine based on storage type
 * - Local: Use diskStorage (saves to disk immediately)
 * - Cloud (S3, etc.): Use memoryStorage (keeps in memory for upload)
 */
function getMulterStorage() {
  if (storageType === 'local') {
    // Disk storage for local filesystem
    const uploadDir = process.env.LOCAL_STORAGE_PATH || './uploads';

    // Ensure directory exists
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
      console.log(`Created upload directory: ${uploadDir}`);
    }

    return multer.diskStorage({
      destination: (req, file, cb) => {
        cb(null, uploadDir);
      },
      filename: (req, file, cb) => {
        const uniqueName = `${Date.now()}-${uuidv4()}${path.extname(file.originalname)}`;
        cb(null, uniqueName);
      }
    });
  } else {
    // Memory storage for cloud providers (S3, GCS, Azure)
    // Files are kept in memory as Buffer and uploaded to cloud storage
    console.log(`Using memory storage for ${storageType} storage`);
    return multer.memoryStorage();
  }
}

/**
 * File filter to validate file types
 */
function fileFilter(req, file, cb) {
  const allowedTypes = /jpeg|jpg|png|gif|pdf|doc|docx|xls|xlsx|dwg|dxf/;
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = allowedTypes.test(file.mimetype.split('/')[1]);

  if (extname || mimetype) {
    return cb(null, true);
  } else {
    cb(new Error(`Invalid file type. Allowed types: ${allowedTypes.source}`));
  }
}

/**
 * Create multer upload instance
 */
const upload = multer({
  storage: getMulterStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB limit
  },
  fileFilter: fileFilter
});

module.exports = {
  upload,
  storageType
};
