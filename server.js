// ============================================================================
// BUILDPRO - COMPLETE PRODUCTION BACKEND
// All 10 modules included - Ready for production deployment
// ============================================================================

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL not set');
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

pool.connect((err, client, release) => {
  if (err) {
    console.error('❌ Database error:', err.stack);
  } else {
    console.log('✅ Database connected');
    release();
  }
});

const uploadDir = './uploads';
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
      const uniqueName = `${Date.now()}-${uuidv4()}${path.extname(file.originalname)}`;
      cb(null, uniqueName);
    }
  }),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|pdf|doc|docx|xls|xlsx|dwg|dxf/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    if (extname) return cb(null, true);
    cb(new Error('Invalid file type'));
  }
});

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
app.use('/uploads', express.static('uploads'));

app.get('/', (req, res) => {
  res.json({ 
    message: 'BuildPro API - Complete',
    version: '1.0.0',
    modules: ['auth', 'projects', 'documents', 'rfis', 'drawings', 'photos', 'submittals', 'dailylogs', 'punch', 'financials', 'team']
  });
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

const checkPermission = (requiredRole) => {
  return async (req, res, next) => {
    try {
      const projectId = req.params.projectId || req.body.project_id;
      if (!projectId) return next();

      const result = await pool.query(
        `SELECT role FROM project_members WHERE project_id = $1 AND user_id = $2`,
        [projectId, req.user.userId]
      );

      if (result.rows.length === 0) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const roleHierarchy = { 'viewer': 1, 'subcontractor': 2, 'engineer': 3, 'superintendent': 4, 'project_manager': 5, 'admin': 6 };
      if (roleHierarchy[result.rows[0].role] < roleHierarchy[requiredRole]) {
        return res.status(403).json({ error: `Requires ${requiredRole} role` });
      }
      next();
    } catch (error) {
      next(error);
    }
  };
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
app.post('/api/v1/projects/:projectId/documents', authenticateToken, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const { name } = req.body;
    const result = await pool.query(
      `INSERT INTO documents (project_id, name, file_path, file_size, mime_type, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [req.params.projectId, name || req.file.originalname, req.file.path, req.file.size, req.file.mimetype, req.user.userId]
    );
    await emitEvent('document.uploaded', 'document', result.rows[0].id, req.params.projectId, req.user.userId, result.rows[0]);
    res.status(201).json({ document: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/projects/:projectId/documents', authenticateToken, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT d.*, u.first_name, u.last_name FROM documents d
       LEFT JOIN users u ON d.uploaded_by = u.id
       WHERE d.project_id = $1 ORDER BY d.uploaded_at DESC`,
      [req.params.projectId]
    );
    res.json({ documents: result.rows });
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

app.put('/api/v1/rfis/:id/status', authenticateToken, async (req, res, next) => {
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

app.post('/api/v1/rfis/:id/responses', authenticateToken, async (req, res, next) => {
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
app.post('/api/v1/projects/:projectId/drawing-sets', authenticateToken, async (req, res, next) => {
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

app.post('/api/v1/drawing-sets/:setId/sheets', authenticateToken, upload.single('file'), async (req, res, next) => {
  try {
    const { sheet_number, title, discipline, page_number } = req.body;
    let documentVersionId = null;
    
    if (req.file) {
      const docResult = await pool.query(
        `INSERT INTO documents (project_id, name, file_path, file_size, mime_type, uploaded_by)
         SELECT ds.project_id, $1, $2, $3, $4, $5 FROM drawing_sets ds WHERE ds.id = $6 RETURNING *`,
        [req.file.originalname, req.file.path, req.file.size, req.file.mimetype, req.user.userId, req.params.setId]
      );
      
      const versionResult = await pool.query(
        `INSERT INTO document_versions (document_id, version_number, file_path, file_size, uploaded_by)
         VALUES ($1, 1, $2, $3, $4) RETURNING *`,
        [docResult.rows[0].id, req.file.path, req.file.size, req.user.userId]
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

app.delete('/api/v1/drawing-sheets/:id', authenticateToken, async (req, res, next) => {
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
app.post('/api/v1/drawing-sheets/:sheetId/markups', authenticateToken, async (req, res, next) => {
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

// PHOTOS
app.post('/api/v1/projects/:projectId/photo-albums', authenticateToken, async (req, res, next) => {
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

app.post('/api/v1/photo-albums/:albumId/photos', authenticateToken, upload.single('photo'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No photo uploaded' });
    const { title, description, taken_at, location } = req.body;
    
    const albumResult = await pool.query('SELECT project_id FROM photo_albums WHERE id = $1', [req.params.albumId]);
    if (albumResult.rows.length === 0) return res.status(404).json({ error: 'Album not found' });
    
    const projectId = albumResult.rows[0].project_id;
    
    const docResult = await pool.query(
      `INSERT INTO documents (project_id, name, file_path, file_size, mime_type, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [projectId, req.file.originalname, req.file.path, req.file.size, req.file.mimetype, req.user.userId]
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

// SUBMITTALS
app.post('/api/v1/projects/:projectId/submittal-packages', authenticateToken, async (req, res, next) => {
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

app.post('/api/v1/submittal-packages/:packageId/submittals', authenticateToken, async (req, res, next) => {
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
app.post('/api/v1/projects/:projectId/daily-logs', authenticateToken, async (req, res, next) => {
  try {
    const { log_date, weather, work_performed, delays } = req.body;
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

app.post('/api/v1/daily-logs/:id/submit', authenticateToken, async (req, res, next) => {
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
app.post('/api/v1/projects/:projectId/punch-items', authenticateToken, async (req, res, next) => {
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

app.put('/api/v1/punch-items/:id', authenticateToken, async (req, res, next) => {
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

app.put('/api/v1/punch-items/:id/verify', authenticateToken, async (req, res, next) => {
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

app.put('/api/v1/punch-items/:id/close', authenticateToken, async (req, res, next) => {
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
app.post('/api/v1/projects/:projectId/budget-lines', authenticateToken, async (req, res, next) => {
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

app.get('/api/v1/projects/:projectId/budget-lines', authenticateToken, async (req, res, next) => {
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

app.post('/api/v1/projects/:projectId/commitments', authenticateToken, async (req, res, next) => {
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

app.get('/api/v1/projects/:projectId/commitments', authenticateToken, async (req, res, next) => {
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

app.post('/api/v1/projects/:projectId/change-events', authenticateToken, async (req, res, next) => {
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

app.get('/api/v1/projects/:projectId/change-events', authenticateToken, async (req, res, next) => {
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

app.put('/api/v1/change-events/:id/approve', authenticateToken, async (req, res, next) => {
  try {
    await pool.query(`UPDATE change_events SET status = 'approved' WHERE id = $1`, [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

app.post('/api/v1/change-events/:id/convert-to-order', authenticateToken, async (req, res, next) => {
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

app.get('/api/v1/projects/:projectId/change-orders', authenticateToken, async (req, res, next) => {
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

app.put('/api/v1/change-orders/:id/approve', authenticateToken, async (req, res, next) => {
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

// ERROR HANDLER
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// START SERVER
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ BuildPro API (Complete) running on port ${PORT}`);
  console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔧 All 10 modules loaded`);
});

process.on('SIGTERM', () => {
  console.log('Shutting down...');
  pool.end();
  process.exit(0);
});