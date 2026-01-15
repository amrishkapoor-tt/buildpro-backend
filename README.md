# BuildPro Backend

**Open-source construction management platform API**

BuildPro is a full-featured construction management system designed to help construction teams manage projects, documents, RFIs, drawings, photos, daily logs, punch lists, and financials—all in one place.

## Features

- **Authentication** - JWT-based user registration and login
- **Projects** - Create and manage construction projects with team members
- **Documents** - Upload and organize project documents
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
- **File Uploads**: Multer
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

## Project Structure

```
buildpro-backend/
├── server.js          # Main application entry point
├── schema.sql         # PostgreSQL database schema
├── package.json       # Dependencies and scripts
├── .env               # Environment variables (create this)
├── .gitignore         # Git ignore rules
└── uploads/           # File upload directory (created automatically)
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

```env
NODE_ENV=production
DATABASE_URL=your-production-database-url
JWT_SECRET=strong-random-secret
CORS_ORIGIN=https://your-frontend-domain.com
```

## Known Limitations

- **File Storage**: Currently uses local filesystem storage which doesn't persist on ephemeral hosts like Render's free tier. For production, integrate cloud storage (S3, Supabase Storage, etc.)
- **Real-time Updates**: No WebSocket support yet; clients must poll for updates

## License

MIT License - see LICENSE file for details.

## Links

- **Frontend Repository**: [buildpro-frontend](https://github.com/amrishkapoor-tt/buildpro-frontend)
- **Live Demo**: [buildpro-api.onrender.com](https://buildpro-api.onrender.com)