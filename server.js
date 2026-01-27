// ============================================================================
// BUILDPRO - COMPLETE PRODUCTION BACKEND
// All 11 modules included - Ready for production deployment
// ============================================================================

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const storage = require('./storage');
const { upload, storageType } = require('./middleware/upload');
const { registerWorkflowRoutes } = require('./services/workflow-api');

const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET;
const DATABASE_URL = process.env.DATABASE_URL;

if (!JWT_SECRET) {
  console.error('❌ JWT_SECRET environment variable is required for security');
  console.error('Please set JWT_SECRET to a strong random value (e.g., openssl rand -base64 32)');
  process.exit(1);
}

if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL not set');
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

pool.connect(async (err, client, release) => {
  if (err) {
    console.error('❌ Database error:', err.stack);
  } else {
    console.log('✅ Database connected');
    release();

    // Run migrations automatically
    const { runMigrations } = require('./services/run-migrations');
    await runMigrations(pool);
  }
});

// Storage configuration moved to ./storage and ./middleware/upload
console.log(`🗄️  Storage type: ${storageType}`);

app.use(cors({
  origin: function (origin, callback) {
    const allowedOrigins = process.env.CORS_ORIGIN 
      ? process.env.CORS_ORIGIN.split(',') 
      : ['*'];
    
    if (allowedOrigins.includes('*') || !origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));

app.use(express.json());

// Only serve static files for local storage
if (storageType === 'local') {
  const uploadPath = process.env.LOCAL_STORAGE_PATH || './uploads';
  app.use('/uploads', express.static(uploadPath));
  console.log(`📁 Serving static files from: ${uploadPath}`);
}

app.get('/', (req, res) => {
  res.json({
    message: 'BuildPro API - Complete',
    version: '1.0.0',
    modules: ['auth', 'projects', 'scheduling', 'documents', 'rfis', 'drawings', 'photos', 'submittals', 'dailylogs', 'punch', 'financials', 'team']
  });
});

// Storage health check endpoint
app.get('/api/v1/storage/health', async (req, res) => {
  try {
    const isHealthy = await storage.healthCheck();
    res.json({
      status: isHealthy ? 'ok' : 'degraded',
      storageType: storageType,
      healthy: isHealthy,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(503).json({
      status: 'error',
      storageType: storageType,
      healthy: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Access token required' });
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid token' });
    req.user = user;
    next();
  });
};

// Middleware to check if user is a member of the project
const requireProjectMember = async (req, res, next) => {
  try {
    const projectId = req.params.projectId || req.body.project_id;
    if (!projectId) {
      return res.status(400).json({ error: 'Project ID required' });
    }

    const result = await pool.query(
      `SELECT role FROM project_members WHERE project_id = $1 AND user_id = $2`,
      [projectId, req.user.userId]
    );

    if (result.rows.length === 0) {
      return res.status(403).json({ error: 'Access denied. You must be a project member.' });
    }

    req.userRole = result.rows[0].role;
    next();
  } catch (error) {
    next(error);
  }
};

// Enhanced permission checking middleware
const checkPermission = (requiredRole, options = {}) => {
  return async (req, res, next) => {
    try {
      const projectId = req.params.projectId || req.body.project_id;

      if (!projectId && !options.requireProject) {
        return next();
      }

      if (!projectId) {
        return res.status(400).json({ error: 'Project ID required' });
      }

      const result = await pool.query(
        `SELECT role FROM project_members WHERE project_id = $1 AND user_id = $2`,
        [projectId, req.user.userId]
      );

      if (result.rows.length === 0) {
        return res.status(403).json({
          error: 'Access denied. You must be a project member.',
          required_permission: requiredRole
        });
      }

      const userRole = result.rows[0].role;
      const roleHierarchy = {
        'viewer': 1, 'subcontractor': 2, 'engineer': 3,
        'superintendent': 4, 'project_manager': 5, 'admin': 6
      };

      if (roleHierarchy[userRole] < roleHierarchy[requiredRole]) {
        return res.status(403).json({
          error: `Insufficient permissions. Requires ${requiredRole} role or higher.`,
          user_role: userRole, required_role: requiredRole
        });
      }

      req.userRole = userRole;
      req.userRoleLevel = roleHierarchy[userRole];
      next();
    } catch (error) {
      next(error);
    }
  };
};

// Ownership check middleware
const checkOwnership = (resourceType) => {
  return async (req, res, next) => {
    try {
      const resourceId = req.params.id;
      let query;

      switch(resourceType) {
        case 'document':
          query = 'SELECT uploaded_by FROM documents WHERE id = $1';
          break;
        case 'daily_log':
          query = 'SELECT created_by FROM daily_logs WHERE id = $1';
          break;
        case 'photo':
          query = 'SELECT uploaded_by FROM photos WHERE id = $1';
          break;
        default:
          return res.status(400).json({ error: 'Invalid resource type' });
      }

      const result = await pool.query(query, [resourceId]);

      if (result.rows.length === 0) {
        return res.status(404).json({ error: `${resourceType} not found` });
      }

      const roleHierarchy = { 'viewer': 1, 'subcontractor': 2, 'engineer': 3, 'superintendent': 4, 'project_manager': 5, 'admin': 6 };
      const isOwner = result.rows[0].uploaded_by === req.user.userId || result.rows[0].created_by === req.user.userId;
      const hasSufficientRole = req.userRoleLevel >= roleHierarchy['superintendent'];

      if (!isOwner && !hasSufficientRole) {
        return res.status(403).json({ error: 'You can only modify your own resources' });
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};

// Audit logging function
const logAudit = async (userId, action, entityType, entityId, changes = null, req = null) => {
  try {
    await pool.query(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, changes, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [userId, action, entityType, entityId,
       changes ? JSON.stringify(changes) : null,
       req?.ip || null, req?.get('user-agent') || null]
    );
  } catch (error) {
    console.error('Audit logging error:', error);
  }
};

const emitEvent = async (eventType, entityType, entityId, projectId, userId, eventData) => {
  try {
    await pool.query(
      `INSERT INTO system_events (event_type, entity_type, entity_id, project_id, user_id, event_data)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [eventType, entityType, entityId, projectId, userId, JSON.stringify(eventData)]
    );
  } catch (error) {
    console.error('Event error:', error);
  }
};

const createNotification = async (userId, type, title, message, entityType, entityId) => {
  try {
    await pool.query(
      `INSERT INTO notifications (user_id, type, title, message, entity_type, entity_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, type, title, message, entityType, entityId]
    );
  } catch (error) {
    console.error('Notification error:', error);
  }
};

// AUTH
app.post('/api/v1/auth/register', async (req, res, next) => {
  try {
    const { email, password, first_name, last_name, organization_name, organization_type } = req.body;
    if (!email || !password || !first_name || !last_name) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    const password_hash = await bcrypt.hash(password, 10);
    const userResult = await pool.query(
      `INSERT INTO users (email, password_hash, first_name, last_name)
       VALUES ($1, $2, $3, $4) RETURNING id, email, first_name, last_name`,
      [email, password_hash, first_name, last_name]
    );

    const user = userResult.rows[0];
    let organizationId = null;
    
    if (organization_name) {
      const orgResult = await pool.query(
        `INSERT INTO organizations (name, type) VALUES ($1, $2) RETURNING id`,
        [organization_name, organization_type || 'gc']
      );
      organizationId = orgResult.rows[0].id;
      await pool.query(
        `INSERT INTO user_organizations (user_id, organization_id, role) VALUES ($1, $2, $3)`,
        [user.id, organizationId, 'admin']
      );
    }

    const token = jwt.sign({ userId: user.id, email: user.email, organizationId }, JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ message: 'User created successfully', user, token, organizationId });
  } catch (error) {
    next(error);
  }
});

app.post('/api/v1/auth/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const result = await pool.query(
      `SELECT u.*, uo.organization_id FROM users u
       LEFT JOIN user_organizations uo ON u.id = uo.user_id
       WHERE u.email = $1 AND u.is_active = true`,
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign({ userId: user.id, email: user.email, organizationId: user.organization_id }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ user: { id: user.id, email: user.email, first_name: user.first_name, last_name: user.last_name, organizationId: user.organization_id }, token });
  } catch (error) {
    next(error);
  }
});

// PROJECTS
app.get('/api/v1/projects', authenticateToken, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT DISTINCT p.*, pm.role as user_role FROM projects p
       JOIN project_members pm ON p.id = pm.project_id
       WHERE pm.user_id = $1 ORDER BY p.created_at DESC`,
      [req.user.userId]
    );
    res.json({ projects: result.rows });
  } catch (error) {
    next(error);
  }
});

app.post('/api/v1/projects', authenticateToken, async (req, res, next) => {
  try {
    const { name, location, budget, start_date, end_date } = req.body;
    const result = await pool.query(
      `INSERT INTO projects (name, location, budget, start_date, end_date, status)
       VALUES ($1, $2, $3, $4, $5, 'planning') RETURNING *`,
      [name, JSON.stringify(location || {}), budget, start_date, end_date]
    );

    const project = result.rows[0];
    await pool.query(
      `INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, 'project_manager')`,
      [project.id, req.user.userId]
    );

    await emitEvent('project.created', 'project', project.id, project.id, req.user.userId, project);
    res.status(201).json({ project });
  } catch (error) {
    next(error);
  }
});

// DOCUMENTS
app.delete('/api/v1/documents/:id', authenticateToken, async (req, res, next) => {
  try {
    // Get document details first
    const docResult = await pool.query(
      'SELECT file_path, project_id FROM documents WHERE id = $1',
      [req.params.id]
    );

    if (docResult.rows.length === 0) {
      return res.status(404).json({ error: 'Document not found' });
    }

    const document = docResult.rows[0];
    const mainFilePath = document.file_path;
    const projectId = document.project_id;

    // Check permissions using the document's project_id
    if (!projectId) {
      return res.status(400).json({ error: 'Document has no associated project' });
    }

    // Verify user has permission to delete in this project
    const memberResult = await pool.query(
      'SELECT role FROM project_members WHERE project_id = $1 AND user_id = $2',
      [projectId, req.user.userId]
    );

    if (memberResult.rows.length === 0) {
      return res.status(403).json({ error: 'Access denied. You must be a project member.' });
    }

    const userRole = memberResult.rows[0].role;
    const roleHierarchy = {
      'viewer': 1, 'subcontractor': 2, 'engineer': 3,
      'superintendent': 4, 'project_manager': 5, 'admin': 6
    };

    if (roleHierarchy[userRole] < roleHierarchy['superintendent']) {
      return res.status(403).json({
        error: 'Insufficient permissions. Requires superintendent role or higher.',
        user_role: userRole
      });
    }

    // Get document version IDs and file paths for this document
    const versions = await pool.query(
      'SELECT id, file_path FROM document_versions WHERE document_id = $1',
      [req.params.id]
    );
    const versionIds = versions.rows.map(v => v.id);
    const versionFilePaths = versions.rows.map(v => v.file_path);

    if (versionIds.length > 0) {
      // Remove references from drawing_sheets
      await pool.query(
        'UPDATE drawing_sheets SET document_version_id = NULL WHERE document_version_id = ANY($1)',
        [versionIds]
      );

      // Delete document versions
      await pool.query(
        'DELETE FROM document_versions WHERE document_id = $1',
        [req.params.id]
      );
    }

    // Delete entity links where this document is the source
    await pool.query(
      "DELETE FROM entity_links WHERE source_type = 'document' AND source_id = $1",
      [req.params.id]
    );

    // Delete entity links where this document is the target
    await pool.query(
      "DELETE FROM entity_links WHERE target_type = 'document' AND target_id = $1",
      [req.params.id]
    );

    // Delete drawing-related data (these have CASCADE but explicit delete is clearer)
    // The CASCADE will handle these, but we'll delete explicitly for clarity
    try {
      await pool.query('DELETE FROM drawing_workflow_states WHERE document_id = $1', [req.params.id]);
      await pool.query('DELETE FROM drawing_workflow_history WHERE document_id = $1', [req.params.id]);
      await pool.query('DELETE FROM drawing_markups WHERE document_id = $1', [req.params.id]);
      await pool.query('DELETE FROM drawing_reviews WHERE document_id = $1', [req.params.id]);
      await pool.query('DELETE FROM drawing_distributions WHERE document_id = $1', [req.params.id]);
      await pool.query('DELETE FROM asi_drawings WHERE document_id = $1', [req.params.id]);
      await pool.query('DELETE FROM drawing_set_members WHERE document_id = $1', [req.params.id]);
    } catch (cleanupError) {
      console.warn('Drawing data cleanup warning:', cleanupError.message);
      // Continue with deletion even if cleanup fails
    }

    // Delete the document
    await pool.query('DELETE FROM documents WHERE id = $1', [req.params.id]);

    // File cleanup (non-blocking)
    if (mainFilePath) {
      try {
        await storage.deleteFile(mainFilePath);
      } catch (error) {
        console.error('File deletion error:', error);
      }
    }

    // Delete version files
    if (versionFilePaths.length > 0) {
      try {
        const deleteResults = await storage.deleteFiles(versionFilePaths.filter(fp => fp));
        if (deleteResults.failed.length > 0) {
          console.error('Some version files failed to delete:', deleteResults.failed);
        }
      } catch (error) {
        console.error('Version file deletion error:', error);
      }
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Delete document error:', error);
    next(error);
  }
});

app.post('/api/v1/projects/:projectId/documents', authenticateToken, checkPermission('subcontractor'), upload.fields([{ name: 'file', maxCount: 1 }, { name: 'document', maxCount: 1 }]), async (req, res, next) => {
  try {
    // Handle both 'file' and 'document' field names
    const uploadedFile = req.files?.file?.[0] || req.files?.document?.[0];
    if (!uploadedFile) return res.status(400).json({ error: 'No file uploaded' });

    const {
      name, description, tags, category, folder_id,
      drawing_number, discipline, sheet_title, revision_number,
      drawing_scale, sheet_size, issue_date, is_current_revision
    } = req.body;

    // Handle file storage based on storage type
    let filePath, fileUrl;
    if (storageType === 'local') {
      filePath = uploadedFile.path;
      fileUrl = `/uploads/${path.basename(uploadedFile.path)}`;
    } else {
      const uploadResult = await storage.uploadBuffer(
        uploadedFile.buffer,
        uploadedFile.originalname,
        { mimetype: uploadedFile.mimetype, projectId: req.params.projectId }
      );
      filePath = uploadResult.path;
      fileUrl = uploadResult.url;
    }

    const result = await pool.query(
      `INSERT INTO documents (
        project_id, name, description, tags, category, folder_id, file_path, file_size, mime_type, uploaded_by,
        drawing_number, discipline, sheet_title, revision_number, drawing_scale, sheet_size, issue_date, is_current_revision
      )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18) RETURNING *`,
      [
        req.params.projectId,
        name || uploadedFile.originalname,
        description,
        tags ? (Array.isArray(tags) ? tags : tags.split(',').map(t => t.trim())) : null,
        category,
        folder_id || null,
        filePath,
        uploadedFile.size,
        uploadedFile.mimetype,
        req.user.userId,
        drawing_number || null,
        discipline || null,
        sheet_title || null,
        revision_number || null,
        drawing_scale || null,
        sheet_size || null,
        issue_date || null,
        is_current_revision !== undefined ? is_current_revision === 'true' || is_current_revision === true : null
      ]
    );

    // Create initial version entry (Version 1)
    await pool.query(
      `INSERT INTO document_versions (document_id, version_number, file_path, file_size, uploaded_by, version_name, is_current)
       VALUES ($1, 1, $2, $3, $4, 'Original', true)`,
      [result.rows[0].id, filePath, uploadedFile.size, req.user.userId]
    );

    await emitEvent('document.uploaded', 'document', result.rows[0].id, req.params.projectId, req.user.userId, result.rows[0]);
    res.status(201).json({ document: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/projects/:projectId/documents', authenticateToken, async (req, res, next) => {
  try {
    const { folder_id } = req.query;
    let query, params;

    if (folder_id) {
      query = `SELECT d.*, u.first_name, u.last_name FROM documents d
               LEFT JOIN users u ON d.uploaded_by = u.id
               WHERE d.project_id = $1 AND d.folder_id = $2 ORDER BY d.uploaded_at DESC`;
      params = [req.params.projectId, folder_id];
    } else {
      query = `SELECT d.*, u.first_name, u.last_name FROM documents d
               LEFT JOIN users u ON d.uploaded_by = u.id
               WHERE d.project_id = $1 ORDER BY d.uploaded_at DESC`;
      params = [req.params.projectId];
    }

    const result = await pool.query(query, params);
    res.json({ documents: result.rows });
  } catch (error) {
    next(error);
  }
});

// Update document metadata
app.put('/api/v1/documents/:id', authenticateToken, checkPermission('engineer'), async (req, res, next) => {
  try {
    const {
      name, description, tags, category,
      drawing_number, discipline, sheet_title, revision_number,
      drawing_scale, sheet_size, issue_date, is_current_revision
    } = req.body;

    const result = await pool.query(
      `UPDATE documents SET
        name = COALESCE($1, name),
        description = COALESCE($2, description),
        tags = COALESCE($3, tags),
        category = COALESCE($4, category),
        drawing_number = COALESCE($5, drawing_number),
        discipline = COALESCE($6, discipline),
        sheet_title = COALESCE($7, sheet_title),
        revision_number = COALESCE($8, revision_number),
        drawing_scale = COALESCE($9, drawing_scale),
        sheet_size = COALESCE($10, sheet_size),
        issue_date = COALESCE($11, issue_date),
        is_current_revision = COALESCE($12, is_current_revision)
       WHERE id = $13 RETURNING *`,
      [
        name, description, tags, category,
        drawing_number, discipline, sheet_title, revision_number,
        drawing_scale, sheet_size, issue_date, is_current_revision,
        req.params.id
      ]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Document not found' });
    res.json({ document: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

// Toggle document favorite
app.post('/api/v1/documents/:id/favorite', authenticateToken, async (req, res, next) => {
  try {
    const result = await pool.query(
      `UPDATE documents SET is_favorite = NOT is_favorite WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Document not found' });
    res.json({ document: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

// Get recent documents
app.get('/api/v1/projects/:projectId/documents/recent', authenticateToken, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT d.*, u.first_name, u.last_name FROM documents d
       LEFT JOIN users u ON d.uploaded_by = u.id
       WHERE d.project_id = $1 AND d.uploaded_at > NOW() - INTERVAL '7 days'
       ORDER BY d.uploaded_at DESC LIMIT 20`,
      [req.params.projectId]
    );
    res.json({ documents: result.rows });
  } catch (error) {
    next(error);
  }
});

// Get favorite documents
app.get('/api/v1/projects/:projectId/documents/favorites', authenticateToken, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT d.*, u.first_name, u.last_name FROM documents d
       LEFT JOIN users u ON d.uploaded_by = u.id
       WHERE d.project_id = $1 AND d.is_favorite = true
       ORDER BY d.uploaded_at DESC`,
      [req.params.projectId]
    );
    res.json({ documents: result.rows });
  } catch (error) {
    next(error);
  }
});

// Advanced document search
app.get('/api/v1/projects/:projectId/documents/search', authenticateToken, async (req, res, next) => {
  try {
    const { q, folder_id, category, tags, uploader_id, date_from, date_to, file_type, sort = 'date', order = 'desc' } = req.query;

    let conditions = ['d.project_id = $1'];
    let params = [req.params.projectId];
    let paramIndex = 2;

    if (q) {
      conditions.push(`(d.name ILIKE $${paramIndex} OR d.description ILIKE $${paramIndex})`);
      params.push(`%${q}%`);
      paramIndex++;
    }

    if (folder_id) {
      conditions.push(`d.folder_id = $${paramIndex}`);
      params.push(folder_id);
      paramIndex++;
    }

    if (category) {
      conditions.push(`d.category = $${paramIndex}`);
      params.push(category);
      paramIndex++;
    }

    if (tags) {
      const tagArray = tags.split(',');
      conditions.push(`d.tags && $${paramIndex}`);
      params.push(tagArray);
      paramIndex++;
    }

    if (uploader_id) {
      conditions.push(`d.uploaded_by = $${paramIndex}`);
      params.push(uploader_id);
      paramIndex++;
    }

    if (date_from) {
      conditions.push(`d.uploaded_at >= $${paramIndex}`);
      params.push(date_from);
      paramIndex++;
    }

    if (date_to) {
      conditions.push(`d.uploaded_at <= $${paramIndex}`);
      params.push(date_to);
      paramIndex++;
    }

    if (file_type) {
      conditions.push(`d.mime_type LIKE $${paramIndex}`);
      params.push(`%${file_type}%`);
      paramIndex++;
    }

    const sortField = sort === 'name' ? 'd.name' : sort === 'size' ? 'd.file_size' : 'd.uploaded_at';
    const sortOrder = order === 'asc' ? 'ASC' : 'DESC';

    const query = `SELECT d.*, u.first_name, u.last_name FROM documents d
                   LEFT JOIN users u ON d.uploaded_by = u.id
                   WHERE ${conditions.join(' AND ')}
                   ORDER BY ${sortField} ${sortOrder}`;

    const result = await pool.query(query, params);
    res.json({ documents: result.rows });
  } catch (error) {
    next(error);
  }
});

// Move document to folder
app.post('/api/v1/documents/:id/move', authenticateToken, checkPermission('engineer'), async (req, res, next) => {
  try {
    const { folder_id } = req.body;
    const result = await pool.query(
      `UPDATE documents SET folder_id = $1 WHERE id = $2 RETURNING *`,
      [folder_id, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Document not found' });
    res.json({ document: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

// FOLDER MANAGEMENT
// Create folder
app.post('/api/v1/projects/:projectId/folders', authenticateToken, checkPermission('engineer'), async (req, res, next) => {
  try {
    const { name, parent_folder_id } = req.body;
    if (!name) return res.status(400).json({ error: 'Folder name required' });

    // Check for circular reference if parent exists
    if (parent_folder_id) {
      const parentCheck = await pool.query(
        'SELECT project_id FROM document_folders WHERE id = $1',
        [parent_folder_id]
      );
      if (parentCheck.rows.length === 0) {
        return res.status(404).json({ error: 'Parent folder not found' });
      }
    }

    const result = await pool.query(
      `INSERT INTO document_folders (project_id, name, parent_folder_id, created_by)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.params.projectId, name, parent_folder_id || null, req.user.userId]
    );
    await emitEvent('folder.created', 'folder', result.rows[0].id, req.params.projectId, req.user.userId, result.rows[0]);
    res.status(201).json({ folder: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

// Get all folders (tree structure)
app.get('/api/v1/projects/:projectId/folders', authenticateToken, async (req, res, next) => {
  try {
    const result = await pool.query(
      `WITH RECURSIVE folder_tree AS (
        SELECT f.*, u.first_name, u.last_name,
               (SELECT COUNT(*) FROM documents d WHERE d.folder_id = f.id) as document_count,
               ARRAY[f.id] as path
        FROM document_folders f
        LEFT JOIN users u ON f.created_by = u.id
        WHERE f.project_id = $1 AND f.parent_folder_id IS NULL

        UNION ALL

        SELECT f.*, u.first_name, u.last_name,
               (SELECT COUNT(*) FROM documents d WHERE d.folder_id = f.id) as document_count,
               ft.path || f.id
        FROM document_folders f
        LEFT JOIN users u ON f.created_by = u.id
        INNER JOIN folder_tree ft ON f.parent_folder_id = ft.id
        WHERE f.project_id = $1
      )
      SELECT * FROM folder_tree ORDER BY path`,
      [req.params.projectId]
    );
    res.json({ folders: result.rows });
  } catch (error) {
    next(error);
  }
});

// Rename folder
app.put('/api/v1/folders/:id', authenticateToken, checkPermission('engineer'), async (req, res, next) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Folder name required' });

    const result = await pool.query(
      `UPDATE document_folders SET name = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *`,
      [name, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Folder not found' });
    res.json({ folder: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

// Delete folder (move contents to parent)
app.delete('/api/v1/folders/:id', authenticateToken, checkPermission('superintendent'), async (req, res, next) => {
  try {
    const folderResult = await pool.query(
      'SELECT parent_folder_id FROM document_folders WHERE id = $1',
      [req.params.id]
    );
    if (folderResult.rows.length === 0) return res.status(404).json({ error: 'Folder not found' });

    const parentFolderId = folderResult.rows[0].parent_folder_id;

    // Move documents to parent (or null if no parent)
    await pool.query(
      'UPDATE documents SET folder_id = $1 WHERE folder_id = $2',
      [parentFolderId, req.params.id]
    );

    // Move child folders to parent
    await pool.query(
      'UPDATE document_folders SET parent_folder_id = $1 WHERE parent_folder_id = $2',
      [parentFolderId, req.params.id]
    );

    // Delete the folder
    await pool.query('DELETE FROM document_folders WHERE id = $1', [req.params.id]);

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// DOCUMENT VERSIONING
// Upload new version
app.post('/api/v1/documents/:id/versions', authenticateToken, checkPermission('subcontractor'), upload.fields([{ name: 'file', maxCount: 1 }, { name: 'document', maxCount: 1 }]), async (req, res, next) => {
  try {
    // Handle both 'file' and 'document' field names
    const uploadedFile = req.files?.file?.[0] || req.files?.document?.[0];
    if (!uploadedFile) return res.status(400).json({ error: 'No file uploaded' });

    const { version_name, change_description } = req.body;

    // Handle file storage based on storage type
    let filePath, fileUrl;
    if (storageType === 'local') {
      filePath = uploadedFile.path;
      fileUrl = `/uploads/${path.basename(uploadedFile.path)}`;
    } else {
      const uploadResult = await storage.uploadBuffer(
        uploadedFile.buffer,
        uploadedFile.originalname,
        { mimetype: uploadedFile.mimetype, documentId: req.params.id }
      );
      filePath = uploadResult.path;
      fileUrl = uploadResult.url;
    }

    // Get current max version number
    const versionResult = await pool.query(
      'SELECT COALESCE(MAX(version_number), 0) as max_version FROM document_versions WHERE document_id = $1',
      [req.params.id]
    );
    const newVersionNumber = versionResult.rows[0].max_version + 1;

    // Mark all existing versions as not current
    await pool.query(
      'UPDATE document_versions SET is_current = false WHERE document_id = $1',
      [req.params.id]
    );

    // Insert new version
    const result = await pool.query(
      `INSERT INTO document_versions (document_id, version_number, file_path, file_size, uploaded_by, version_name, change_description, is_current)
       VALUES ($1, $2, $3, $4, $5, $6, $7, true) RETURNING *`,
      [req.params.id, newVersionNumber, filePath, uploadedFile.size, req.user.userId, version_name, change_description]
    );

    // Update main document file_path to new version
    await pool.query(
      'UPDATE documents SET file_path = $1, file_size = $2 WHERE id = $3',
      [filePath, uploadedFile.size, req.params.id]
    );

    res.status(201).json({ version: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

// Get version history
app.get('/api/v1/documents/:id/versions', authenticateToken, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT v.*, u.first_name, u.last_name FROM document_versions v
       LEFT JOIN users u ON v.uploaded_by = u.id
       WHERE v.document_id = $1 ORDER BY v.version_number DESC`,
      [req.params.id]
    );
    res.json({ versions: result.rows });
  } catch (error) {
    next(error);
  }
});

// Download specific version
app.get('/api/v1/document-versions/:versionId', async (req, res, next) => {
  try {
    // Support token in query parameter for direct download links
    const token = req.query.token || (req.headers['authorization'] && req.headers['authorization'].split(' ')[1]);

    if (!token) {
      return res.status(401).json({ error: 'Access token required' });
    }

    // Verify token
    jwt.verify(token, JWT_SECRET, async (err, user) => {
      if (err) {
        return res.status(403).json({ error: 'Invalid token' });
      }

      try {
        const result = await pool.query(
          'SELECT file_path FROM document_versions WHERE id = $1',
          [req.params.versionId]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Version not found' });

        const filePath = result.rows[0].file_path;

        if (storageType === 'local') {
          // Direct file download for local storage
          res.download(path.resolve(filePath));
        } else {
          // Redirect to signed URL for cloud storage
          const signedUrl = await storage.getSignedUrl(filePath, 3600);
          res.redirect(signedUrl);
        }
      } catch (error) {
        next(error);
      }
    });
  } catch (error) {
    next(error);
  }
});

// Revert to specific version
app.put('/api/v1/documents/:id/versions/:versionId/set-current', authenticateToken, checkPermission('engineer'), async (req, res, next) => {
  try {
    // Mark all versions as not current
    await pool.query(
      'UPDATE document_versions SET is_current = false WHERE document_id = $1',
      [req.params.id]
    );

    // Mark specified version as current
    const result = await pool.query(
      'UPDATE document_versions SET is_current = true WHERE id = $1 AND document_id = $2 RETURNING *',
      [req.params.versionId, req.params.id]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Version not found' });

    // Update main document file_path
    await pool.query(
      'UPDATE documents SET file_path = $1, file_size = $2 WHERE id = $3',
      [result.rows[0].file_path, result.rows[0].file_size, req.params.id]
    );

    res.json({ version: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

// Delete version (only if not current)
app.delete('/api/v1/document-versions/:versionId', authenticateToken, async (req, res, next) => {
  try {
    const versionResult = await pool.query(
      'SELECT is_current FROM document_versions WHERE id = $1',
      [req.params.versionId]
    );

    if (versionResult.rows.length === 0) return res.status(404).json({ error: 'Version not found' });
    if (versionResult.rows[0].is_current) {
      return res.status(400).json({ error: 'Cannot delete current version' });
    }

    await pool.query('DELETE FROM document_versions WHERE id = $1', [req.params.versionId]);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// TAG MANAGEMENT
// Add tags to document
app.post('/api/v1/documents/:id/tags', authenticateToken, checkPermission('engineer'), async (req, res, next) => {
  try {
    const { tags } = req.body;
    if (!Array.isArray(tags)) return res.status(400).json({ error: 'Tags must be an array' });

    const result = await pool.query(
      `UPDATE documents SET tags = array_cat(COALESCE(tags, ARRAY[]::TEXT[]), $1) WHERE id = $2 RETURNING *`,
      [tags, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Document not found' });
    res.json({ document: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

// Remove tag from document
app.delete('/api/v1/documents/:id/tags', authenticateToken, checkPermission('engineer'), async (req, res, next) => {
  try {
    const { tag } = req.body;
    if (!tag) return res.status(400).json({ error: 'Tag required' });

    const result = await pool.query(
      `UPDATE documents SET tags = array_remove(tags, $1) WHERE id = $2 RETURNING *`,
      [tag, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Document not found' });
    res.json({ document: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

// Get all tags with usage count
app.get('/api/v1/projects/:projectId/tags', authenticateToken, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT unnest(tags) as tag, COUNT(*) as count
       FROM documents WHERE project_id = $1 AND tags IS NOT NULL
       GROUP BY tag ORDER BY count DESC`,
      [req.params.projectId]
    );
    res.json({ tags: result.rows });
  } catch (error) {
    next(error);
  }
});

// Update document category
app.put('/api/v1/documents/:id/category', authenticateToken, checkPermission('engineer'), async (req, res, next) => {
  try {
    const { category } = req.body;
    const result = await pool.query(
      `UPDATE documents SET category = $1 WHERE id = $2 RETURNING *`,
      [category, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Document not found' });
    res.json({ document: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

// DOCUMENT LINKING
// Link document to entity
app.post('/api/v1/documents/:id/link', authenticateToken, checkPermission('engineer'), async (req, res, next) => {
  try {
    const { target_type, target_id, relationship } = req.body;
    if (!target_type || !target_id) {
      return res.status(400).json({ error: 'target_type and target_id required' });
    }

    const result = await pool.query(
      `INSERT INTO entity_links (source_type, source_id, target_type, target_id, relationship)
       VALUES ('document', $1, $2, $3, $4) RETURNING *`,
      [req.params.id, target_type, target_id, relationship || 'attachment']
    );
    res.status(201).json({ link: result.rows[0] });
  } catch (error) {
    if (error.code === '23505') { // Unique violation
      return res.status(400).json({ error: 'Link already exists' });
    }
    next(error);
  }
});

// Unlink document
app.delete('/api/v1/document-links/:linkId', authenticateToken, async (req, res, next) => {
  try {
    await pool.query('DELETE FROM entity_links WHERE id = $1', [req.params.linkId]);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// Get all links for document
app.get('/api/v1/documents/:id/links', authenticateToken, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT * FROM entity_links WHERE source_type = 'document' AND source_id = $1`,
      [req.params.id]
    );
    res.json({ links: result.rows });
  } catch (error) {
    next(error);
  }
});

// Get documents linked to RFI
app.get('/api/v1/rfis/:id/documents', authenticateToken, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT d.*, u.first_name, u.last_name, el.id as link_id FROM entity_links el
       INNER JOIN documents d ON d.id = el.source_id::UUID
       LEFT JOIN users u ON d.uploaded_by = u.id
       WHERE el.source_type = 'document' AND el.target_type = 'rfi' AND el.target_id = $1`,
      [req.params.id]
    );
    res.json({ documents: result.rows });
  } catch (error) {
    next(error);
  }
});

// Get documents linked to submittal
app.get('/api/v1/submittals/:id/documents', authenticateToken, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT d.*, u.first_name, u.last_name, el.id as link_id FROM entity_links el
       INNER JOIN documents d ON d.id = el.source_id::UUID
       LEFT JOIN users u ON d.uploaded_by = u.id
       WHERE el.source_type = 'document' AND el.target_type = 'submittal' AND el.target_id = $1`,
      [req.params.id]
    );
    res.json({ documents: result.rows });
  } catch (error) {
    next(error);
  }
});

// BULK OPERATIONS
// Bulk upload
app.post('/api/v1/projects/:projectId/documents/bulk-upload', authenticateToken, checkPermission('subcontractor'), upload.array('files', 10), async (req, res, next) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    const metadata = req.body.metadata ? JSON.parse(req.body.metadata) : [];
    const uploaded = [];
    const failed = [];

    for (let i = 0; i < req.files.length; i++) {
      const file = req.files[i];
      const meta = metadata[i] || {};

      try {
        // Handle file storage based on storage type
        let filePath, fileUrl;
        if (storageType === 'local') {
          filePath = file.path;
          fileUrl = `/uploads/${path.basename(file.path)}`;
        } else {
          const uploadResult = await storage.uploadBuffer(
            file.buffer,
            file.originalname,
            { mimetype: file.mimetype, projectId: req.params.projectId }
          );
          filePath = uploadResult.path;
          fileUrl = uploadResult.url;
        }

        const result = await pool.query(
          `INSERT INTO documents (project_id, name, file_path, file_size, mime_type, uploaded_by, description, tags, category, folder_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
          [
            req.params.projectId,
            meta.name || file.originalname,
            filePath,
            file.size,
            file.mimetype,
            req.user.userId,
            meta.description || null,
            meta.tags || null,
            meta.category || null,
            meta.folder_id || null
          ]
        );

        // Create initial version entry (Version 1)
        await pool.query(
          `INSERT INTO document_versions (document_id, version_number, file_path, file_size, uploaded_by, version_name, is_current)
           VALUES ($1, 1, $2, $3, $4, 'Original', true)`,
          [result.rows[0].id, filePath, file.size, req.user.userId]
        );

        uploaded.push(result.rows[0]);
        await emitEvent('document.uploaded', 'document', result.rows[0].id, req.params.projectId, req.user.userId, result.rows[0]);
      } catch (error) {
        failed.push({ file: file.originalname, error: error.message });
      }
    }

    res.status(201).json({ uploaded, failed });
  } catch (error) {
    next(error);
  }
});

// Bulk move
app.post('/api/v1/documents/bulk-move', authenticateToken, checkPermission('superintendent'), async (req, res, next) => {
  try {
    const { document_ids, folder_id } = req.body;
    if (!Array.isArray(document_ids)) {
      return res.status(400).json({ error: 'document_ids must be an array' });
    }

    await pool.query(
      'UPDATE documents SET folder_id = $1 WHERE id = ANY($2)',
      [folder_id, document_ids]
    );

    res.json({ success: true, count: document_ids.length });
  } catch (error) {
    next(error);
  }
});

// Bulk delete
app.post('/api/v1/documents/bulk-delete', authenticateToken, checkPermission('superintendent'), async (req, res, next) => {
  try {
    const { document_ids } = req.body;
    if (!Array.isArray(document_ids)) {
      return res.status(400).json({ error: 'document_ids must be an array' });
    }

    // Get file paths for cleanup
    const filesResult = await pool.query(
      'SELECT file_path FROM documents WHERE id = ANY($1)',
      [document_ids]
    );

    // Delete documents (CASCADE handles versions)
    await pool.query('DELETE FROM documents WHERE id = ANY($1)', [document_ids]);

    // Cleanup files (non-blocking)
    const filePaths = filesResult.rows.map(row => row.file_path).filter(fp => fp);
    if (filePaths.length > 0) {
      try {
        const deleteResults = await storage.deleteFiles(filePaths);
        if (deleteResults.failed.length > 0) {
          console.error('Some files failed to delete:', deleteResults.failed);
        }
      } catch (error) {
        console.error('File deletion error:', error);
      }
    }

    res.json({ success: true, count: document_ids.length });
  } catch (error) {
    next(error);
  }
});

// Bulk tag
app.post('/api/v1/documents/bulk-tag', authenticateToken, checkPermission('superintendent'), async (req, res, next) => {
  try {
    const { document_ids, tags } = req.body;
    if (!Array.isArray(document_ids) || !Array.isArray(tags)) {
      return res.status(400).json({ error: 'document_ids and tags must be arrays' });
    }

    await pool.query(
      `UPDATE documents SET tags = array_cat(COALESCE(tags, ARRAY[]::TEXT[]), $1) WHERE id = ANY($2)`,
      [tags, document_ids]
    );

    res.json({ success: true, count: document_ids.length });
  } catch (error) {
    next(error);
  }
});

// Bulk categorize
app.post('/api/v1/documents/bulk-categorize', authenticateToken, checkPermission('superintendent'), async (req, res, next) => {
  try {
    const { document_ids, category } = req.body;
    if (!Array.isArray(document_ids)) {
      return res.status(400).json({ error: 'document_ids must be an array' });
    }

    await pool.query(
      'UPDATE documents SET category = $1 WHERE id = ANY($2)',
      [category, document_ids]
    );

    res.json({ success: true, count: document_ids.length });
  } catch (error) {
    next(error);
  }
});

// DOCUMENT PREVIEW
// Handle CORS preflight for preview endpoint
app.options('/api/v1/documents/:id/preview', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.sendStatus(200);
});

app.get('/api/v1/documents/:id/preview', async (req, res, next) => {
  try {
    // Set CORS headers explicitly for image loading
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

    // Support token in query parameter for iframe/img tag loading
    const token = req.query.token || (req.headers['authorization'] && req.headers['authorization'].split(' ')[1]);

    console.log('Preview request for document:', req.params.id);
    console.log('Token present:', !!token);
    console.log('Origin:', req.headers.origin);

    if (!token) {
      console.error('No token provided for preview');
      return res.status(401).json({ error: 'Access token required' });
    }

    // Verify token
    jwt.verify(token, JWT_SECRET, async (err, user) => {
      if (err) {
        console.error('Token verification failed:', err.message);
        return res.status(403).json({ error: 'Invalid token', details: err.message });
      }

      console.log('Token verified for user:', user.userId);

      try {
        const result = await pool.query(
          'SELECT file_path, mime_type, name FROM documents WHERE id = $1',
          [req.params.id]
        );

        if (result.rows.length === 0) {
          console.error('Document not found:', req.params.id);
          return res.status(404).json({ error: 'Document not found' });
        }

        const { file_path, mime_type, name } = result.rows[0];
        console.log('Document found:', { file_path, mime_type, name, storageType });

        if (storageType === 'local') {
          // Direct file serving for local storage
          const fullPath = path.resolve(file_path);
          console.log('Serving file from:', fullPath);

          // Check if file exists
          const fs = require('fs');
          if (!fs.existsSync(fullPath)) {
            console.error('File not found on disk:', fullPath);
            return res.status(404).json({ error: 'File not found on disk', path: fullPath });
          }

          res.setHeader('Content-Type', mime_type);
          res.setHeader('Content-Disposition', `inline; filename="${name}"`);
          res.sendFile(fullPath);
        } else {
          // Redirect to signed URL for cloud storage
          console.log('Generating signed URL for cloud storage');
          const signedUrl = await storage.getSignedUrl(file_path, 3600);
          res.redirect(signedUrl);
        }
      } catch (error) {
        console.error('Error in preview endpoint:', error);
        next(error);
      }
    });
  } catch (error) {
    console.error('Error in preview endpoint outer try:', error);
    next(error);
  }
});

// Download document
// Handle CORS preflight for download endpoint
app.options('/api/v1/documents/:id/download', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.sendStatus(200);
});

app.get('/api/v1/documents/:id/download', async (req, res, next) => {
  try {
    // Set CORS headers explicitly for cross-origin downloads
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');

    // Support token in query parameter for direct download links
    const token = req.query.token || (req.headers['authorization'] && req.headers['authorization'].split(' ')[1]);

    if (!token) {
      return res.status(401).json({ error: 'Access token required' });
    }

    // Verify token
    jwt.verify(token, JWT_SECRET, async (err, user) => {
      if (err) {
        return res.status(403).json({ error: 'Invalid token' });
      }

      try {
        const result = await pool.query(
          'SELECT file_path, mime_type, name FROM documents WHERE id = $1',
          [req.params.id]
        );

        if (result.rows.length === 0) return res.status(404).json({ error: 'Document not found' });

        const { file_path, mime_type, name } = result.rows[0];

        if (storageType === 'local') {
          // Direct file download for local storage
          res.setHeader('Content-Type', mime_type);
          res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
          res.sendFile(path.resolve(file_path));
        } else {
          // Redirect to signed URL for cloud storage
          const signedUrl = await storage.getSignedUrl(file_path, 3600);
          res.redirect(signedUrl);
        }
      } catch (error) {
        next(error);
      }
    });
  } catch (error) {
    next(error);
  }
});

// RFIS
app.post('/api/v1/projects/:projectId/rfis', authenticateToken, checkPermission('subcontractor'), async (req, res, next) => {
  try {
    const { title, question, priority, due_date, assigned_to } = req.body;
    const numberResult = await pool.query('SELECT COUNT(*) as count FROM rfis WHERE project_id = $1', [req.params.projectId]);
    const rfi_number = `RFI-${String(parseInt(numberResult.rows[0].count) + 1).padStart(3, '0')}`;

    const result = await pool.query(
      `INSERT INTO rfis (project_id, rfi_number, title, question, status, priority, due_date, created_by, assigned_to, ball_in_court)
       VALUES ($1, $2, $3, $4, 'draft', $5, $6, $7, $8, $8) RETURNING *`,
      [req.params.projectId, rfi_number, title, question, priority || 'normal', due_date, req.user.userId, assigned_to]
    );

    const rfi = result.rows[0];
    await emitEvent('rfi.created', 'rfi', rfi.id, req.params.projectId, req.user.userId, rfi);
    if (assigned_to) {
      await createNotification(assigned_to, 'assignment', 'New RFI Assigned', `RFI ${rfi_number}: ${title}`, 'rfi', rfi.id);
    }
    res.status(201).json({ rfi });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/projects/:projectId/rfis', authenticateToken, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT r.*, 
              u1.first_name || ' ' || u1.last_name as created_by_name,
              u2.first_name || ' ' || u2.last_name as assigned_to_name
       FROM rfis r
       LEFT JOIN users u1 ON r.created_by = u1.id
       LEFT JOIN users u2 ON r.assigned_to = u2.id
       WHERE r.project_id = $1 ORDER BY r.created_at DESC`,
      [req.params.projectId]
    );
    res.json({ rfis: result.rows });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/rfis/:id', authenticateToken, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT r.*, 
              u1.first_name || ' ' || u1.last_name as created_by_name,
              u2.first_name || ' ' || u2.last_name as assigned_to_name
       FROM rfis r
       LEFT JOIN users u1 ON r.created_by = u1.id
       LEFT JOIN users u2 ON r.assigned_to = u2.id
       WHERE r.id = $1`,
      [req.params.id]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'RFI not found' });

    const rfi = result.rows[0];
    const responses = await pool.query(
      `SELECT rr.*, u.first_name || ' ' || u.last_name as responded_by_name
       FROM rfi_responses rr
       LEFT JOIN users u ON rr.responded_by = u.id
       WHERE rr.rfi_id = $1 ORDER BY rr.responded_at ASC`,
      [req.params.id]
    );

    rfi.responses = responses.rows;
    res.json({ rfi });
  } catch (error) {
    next(error);
  }
});

app.put('/api/v1/rfis/:id/status', authenticateToken, checkPermission('engineer'), async (req, res, next) => {
  try {
    const { status } = req.body;
    const validTransitions = { 'draft': ['open'], 'open': ['answered', 'closed'], 'answered': ['closed'], 'closed': [] };
    
    const currentResult = await pool.query('SELECT status, project_id FROM rfis WHERE id = $1', [req.params.id]);
    if (currentResult.rows.length === 0) return res.status(404).json({ error: 'RFI not found' });

    const currentStatus = currentResult.rows[0].status;
    if (!validTransitions[currentStatus].includes(status)) {
      return res.status(400).json({ error: `Cannot transition from ${currentStatus} to ${status}` });
    }

    const result = await pool.query(
      `UPDATE rfis SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *`,
      [status, req.params.id]
    );

    await emitEvent('rfi.status_changed', 'rfi', req.params.id, currentResult.rows[0].project_id, req.user.userId, { old_status: currentStatus, new_status: status });
    res.json({ rfi: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

app.post('/api/v1/rfis/:id/responses', authenticateToken, checkPermission('subcontractor'), async (req, res, next) => {
  try {
    const { response_text, is_official } = req.body;
    const rfiResult = await pool.query('SELECT project_id FROM rfis WHERE id = $1', [req.params.id]);
    if (rfiResult.rows.length === 0) return res.status(404).json({ error: 'RFI not found' });

    const result = await pool.query(
      `INSERT INTO rfi_responses (rfi_id, response_text, is_official, responded_by)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.params.id, response_text, is_official || false, req.user.userId]
    );

    if (is_official) {
      await pool.query('UPDATE rfis SET status = $1 WHERE id = $2', ['answered', req.params.id]);
    }

    res.status(201).json({ response: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

// DRAWINGS
app.post('/api/v1/projects/:projectId/drawing-sets', authenticateToken, checkPermission('engineer'), async (req, res, next) => {
  try {
    const { name, discipline, set_number, issue_date, revision } = req.body;
    const result = await pool.query(
      `INSERT INTO drawing_sets (project_id, name, discipline, set_number, issue_date, revision, status, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, 'draft', $7) RETURNING *`,
      [req.params.projectId, name, discipline, set_number, issue_date, revision, req.user.userId]
    );
    res.status(201).json({ drawing_set: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/projects/:projectId/drawing-sets', authenticateToken, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT ds.*, u.first_name || ' ' || u.last_name as created_by_name, COUNT(sh.id) as sheet_count
       FROM drawing_sets ds
       LEFT JOIN users u ON ds.created_by = u.id
       LEFT JOIN drawing_sheets sh ON ds.id = sh.drawing_set_id
       WHERE ds.project_id = $1
       GROUP BY ds.id, u.first_name, u.last_name ORDER BY ds.created_at DESC`,
      [req.params.projectId]
    );
    res.json({ drawing_sets: result.rows });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/drawing-sets/:id', authenticateToken, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT ds.* FROM drawing_sets ds WHERE ds.id = $1`,
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Drawing set not found' });
    
    const sheetsResult = await pool.query(
      `SELECT sh.* FROM drawing_sheets sh WHERE sh.drawing_set_id = $1 ORDER BY sh.sheet_number`,
      [req.params.id]
    );
    
    const drawingSet = result.rows[0];
    drawingSet.sheets = sheetsResult.rows;
    res.json({ drawing_set: drawingSet });
  } catch (error) {
    next(error);
  }
});

app.post('/api/v1/drawing-sets/:setId/sheets', authenticateToken, checkPermission('engineer'), upload.single('file'), async (req, res, next) => {
  try {
    const { sheet_number, title, discipline, page_number } = req.body;
    let documentVersionId = null;

    if (req.file) {
      // Handle file storage based on storage type
      let filePath, fileUrl;
      if (storageType === 'local') {
        filePath = req.file.path;
        fileUrl = `/uploads/${path.basename(req.file.path)}`;
      } else {
        const uploadResult = await storage.uploadBuffer(
          req.file.buffer,
          req.file.originalname,
          { mimetype: req.file.mimetype, drawingSetId: req.params.setId }
        );
        filePath = uploadResult.path;
        fileUrl = uploadResult.url;
      }

      const docResult = await pool.query(
        `INSERT INTO documents (project_id, name, file_path, file_size, mime_type, uploaded_by)
         SELECT ds.project_id, $1, $2, $3, $4, $5 FROM drawing_sets ds WHERE ds.id = $6 RETURNING *`,
        [req.file.originalname, filePath, req.file.size, req.file.mimetype, req.user.userId, req.params.setId]
      );

      const versionResult = await pool.query(
        `INSERT INTO document_versions (document_id, version_number, file_path, file_size, uploaded_by)
         VALUES ($1, 1, $2, $3, $4) RETURNING *`,
        [docResult.rows[0].id, filePath, req.file.size, req.user.userId]
      );

      documentVersionId = versionResult.rows[0].id;
    }
    
    const result = await pool.query(
      `INSERT INTO drawing_sheets (drawing_set_id, sheet_number, title, discipline, page_number, document_version_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [req.params.setId, sheet_number, title, discipline, page_number, documentVersionId]
    );
    
    res.status(201).json({ sheet: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/drawing-sheets/:sheetId/markups', authenticateToken, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT m.*, u.first_name || ' ' || u.last_name as created_by_name
       FROM drawing_markups m LEFT JOIN users u ON m.created_by = u.id
       WHERE m.drawing_sheet_id = $1 ORDER BY m.created_at DESC`,
      [req.params.sheetId]
    );
    res.json({ markups: result.rows });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/v1/drawing-sheets/:id', authenticateToken, checkPermission('superintendent'), async (req, res, next) => {
  try {
    await pool.query('DELETE FROM drawing_sheets WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/drawing-sheets/:id', authenticateToken, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT sh.*, dv.file_path, d.file_path as doc_file_path
       FROM drawing_sheets sh
       LEFT JOIN document_versions dv ON sh.document_version_id = dv.id
       LEFT JOIN documents d ON dv.document_id = d.id
       WHERE sh.id = $1`,
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Sheet not found' });
    
    const markupsResult = await pool.query(
      `SELECT m.*, u.first_name || ' ' || u.last_name as created_by_name
       FROM drawing_markups m LEFT JOIN users u ON m.created_by = u.id
       WHERE m.drawing_sheet_id = $1 ORDER BY m.created_at DESC`,
      [req.params.id]
    );
    
    const sheet = result.rows[0];
    sheet.markups = markupsResult.rows;
    res.json({ sheet });
  } catch (error) {
    next(error);
  }
});
app.post('/api/v1/drawing-sheets/:sheetId/markups', authenticateToken, checkPermission('subcontractor'), async (req, res, next) => {
  try {
    const { markup_data } = req.body;
    if (!markup_data || !markup_data.type) {
      return res.status(400).json({ error: 'Invalid markup data' });
    }
    
    const result = await pool.query(
      `INSERT INTO drawing_markups (drawing_sheet_id, created_by, markup_data)
       VALUES ($1, $2, $3) RETURNING *`,
      [req.params.sheetId, req.user.userId, JSON.stringify(markup_data)]
    );
    
    res.status(201).json({ markup: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/v1/drawing-markups/:id', authenticateToken, async (req, res, next) => {
  try {
    await pool.query('DELETE FROM drawing_markups WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// ==========================================================================
// DRAWING WORKFLOW STATE MANAGEMENT
// ==========================================================================

// Get drawing workflow state
app.get('/api/v1/drawings/:documentId/workflow', authenticateToken, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT dws.*, u.first_name || ' ' || u.last_name as assigned_to_name,
       uc.first_name || ' ' || uc.last_name as created_by_name
       FROM drawing_workflow_states dws
       LEFT JOIN users u ON dws.assigned_to = u.id
       LEFT JOIN users uc ON dws.created_by = uc.id
       WHERE dws.document_id = $1
       ORDER BY dws.created_at DESC LIMIT 1`,
      [req.params.documentId]
    );

    if (result.rows.length === 0) {
      return res.json({ workflow_state: null });
    }

    res.json({ workflow_state: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

// Update drawing workflow state
app.post('/api/v1/drawings/:documentId/workflow', authenticateToken, checkPermission('engineer'), async (req, res, next) => {
  try {
    const { workflow_state, assigned_to, due_date, notes } = req.body;

    if (!workflow_state) {
      return res.status(400).json({ error: 'workflow_state is required' });
    }

    // Valid states
    const validStates = ['received', 'under_review', 'markup_in_progress', 'asi_pending', 'distributed', 'superseded', 'archived'];
    if (!validStates.includes(workflow_state)) {
      return res.status(400).json({ error: 'Invalid workflow_state' });
    }

    // Get current state if exists
    const currentStateResult = await pool.query(
      'SELECT workflow_state FROM drawing_workflow_states WHERE document_id = $1 ORDER BY created_at DESC LIMIT 1',
      [req.params.documentId]
    );
    const fromState = currentStateResult.rows.length > 0 ? currentStateResult.rows[0].workflow_state : null;

    // Insert new workflow state
    const result = await pool.query(
      `INSERT INTO drawing_workflow_states (document_id, workflow_state, assigned_to, due_date, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [req.params.documentId, workflow_state, assigned_to, due_date, notes, req.user.userId]
    );

    // Log workflow history
    await pool.query(
      `INSERT INTO drawing_workflow_history (document_id, from_state, to_state, changed_by, change_reason)
       VALUES ($1, $2, $3, $4, $5)`,
      [req.params.documentId, fromState, workflow_state, req.user.userId, notes]
    );

    res.status(201).json({ workflow_state: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

// Get workflow history for a drawing
app.get('/api/v1/drawings/:documentId/workflow-history', authenticateToken, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT dwh.*, u.first_name || ' ' || u.last_name as changed_by_name
       FROM drawing_workflow_history dwh
       LEFT JOIN users u ON dwh.changed_by = u.id
       WHERE dwh.document_id = $1
       ORDER BY dwh.created_at DESC`,
      [req.params.documentId]
    );
    res.json({ history: result.rows });
  } catch (error) {
    next(error);
  }
});

// ==========================================================================
// DRAWING MARKUPS (Document-based, new schema)
// ==========================================================================

// Get markups for a drawing
app.get('/api/v1/drawings/:documentId/markups', authenticateToken, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT dm.*, u.first_name || ' ' || u.last_name as created_by_name,
       ur.first_name || ' ' || ur.last_name as resolved_by_name
       FROM drawing_markups dm
       LEFT JOIN users u ON dm.created_by = u.id
       LEFT JOIN users ur ON dm.resolved_by = ur.id
       WHERE dm.document_id = $1
       ORDER BY dm.created_at DESC`,
      [req.params.documentId]
    );
    res.json({ markups: result.rows });
  } catch (error) {
    next(error);
  }
});

// Create markup for a drawing
app.post('/api/v1/drawings/:documentId/markups', authenticateToken, checkPermission('subcontractor'), async (req, res, next) => {
  try {
    const { markup_data, markup_type, position_x, position_y, comment, color, linked_entity_type, linked_entity_id } = req.body;

    if (!markup_data) {
      return res.status(400).json({ error: 'markup_data is required' });
    }

    const result = await pool.query(
      `INSERT INTO drawing_markups
       (document_id, created_by, markup_data, markup_type, position_x, position_y, comment, color, linked_entity_type, linked_entity_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [req.params.documentId, req.user.userId, JSON.stringify(markup_data), markup_type, position_x, position_y, comment, color, linked_entity_type, linked_entity_id]
    );

    res.status(201).json({ markup: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

// Update markup
app.put('/api/v1/drawing-markups/:markupId', authenticateToken, async (req, res, next) => {
  try {
    const { markup_data, status, comment, color } = req.body;

    // First, fetch the markup to check ownership and get project_id
    const markupCheck = await pool.query(
      `SELECT dm.created_by, d.project_id
       FROM drawing_markups dm
       JOIN documents d ON d.id = dm.document_id
       WHERE dm.id = $1`,
      [req.params.markupId]
    );

    if (markupCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Markup not found' });
    }

    const markup = markupCheck.rows[0];

    // Check if user owns the markup OR has engineer+ role in the project
    if (markup.created_by !== req.user.userId) {
      // Check user's role in the project
      const roleCheck = await pool.query(
        `SELECT role FROM project_members WHERE project_id = $1 AND user_id = $2`,
        [markup.project_id, req.user.userId]
      );

      if (roleCheck.rows.length === 0) {
        return res.status(403).json({ error: 'Access denied. You must be a project member.' });
      }

      const roleHierarchy = {
        'viewer': 1, 'subcontractor': 2, 'engineer': 3,
        'superintendent': 4, 'project_manager': 5, 'admin': 6
      };

      if (roleHierarchy[roleCheck.rows[0].role] < roleHierarchy['engineer']) {
        return res.status(403).json({ error: 'You can only update your own markups. Engineer role or higher required to modify others.' });
      }
    }

    // Now perform the update
    const result = await pool.query(
      `UPDATE drawing_markups
       SET markup_data = COALESCE($1, markup_data),
           status = COALESCE($2, status),
           comment = COALESCE($3, comment),
           color = COALESCE($4, color),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $5 RETURNING *`,
      [markup_data ? JSON.stringify(markup_data) : null, status, comment, color, req.params.markupId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Markup not found' });
    }

    res.json({ markup: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

// Resolve markup
app.post('/api/v1/drawing-markups/:markupId/resolve', authenticateToken, checkPermission('engineer'), async (req, res, next) => {
  try {
    const result = await pool.query(
      `UPDATE drawing_markups
       SET status = 'resolved',
           resolved_by = $1,
           resolved_at = CURRENT_TIMESTAMP
       WHERE id = $2 RETURNING *`,
      [req.user.userId, req.params.markupId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Markup not found' });
    }

    res.json({ markup: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

// Delete markup
app.delete('/api/v1/drawing-markups/:markupId', authenticateToken, async (req, res, next) => {
  try {
    // Check if user created this markup or has permission
    const markup = await pool.query(
      `SELECT dm.created_by, d.project_id
       FROM drawing_markups dm
       JOIN documents d ON d.id = dm.document_id
       WHERE dm.id = $1`,
      [req.params.markupId]
    );

    if (markup.rows.length === 0) {
      return res.status(404).json({ error: 'Markup not found' });
    }

    // Allow deletion if user created it OR has superintendent+ role in the project
    if (markup.rows[0].created_by !== req.user.userId) {
      // Check user's role in the project
      const roleCheck = await pool.query(
        `SELECT role FROM project_members WHERE project_id = $1 AND user_id = $2`,
        [markup.rows[0].project_id, req.user.userId]
      );

      if (roleCheck.rows.length === 0) {
        return res.status(403).json({ error: 'Access denied. You must be a project member.' });
      }

      const roleHierarchy = {
        'viewer': 1, 'subcontractor': 2, 'engineer': 3,
        'superintendent': 4, 'project_manager': 5, 'admin': 6
      };

      if (roleHierarchy[roleCheck.rows[0].role] < roleHierarchy['superintendent']) {
        return res.status(403).json({ error: 'You can only delete your own markups. Superintendent role or higher required to delete others.' });
      }
    }

    await pool.query('DELETE FROM drawing_markups WHERE id = $1', [req.params.markupId]);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// ==========================================================================
// DRAWING REVIEWS & COORDINATION
// ==========================================================================

// Get reviews for a drawing
app.get('/api/v1/drawings/:documentId/reviews', authenticateToken, async (req, res, next) => {
  try {
    // Single query to fetch all reviews with their checklist items (fix N+1 problem)
    const result = await pool.query(
      `SELECT dr.*,
       u.first_name || ' ' || u.last_name as reviewer_name,
       ur.first_name || ' ' || ur.last_name as requested_by_name,
       drc.id as checklist_id,
       drc.item_description,
       drc.is_checked,
       drc.notes as checklist_notes,
       drc.checked_by,
       drc.checked_at,
       drc.created_at as checklist_created_at,
       uc.first_name || ' ' || uc.last_name as checked_by_name
       FROM drawing_reviews dr
       LEFT JOIN users u ON dr.reviewer_id = u.id
       LEFT JOIN users ur ON dr.requested_by = ur.id
       LEFT JOIN drawing_review_checklist drc ON drc.review_id = dr.id
       LEFT JOIN users uc ON drc.checked_by = uc.id
       WHERE dr.document_id = $1
       ORDER BY dr.created_at DESC, drc.created_at ASC`,
      [req.params.documentId]
    );

    // Group checklist items by review
    const reviewsMap = new Map();
    for (let row of result.rows) {
      if (!reviewsMap.has(row.id)) {
        // Create review object (only review fields, not checklist fields)
        reviewsMap.set(row.id, {
          id: row.id,
          document_id: row.document_id,
          reviewer_id: row.reviewer_id,
          reviewer_name: row.reviewer_name,
          discipline: row.discipline,
          review_status: row.review_status,
          review_notes: row.review_notes,
          clash_detected: row.clash_detected,
          clash_description: row.clash_description,
          requested_by: row.requested_by,
          requested_by_name: row.requested_by_name,
          requested_at: row.requested_at,
          completed_at: row.completed_at,
          created_at: row.created_at,
          updated_at: row.updated_at,
          checklist: []
        });
      }

      // Add checklist item if it exists
      if (row.checklist_id) {
        reviewsMap.get(row.id).checklist.push({
          id: row.checklist_id,
          item_description: row.item_description,
          is_checked: row.is_checked,
          notes: row.checklist_notes,
          checked_by: row.checked_by,
          checked_by_name: row.checked_by_name,
          checked_at: row.checked_at,
          created_at: row.checklist_created_at
        });
      }
    }

    res.json({ reviews: Array.from(reviewsMap.values()) });
  } catch (error) {
    next(error);
  }
});

// Request drawing review
app.post('/api/v1/drawings/:documentId/reviews', authenticateToken, checkPermission('engineer'), async (req, res, next) => {
  try {
    const { reviewer_id, discipline, review_notes, checklist_items } = req.body;

    if (!reviewer_id) {
      return res.status(400).json({ error: 'reviewer_id is required' });
    }

    const result = await pool.query(
      `INSERT INTO drawing_reviews (document_id, reviewer_id, discipline, review_notes, requested_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.params.documentId, reviewer_id, discipline, review_notes, req.user.userId]
    );

    const review = result.rows[0];

    // Add checklist items if provided
    if (checklist_items && Array.isArray(checklist_items)) {
      for (let item of checklist_items) {
        await pool.query(
          `INSERT INTO drawing_review_checklist (review_id, item_description)
           VALUES ($1, $2)`,
          [review.id, item]
        );
      }
    }

    // TODO: Send notification to reviewer

    res.status(201).json({ review });
  } catch (error) {
    next(error);
  }
});

// Update review status
app.put('/api/v1/drawing-reviews/:reviewId', authenticateToken, async (req, res, next) => {
  try {
    const { review_status, review_notes, clash_detected, clash_description } = req.body;

    // Check if user is the assigned reviewer and get project_id
    const review = await pool.query(
      `SELECT dr.reviewer_id, d.project_id
       FROM drawing_reviews dr
       JOIN documents d ON d.id = dr.document_id
       WHERE dr.id = $1`,
      [req.params.reviewId]
    );

    if (review.rows.length === 0) {
      return res.status(404).json({ error: 'Review not found' });
    }

    // Allow update if user is the reviewer OR has superintendent+ role in the project
    if (review.rows[0].reviewer_id !== req.user.userId) {
      // Check user's role in the project
      const roleCheck = await pool.query(
        `SELECT role FROM project_members WHERE project_id = $1 AND user_id = $2`,
        [review.rows[0].project_id, req.user.userId]
      );

      if (roleCheck.rows.length === 0) {
        return res.status(403).json({ error: 'Access denied. You must be a project member.' });
      }

      const roleHierarchy = {
        'viewer': 1, 'subcontractor': 2, 'engineer': 3,
        'superintendent': 4, 'project_manager': 5, 'admin': 6
      };

      if (roleHierarchy[roleCheck.rows[0].role] < roleHierarchy['superintendent']) {
        return res.status(403).json({ error: 'Only the assigned reviewer or superintendent+ can update this review.' });
      }
    }

    const result = await pool.query(
      `UPDATE drawing_reviews
       SET review_status = COALESCE($1, review_status),
           review_notes = COALESCE($2, review_notes),
           clash_detected = COALESCE($3, clash_detected),
           clash_description = COALESCE($4, clash_description),
           completed_at = CASE WHEN $1 IN ('approved', 'rejected') THEN CURRENT_TIMESTAMP ELSE completed_at END,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $5 RETURNING *`,
      [review_status, review_notes, clash_detected, clash_description, req.params.reviewId]
    );

    res.json({ review: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

// Update checklist item
app.put('/api/v1/drawing-review-checklist/:itemId', authenticateToken, async (req, res, next) => {
  try {
    const { is_checked, notes } = req.body;

    const result = await pool.query(
      `UPDATE drawing_review_checklist
       SET is_checked = COALESCE($1, is_checked),
           notes = COALESCE($2, notes),
           checked_by = CASE WHEN $1 = true THEN $3 ELSE checked_by END,
           checked_at = CASE WHEN $1 = true THEN CURRENT_TIMESTAMP ELSE checked_at END
       WHERE id = $4 RETURNING *`,
      [is_checked, notes, req.user.userId, req.params.itemId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Checklist item not found' });
    }

    res.json({ item: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

// ==========================================================================
// DRAWING DISTRIBUTION
// ==========================================================================

// Get distributions for a drawing
app.get('/api/v1/drawings/:documentId/distributions', authenticateToken, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT dd.*,
       u.first_name || ' ' || u.last_name as distributed_to_name,
       ub.first_name || ' ' || ub.last_name as distributed_by_name
       FROM drawing_distributions dd
       LEFT JOIN users u ON dd.distributed_to_user_id = u.id
       LEFT JOIN users ub ON dd.distributed_by = ub.id
       WHERE dd.document_id = $1
       ORDER BY dd.created_at DESC`,
      [req.params.documentId]
    );
    res.json({ distributions: result.rows });
  } catch (error) {
    next(error);
  }
});

// Distribute drawing to user/role
app.post('/api/v1/drawings/:documentId/distribute', authenticateToken, checkPermission('engineer'), async (req, res, next) => {
  try {
    const { distributed_to_user_id, distributed_to_role, distribution_method, distribution_notes } = req.body;

    if (!distributed_to_user_id && !distributed_to_role) {
      return res.status(400).json({ error: 'Either distributed_to_user_id or distributed_to_role is required' });
    }

    const result = await pool.query(
      `INSERT INTO drawing_distributions
       (document_id, distributed_to_user_id, distributed_to_role, distribution_method, distribution_notes, distributed_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [req.params.documentId, distributed_to_user_id, distributed_to_role, distribution_method || 'manual', distribution_notes, req.user.userId]
    );

    // TODO: Send notification to recipient

    // Update workflow state to 'distributed' if not already
    const workflowCheck = await pool.query(
      'SELECT workflow_state FROM drawing_workflow_states WHERE document_id = $1 ORDER BY created_at DESC LIMIT 1',
      [req.params.documentId]
    );

    if (workflowCheck.rows.length === 0 || workflowCheck.rows[0].workflow_state !== 'distributed') {
      await pool.query(
        `INSERT INTO drawing_workflow_states (document_id, workflow_state, created_by, notes)
         VALUES ($1, 'distributed', $2, 'Auto-updated on distribution')`,
        [req.params.documentId, req.user.userId]
      );
    }

    res.status(201).json({ distribution: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

// Acknowledge distribution
app.post('/api/v1/drawing-distributions/:distributionId/acknowledge', authenticateToken, async (req, res, next) => {
  try {
    const result = await pool.query(
      `UPDATE drawing_distributions
       SET acknowledged = true,
           acknowledged_at = CURRENT_TIMESTAMP
       WHERE id = $1 RETURNING *`,
      [req.params.distributionId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Distribution not found' });
    }

    res.json({ distribution: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

// Bulk distribute drawing to multiple users/roles
app.post('/api/v1/drawings/:documentId/distribute-bulk', authenticateToken, checkPermission('engineer'), async (req, res, next) => {
  try {
    const { user_ids, roles, distribution_method, distribution_notes } = req.body;

    if ((!user_ids || user_ids.length === 0) && (!roles || roles.length === 0)) {
      return res.status(400).json({ error: 'user_ids or roles array required' });
    }

    const distributions = [];

    // Distribute to users
    if (user_ids && Array.isArray(user_ids)) {
      for (let userId of user_ids) {
        const result = await pool.query(
          `INSERT INTO drawing_distributions
           (document_id, distributed_to_user_id, distribution_method, distribution_notes, distributed_by)
           VALUES ($1, $2, $3, $4, $5) RETURNING *`,
          [req.params.documentId, userId, distribution_method || 'manual', distribution_notes, req.user.userId]
        );
        distributions.push(result.rows[0]);
      }
    }

    // Distribute to roles
    if (roles && Array.isArray(roles)) {
      for (let role of roles) {
        const result = await pool.query(
          `INSERT INTO drawing_distributions
           (document_id, distributed_to_role, distribution_method, distribution_notes, distributed_by)
           VALUES ($1, $2, $3, $4, $5) RETURNING *`,
          [req.params.documentId, role, distribution_method || 'manual', distribution_notes, req.user.userId]
        );
        distributions.push(result.rows[0]);
      }
    }

    res.status(201).json({ distributions, count: distributions.length });
  } catch (error) {
    next(error);
  }
});

// ==========================================================================
// ASI (ARCHITECT SUPPLEMENTAL INSTRUCTIONS)
// ==========================================================================

// Get ASIs for a project
app.get('/api/v1/projects/:projectId/asis', authenticateToken, async (req, res, next) => {
  try {
    const { status } = req.query;

    let query = `
      SELECT a.*, u.first_name || ' ' || u.last_name as created_by_name,
      (SELECT COUNT(*) FROM asi_drawings WHERE asi_id = a.id) as affected_drawings_count
      FROM asis a
      LEFT JOIN users u ON a.created_by = u.id
      WHERE a.project_id = $1
    `;
    const params = [req.params.projectId];

    if (status) {
      query += ` AND a.status = $2`;
      params.push(status);
    }

    query += ` ORDER BY a.issue_date DESC, a.asi_number DESC`;

    const result = await pool.query(query, params);
    res.json({ asis: result.rows });
  } catch (error) {
    next(error);
  }
});

// Get single ASI with affected drawings
app.get('/api/v1/asis/:asiId', authenticateToken, async (req, res, next) => {
  try {
    const asiResult = await pool.query(
      `SELECT a.*, u.first_name || ' ' || u.last_name as created_by_name
       FROM asis a
       LEFT JOIN users u ON a.created_by = u.id
       WHERE a.id = $1`,
      [req.params.asiId]
    );

    if (asiResult.rows.length === 0) {
      return res.status(404).json({ error: 'ASI not found' });
    }

    const asi = asiResult.rows[0];

    // Get affected drawings
    const drawingsResult = await pool.query(
      `SELECT ad.*, d.name as drawing_name, d.drawing_number, d.discipline
       FROM asi_drawings ad
       INNER JOIN documents d ON ad.document_id = d.id
       WHERE ad.asi_id = $1`,
      [req.params.asiId]
    );

    asi.affected_drawings = drawingsResult.rows;

    res.json({ asi });
  } catch (error) {
    next(error);
  }
});

// Create ASI
app.post('/api/v1/projects/:projectId/asis', authenticateToken, checkPermission('engineer'), async (req, res, next) => {
  try {
    const {
      asi_number, title, description, issued_by, issue_date, received_date,
      affects_cost, affects_schedule, estimated_cost_impact, estimated_schedule_impact_days
    } = req.body;

    if (!asi_number || !title) {
      return res.status(400).json({ error: 'asi_number and title are required' });
    }

    const result = await pool.query(
      `INSERT INTO asis
       (project_id, asi_number, title, description, issued_by, issue_date, received_date,
        affects_cost, affects_schedule, estimated_cost_impact, estimated_schedule_impact_days, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
      [req.params.projectId, asi_number, title, description, issued_by, issue_date, received_date,
       affects_cost, affects_schedule, estimated_cost_impact, estimated_schedule_impact_days, req.user.userId]
    );

    res.status(201).json({ asi: result.rows[0] });
  } catch (error) {
    if (error.code === '23505') { // Unique violation
      return res.status(400).json({ error: 'ASI number already exists for this project' });
    }
    next(error);
  }
});

// Update ASI
app.put('/api/v1/asis/:asiId', authenticateToken, checkPermission('engineer'), async (req, res, next) => {
  try {
    const {
      title, description, issued_by, issue_date, received_date, status,
      affects_cost, affects_schedule, estimated_cost_impact, estimated_schedule_impact_days, incorporation_notes
    } = req.body;

    const result = await pool.query(
      `UPDATE asis
       SET title = COALESCE($1, title),
           description = COALESCE($2, description),
           issued_by = COALESCE($3, issued_by),
           issue_date = COALESCE($4, issue_date),
           received_date = COALESCE($5, received_date),
           status = COALESCE($6, status),
           affects_cost = COALESCE($7, affects_cost),
           affects_schedule = COALESCE($8, affects_schedule),
           estimated_cost_impact = COALESCE($9, estimated_cost_impact),
           estimated_schedule_impact_days = COALESCE($10, estimated_schedule_impact_days),
           incorporation_notes = COALESCE($11, incorporation_notes),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $12 RETURNING *`,
      [title, description, issued_by, issue_date, received_date, status,
       affects_cost, affects_schedule, estimated_cost_impact, estimated_schedule_impact_days, incorporation_notes, req.params.asiId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'ASI not found' });
    }

    res.json({ asi: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

// Link ASI to drawing
app.post('/api/v1/asis/:asiId/drawings/:documentId', authenticateToken, checkPermission('engineer'), async (req, res, next) => {
  try {
    const { impact_description, requires_revision } = req.body;

    const result = await pool.query(
      `INSERT INTO asi_drawings (asi_id, document_id, impact_description, requires_revision)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.params.asiId, req.params.documentId, impact_description, requires_revision !== false]
    );

    // Update drawing workflow state to 'asi_pending' if requires revision
    if (requires_revision !== false) {
      await pool.query(
        `INSERT INTO drawing_workflow_states (document_id, workflow_state, created_by, notes)
         VALUES ($1, 'asi_pending', $2, 'ASI linked - revision may be required')`,
        [req.params.documentId, req.user.userId]
      );
    }

    res.status(201).json({ asi_drawing: result.rows[0] });
  } catch (error) {
    if (error.code === '23505') { // Unique violation
      return res.status(400).json({ error: 'This drawing is already linked to this ASI' });
    }
    next(error);
  }
});

// Mark ASI-drawing revision as completed
app.post('/api/v1/asi-drawings/:asiDrawingId/complete', authenticateToken, checkPermission('engineer'), async (req, res, next) => {
  try {
    const result = await pool.query(
      `UPDATE asi_drawings
       SET revision_completed = true,
           completed_at = CURRENT_TIMESTAMP
       WHERE id = $1 RETURNING *`,
      [req.params.asiDrawingId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'ASI-Drawing link not found' });
    }

    res.json({ asi_drawing: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

// Delete ASI
app.delete('/api/v1/asis/:asiId', authenticateToken, async (req, res, next) => {
  try {
    // Get ASI to find its project_id for permission check
    const asiResult = await pool.query('SELECT project_id FROM asis WHERE id = $1', [req.params.asiId]);

    if (asiResult.rows.length === 0) {
      return res.status(404).json({ error: 'ASI not found' });
    }

    // Set projectId for checkPermission middleware
    req.params.projectId = asiResult.rows[0].project_id;

    // Check permission manually - same level as create (engineer)
    const permissionCheck = checkPermission('engineer');
    await new Promise((resolve, reject) => {
      permissionCheck(req, res, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    // Delete the ASI (CASCADE will delete related asi_drawings)
    await pool.query('DELETE FROM asis WHERE id = $1', [req.params.asiId]);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// ==========================================================================
// DRAWING SETS (Enhanced version with new schema)
// ==========================================================================

// Create drawing set
app.post('/api/v1/projects/:projectId/drawing-sets-v2', authenticateToken, checkPermission('engineer'), async (req, res, next) => {
  try {
    const { set_name, set_description, set_type, issue_date } = req.body;

    if (!set_name) {
      return res.status(400).json({ error: 'set_name is required' });
    }

    const result = await pool.query(
      `INSERT INTO drawing_sets (project_id, set_name, set_description, set_type, issue_date, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [req.params.projectId, set_name, set_description, set_type, issue_date, req.user.userId]
    );

    res.status(201).json({ drawing_set: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

// Get drawing sets for project
app.get('/api/v1/projects/:projectId/drawing-sets-v2', authenticateToken, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT ds.*, u.first_name || ' ' || u.last_name as created_by_name,
       (SELECT COUNT(*) FROM drawing_set_members WHERE drawing_set_id = ds.id) as drawing_count
       FROM drawing_sets ds
       LEFT JOIN users u ON ds.created_by = u.id
       WHERE ds.project_id = $1
       ORDER BY ds.created_at DESC`,
      [req.params.projectId]
    );
    res.json({ drawing_sets: result.rows });
  } catch (error) {
    next(error);
  }
});

// Add drawing to set
app.post('/api/v1/drawing-sets/:setId/members/:documentId', authenticateToken, checkPermission('engineer'), async (req, res, next) => {
  try {
    const { sequence_order } = req.body;

    const result = await pool.query(
      `INSERT INTO drawing_set_members (drawing_set_id, document_id, sequence_order)
       VALUES ($1, $2, $3) RETURNING *`,
      [req.params.setId, req.params.documentId, sequence_order]
    );

    res.status(201).json({ member: result.rows[0] });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(400).json({ error: 'Drawing already in this set' });
    }
    next(error);
  }
});

// Remove drawing from set
app.delete('/api/v1/drawing-set-members/:memberId', authenticateToken, checkPermission('engineer'), async (req, res, next) => {
  try {
    await pool.query('DELETE FROM drawing_set_members WHERE id = $1', [req.params.memberId]);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// Get drawings in a set
app.get('/api/v1/drawing-sets/:setId/drawings', authenticateToken, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT d.*, dsm.sequence_order, dsm.id as member_id
       FROM drawing_set_members dsm
       INNER JOIN documents d ON dsm.document_id = d.id
       WHERE dsm.drawing_set_id = $1
       ORDER BY dsm.sequence_order, d.drawing_number`,
      [req.params.setId]
    );
    res.json({ drawings: result.rows });
  } catch (error) {
    next(error);
  }
});

// PHOTOS
app.post('/api/v1/projects/:projectId/photo-albums', authenticateToken, checkPermission('engineer'), async (req, res, next) => {
  try {
    const { name, description } = req.body;
    const result = await pool.query(
      `INSERT INTO photo_albums (project_id, name, description, created_by) VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.params.projectId, name, description, req.user.userId]
    );
    res.status(201).json({ album: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/projects/:projectId/photo-albums', authenticateToken, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT pa.*, COUNT(p.id) as photo_count
       FROM photo_albums pa LEFT JOIN photos p ON pa.id = p.album_id
       WHERE pa.project_id = $1 GROUP BY pa.id ORDER BY pa.created_at DESC`,
      [req.params.projectId]
    );
    res.json({ albums: result.rows });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/v1/photo-albums/:id', authenticateToken, checkPermission('superintendent'), async (req, res, next) => {
  try {
    // Fetch album to verify it exists and get project_id
    const albumQuery = await pool.query(
      'SELECT project_id FROM photo_albums WHERE id = $1',
      [req.params.id]
    );

    if (albumQuery.rows.length === 0) {
      return res.status(404).json({ error: 'Album not found' });
    }

    const album = albumQuery.rows[0];

    // Verify user is project member
    const memberCheck = await pool.query(
      'SELECT role FROM project_members WHERE project_id = $1 AND user_id = $2',
      [album.project_id, req.user.userId]
    );

    if (memberCheck.rows.length === 0) {
      return res.status(403).json({
        error: 'Access denied. You must be a project member to delete albums.'
      });
    }

    // Delete album (photos will have album_id set to NULL due to ON DELETE SET NULL)
    await pool.query('DELETE FROM photo_albums WHERE id = $1', [req.params.id]);

    // Emit audit event
    await emitEvent(
      'album.deleted',
      'photo_album',
      req.params.id,
      album.project_id,
      req.user.userId,
      { album_id: req.params.id }
    );

    res.json({
      success: true,
      deletedAlbumId: req.params.id
    });

  } catch (error) {
    console.error('Delete album error:', error);
    next(error);
  }
});

app.post('/api/v1/photo-albums/:albumId/photos', authenticateToken, checkPermission('subcontractor'), upload.single('photo'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No photo uploaded' });
    const { title, description, taken_at, location } = req.body;

    const albumResult = await pool.query('SELECT project_id FROM photo_albums WHERE id = $1', [req.params.albumId]);
    if (albumResult.rows.length === 0) return res.status(404).json({ error: 'Album not found' });

    const projectId = albumResult.rows[0].project_id;

    // Handle file storage based on storage type
    let filePath, fileUrl;
    if (storageType === 'local') {
      filePath = req.file.path;
      fileUrl = `/uploads/${path.basename(req.file.path)}`;
    } else {
      const uploadResult = await storage.uploadBuffer(
        req.file.buffer,
        req.file.originalname,
        { mimetype: req.file.mimetype, albumId: req.params.albumId, projectId: projectId }
      );
      filePath = uploadResult.path;
      fileUrl = uploadResult.url;
    }

    const docResult = await pool.query(
      `INSERT INTO documents (project_id, name, file_path, file_size, mime_type, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [projectId, req.file.originalname, filePath, req.file.size, req.file.mimetype, req.user.userId]
    );

    const photoResult = await pool.query(
      `INSERT INTO photos (album_id, project_id, document_id, title, description, taken_at, location, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [req.params.albumId, projectId, docResult.rows[0].id, title, description,
       taken_at || new Date().toISOString(), location, req.user.userId]
    );

    res.status(201).json({ photo: photoResult.rows[0] });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/projects/:projectId/photos', authenticateToken, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT p.*, d.file_path FROM photos p
       JOIN documents d ON p.document_id = d.id
       WHERE p.project_id = $1 ORDER BY p.taken_at DESC`,
      [req.params.projectId]
    );
    
    for (let photo of result.rows) {
      const tagsResult = await pool.query('SELECT tag FROM photo_tags WHERE photo_id = $1', [photo.id]);
      photo.tags = tagsResult.rows.map(r => r.tag);
    }
    
    res.json({ photos: result.rows });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/photos/:id', authenticateToken, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT p.*, d.file_path FROM photos p
       JOIN documents d ON p.document_id = d.id WHERE p.id = $1`,
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Photo not found' });
    
    const tagsResult = await pool.query('SELECT tag FROM photo_tags WHERE photo_id = $1', [req.params.id]);
    const photo = result.rows[0];
    photo.tags = tagsResult.rows.map(r => r.tag);
    res.json({ photo });
  } catch (error) {
    next(error);
  }
});

app.post('/api/v1/photos/:photoId/tags', authenticateToken, async (req, res, next) => {
  try {
    const { tags } = req.body;
    if (!Array.isArray(tags)) return res.status(400).json({ error: 'Tags must be array' });
    
    for (const tag of tags) {
      await pool.query(
        `INSERT INTO photo_tags (photo_id, tag) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [req.params.photoId, tag.toLowerCase().trim()]
      );
    }
    
    const result = await pool.query('SELECT tag FROM photo_tags WHERE photo_id = $1', [req.params.photoId]);
    res.json({ tags: result.rows.map(r => r.tag) });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/projects/:projectId/tags', authenticateToken, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT DISTINCT pt.tag, COUNT(*) as count FROM photo_tags pt
       JOIN photos p ON pt.photo_id = p.id WHERE p.project_id = $1
       GROUP BY pt.tag ORDER BY count DESC`,
      [req.params.projectId]
    );
    res.json({ tags: result.rows });
  } catch (error) {
    next(error);
  }
});

app.post('/api/v1/photos/:photoId/link', authenticateToken, async (req, res, next) => {
  try {
    const { target_type, target_id, metadata } = req.body;
    const result = await pool.query(
      `INSERT INTO entity_links (source_type, source_id, target_type, target_id, metadata)
       VALUES ('photo', $1, $2, $3, $4) RETURNING *`,
      [req.params.photoId, target_type, target_id, JSON.stringify(metadata || {})]
    );
    res.status(201).json({ link: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/v1/photos/:id', authenticateToken, checkPermission('superintendent'), async (req, res, next) => {
  const client = await pool.connect();

  try {
    // Fetch photo with document info
    const photoQuery = await client.query(
      `SELECT p.*, d.file_path, d.id as document_id
       FROM photos p
       JOIN documents d ON p.document_id = d.id
       WHERE p.id = $1`,
      [req.params.id]
    );

    if (photoQuery.rows.length === 0) {
      client.release();
      return res.status(404).json({ error: 'Photo not found' });
    }

    const photo = photoQuery.rows[0];
    const filePath = photo.file_path;
    const documentId = photo.document_id;

    // Verify user is project member
    const memberCheck = await client.query(
      `SELECT role FROM project_members
       WHERE project_id = $1 AND user_id = $2`,
      [photo.project_id, req.user.userId]
    );

    if (memberCheck.rows.length === 0) {
      client.release();
      return res.status(403).json({
        error: 'Access denied. You must be a project member to delete photos.'
      });
    }

    // Database transaction
    await client.query('BEGIN');

    // Delete photo (CASCADE handles photo_tags and entity_links)
    await client.query('DELETE FROM photos WHERE id = $1', [req.params.id]);

    // Delete document
    await client.query('DELETE FROM documents WHERE id = $1', [documentId]);

    await client.query('COMMIT');

    // File cleanup (non-blocking, after DB commit)
    if (filePath) {
      try {
        await storage.deleteFile(filePath);
      } catch (unlinkErr) {
        console.error('File deletion error (non-critical):', unlinkErr);
      }
    }

    // Emit audit event
    await emitEvent(
      'photo.deleted',
      'photo',
      req.params.id,
      photo.project_id,
      req.user.userId,
      {
        title: photo.title,
        document_id: documentId
      }
    );

    res.json({
      success: true,
      deletedPhotoId: req.params.id,
      deletedDocumentId: documentId
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Delete photo error:', error);
    next(error);
  } finally {
    client.release();
  }
});

// SUBMITTALS
app.post('/api/v1/projects/:projectId/submittal-packages', authenticateToken, checkPermission('subcontractor'), async (req, res, next) => {
  try {
    const { package_number, title, spec_section } = req.body;
    const result = await pool.query(
      `INSERT INTO submittal_packages (project_id, package_number, title, spec_section, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.params.projectId, package_number, title, spec_section, req.user.userId]
    );
    res.status(201).json({ package: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/projects/:projectId/submittal-packages', authenticateToken, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT sp.*, COUNT(s.id) as submittal_count
       FROM submittal_packages sp
       LEFT JOIN submittals s ON sp.id = s.package_id
       WHERE sp.project_id = $1
       GROUP BY sp.id ORDER BY sp.created_at DESC`,
      [req.params.projectId]
    );
    res.json({ packages: result.rows });
  } catch (error) {
    next(error);
  }
});

app.post('/api/v1/submittal-packages/:packageId/submittals', authenticateToken, checkPermission('subcontractor'), async (req, res, next) => {
  try {
    const { submittal_number, title, type, due_date } = req.body;
    const result = await pool.query(
      `INSERT INTO submittals (package_id, submittal_number, title, type, status, due_date, submitted_by)
       VALUES ($1, $2, $3, $4, 'draft', $5, $6) RETURNING *`,
      [req.params.packageId, submittal_number, title, type, due_date, req.user.userId]
    );
    res.status(201).json({ submittal: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/projects/:projectId/submittals', authenticateToken, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT s.*, sp.package_number, sp.title as package_title
       FROM submittals s
       JOIN submittal_packages sp ON s.package_id = sp.id
       WHERE sp.project_id = $1 ORDER BY s.created_at DESC`,
      [req.params.projectId]
    );
    res.json({ submittals: result.rows });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/submittals/:id', authenticateToken, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT s.*, sp.package_title FROM submittals s
       JOIN submittal_packages sp ON s.package_id = sp.id WHERE s.id = $1`,
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Submittal not found' });
    res.json({ submittal: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

// DAILY LOGS
app.post('/api/v1/projects/:projectId/daily-logs', authenticateToken, checkPermission('subcontractor'), async (req, res, next) => {
  try {
    const { log_date, weather, work_performed, delays } = req.body;

    // Check if a log already exists for this date
    const existingLog = await pool.query(
      'SELECT id FROM daily_logs WHERE project_id = $1 AND log_date = $2',
      [req.params.projectId, log_date]
    );

    if (existingLog.rows.length > 0) {
      return res.status(400).json({
        error: 'A daily log already exists for this date. Please select a different date or edit the existing log.'
      });
    }

    const result = await pool.query(
      `INSERT INTO daily_logs (project_id, log_date, weather, work_performed, delays, is_submitted, created_by)
       VALUES ($1, $2, $3, $4, $5, false, $6) RETURNING *`,
      [req.params.projectId, log_date, JSON.stringify(weather || {}), work_performed, delays, req.user.userId]
    );
    res.status(201).json({ daily_log: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/projects/:projectId/daily-logs', authenticateToken, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT dl.* FROM daily_logs dl
       WHERE dl.project_id = $1 ORDER BY dl.log_date DESC`,
      [req.params.projectId]
    );
    res.json({ daily_logs: result.rows });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/daily-logs/:id', authenticateToken, async (req, res, next) => {
  try {
    const result = await pool.query('SELECT dl.* FROM daily_logs dl WHERE dl.id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Daily log not found' });
    res.json({ daily_log: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

app.post('/api/v1/daily-logs/:id/submit', authenticateToken, checkPermission('subcontractor'), async (req, res, next) => {
  try {
    const result = await pool.query(
      `UPDATE daily_logs SET is_submitted = true, submitted_by = $1, submitted_at = CURRENT_TIMESTAMP
       WHERE id = $2 RETURNING *`,
      [req.user.userId, req.params.id]
    );
    res.json({ daily_log: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

// PUNCH ITEMS
app.post('/api/v1/projects/:projectId/punch-items', authenticateToken, checkPermission('engineer'), async (req, res, next) => {
  try {
    const { description, location, trade, priority, due_date } = req.body;
    const numberResult = await pool.query('SELECT COUNT(*) as count FROM punch_items WHERE project_id = $1', [req.params.projectId]);
    const item_number = `PUNCH-${String(parseInt(numberResult.rows[0].count) + 1).padStart(4, '0')}`;
    
    const result = await pool.query(
      `INSERT INTO punch_items (project_id, item_number, description, location, trade, status, priority, due_date, created_by)
       VALUES ($1, $2, $3, $4, $5, 'open', $6, $7, $8) RETURNING *`,
      [req.params.projectId, item_number, description, location, trade, priority || 'normal', due_date, req.user.userId]
    );
    
    res.status(201).json({ punch_item: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/projects/:projectId/punch-items', authenticateToken, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT pi.* FROM punch_items pi WHERE pi.project_id = $1 ORDER BY pi.created_at DESC`,
      [req.params.projectId]
    );
    res.json({ punch_items: result.rows });
  } catch (error) {
    next(error);
  }
});

app.put('/api/v1/punch-items/:id', authenticateToken, checkPermission('engineer'), async (req, res, next) => {
  try {
    const { status } = req.body;
    const result = await pool.query(
      `UPDATE punch_items SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *`,
      [status, req.params.id]
    );
    res.json({ punch_item: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

app.put('/api/v1/punch-items/:id/verify', authenticateToken, checkPermission('superintendent'), async (req, res, next) => {
  try {
    const result = await pool.query(
      `UPDATE punch_items SET status = 'verified', verified_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
    res.json({ punch_item: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

app.put('/api/v1/punch-items/:id/close', authenticateToken, checkPermission('superintendent'), async (req, res, next) => {
  try {
    const result = await pool.query(
      `UPDATE punch_items SET status = 'closed' WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
    res.json({ punch_item: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

// FINANCIALS
app.post('/api/v1/projects/:projectId/budget-lines', authenticateToken, checkPermission('project_manager'), async (req, res, next) => {
  try {
    const { cost_code, description, category, budgeted_amount } = req.body;
    const result = await pool.query(
      `INSERT INTO budget_lines (project_id, cost_code, description, category, budgeted_amount)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.params.projectId, cost_code, description, category, budgeted_amount]
    );
    res.status(201).json({ budget_line: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/projects/:projectId/budget-lines', authenticateToken, checkPermission('superintendent'), async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT bl.* FROM budget_lines bl WHERE bl.project_id = $1 ORDER BY bl.cost_code`,
      [req.params.projectId]
    );
    res.json({ budget_lines: result.rows });
  } catch (error) {
    next(error);
  }
});

app.post('/api/v1/projects/:projectId/commitments', authenticateToken, checkPermission('project_manager'), async (req, res, next) => {
  try {
    const { commitment_number, title, type, total_amount } = req.body;
    const result = await pool.query(
      `INSERT INTO commitments (project_id, commitment_number, title, type, total_amount, status, created_by)
       VALUES ($1, $2, $3, $4, $5, 'draft', $6) RETURNING *`,
      [req.params.projectId, commitment_number, title, type, total_amount, req.user.userId]
    );
    res.status(201).json({ commitment: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/projects/:projectId/commitments', authenticateToken, checkPermission('superintendent'), async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT c.* FROM commitments c WHERE c.project_id = $1 ORDER BY c.created_at DESC`,
      [req.params.projectId]
    );
    res.json({ commitments: result.rows });
  } catch (error) {
    next(error);
  }
});

app.post('/api/v1/projects/:projectId/change-events', authenticateToken, checkPermission('engineer'), async (req, res, next) => {
  try {
    const { event_number, title, description, estimated_cost, estimated_days } = req.body;
    const result = await pool.query(
      `INSERT INTO change_events (project_id, event_number, title, description, estimated_cost, estimated_days, status, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, 'draft', $7) RETURNING *`,
      [req.params.projectId, event_number, title, description, estimated_cost, estimated_days, req.user.userId]
    );
    res.status(201).json({ change_event: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/projects/:projectId/change-events', authenticateToken, checkPermission('superintendent'), async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT ce.* FROM change_events ce WHERE ce.project_id = $1 ORDER BY ce.created_at DESC`,
      [req.params.projectId]
    );
    res.json({ change_events: result.rows });
  } catch (error) {
    next(error);
  }
});

app.put('/api/v1/change-events/:id/approve', authenticateToken, checkPermission('superintendent'), async (req, res, next) => {
  try {
    await pool.query(`UPDATE change_events SET status = 'approved' WHERE id = $1`, [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

app.post('/api/v1/change-events/:id/convert-to-order', authenticateToken, checkPermission('project_manager'), async (req, res, next) => {
  try {
    const eventResult = await pool.query(`SELECT * FROM change_events WHERE id = $1`, [req.params.id]);
    if (eventResult.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    
    const event = eventResult.rows[0];
    const numberResult = await pool.query('SELECT COUNT(*) as count FROM change_orders WHERE project_id = $1', [event.project_id]);
    const change_order_number = `CO-${String(parseInt(numberResult.rows[0].count) + 1).padStart(3, '0')}`;
    
    const coResult = await pool.query(
      `INSERT INTO change_orders (project_id, change_order_number, change_event_id, title, description, cost_impact, schedule_impact, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending') RETURNING *`,
      [event.project_id, change_order_number, event.id, event.title, event.description, event.estimated_cost, event.estimated_days]
    );
    
    await pool.query(`UPDATE change_events SET status = 'converted' WHERE id = $1`, [req.params.id]);
    res.status(201).json({ change_order: coResult.rows[0] });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/projects/:projectId/change-orders', authenticateToken, checkPermission('superintendent'), async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT co.* FROM change_orders co WHERE co.project_id = $1 ORDER BY co.created_at DESC`,
      [req.params.projectId]
    );
    res.json({ change_orders: result.rows });
  } catch (error) {
    next(error);
  }
});

app.put('/api/v1/change-orders/:id/approve', authenticateToken, checkPermission('project_manager'), async (req, res, next) => {
  try {
    const statusCheck = await pool.query('SELECT project_id, cost_impact FROM change_orders WHERE id = $1', [req.params.id]);
    if (statusCheck.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    
    const result = await pool.query(
      `UPDATE change_orders SET status = 'approved', approved_by = $1, approved_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *`,
      [req.user.userId, req.params.id]
    );
    
    await pool.query(
      `UPDATE projects SET budget = budget + $1 WHERE id = $2`,
      [statusCheck.rows[0].cost_impact || 0, statusCheck.rows[0].project_id]
    );
    
    res.json({ change_order: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/projects/:projectId/financial-summary', authenticateToken, async (req, res, next) => {
  try {
    const budgetResult = await pool.query(
      `SELECT COALESCE(SUM(budgeted_amount), 0) as total_budget,
              COALESCE(SUM(committed_amount), 0) as total_committed,
              COALESCE(SUM(invoiced_amount), 0) as total_invoiced
       FROM budget_lines WHERE project_id = $1`,
      [req.params.projectId]
    );
    
    const projectResult = await pool.query('SELECT budget FROM projects WHERE id = $1', [req.params.projectId]);
    
    const summary = {
      ...budgetResult.rows[0],
      remaining_budget: parseFloat(budgetResult.rows[0].total_budget) - parseFloat(budgetResult.rows[0].total_committed),
      project_budget: projectResult.rows[0]?.budget
    };
    
    res.json({ summary });
  } catch (error) {
    next(error);
  }
});

// TEAM
app.get('/api/v1/projects/:projectId/members', authenticateToken, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT pm.*, u.email, u.first_name, u.last_name FROM project_members pm
       JOIN users u ON pm.user_id = u.id
       WHERE pm.project_id = $1 ORDER BY pm.joined_at DESC`,
      [req.params.projectId]
    );
    res.json({ members: result.rows });
  } catch (error) {
    next(error);
  }
});

// Add member to project
app.post('/api/v1/projects/:projectId/members',
  authenticateToken,
  checkPermission('project_manager'),
  async (req, res, next) => {
    try {
      const { user_id, role, email } = req.body;

      const validRoles = ['viewer', 'subcontractor', 'engineer', 'superintendent', 'project_manager', 'admin'];
      if (!validRoles.includes(role)) {
        return res.status(400).json({ error: 'Invalid role' });
      }

      let userId = user_id;
      if (!userId && email) {
        const userResult = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
        if (userResult.rows.length === 0) {
          return res.status(404).json({ error: 'User not found with that email' });
        }
        userId = userResult.rows[0].id;
      }

      if (!userId) {
        return res.status(400).json({ error: 'user_id or email required' });
      }

      const existing = await pool.query(
        'SELECT id FROM project_members WHERE project_id = $1 AND user_id = $2',
        [req.params.projectId, userId]
      );

      if (existing.rows.length > 0) {
        return res.status(400).json({ error: 'User is already a project member' });
      }

      const result = await pool.query(
        `INSERT INTO project_members (project_id, user_id, role)
         VALUES ($1, $2, $3) RETURNING *`,
        [req.params.projectId, userId, role]
      );

      await logAudit(req.user.userId, 'create', 'project_member', result.rows[0].id, {
        project_id: req.params.projectId, added_user_id: userId, role: role
      }, req);

      const memberDetails = await pool.query(
        `SELECT pm.*, u.first_name, u.last_name, u.email
         FROM project_members pm JOIN users u ON pm.user_id = u.id
         WHERE pm.id = $1`,
        [result.rows[0].id]
      );

      res.status(201).json({ member: memberDetails.rows[0] });
    } catch (error) {
      next(error);
    }
});

// Update member role
app.put('/api/v1/project-members/:id/role',
  authenticateToken, checkPermission('project_manager'),
  async (req, res, next) => {
    try {
      const { role } = req.body;
      const validRoles = ['viewer', 'subcontractor', 'engineer', 'superintendent', 'project_manager', 'admin'];
      if (!validRoles.includes(role)) {
        return res.status(400).json({ error: 'Invalid role' });
      }

      const oldData = await pool.query(
        'SELECT role, user_id, project_id FROM project_members WHERE id = $1',
        [req.params.id]
      );

      if (oldData.rows.length === 0) {
        return res.status(404).json({ error: 'Project member not found' });
      }

      const result = await pool.query(
        `UPDATE project_members SET role = $1 WHERE id = $2 RETURNING *`,
        [role, req.params.id]
      );

      await logAudit(req.user.userId, 'update', 'project_member', req.params.id, {
        field: 'role', old_value: oldData.rows[0].role, new_value: role,
        user_id: oldData.rows[0].user_id, project_id: oldData.rows[0].project_id
      }, req);

      res.json({ member: result.rows[0] });
    } catch (error) {
      next(error);
    }
});

// Remove member from project
app.delete('/api/v1/project-members/:id',
  authenticateToken, checkPermission('project_manager'),
  async (req, res, next) => {
    try {
      const memberData = await pool.query(
        'SELECT user_id, project_id, role FROM project_members WHERE id = $1',
        [req.params.id]
      );

      if (memberData.rows.length === 0) {
        return res.status(404).json({ error: 'Project member not found' });
      }

      if (memberData.rows[0].user_id === req.user.userId) {
        return res.status(400).json({ error: 'You cannot remove yourself from the project' });
      }

      await pool.query('DELETE FROM project_members WHERE id = $1', [req.params.id]);

      await logAudit(req.user.userId, 'delete', 'project_member', req.params.id, {
        removed_user_id: memberData.rows[0].user_id,
        project_id: memberData.rows[0].project_id,
        role: memberData.rows[0].role
      }, req);

      res.json({ success: true });
    } catch (error) {
      next(error);
    }
});

// Search users
app.get('/api/v1/users/search',
  authenticateToken, checkPermission('project_manager', { requireProject: false }),
  async (req, res, next) => {
    try {
      const { q } = req.query;
      if (!q || q.length < 2) {
        return res.status(400).json({ error: 'Search query must be at least 2 characters' });
      }

      const result = await pool.query(
        `SELECT id, email, first_name, last_name
         FROM users
         WHERE (email ILIKE $1 OR first_name ILIKE $1 OR last_name ILIKE $1)
         LIMIT 20`,
        [`%${q}%`]
      );

      res.json({ users: result.rows });
    } catch (error) {
      next(error);
    }
});

// Get role definitions
app.get('/api/v1/roles', authenticateToken, async (req, res, next) => {
  try {
    const roles = [
      { name: 'viewer', level: 1, display_name: 'Viewer',
        description: 'Read-only access to project information',
        typical_users: 'Owners, clients, inspectors, external stakeholders' },
      { name: 'subcontractor', level: 2, display_name: 'Subcontractor',
        description: 'Can create RFIs, submit daily logs, and upload documents',
        typical_users: 'Specialty trade contractors, vendors' },
      { name: 'engineer', level: 3, display_name: 'Engineer',
        description: 'Manage schedule, create technical documents, respond to RFIs',
        typical_users: 'Field engineers, assistant project engineers' },
      { name: 'superintendent', level: 4, display_name: 'Superintendent',
        description: 'Manage daily operations, punch lists, quality control',
        typical_users: 'Site superintendents, construction managers' },
      { name: 'project_manager', level: 5, display_name: 'Project Manager',
        description: 'Full project control including budget and team management',
        typical_users: 'Project managers, senior construction managers' },
      { name: 'admin', level: 6, display_name: 'Administrator',
        description: 'All permissions plus system administration',
        typical_users: 'Company admins, IT staff' }
    ];
    res.json({ roles });
  } catch (error) {
    next(error);
  }
});

// NOTIFICATIONS
app.get('/api/v1/notifications', authenticateToken, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [req.user.userId]
    );
    res.json({ notifications: result.rows });
  } catch (error) {
    next(error);
  }
});

// EVENTS
app.get('/api/v1/events', authenticateToken, async (req, res, next) => {
  try {
    const { limit = 100 } = req.query;
    const result = await pool.query(
      `SELECT * FROM system_events ORDER BY created_at DESC LIMIT ${parseInt(limit)}`
    );
    res.json({ events: result.rows });
  } catch (error) {
    next(error);
  }
});
// ============================================================================
// PROJECT SCHEDULING & TIMELINE MANAGEMENT
// Comprehensive scheduling system with tasks, dependencies, critical path
// ============================================================================

// ===========================================================================
// SCHEDULE TASKS
// ===========================================================================

// Create a new task
app.post('/api/v1/projects/:projectId/schedule/tasks', authenticateToken, checkPermission('engineer'), async (req, res, next) => {
  try {
    const {
      parent_task_id, task_code, name, description,
      planned_start_date, planned_end_date, duration_days,
      status, percent_complete, priority, task_type,
      constraint_type, constraint_date,
      budgeted_cost, assigned_to
    } = req.body;

    const result = await pool.query(
      `INSERT INTO schedule_tasks (
        project_id, parent_task_id, task_code, name, description,
        planned_start_date, planned_end_date, duration_days,
        status, percent_complete, priority, task_type,
        constraint_type, constraint_date,
        budgeted_cost, assigned_to, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
      RETURNING *`,
      [
        req.params.projectId, parent_task_id, task_code, name, description,
        planned_start_date, planned_end_date, duration_days,
        status || 'not_started', percent_complete || 0, priority || 'normal', task_type || 'task',
        constraint_type, constraint_date,
        budgeted_cost, assigned_to, req.user.userId
      ]
    );

    await emitEvent('task.created', 'schedule_task', result.rows[0].id, req.params.projectId, req.user.userId, result.rows[0]);
    res.status(201).json({ task: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

// Get all tasks for a project (with hierarchy)
app.get('/api/v1/projects/:projectId/schedule/tasks', authenticateToken, async (req, res, next) => {
  try {
    const { status, priority, assigned_to, parent_only } = req.query;

    let query = `
      SELECT t.*,
             u.first_name || ' ' || u.last_name as assigned_to_name,
             creator.first_name || ' ' || creator.last_name as created_by_name,
             (SELECT COUNT(*) FROM schedule_tasks WHERE parent_task_id = t.id) as subtask_count
      FROM schedule_tasks t
      LEFT JOIN users u ON t.assigned_to = u.id
      LEFT JOIN users creator ON t.created_by = creator.id
      WHERE t.project_id = $1
    `;
    const params = [req.params.projectId];
    let paramIndex = 2;

    if (status) {
      query += ` AND t.status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    if (priority) {
      query += ` AND t.priority = $${paramIndex}`;
      params.push(priority);
      paramIndex++;
    }

    if (assigned_to) {
      query += ` AND t.assigned_to = $${paramIndex}`;
      params.push(assigned_to);
      paramIndex++;
    }

    if (parent_only === 'true') {
      query += ` AND t.parent_task_id IS NULL`;
    }

    query += ` ORDER BY t.planned_start_date, t.task_code`;

    const result = await pool.query(query, params);
    res.json({ tasks: result.rows });
  } catch (error) {
    next(error);
  }
});

// Get single task with details
app.get('/api/v1/schedule/tasks/:id', authenticateToken, async (req, res, next) => {
  try {
    const taskResult = await pool.query(
      `SELECT t.*,
              u.first_name || ' ' || u.last_name as assigned_to_name,
              creator.first_name || ' ' || creator.last_name as created_by_name,
              parent.name as parent_task_name
       FROM schedule_tasks t
       LEFT JOIN users u ON t.assigned_to = u.id
       LEFT JOIN users creator ON t.created_by = creator.id
       LEFT JOIN schedule_tasks parent ON t.parent_task_id = parent.id
       WHERE t.id = $1`,
      [req.params.id]
    );

    if (taskResult.rows.length === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }

    // Get subtasks
    const subtasksResult = await pool.query(
      `SELECT * FROM schedule_tasks WHERE parent_task_id = $1 ORDER BY planned_start_date`,
      [req.params.id]
    );

    // Get dependencies
    const predecessorsResult = await pool.query(
      `SELECT td.*, t.name as predecessor_name
       FROM task_dependencies td
       JOIN schedule_tasks t ON td.predecessor_task_id = t.id
       WHERE td.successor_task_id = $1`,
      [req.params.id]
    );

    const successorsResult = await pool.query(
      `SELECT td.*, t.name as successor_name
       FROM task_dependencies td
       JOIN schedule_tasks t ON td.successor_task_id = t.id
       WHERE td.predecessor_task_id = $1`,
      [req.params.id]
    );

    // Get assignments
    const assignmentsResult = await pool.query(
      `SELECT ta.*, u.first_name || ' ' || u.last_name as user_name
       FROM task_assignments ta
       JOIN users u ON ta.user_id = u.id
       WHERE ta.task_id = $1`,
      [req.params.id]
    );

    const task = {
      ...taskResult.rows[0],
      subtasks: subtasksResult.rows,
      predecessors: predecessorsResult.rows,
      successors: successorsResult.rows,
      assignments: assignmentsResult.rows
    };

    res.json({ task });
  } catch (error) {
    next(error);
  }
});

// Update task
app.put('/api/v1/schedule/tasks/:id', authenticateToken, checkPermission('engineer'), async (req, res, next) => {
  try {
    const {
      name, description, planned_start_date, planned_end_date, duration_days,
      actual_start_date, actual_end_date, status, percent_complete,
      priority, constraint_type, constraint_date, budgeted_cost, actual_cost
    } = req.body;

    const result = await pool.query(
      `UPDATE schedule_tasks SET
        name = COALESCE($1, name),
        description = COALESCE($2, description),
        planned_start_date = COALESCE($3, planned_start_date),
        planned_end_date = COALESCE($4, planned_end_date),
        duration_days = COALESCE($5, duration_days),
        actual_start_date = COALESCE($6, actual_start_date),
        actual_end_date = COALESCE($7, actual_end_date),
        status = COALESCE($8, status),
        percent_complete = COALESCE($9, percent_complete),
        priority = COALESCE($10, priority),
        constraint_type = COALESCE($11, constraint_type),
        constraint_date = COALESCE($12, constraint_date),
        budgeted_cost = COALESCE($13, budgeted_cost),
        actual_cost = COALESCE($14, actual_cost),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $15
      RETURNING *`,
      [
        name, description, planned_start_date, planned_end_date, duration_days,
        actual_start_date, actual_end_date, status, percent_complete,
        priority, constraint_type, constraint_date, budgeted_cost, actual_cost,
        req.params.id
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }

    await emitEvent('task.updated', 'schedule_task', req.params.id, result.rows[0].project_id, req.user.userId, result.rows[0]);
    res.json({ task: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

// Delete task
app.delete('/api/v1/schedule/tasks/:id', authenticateToken, checkPermission('engineer'), async (req, res, next) => {
  try {
    const taskResult = await pool.query(
      'SELECT project_id FROM schedule_tasks WHERE id = $1',
      [req.params.id]
    );

    if (taskResult.rows.length === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }

    // Cascade will handle dependencies and assignments
    await pool.query('DELETE FROM schedule_tasks WHERE id = $1', [req.params.id]);

    await emitEvent('task.deleted', 'schedule_task', req.params.id, taskResult.rows[0].project_id, req.user.userId, {});
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// ===========================================================================
// TASK DEPENDENCIES
// ===========================================================================

// Add task dependency
app.post('/api/v1/schedule/tasks/:taskId/dependencies', authenticateToken, checkPermission('engineer'), async (req, res, next) => {
  try {
    const { predecessor_task_id, dependency_type, lag_days } = req.body;

    // Prevent circular dependencies (basic check)
    if (predecessor_task_id === req.params.taskId) {
      return res.status(400).json({ error: 'Cannot create self-dependency' });
    }

    const result = await pool.query(
      `INSERT INTO task_dependencies (
        predecessor_task_id, successor_task_id, dependency_type, lag_days, created_by
      ) VALUES ($1, $2, $3, $4, $5)
      RETURNING *`,
      [predecessor_task_id, req.params.taskId, dependency_type || 'FS', lag_days || 0, req.user.userId]
    );

    res.status(201).json({ dependency: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

// Get task dependencies
app.get('/api/v1/schedule/tasks/:taskId/dependencies', authenticateToken, async (req, res, next) => {
  try {
    const predecessorsResult = await pool.query(
      `SELECT td.*,
              pred.name as predecessor_name,
              pred.planned_start_date as predecessor_start,
              pred.planned_end_date as predecessor_end
       FROM task_dependencies td
       JOIN schedule_tasks pred ON td.predecessor_task_id = pred.id
       WHERE td.successor_task_id = $1`,
      [req.params.taskId]
    );

    const successorsResult = await pool.query(
      `SELECT td.*,
              succ.name as successor_name,
              succ.planned_start_date as successor_start,
              succ.planned_end_date as successor_end
       FROM task_dependencies td
       JOIN schedule_tasks succ ON td.successor_task_id = succ.id
       WHERE td.predecessor_task_id = $1`,
      [req.params.taskId]
    );

    res.json({
      predecessors: predecessorsResult.rows,
      successors: successorsResult.rows
    });
  } catch (error) {
    next(error);
  }
});

// Delete dependency
app.delete('/api/v1/schedule/dependencies/:id', authenticateToken, checkPermission('engineer'), async (req, res, next) => {
  try {
    await pool.query('DELETE FROM task_dependencies WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// ===========================================================================
// MILESTONES
// ===========================================================================

// Create milestone
app.post('/api/v1/projects/:projectId/schedule/milestones', authenticateToken, checkPermission('engineer'), async (req, res, next) => {
  try {
    const {
      name, description, milestone_type, target_date,
      is_critical, related_task_id
    } = req.body;

    const result = await pool.query(
      `INSERT INTO schedule_milestones (
        project_id, name, description, milestone_type, target_date,
        is_critical, related_task_id, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *`,
      [
        req.params.projectId, name, description, milestone_type || 'project',
        target_date, is_critical || false, related_task_id, req.user.userId
      ]
    );

    res.status(201).json({ milestone: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

// Get project milestones
app.get('/api/v1/projects/:projectId/schedule/milestones', authenticateToken, async (req, res, next) => {
  try {
    const { status, milestone_type } = req.query;

    let query = `
      SELECT m.*,
             t.name as related_task_name,
             creator.first_name || ' ' || creator.last_name as created_by_name
      FROM schedule_milestones m
      LEFT JOIN schedule_tasks t ON m.related_task_id = t.id
      LEFT JOIN users creator ON m.created_by = creator.id
      WHERE m.project_id = $1
    `;
    const params = [req.params.projectId];
    let paramIndex = 2;

    if (status) {
      query += ` AND m.status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    if (milestone_type) {
      query += ` AND m.milestone_type = $${paramIndex}`;
      params.push(milestone_type);
      paramIndex++;
    }

    query += ` ORDER BY m.target_date`;

    const result = await pool.query(query, params);
    res.json({ milestones: result.rows });
  } catch (error) {
    next(error);
  }
});

// Update milestone
app.put('/api/v1/schedule/milestones/:id', authenticateToken, checkPermission('engineer'), async (req, res, next) => {
  try {
    const {
      name, description, target_date, forecast_date,
      actual_date, status, is_critical
    } = req.body;

    const result = await pool.query(
      `UPDATE schedule_milestones SET
        name = COALESCE($1, name),
        description = COALESCE($2, description),
        target_date = COALESCE($3, target_date),
        forecast_date = COALESCE($4, forecast_date),
        actual_date = COALESCE($5, actual_date),
        status = COALESCE($6, status),
        is_critical = COALESCE($7, is_critical),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $8
      RETURNING *`,
      [name, description, target_date, forecast_date, actual_date, status, is_critical, req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Milestone not found' });
    }

    res.json({ milestone: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

// Delete milestone
app.delete('/api/v1/schedule/milestones/:id', authenticateToken, checkPermission('engineer'), async (req, res, next) => {
  try {
    await pool.query('DELETE FROM schedule_milestones WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// ===========================================================================
// TASK ASSIGNMENTS
// ===========================================================================

// Assign user to task
app.post('/api/v1/schedule/tasks/:taskId/assignments', authenticateToken, checkPermission('engineer'), async (req, res, next) => {
  try {
    const { user_id, role, allocation_percent, assigned_from, assigned_to } = req.body;

    const result = await pool.query(
      `INSERT INTO task_assignments (
        task_id, user_id, role, allocation_percent,
        assigned_from, assigned_to, assigned_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (task_id, user_id) DO UPDATE SET
        role = EXCLUDED.role,
        allocation_percent = EXCLUDED.allocation_percent,
        assigned_from = EXCLUDED.assigned_from,
        assigned_to = EXCLUDED.assigned_to
      RETURNING *`,
      [
        req.params.taskId, user_id, role, allocation_percent || 100,
        assigned_from, assigned_to, req.user.userId
      ]
    );

    // Create notification for assigned user
    const taskResult = await pool.query('SELECT name, project_id FROM schedule_tasks WHERE id = $1', [req.params.taskId]);
    if (taskResult.rows.length > 0) {
      await createNotification(
        user_id,
        'assignment',
        'Task Assigned',
        `You have been assigned to task: ${taskResult.rows[0].name}`,
        'schedule_task',
        req.params.taskId
      );
    }

    res.status(201).json({ assignment: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

// Get task assignments
app.get('/api/v1/schedule/tasks/:taskId/assignments', authenticateToken, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT ta.*,
              u.first_name || ' ' || u.last_name as user_name,
              u.email as user_email
       FROM task_assignments ta
       JOIN users u ON ta.user_id = u.id
       WHERE ta.task_id = $1`,
      [req.params.taskId]
    );

    res.json({ assignments: result.rows });
  } catch (error) {
    next(error);
  }
});

// Get user's assigned tasks
app.get('/api/v1/users/:userId/assigned-tasks', authenticateToken, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT t.*, ta.role, ta.allocation_percent,
              p.name as project_name
       FROM schedule_tasks t
       JOIN task_assignments ta ON t.id = ta.task_id
       JOIN projects p ON t.project_id = p.id
       WHERE ta.user_id = $1
       ORDER BY t.planned_start_date`,
      [req.params.userId]
    );

    res.json({ tasks: result.rows });
  } catch (error) {
    next(error);
  }
});

// Remove assignment
app.delete('/api/v1/schedule/assignments/:id', authenticateToken, checkPermission('engineer'), async (req, res, next) => {
  try {
    await pool.query('DELETE FROM task_assignments WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// ===========================================================================
// SCHEDULE BASELINES
// ===========================================================================

// Create baseline snapshot
app.post('/api/v1/projects/:projectId/schedule/baselines', authenticateToken, checkPermission('project_manager'), async (req, res, next) => {
  try {
    const { name, description, baseline_type } = req.body;

    // Get all tasks for snapshot
    const tasksResult = await pool.query(
      `SELECT * FROM schedule_tasks WHERE project_id = $1`,
      [req.params.projectId]
    );

    // Get schedule date range
    const rangeResult = await pool.query(
      `SELECT MIN(planned_start_date) as start_date,
              MAX(planned_end_date) as finish_date
       FROM schedule_tasks
       WHERE project_id = $1`,
      [req.params.projectId]
    );

    // Deactivate other baselines if this is being set as active
    if (baseline_type === 'original' || baseline_type === 'approved') {
      await pool.query(
        'UPDATE schedule_baselines SET is_active = false WHERE project_id = $1',
        [req.params.projectId]
      );
    }

    const result = await pool.query(
      `INSERT INTO schedule_baselines (
        project_id, name, description, baseline_type,
        baseline_date, start_date, finish_date,
        task_snapshot, is_active, created_by
      ) VALUES ($1, $2, $3, $4, CURRENT_DATE, $5, $6, $7, $8, $9)
      RETURNING *`,
      [
        req.params.projectId, name, description, baseline_type || 'approved',
        rangeResult.rows[0].start_date, rangeResult.rows[0].finish_date,
        JSON.stringify(tasksResult.rows),
        baseline_type === 'original' || baseline_type === 'approved',
        req.user.userId
      ]
    );

    res.status(201).json({ baseline: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

// Get project baselines
app.get('/api/v1/projects/:projectId/schedule/baselines', authenticateToken, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT id, name, description, baseline_type, baseline_date,
              start_date, finish_date, is_active, created_at
       FROM schedule_baselines
       WHERE project_id = $1
       ORDER BY baseline_date DESC`,
      [req.params.projectId]
    );

    res.json({ baselines: result.rows });
  } catch (error) {
    next(error);
  }
});

// Get baseline details with task snapshot
app.get('/api/v1/schedule/baselines/:id', authenticateToken, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT * FROM schedule_baselines WHERE id = $1`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Baseline not found' });
    }

    res.json({ baseline: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

// Set active baseline
app.put('/api/v1/schedule/baselines/:id/set-active', authenticateToken, checkPermission('project_manager'), async (req, res, next) => {
  try {
    const baselineResult = await pool.query(
      'SELECT project_id FROM schedule_baselines WHERE id = $1',
      [req.params.id]
    );

    if (baselineResult.rows.length === 0) {
      return res.status(404).json({ error: 'Baseline not found' });
    }

    // Deactivate all other baselines for this project
    await pool.query(
      'UPDATE schedule_baselines SET is_active = false WHERE project_id = $1',
      [baselineResult.rows[0].project_id]
    );

    // Activate this baseline
    await pool.query(
      'UPDATE schedule_baselines SET is_active = true WHERE id = $1',
      [req.params.id]
    );

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// ===========================================================================
// GANTT CHART DATA
// ===========================================================================

// Get Gantt chart data (tasks with dependencies for visualization)
app.get('/api/v1/projects/:projectId/schedule/gantt', authenticateToken, async (req, res, next) => {
  try {
    // Get all tasks
    const tasksResult = await pool.query(
      `SELECT t.id, t.task_code, t.name, t.parent_task_id,
              t.planned_start_date as start_date,
              t.planned_end_date as end_date,
              t.duration_days as duration,
              t.status, t.percent_complete, t.is_critical,
              t.priority, t.task_type,
              u.first_name || ' ' || u.last_name as assigned_to_name
       FROM schedule_tasks t
       LEFT JOIN users u ON t.assigned_to = u.id
       WHERE t.project_id = $1
       ORDER BY t.planned_start_date, t.task_code`,
      [req.params.projectId]
    );

    // Get all dependencies
    const depsResult = await pool.query(
      `SELECT td.id, td.predecessor_task_id as source,
              td.successor_task_id as target,
              td.dependency_type as type,
              td.lag_days as lag
       FROM task_dependencies td
       JOIN schedule_tasks pred ON td.predecessor_task_id = pred.id
       JOIN schedule_tasks succ ON td.successor_task_id = succ.id
       WHERE pred.project_id = $1`,
      [req.params.projectId]
    );

    // Get milestones
    const milestonesResult = await pool.query(
      `SELECT id, name, target_date as date, milestone_type, status, is_critical
       FROM schedule_milestones
       WHERE project_id = $1
       ORDER BY target_date`,
      [req.params.projectId]
    );

    res.json({
      tasks: tasksResult.rows,
      dependencies: depsResult.rows,
      milestones: milestonesResult.rows
    });
  } catch (error) {
    next(error);
  }
});

// ===========================================================================
// CRITICAL PATH CALCULATION
// ===========================================================================

// Calculate and return critical path
app.get('/api/v1/projects/:projectId/schedule/critical-path', authenticateToken, async (req, res, next) => {
  try {
    // Get all tasks and dependencies
    const tasksResult = await pool.query(
      `SELECT * FROM schedule_tasks WHERE project_id = $1`,
      [req.params.projectId]
    );

    const depsResult = await pool.query(
      `SELECT td.*
       FROM task_dependencies td
       JOIN schedule_tasks t ON td.successor_task_id = t.id
       WHERE t.project_id = $1`,
      [req.params.projectId]
    );

    const tasks = tasksResult.rows;
    const dependencies = depsResult.rows;

    if (tasks.length === 0) {
      return res.json({ criticalPath: [], projectDuration: 0 });
    }

    // Build task map and dependency graph
    const taskMap = new Map();
    tasks.forEach(task => {
      taskMap.set(task.id, {
        ...task,
        earlyStart: null,
        earlyFinish: null,
        lateStart: null,
        lateFinish: null,
        totalFloat: 0,
        freeFloat: 0,
        isCritical: false,
        predecessors: [],
        successors: []
      });
    });

    // Build predecessor/successor relationships
    dependencies.forEach(dep => {
      const successor = taskMap.get(dep.successor_task_id);
      const predecessor = taskMap.get(dep.predecessor_task_id);

      if (successor && predecessor) {
        successor.predecessors.push({
          taskId: dep.predecessor_task_id,
          type: dep.dependency_type,
          lag: dep.lag_days || 0
        });
        predecessor.successors.push({
          taskId: dep.successor_task_id,
          type: dep.dependency_type,
          lag: dep.lag_days || 0
        });
      }
    });

    // Forward pass (calculate Early Start and Early Finish)
    const calculateForwardPass = (taskId, visited = new Set()) => {
      if (visited.has(taskId)) return;
      visited.add(taskId);

      const task = taskMap.get(taskId);
      if (!task) return;

      if (task.predecessors.length === 0) {
        // Start task - use planned start date
        task.earlyStart = new Date(task.planned_start_date);
        task.earlyFinish = new Date(task.earlyStart);
        task.earlyFinish.setDate(task.earlyFinish.getDate() + task.duration_days);
      } else {
        // Calculate based on predecessors
        let maxFinish = null;

        task.predecessors.forEach(pred => {
          calculateForwardPass(pred.taskId, visited);
          const predTask = taskMap.get(pred.taskId);

          if (predTask && predTask.earlyFinish) {
            let finishDate = new Date(predTask.earlyFinish);
            finishDate.setDate(finishDate.getDate() + pred.lag);

            if (!maxFinish || finishDate > maxFinish) {
              maxFinish = finishDate;
            }
          }
        });

        if (maxFinish) {
          task.earlyStart = maxFinish;
          task.earlyFinish = new Date(task.earlyStart);
          task.earlyFinish.setDate(task.earlyFinish.getDate() + task.duration_days);
        }
      }
    };

    // Run forward pass for all tasks
    tasks.forEach(task => calculateForwardPass(task.id));

    // Find project end date (max early finish)
    let projectEnd = null;
    taskMap.forEach(task => {
      if (task.earlyFinish && (!projectEnd || task.earlyFinish > projectEnd)) {
        projectEnd = task.earlyFinish;
      }
    });

    // Backward pass (calculate Late Start and Late Finish)
    const calculateBackwardPass = (taskId, visited = new Set()) => {
      if (visited.has(taskId)) return;
      visited.add(taskId);

      const task = taskMap.get(taskId);
      if (!task) return;

      if (task.successors.length === 0) {
        // End task - late finish = project end
        task.lateFinish = projectEnd;
        task.lateStart = new Date(task.lateFinish);
        task.lateStart.setDate(task.lateStart.getDate() - task.duration_days);
      } else {
        // Calculate based on successors
        let minStart = null;

        task.successors.forEach(succ => {
          calculateBackwardPass(succ.taskId, visited);
          const succTask = taskMap.get(succ.taskId);

          if (succTask && succTask.lateStart) {
            let startDate = new Date(succTask.lateStart);
            startDate.setDate(startDate.getDate() - succ.lag);

            if (!minStart || startDate < minStart) {
              minStart = startDate;
            }
          }
        });

        if (minStart) {
          task.lateFinish = minStart;
          task.lateStart = new Date(task.lateFinish);
          task.lateStart.setDate(task.lateStart.getDate() - task.duration_days);
        }
      }

      // Calculate float
      if (task.earlyStart && task.lateStart) {
        task.totalFloat = Math.floor((task.lateStart - task.earlyStart) / (1000 * 60 * 60 * 24));
        task.isCritical = task.totalFloat === 0;
      }
    };

    // Run backward pass for all tasks
    tasks.forEach(task => calculateBackwardPass(task.id));

    // Extract critical path
    const criticalPath = [];
    taskMap.forEach(task => {
      if (task.isCritical) {
        criticalPath.push({
          id: task.id,
          name: task.name,
          task_code: task.task_code,
          duration_days: task.duration_days,
          early_start: task.earlyStart,
          early_finish: task.earlyFinish,
          total_float: task.totalFloat
        });
      }
    });

    // Sort critical path by early start
    criticalPath.sort((a, b) => a.early_start - b.early_start);

    // Calculate project duration
    const projectStart = tasks.reduce((min, task) => {
      const taskDate = new Date(task.planned_start_date);
      return !min || taskDate < min ? taskDate : min;
    }, null);

    const projectDuration = projectStart && projectEnd
      ? Math.floor((projectEnd - projectStart) / (1000 * 60 * 60 * 24))
      : 0;

    // Update tasks in database with calculated values
    const updatePromises = Array.from(taskMap.values()).map(task => {
      return pool.query(
        `UPDATE schedule_tasks SET
          early_start_date = $1,
          early_finish_date = $2,
          late_start_date = $3,
          late_finish_date = $4,
          total_float_days = $5,
          is_critical = $6
        WHERE id = $7`,
        [
          task.earlyStart,
          task.earlyFinish,
          task.lateStart,
          task.lateFinish,
          task.totalFloat,
          task.isCritical,
          task.id
        ]
      );
    });

    await Promise.all(updatePromises);

    res.json({
      criticalPath,
      projectDuration,
      projectStart,
      projectEnd,
      criticalTaskCount: criticalPath.length,
      totalTaskCount: tasks.length
    });
  } catch (error) {
    console.error('Critical path calculation error:', error);
    next(error);
  }
});

// ===========================================================================
// SCHEDULE ANALYTICS & REPORTING
// ===========================================================================

// Get project schedule summary
app.get('/api/v1/projects/:projectId/schedule/summary', authenticateToken, async (req, res, next) => {
  try {
    // Task statistics
    const statsResult = await pool.query(
      `SELECT
        COUNT(*) as total_tasks,
        COUNT(*) FILTER (WHERE status = 'completed') as completed_tasks,
        COUNT(*) FILTER (WHERE status = 'in_progress') as in_progress_tasks,
        COUNT(*) FILTER (WHERE status = 'not_started') as not_started_tasks,
        COUNT(*) FILTER (WHERE status = 'delayed') as delayed_tasks,
        COUNT(*) FILTER (WHERE is_critical = true) as critical_tasks,
        AVG(percent_complete) as avg_completion,
        MIN(planned_start_date) as project_start,
        MAX(planned_end_date) as project_end
       FROM schedule_tasks
       WHERE project_id = $1`,
      [req.params.projectId]
    );

    // Milestone statistics
    const milestoneStats = await pool.query(
      `SELECT
        COUNT(*) as total_milestones,
        COUNT(*) FILTER (WHERE status = 'achieved') as achieved_milestones,
        COUNT(*) FILTER (WHERE status = 'missed') as missed_milestones,
        COUNT(*) FILTER (WHERE status = 'at_risk') as at_risk_milestones
       FROM schedule_milestones
       WHERE project_id = $1`,
      [req.params.projectId]
    );

    // Budget statistics
    const budgetStats = await pool.query(
      `SELECT
        COALESCE(SUM(budgeted_cost), 0) as total_budgeted,
        COALESCE(SUM(actual_cost), 0) as total_actual,
        COALESCE(SUM(actual_cost) - SUM(budgeted_cost), 0) as variance
       FROM schedule_tasks
       WHERE project_id = $1`,
      [req.params.projectId]
    );

    // Upcoming tasks (next 7 days)
    const upcomingResult = await pool.query(
      `SELECT COUNT(*) as upcoming_tasks
       FROM schedule_tasks
       WHERE project_id = $1
       AND planned_start_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days'
       AND status = 'not_started'`,
      [req.params.projectId]
    );

    // Overdue tasks
    const overdueResult = await pool.query(
      `SELECT COUNT(*) as overdue_tasks
       FROM schedule_tasks
       WHERE project_id = $1
       AND planned_end_date < CURRENT_DATE
       AND status != 'completed'`,
      [req.params.projectId]
    );

    const summary = {
      ...statsResult.rows[0],
      ...milestoneStats.rows[0],
      ...budgetStats.rows[0],
      upcoming_tasks: upcomingResult.rows[0].upcoming_tasks,
      overdue_tasks: overdueResult.rows[0].overdue_tasks
    };

    res.json({ summary });
  } catch (error) {
    next(error);
  }
});

// Get schedule variance report (baseline vs current)
app.get('/api/v1/projects/:projectId/schedule/variance', authenticateToken, async (req, res, next) => {
  try {
    // Get active baseline
    const baselineResult = await pool.query(
      `SELECT * FROM schedule_baselines
       WHERE project_id = $1 AND is_active = true
       LIMIT 1`,
      [req.params.projectId]
    );

    if (baselineResult.rows.length === 0) {
      return res.status(404).json({ error: 'No active baseline found' });
    }

    const baseline = baselineResult.rows[0];
    const baselineTasks = baseline.task_snapshot;

    // Get current tasks
    const currentResult = await pool.query(
      `SELECT * FROM schedule_tasks WHERE project_id = $1`,
      [req.params.projectId]
    );

    const currentTasks = currentResult.rows;

    // Calculate variances
    const variances = currentTasks.map(current => {
      const baselineTask = baselineTasks.find(b => b.id === current.id);

      if (!baselineTask) {
        return {
          task_id: current.id,
          task_name: current.name,
          status: 'new_task',
          variance_days: null
        };
      }

      const baselineEnd = new Date(baselineTask.planned_end_date);
      const currentEnd = new Date(current.planned_end_date);
      const varianceDays = Math.floor((currentEnd - baselineEnd) / (1000 * 60 * 60 * 24));

      return {
        task_id: current.id,
        task_name: current.name,
        task_code: current.task_code,
        baseline_start: baselineTask.planned_start_date,
        baseline_end: baselineTask.planned_end_date,
        current_start: current.planned_start_date,
        current_end: current.planned_end_date,
        variance_days: varianceDays,
        status: varianceDays > 0 ? 'delayed' : varianceDays < 0 ? 'ahead' : 'on_track',
        is_critical: current.is_critical
      };
    });

    // Summary statistics
    const summary = {
      total_tasks: variances.length,
      tasks_delayed: variances.filter(v => v.status === 'delayed').length,
      tasks_ahead: variances.filter(v => v.status === 'ahead').length,
      tasks_on_track: variances.filter(v => v.status === 'on_track').length,
      avg_variance_days: variances.reduce((sum, v) => sum + (v.variance_days || 0), 0) / variances.length,
      critical_tasks_delayed: variances.filter(v => v.is_critical && v.status === 'delayed').length
    };

    res.json({
      baseline: {
        id: baseline.id,
        name: baseline.name,
        baseline_date: baseline.baseline_date
      },
      summary,
      variances: variances.sort((a, b) => (b.variance_days || 0) - (a.variance_days || 0))
    });
  } catch (error) {
    next(error);
  }
});

// Get look-ahead schedule (next N weeks)
app.get('/api/v1/projects/:projectId/schedule/look-ahead', authenticateToken, async (req, res, next) => {
  try {
    const { weeks = 3 } = req.query;
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + (parseInt(weeks) * 7));

    const result = await pool.query(
      `SELECT t.*,
              u.first_name || ' ' || u.last_name as assigned_to_name,
              (SELECT COUNT(*) FROM task_dependencies WHERE successor_task_id = t.id) as predecessor_count
       FROM schedule_tasks t
       LEFT JOIN users u ON t.assigned_to = u.id
       WHERE t.project_id = $1
       AND t.planned_start_date BETWEEN CURRENT_DATE AND $2
       AND t.status != 'completed'
       ORDER BY t.planned_start_date, t.priority DESC`,
      [req.params.projectId, endDate]
    );

    // Group by week
    const tasksByWeek = {};
    result.rows.forEach(task => {
      const weekStart = new Date(task.planned_start_date);
      weekStart.setDate(weekStart.getDate() - weekStart.getDay()); // Start of week
      const weekKey = weekStart.toISOString().split('T')[0];

      if (!tasksByWeek[weekKey]) {
        tasksByWeek[weekKey] = [];
      }
      tasksByWeek[weekKey].push(task);
    });

    res.json({
      weeks: parseInt(weeks),
      end_date: endDate,
      tasks_by_week: tasksByWeek,
      total_tasks: result.rows.length
    });
  } catch (error) {
    next(error);
  }
});

// ===========================================================================
// SCHEDULE INTEGRATION
// ===========================================================================

// Link schedule task to other entities
app.post('/api/v1/schedule/tasks/:taskId/links', authenticateToken, async (req, res, next) => {
  try {
    const { entity_type, entity_id, link_type, schedule_impact_days } = req.body;

    const result = await pool.query(
      `INSERT INTO schedule_links (
        task_id, entity_type, entity_id, link_type,
        schedule_impact_days, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *`,
      [
        req.params.taskId, entity_type, entity_id, link_type || 'related',
        schedule_impact_days || 0, req.user.userId
      ]
    );

    res.status(201).json({ link: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

// Get task links
app.get('/api/v1/schedule/tasks/:taskId/links', authenticateToken, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT * FROM schedule_links WHERE task_id = $1`,
      [req.params.taskId]
    );

    res.json({ links: result.rows });
  } catch (error) {
    next(error);
  }
});

// Get schedule impacts from RFIs, submittals, etc.
app.get('/api/v1/projects/:projectId/schedule/impacts', authenticateToken, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT sl.*,
              t.name as task_name,
              t.planned_start_date,
              t.planned_end_date
       FROM schedule_links sl
       JOIN schedule_tasks t ON sl.task_id = t.id
       WHERE t.project_id = $1
       AND sl.schedule_impact_days != 0
       ORDER BY ABS(sl.schedule_impact_days) DESC`,
      [req.params.projectId]
    );

    res.json({ impacts: result.rows });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// ANALYTICS & DASHBOARD ENDPOINTS
// ============================================================================

// Get comprehensive project analytics
app.get('/api/v1/projects/:projectId/analytics', authenticateToken, requireProjectMember, async (req, res, next) => {
  try {
    const { projectId } = req.params;
    console.log(`[Analytics] Starting analytics for project: ${projectId}`);

    const analytics = {
      documents: { total: 0 },
      rfis: { total: 0, open: 0, closed: 0 },
      drawings: { total: 0 },
      photos: { total: 0 },
      submittals: { total: 0, pending: 0 },
      dailyLogs: { total: 0 },
      punchList: { total: 0, open: 0, closed: 0 },
      financials: { budgetLines: 0, totalBudget: 0, commitments: 0, totalCommitted: 0, changeOrders: 0, totalChanges: 0, remainingBudget: 0 },
      schedule: { totalTasks: 0, completedTasks: 0, inProgressTasks: 0, completionPercentage: 0, milestones: 0, achievedMilestones: 0 },
      team: { members: 0 }
    };

    // Query each module individually with error handling
    try {
      const documents = await pool.query('SELECT COUNT(*) as count FROM documents WHERE project_id = $1', [projectId]);
      analytics.documents.total = parseInt(documents.rows[0].count) || 0;
      console.log('[Analytics] Documents query succeeded');
    } catch (e) {
      console.error('[Analytics] Documents query failed:', e.message);
    }

    try {
      const rfis = await pool.query(`SELECT COUNT(*) as total,
                COALESCE(SUM(CASE WHEN status = $2 THEN 1 ELSE 0 END), 0) as open
                FROM rfis WHERE project_id = $1`, [projectId, 'open']);
      analytics.rfis.total = parseInt(rfis.rows[0].total) || 0;
      analytics.rfis.open = parseInt(rfis.rows[0].open) || 0;
      analytics.rfis.closed = analytics.rfis.total - analytics.rfis.open;
      console.log('[Analytics] RFIs query succeeded');
    } catch (e) {
      console.error('[Analytics] RFIs query failed:', e.message);
    }

    try {
      const drawings = await pool.query('SELECT COUNT(*) as count FROM drawing_sheets WHERE drawing_set_id IN (SELECT id FROM drawing_sets WHERE project_id = $1)', [projectId]);
      analytics.drawings.total = parseInt(drawings.rows[0].count) || 0;
      console.log('[Analytics] Drawings query succeeded');
    } catch (e) {
      console.error('[Analytics] Drawings query failed:', e.message);
    }

    try {
      const photos = await pool.query('SELECT COUNT(*) as count FROM photos WHERE album_id IN (SELECT id FROM photo_albums WHERE project_id = $1)', [projectId]);
      analytics.photos.total = parseInt(photos.rows[0].count) || 0;
      console.log('[Analytics] Photos query succeeded');
    } catch (e) {
      console.error('[Analytics] Photos query failed:', e.message);
    }

    try {
      const submittals = await pool.query(`SELECT COUNT(*) as total,
                COALESCE(SUM(CASE WHEN status = $2 THEN 1 ELSE 0 END), 0) as pending
                FROM submittals WHERE package_id IN (SELECT id FROM submittal_packages WHERE project_id = $1)`, [projectId, 'pending_review']);
      analytics.submittals.total = parseInt(submittals.rows[0].total) || 0;
      analytics.submittals.pending = parseInt(submittals.rows[0].pending) || 0;
      console.log('[Analytics] Submittals query succeeded');
    } catch (e) {
      console.error('[Analytics] Submittals query failed:', e.message);
    }

    try {
      const dailyLogs = await pool.query('SELECT COUNT(*) as count FROM daily_logs WHERE project_id = $1', [projectId]);
      analytics.dailyLogs.total = parseInt(dailyLogs.rows[0].count) || 0;
      console.log('[Analytics] Daily logs query succeeded');
    } catch (e) {
      console.error('[Analytics] Daily logs query failed:', e.message);
    }

    try {
      const punchItems = await pool.query(`SELECT COUNT(*) as total,
                COALESCE(SUM(CASE WHEN status = $2 THEN 1 ELSE 0 END), 0) as open
                FROM punch_items WHERE project_id = $1`, [projectId, 'open']);
      analytics.punchList.total = parseInt(punchItems.rows[0].total) || 0;
      analytics.punchList.open = parseInt(punchItems.rows[0].open) || 0;
      analytics.punchList.closed = analytics.punchList.total - analytics.punchList.open;
      console.log('[Analytics] Punch items query succeeded');
    } catch (e) {
      console.error('[Analytics] Punch items query failed:', e.message);
    }

    try {
      const budgetLines = await pool.query('SELECT COUNT(*) as count, COALESCE(SUM(budget_amount), 0) as total_budget FROM budget_lines WHERE project_id = $1', [projectId]);
      analytics.financials.budgetLines = parseInt(budgetLines.rows[0].count) || 0;
      analytics.financials.totalBudget = parseFloat(budgetLines.rows[0].total_budget) || 0;
      console.log('[Analytics] Budget lines query succeeded');
    } catch (e) {
      console.error('[Analytics] Budget lines query failed:', e.message);
    }

    try {
      const commitments = await pool.query('SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as total_committed FROM commitments WHERE project_id = $1', [projectId]);
      analytics.financials.commitments = parseInt(commitments.rows[0].count) || 0;
      analytics.financials.totalCommitted = parseFloat(commitments.rows[0].total_committed) || 0;
      console.log('[Analytics] Commitments query succeeded');
    } catch (e) {
      console.error('[Analytics] Commitments query failed:', e.message);
    }

    try {
      const changeOrders = await pool.query('SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as total_changes FROM change_orders WHERE project_id = $1 AND status = $2', [projectId, 'approved']);
      analytics.financials.changeOrders = parseInt(changeOrders.rows[0].count) || 0;
      analytics.financials.totalChanges = parseFloat(changeOrders.rows[0].total_changes) || 0;
      analytics.financials.remainingBudget = analytics.financials.totalBudget - analytics.financials.totalCommitted;
      console.log('[Analytics] Change orders query succeeded');
    } catch (e) {
      console.error('[Analytics] Change orders query failed:', e.message);
    }

    try {
      const tasks = await pool.query(`SELECT COUNT(*) as total,
                COALESCE(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END), 0) as completed,
                COALESCE(SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END), 0) as in_progress
                FROM schedule_tasks WHERE project_id = $1`, [projectId]);
      analytics.schedule.totalTasks = parseInt(tasks.rows[0].total) || 0;
      analytics.schedule.completedTasks = parseInt(tasks.rows[0].completed) || 0;
      analytics.schedule.inProgressTasks = parseInt(tasks.rows[0].in_progress) || 0;
      analytics.schedule.completionPercentage = analytics.schedule.totalTasks > 0
        ? Math.round((analytics.schedule.completedTasks / analytics.schedule.totalTasks) * 100)
        : 0;
      console.log('[Analytics] Schedule tasks query succeeded');
    } catch (e) {
      console.error('[Analytics] Schedule tasks query failed:', e.message);
    }

    try {
      const milestones = await pool.query(`SELECT COUNT(*) as total,
                COALESCE(SUM(CASE WHEN status = $2 THEN 1 ELSE 0 END), 0) as achieved
                FROM schedule_milestones WHERE project_id = $1`, [projectId, 'achieved']);
      analytics.schedule.milestones = parseInt(milestones.rows[0].total) || 0;
      analytics.schedule.achievedMilestones = parseInt(milestones.rows[0].achieved) || 0;
      console.log('[Analytics] Milestones query succeeded');
    } catch (e) {
      console.error('[Analytics] Milestones query failed:', e.message);
    }

    try {
      const members = await pool.query('SELECT COUNT(*) as count FROM project_members WHERE project_id = $1', [projectId]);
      analytics.team.members = parseInt(members.rows[0].count) || 0;
      console.log('[Analytics] Project members query succeeded');
    } catch (e) {
      console.error('[Analytics] Project members query failed:', e.message);
    }

    console.log('[Analytics] Completed analytics query successfully');
    res.json({ analytics });
  } catch (error) {
    console.error('[Analytics] Fatal error:', error.message, error.stack);
    res.status(500).json({ error: 'Analytics query failed', details: error.message });
  }
});

// Get recent activity across all modules
app.get('/api/v1/projects/:projectId/activity', authenticateToken, requireProjectMember, async (req, res, next) => {
  try {
    const { projectId } = req.params;
    const limit = parseInt(req.query.limit) || 20;
    console.log(`[Activity] Starting activity query for project: ${projectId}, limit: ${limit}`);

    // Get recent system events
    const result = await pool.query(
      `SELECT se.id, se.event_type, se.entity_type, se.entity_id,
              se.event_data, se.created_at,
              COALESCE(u.first_name || ' ' || u.last_name, u.email) as user_name,
              u.email as user_email
       FROM system_events se
       LEFT JOIN users u ON se.user_id = u.id
       WHERE se.project_id = $1
       ORDER BY se.created_at DESC
       LIMIT $2`,
      [projectId, limit]
    );

    console.log(`[Activity] Query succeeded, found ${result.rows.length} events`);
    res.json({ activity: result.rows });
  } catch (error) {
    console.error('[Activity] Query failed:', error.message, error.stack);
    res.status(500).json({ error: 'Activity query failed', details: error.message, activity: [] });
  }
});

// Get recent documents
app.get('/api/v1/projects/:projectId/recent-documents', authenticateToken, requireProjectMember, async (req, res, next) => {
  try {
    const { projectId } = req.params;
    const limit = parseInt(req.query.limit) || 5;
    console.log(`[Recent Docs] Starting recent documents query for project: ${projectId}, limit: ${limit}`);

    const result = await pool.query(
      `SELECT d.id, d.name, d.category, d.file_size, d.uploaded_at as created_at,
              COALESCE(u.first_name || ' ' || u.last_name, u.email) as uploaded_by_name
       FROM documents d
       LEFT JOIN users u ON d.uploaded_by = u.id
       WHERE d.project_id = $1
       ORDER BY d.uploaded_at DESC
       LIMIT $2`,
      [projectId, limit]
    );

    console.log(`[Recent Docs] Query succeeded, found ${result.rows.length} documents`);
    res.json({ documents: result.rows });
  } catch (error) {
    console.error('[Recent Docs] Query failed:', error.message, error.stack);
    res.status(500).json({ error: 'Recent documents query failed', details: error.message, documents: [] });
  }
});

// Get upcoming schedule tasks
app.get('/api/v1/projects/:projectId/upcoming-tasks', authenticateToken, requireProjectMember, async (req, res, next) => {
  try {
    const { projectId } = req.params;
    const days = parseInt(req.query.days) || 7;
    const limit = parseInt(req.query.limit) || 5;
    console.log(`[Upcoming Tasks] Starting query for project: ${projectId}, days: ${days}, limit: ${limit}`);

    const result = await pool.query(
      `SELECT st.id, st.name, st.status, st.planned_start_date, st.planned_end_date,
              st.duration_days, st.priority
       FROM schedule_tasks st
       WHERE st.project_id = $1
       AND st.status != 'completed'
       AND st.planned_start_date <= CURRENT_DATE + $2 * INTERVAL '1 day'
       AND st.planned_start_date >= CURRENT_DATE
       ORDER BY st.planned_start_date ASC
       LIMIT $3`,
      [projectId, days, limit]
    );

    console.log(`[Upcoming Tasks] Query succeeded, found ${result.rows.length} tasks`);
    res.json({ tasks: result.rows });
  } catch (error) {
    console.error('[Upcoming Tasks] Query failed:', error.message, error.stack);
    res.status(500).json({ error: 'Upcoming tasks query failed', details: error.message, tasks: [] });
  }
});

// Get open RFIs summary
app.get('/api/v1/projects/:projectId/open-rfis', authenticateToken, requireProjectMember, async (req, res, next) => {
  try {
    const { projectId } = req.params;
    const limit = parseInt(req.query.limit) || 5;
    console.log(`[Open RFIs] Starting query for project: ${projectId}, limit: ${limit}`);

    const result = await pool.query(
      `SELECT r.id, r.rfi_number, r.title as subject, r.priority, r.status, r.created_at,
              COALESCE(u.first_name || ' ' || u.last_name, u.email) as created_by_name,
              (SELECT COUNT(*) FROM rfi_responses WHERE rfi_id = r.id) as response_count
       FROM rfis r
       LEFT JOIN users u ON r.created_by = u.id
       WHERE r.project_id = $1 AND r.status = 'open'
       ORDER BY
         CASE r.priority
           WHEN 'urgent' THEN 1
           WHEN 'high' THEN 2
           WHEN 'normal' THEN 3
           WHEN 'low' THEN 4
         END,
         r.created_at ASC
       LIMIT $2`,
      [projectId, limit]
    );

    console.log(`[Open RFIs] Query succeeded, found ${result.rows.length} RFIs`);
    res.json({ rfis: result.rows });
  } catch (error) {
    console.error('[Open RFIs] Query failed:', error.message, error.stack);
    res.status(500).json({ error: 'Open RFIs query failed', details: error.message, rfis: [] });
  }
});

// Get open punch items summary
app.get('/api/v1/projects/:projectId/open-punch', authenticateToken, requireProjectMember, async (req, res, next) => {
  try {
    const { projectId } = req.params;
    const limit = parseInt(req.query.limit) || 5;
    console.log(`[Open Punch] Starting query for project: ${projectId}, limit: ${limit}`);

    const result = await pool.query(
      `SELECT pi.id, pi.item_number, pi.description, pi.priority, pi.status,
              pi.due_date, pi.created_at,
              COALESCE(u.first_name || ' ' || u.last_name, u.email) as assigned_to_name
       FROM punch_items pi
       LEFT JOIN users u ON pi.assigned_to = u.id
       WHERE pi.project_id = $1 AND pi.status IN ('open', 'in_progress')
       ORDER BY
         CASE pi.priority
           WHEN 'critical' THEN 1
           WHEN 'high' THEN 2
           WHEN 'medium' THEN 3
           WHEN 'low' THEN 4
         END,
         pi.due_date ASC NULLS LAST,
         pi.created_at ASC
       LIMIT $2`,
      [projectId, limit]
    );

    console.log(`[Open Punch] Query succeeded, found ${result.rows.length} punch items`);
    res.json({ punchItems: result.rows });
  } catch (error) {
    console.error('[Open Punch] Query failed:', error.message, error.stack);
    res.status(500).json({ error: 'Open punch items query failed', details: error.message, punchItems: [] });
  }
});

// ============================================================================
// WORKFLOW ENGINE API ROUTES
// ============================================================================
registerWorkflowRoutes(app, pool, authenticateToken);

// ERROR HANDLER
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// ============================================================================
// MIGRATION ENDPOINT - Run database migrations
// ============================================================================
app.post('/api/v1/admin/run-migration', authenticateToken, async (req, res) => {
  try {
    // CRITICAL: Verify user has admin role in at least one project (system-wide admin operation)
    const adminCheck = await pool.query(
      `SELECT COUNT(*) as admin_count
       FROM project_members
       WHERE user_id = $1 AND role = 'admin'`,
      [req.user.userId]
    );

    if (parseInt(adminCheck.rows[0].admin_count) === 0) {
      return res.status(403).json({
        error: 'Access denied. System admin role required to run migrations.',
        required_permission: 'admin'
      });
    }

    const { migrationName } = req.body;

    if (!migrationName) {
      return res.status(400).json({ error: 'Migration name required' });
    }

    // Only allow specific migrations
    const allowedMigrations = [
      '001_documents_enhancement.sql',
      '006_scheduling_system.sql'
    ];

    if (!allowedMigrations.includes(migrationName)) {
      return res.status(400).json({ error: 'Invalid migration name' });
    }

    const migrationPath = path.join(__dirname, 'migrations', migrationName);
    if (!fs.existsSync(migrationPath)) {
      return res.status(404).json({ error: 'Migration file not found' });
    }

    console.log(`🔄 Running migration: ${migrationName} by user ${req.user.userId}`);
    const sql = fs.readFileSync(migrationPath, 'utf8');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('COMMIT');

      console.log(`✅ Migration completed: ${migrationName}`);
      res.json({
        success: true,
        message: `Migration ${migrationName} completed successfully`
      });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error(`❌ Migration failed: ${migrationName}`, error);
      res.status(500).json({
        error: 'Migration failed',
        details: error.message
      });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Migration endpoint error:', error);
    res.status(500).json({ error: 'Migration failed', details: error.message });
  }
});

// START SERVER
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ BuildPro API (Complete) running on port ${PORT}`);
  console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔧 All 11 modules loaded: Auth, Projects, Scheduling, Documents, RFIs, Drawings, Photos, Submittals, Daily Logs, Punch, Financials, Team`);
});

process.on('SIGTERM', () => {
  console.log('Shutting down...');
  pool.end();
  process.exit(0);
});