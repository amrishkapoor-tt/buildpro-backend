# BuildPro Storage System

## Overview

BuildPro's storage system provides a pluggable abstraction layer for file storage, supporting both local disk storage and cloud storage providers (AWS S3). This allows seamless switching between storage backends without changing application code.

## Features

- **Pluggable Architecture**: Switch between storage providers via environment variables
- **Local Storage**: Zero-cost development and testing with local disk storage
- **AWS S3 Storage**: Production-ready persistent cloud storage
- **Automatic Failover**: Falls back to local storage if cloud configuration fails
- **Signed URLs**: Secure temporary access to cloud-stored files
- **Batch Operations**: Optimized bulk file deletion for S3
- **Health Checks**: Monitor storage system connectivity

## Storage Providers

### Local Storage (Default)

**Use Case**: Development, testing, and environments where file persistence is not critical

**Pros**:
- Zero cost
- Fast performance (local I/O)
- Simple setup
- No external dependencies

**Cons**:
- Files are ephemeral on platforms like Render (lost on restart/deployment)
- No automatic backups
- Single point of failure
- Not scalable

**Configuration**:
```bash
STORAGE_TYPE=local
LOCAL_STORAGE_PATH=./uploads
LOCAL_STORAGE_BASE_URL=/uploads
```

### AWS S3 Storage

**Use Case**: Production deployments requiring persistent, scalable file storage

**Pros**:
- Persistent and durable (99.999999999% durability)
- Scalable (unlimited storage)
- Automatic backups/versioning available
- CDN integration possible
- Geographic replication
- Cost-effective (~$0.023/GB/month)

**Cons**:
- Requires AWS account and configuration
- Network latency
- Ongoing costs

**Configuration**:
```bash
STORAGE_TYPE=s3
AWS_S3_BUCKET=your-bucket-name
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
SIGNED_URL_EXPIRY=3600
```

## Setup Instructions

### Development Setup (Local Storage)

1. No configuration needed - works out of the box
2. Files stored in `./uploads` directory
3. Suitable for local development and testing

```bash
# Optional: Set custom upload path
echo "STORAGE_TYPE=local" >> .env
echo "LOCAL_STORAGE_PATH=./uploads" >> .env
```

### Production Setup (AWS S3)

#### Step 1: Create S3 Bucket

1. Go to [AWS S3 Console](https://console.aws.amazon.com/s3/)
2. Click "Create bucket"
3. Configure:
   - **Bucket name**: `buildpro-production-files` (must be globally unique)
   - **Region**: `us-east-1` (or your preferred region)
   - **Block all public access**: YES (we use signed URLs for access)
   - **Versioning**: Optional but recommended
   - **Encryption**: Optional but recommended

#### Step 2: Configure CORS

1. Go to your bucket → **Permissions** → **CORS**
2. Add the following configuration:

```json
[
  {
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedOrigins": ["https://yourdomain.com"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3000
  }
]
```

#### Step 3: Create IAM User

1. Go to [AWS IAM Console](https://console.aws.amazon.com/iam/)
2. Create new user: `buildpro-storage`
3. Access type: **Programmatic access**
4. Attach policy with minimal permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:DeleteObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::buildpro-production-files",
        "arn:aws:s3:::buildpro-production-files/*"
      ]
    }
  ]
}
```

5. Save the **Access Key ID** and **Secret Access Key**

#### Step 4: Configure Environment Variables

**On Render**:
1. Go to your service → **Environment**
2. Add the following variables:

```
STORAGE_TYPE=s3
AWS_S3_BUCKET=buildpro-production-files
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
SIGNED_URL_EXPIRY=3600
```

**Local .env file**:
```bash
cp .env.production.template .env.production
# Edit .env.production with your actual credentials
```

#### Step 5: Deploy and Test

1. Deploy your application
2. Test file upload: Upload a document
3. Test persistence: Restart the service
4. Verify: Check that uploaded files still exist
5. Health check: Visit `/api/v1/storage/health`

## API Reference

### Storage Provider Interface

All storage providers implement the following interface:

```javascript
class StorageProvider {
  // Upload operations
  async uploadFile(file, metadata)        // Upload from multer file object
  async uploadBuffer(buffer, filename, metadata)  // Upload from buffer

  // Download operations
  async downloadFile(path)                // Download as buffer
  async getFileStream(path)               // Get readable stream
  async getSignedUrl(path, expiresIn)    // Generate signed URL (cloud only)

  // Delete operations
  async deleteFile(path)                  // Delete single file
  async deleteFiles(paths)                // Delete multiple files (batch)

  // Utility
  async fileExists(path)                  // Check if file exists
  async healthCheck()                     // Check storage connectivity
}
```

### Health Check Endpoint

**GET** `/api/v1/storage/health`

Check storage system health and configuration.

**Response**:
```json
{
  "status": "ok",
  "storageType": "s3",
  "healthy": true,
  "timestamp": "2025-01-16T12:00:00.000Z"
}
```

**Error Response** (503):
```json
{
  "status": "error",
  "storageType": "s3",
  "healthy": false,
  "error": "Failed to connect to S3 bucket",
  "timestamp": "2025-01-16T12:00:00.000Z"
}
```

## Architecture

### Directory Structure

```
backend/storage/
├── README.md                    # This file
├── index.js                     # Storage factory & singleton
├── StorageProvider.js           # Base class interface
├── LocalStorageProvider.js      # Local disk implementation
├── S3StorageProvider.js         # AWS S3 implementation
└── config.js                    # Configuration validation

backend/middleware/
└── upload.js                    # Multer configuration
```

### File Flow

#### Upload Flow

```
User Upload
    ↓
Multer Middleware (diskStorage or memoryStorage)
    ↓
Storage Provider (uploadFile or uploadBuffer)
    ↓
Local Disk (./ uploads) OR S3 Bucket
    ↓
Database (store file path/key)
```

#### Download Flow

**Local Storage**:
```
Request → Database (get file path) → Express sendFile → User
```

**Cloud Storage**:
```
Request → Database (get S3 key) → Generate Signed URL → Redirect → User
```

#### Delete Flow

```
Delete Request
    ↓
Database (get file paths)
    ↓
Storage Provider (deleteFile/deleteFiles)
    ↓
Remove from Local Disk OR S3 Bucket
    ↓
Database (delete records)
```

## Updated Endpoints

All file upload, download, and delete endpoints have been updated to use the storage abstraction:

### Upload Endpoints (5)
- `POST /api/v1/projects/:projectId/documents` - Single document upload
- `POST /api/v1/documents/:id/versions` - Document version upload
- `POST /api/v1/projects/:projectId/documents/bulk-upload` - Bulk upload
- `POST /api/v1/drawing-sets/:setId/sheets` - Drawing sheet upload
- `POST /api/v1/photo-albums/:albumId/photos` - Photo upload

### Download Endpoints (2)
- `GET /api/v1/document-versions/:versionId` - Download specific version
- `GET /api/v1/documents/:id/preview` - Preview/view document

### Delete Endpoints (3)
- `DELETE /api/v1/documents/:id` - Single document delete with versions
- `POST /api/v1/documents/bulk-delete` - Bulk document delete
- `DELETE /api/v1/photos/:id` - Photo delete with transaction

## Cost Estimation (S3)

### Example Usage Scenario
- **Storage**: 5 GB
- **Monthly Uploads**: 1,000 files
- **Monthly Downloads**: 500 files
- **Average File Size**: 5 MB

### Monthly Cost Breakdown
- **Storage**: 5 GB × $0.023 = **$0.12**
- **PUT Requests**: 1,000 × $0.005/1,000 = **$0.005**
- **GET Requests**: 500 × $0.0004/1,000 = **$0.0002**
- **Data Transfer**: 2.5 GB × $0.09 = **$0.225**

**Total**: ~**$0.35/month**

For typical usage, S3 costs are negligible compared to the value of data persistence.

## Troubleshooting

### Files are being lost on Render

**Problem**: Using local storage on Render's ephemeral filesystem

**Solution**: Switch to S3 storage for production
```bash
STORAGE_TYPE=s3
# ... add S3 credentials
```

### S3 upload fails with "Access Denied"

**Problem**: IAM permissions insufficient

**Solution**: Verify IAM policy includes `s3:PutObject` permission for your bucket

### Cannot download files from S3

**Problem**: Bucket CORS not configured or signed URLs expired

**Solution**:
1. Configure CORS on S3 bucket (see setup instructions)
2. Increase `SIGNED_URL_EXPIRY` if needed (default: 3600 seconds)

### Storage health check failing

**Problem**: Misconfigured credentials or bucket doesn't exist

**Solution**:
1. Check environment variables are set correctly
2. Verify S3 bucket exists in specified region
3. Test AWS credentials with AWS CLI:
   ```bash
   aws s3 ls s3://your-bucket-name --profile buildpro
   ```

### High S3 costs

**Problem**: Excessive storage or data transfer

**Solution**:
1. Enable S3 lifecycle policies to move old files to cheaper storage (Glacier)
2. Implement image optimization/compression
3. Use CloudFront CDN to reduce data transfer costs
4. Set up S3 Intelligent-Tiering for automatic cost optimization

## Security Considerations

### Best Practices

1. **Never commit AWS credentials to git**
   - Use environment variables
   - Add `.env*` to `.gitignore`

2. **Use minimal IAM permissions**
   - Only grant required S3 actions
   - Restrict to specific bucket ARN

3. **Rotate credentials regularly**
   - Change AWS access keys every 90 days
   - Monitor AWS CloudTrail for suspicious activity

4. **Enable S3 bucket encryption**
   - Use SSE-S3 or SSE-KMS
   - Encrypt data at rest

5. **Use signed URLs with short expiry**
   - Default: 1 hour (3600 seconds)
   - Reduce for sensitive documents

6. **Enable S3 versioning**
   - Protect against accidental deletions
   - Recover from malicious changes

7. **Monitor S3 access logs**
   - Enable S3 server access logging
   - Alert on unusual patterns

## Future Enhancements

### Planned Features

- **Google Cloud Storage support**
- **Azure Blob Storage support**
- **CDN integration** for faster downloads
- **Image optimization** and thumbnail generation
- **Virus scanning** on upload
- **Migration script** to move existing local files to cloud
- **Multi-region replication**
- **Storage usage analytics**
- **Automatic file compression**

### Contributing

To add a new storage provider:

1. Create new provider class extending `StorageProvider`
2. Implement all required methods
3. Add configuration to `config.js`
4. Update `StorageFactory` in `index.js`
5. Add tests
6. Update documentation

## Support

For issues or questions:
- Check troubleshooting section above
- Review Render logs for error messages
- Test storage health: `GET /api/v1/storage/health`
- Verify environment variables are set correctly

## License

Part of BuildPro construction management platform.
