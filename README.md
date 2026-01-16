# BuildPro Backend

**Open-source construction management platform API**

BuildPro is a full-featured construction management system designed to help construction teams manage projects, documents, RFIs, drawings, photos, daily logs, punch lists, and financials—all in one place.

## Features

- **Authentication** - JWT-based user registration and login
- **Projects** - Create and manage construction projects with team members
- **Scheduling** ⭐ NEW - Full project scheduling with tasks, dependencies, critical path, and Gantt charts
- **Documents** - Upload and organize project documents with cloud storage support
- **RFIs** - Request for Information workflow with responses and status tracking
- **Drawings** - Drawing sets, sheets, and PDF markup annotations
- **Photos** - Photo albums with tagging and entity linking
- **Submittals** - Submittal packages with review workflows
- **Daily Logs** - Daily reports with weather, work performed, and delays
- **Punch List** - Track punch items through completion and verification
- **Financials** - Budget lines, commitments, change events, and change orders
- **Team** - Project member management with role-based permissions

## Tech Stack

- **Runtime**: Node.js 18+
- **Framework**: Express.js 5
- **Database**: PostgreSQL 14+
- **Authentication**: JWT (jsonwebtoken)
- **File Uploads**: Multer (with pluggable storage)
- **Cloud Storage**: AWS S3 (optional, for production)
- **Password Hashing**: bcrypt

## Getting Started

### Prerequisites

- Node.js 18 or higher
- PostgreSQL 14 or higher
- npm or yarn

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/amrishkapoor-tt/buildpro-backend.git
   cd buildpro-backend
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up the database**
   
   Create a PostgreSQL database and run the schema:
   ```bash
   psql -U your_username -d your_database -f schema.sql
   ```

4. **Configure environment variables**

   Create a `.env` file in the root directory:
   ```env
   PORT=3001
   NODE_ENV=development
   DATABASE_URL=postgresql://username:password@localhost:5432/buildpro
   JWT_SECRET=your-secret-key-change-in-production
   CORS_ORIGIN=http://localhost:3000

   # Storage Configuration (optional - defaults to local)
   STORAGE_TYPE=local
   LOCAL_STORAGE_PATH=./uploads
   ```

5. **Start the server**
   ```bash
   npm start
   ```
   
   For development with auto-reload:
   ```bash
   npm run dev
   ```

The API will be available at `http://localhost:3001`.

## Storage Configuration

BuildPro supports pluggable storage backends for file uploads (documents, photos, drawings). You can switch between local disk storage and cloud storage (AWS S3) without changing code.

### Local Storage (Default)

**Best for**: Development, testing, local environments

Local storage stores files on the server's filesystem. This is the default mode and requires no configuration.

**Pros**:
- Zero setup and cost
- Fast performance
- Simple for development

**Cons**:
- Files lost on server restarts (ephemeral platforms like Render)
- No automatic backups
- Not scalable for production

**Configuration** (optional - this is the default):
```env
STORAGE_TYPE=local
LOCAL_STORAGE_PATH=./uploads
```

### AWS S3 Storage

**Best for**: Production deployments, persistent file storage

S3 storage provides durable, scalable cloud storage for production use.

**Pros**:
- Files persist across deployments and restarts
- 99.999999999% durability
- Scalable and globally distributed
- Automatic backups available

**Cons**:
- Requires AWS account
- Ongoing costs (~$0.023/GB/month)

**Setup Instructions**:

1. **Create an S3 bucket** in AWS:
   - Bucket name: `buildpro-production-files` (must be globally unique)
   - Region: `us-east-1` (or your preferred region)
   - Block all public access: YES (we use signed URLs)

2. **Configure CORS** on your bucket:
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

3. **Create IAM user** with S3 permissions:
   - Create user: `buildpro-storage`
   - Attach policy with `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject`, `s3:ListBucket`
   - Save the Access Key ID and Secret Access Key (you'll need these in step 4)

4. **Set environment variables** (replace with your actual values):
   ```env
   STORAGE_TYPE=s3
   AWS_S3_BUCKET=buildpro-production-files
   AWS_REGION=us-east-1
   AWS_ACCESS_KEY_ID=your-access-key-from-step-3
   AWS_SECRET_ACCESS_KEY=your-secret-key-from-step-3
   SIGNED_URL_EXPIRY=3600
   ```

   **⚠️ Security Warning**: Never commit real AWS credentials to git. Always use environment variables or a secure secrets manager.

**For detailed setup instructions**, see:
- `.env.production.template` - Production configuration template
- `storage/README.md` - Complete storage system documentation

**Health Check**: Monitor storage connectivity at `/api/v1/storage/health`

**Cost Estimate**: For typical usage (5GB storage, 1000 uploads, 500 downloads per month), expect ~$0.35/month.

## Project Structure

```
buildpro-backend/
├── server.js                      # Main application entry point
├── schema.sql                     # PostgreSQL database schema
├── package.json                   # Dependencies and scripts
├── .env                           # Environment variables (create this)
├── .env.development               # Development config template
├── .env.production.template       # Production config template with S3 setup
├── .gitignore                     # Git ignore rules
├── storage/                       # Storage abstraction layer
│   ├── index.js                   # Storage factory
│   ├── StorageProvider.js         # Base provider interface
│   ├── LocalStorageProvider.js    # Local disk storage
│   ├── S3StorageProvider.js       # AWS S3 storage
│   ├── config.js                  # Configuration validation
│   └── README.md                  # Detailed storage documentation
├── middleware/                    # Custom middleware
│   └── upload.js                  # Multer upload configuration
└── uploads/                       # Local file storage (created automatically)
```

### server.js Overview

The main server file is organized into sections:

| Section | Description |
|---------|-------------|
| **Configuration** | Environment variables, Express setup, database pool |
| **Middleware** | CORS, JSON parsing, authentication, permissions |
| **Auth Routes** | `/api/v1/auth/*` - Register, login |
| **Project Routes** | `/api/v1/projects/*` - CRUD operations |
| **Document Routes** | `/api/v1/projects/:id/documents/*` - File uploads |
| **RFI Routes** | `/api/v1/projects/:id/rfis/*`, `/api/v1/rfis/*` |
| **Drawing Routes** | `/api/v1/drawing-sets/*`, `/api/v1/drawing-sheets/*` |
| **Photo Routes** | `/api/v1/photo-albums/*`, `/api/v1/photos/*` |
| **Submittal Routes** | `/api/v1/submittal-packages/*`, `/api/v1/submittals/*` |
| **Daily Log Routes** | `/api/v1/daily-logs/*` |
| **Punch List Routes** | `/api/v1/punch-items/*` |
| **Financial Routes** | `/api/v1/budget-lines/*`, `/api/v1/commitments/*`, etc. |
| **Team Routes** | `/api/v1/projects/:id/members` |

## API Reference

### Authentication

All endpoints except `/api/v1/auth/*` require a JWT token in the Authorization header:
```
Authorization: Bearer <token>
```

### Base URL

```
http://localhost:3001/api/v1
```

### Key Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/auth/register` | Create a new user account |
| POST | `/auth/login` | Authenticate and receive JWT |
| GET | `/projects` | List user's projects |
| POST | `/projects` | Create a new project |
| GET | `/projects/:id/documents` | List project documents |
| POST | `/projects/:id/documents` | Upload a document |
| GET | `/projects/:id/rfis` | List project RFIs |
| POST | `/projects/:id/rfis` | Create an RFI |
| GET | `/rfis/:id` | Get RFI with responses |
| POST | `/rfis/:id/responses` | Add response to RFI |
| GET | `/drawing-sets/:id` | Get drawing set with sheets |
| POST | `/drawing-sets/:id/sheets` | Add sheet to drawing set |
| GET | `/drawing-sheets/:id` | Get sheet with markups |
| POST | `/drawing-sheets/:id/markups` | Add markup to sheet |

See `server.js` for the complete list of endpoints.

## Database Schema

The database schema (`schema.sql`) includes these main tables:

### Core Tables
- `users` - User accounts
- `organizations` - Companies/organizations
- `projects` - Construction projects
- `project_members` - Project team assignments
- `documents` - Uploaded files metadata

### Module Tables
- `rfis`, `rfi_responses` - RFI management
- `drawing_sets`, `drawing_sheets`, `drawing_markups` - Drawings
- `photo_albums`, `photos`, `photo_tags` - Photo management
- `submittal_packages`, `submittals` - Submittals
- `daily_logs` - Daily reports
- `punch_items` - Punch list
- `budget_lines`, `commitments`, `change_events`, `change_orders` - Financials

### Supporting Tables
- `notifications` - User notifications
- `system_events` - Audit trail
- `entity_links` - Cross-entity relationships

## Role-Based Permissions

The system supports these roles (in order of permissions):

1. `viewer` - Read-only access
2. `subcontractor` - Can create RFIs, submittals
3. `engineer` - Can review and respond
4. `superintendent` - Field management
5. `project_manager` - Full project control
6. `admin` - Organization admin

## Contributing

We welcome contributions! Here's how to get started:

### Development Setup

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Make your changes
4. Test thoroughly
5. Submit a pull request

### Code Style

- Use async/await for asynchronous operations
- Handle errors with try/catch and pass to Express error handler
- Use parameterized queries to prevent SQL injection
- Follow existing naming conventions

### Adding a New Module

1. **Add database tables** to `schema.sql`
2. **Add API endpoints** in `server.js` following existing patterns:
   ```javascript
   app.get('/api/v1/your-module', authenticateToken, async (req, res, next) => {
     try {
       // Your logic here
       res.json({ data: result.rows });
     } catch (error) {
       next(error);
     }
   });
   ```
3. **Update this README** with new endpoints
4. **Add corresponding frontend** components

### Reporting Issues

Please use GitHub Issues to report bugs or request features. Include:
- Description of the issue
- Steps to reproduce
- Expected vs actual behavior
- Environment details

## Deployment

### Render (Recommended)

1. Create a new Web Service on Render
2. Connect your GitHub repository
3. Set environment variables in Render dashboard
4. Deploy

### Environment Variables for Production

**Required**:
```env
NODE_ENV=production
DATABASE_URL=your-production-database-url
JWT_SECRET=strong-random-secret
CORS_ORIGIN=https://your-frontend-domain.com
```

**Storage Configuration** (choose one):

**Option 1: Local Storage** (not recommended - files lost on restart):
```env
STORAGE_TYPE=local
LOCAL_STORAGE_PATH=./uploads
```

**Option 2: AWS S3 Storage** (recommended - persistent storage):
```env
STORAGE_TYPE=s3
AWS_S3_BUCKET=buildpro-production-files
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
SIGNED_URL_EXPIRY=3600
```

See `.env.production.template` for complete setup instructions.

## Known Limitations

- **Real-time Updates**: No WebSocket support yet; clients must poll for updates
- **Storage Providers**: Currently supports local disk and AWS S3. Additional providers (Google Cloud Storage, Azure Blob Storage) can be added following the plugin architecture in `storage/`

## License

MIT License - see LICENSE file for details.

## Links

- **Frontend Repository**: [buildpro-frontend](https://github.com/amrishkapoor-tt/buildpro-frontend)
- **Live Demo**: [buildpro-api.onrender.com](https://buildpro-api.onrender.com)