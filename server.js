// ============================================================================
// BUILDPRO - PRODUCTION BACKEND (MVP + Core Modules)
// This file includes: Auth, Projects, Documents, RFIs, Team Management
// Deploy this first, then add remaining modules incrementally
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
  console.error('❌ ERROR: DATABASE_URL not set');
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

pool.connect((err, client, release) => {
  if (err) {
    console.error('❌ Database connection error:', err.stack);
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
    if (extname) {
      return cb(null, true);
    }
    cb(new Error('Invalid file type'));
  }
});

app.use(cors({ origin: process.env.CORS_ORIGIN || '*', credentials: true }));
app.use(express.json());
app.use('/uploads', express.static('uploads'));

app.get('/', (req, res) => {
  res.json({ 
    message: 'BuildPro API is running',
    version: '1.0.0',
    environment: process.env.NODE_ENV,
    modules: ['auth', 'projects', 'documents', 'rfis', 'team']
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

// AUTH ROUTES
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

// PROJECT ROUTES
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

app.get('/api/v1/projects/:id', authenticateToken, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT p.*, pm.role as user_role FROM projects p
       JOIN project_members pm ON p.id = pm.project_id
       WHERE p.id = $1 AND pm.user_id = $2`,
      [req.params.id, req.user.userId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Project not found' });
    res.json({ project: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

// DOCUMENT ROUTES
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

// RFI ROUTES
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
    const { status, ball_in_court } = req.body;
    const validTransitions = { 'draft': ['open'], 'open': ['answered', 'closed'], 'answered': ['closed'], 'closed': [] };
    
    const currentResult = await pool.query('SELECT status, project_id FROM rfis WHERE id = $1', [req.params.id]);
    if (currentResult.rows.length === 0) return res.status(404).json({ error: 'RFI not found' });

    const currentStatus = currentResult.rows[0].status;
    if (!validTransitions[currentStatus].includes(status)) {
      return res.status(400).json({ error: `Cannot transition from ${currentStatus} to ${status}` });
    }

    const result = await pool.query(
      `UPDATE rfis SET status = $1, ball_in_court = COALESCE($2, ball_in_court), updated_at = CURRENT_TIMESTAMP
       WHERE id = $3 RETURNING *`,
      [status, ball_in_court, req.params.id]
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

    await emitEvent('rfi.response_added', 'rfi', req.params.id, rfiResult.rows[0].project_id, req.user.userId, { response_id: result.rows[0].id });
    res.status(201).json({ response: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

// TEAM ROUTES
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

app.post('/api/v1/projects/:projectId/members', authenticateToken, checkPermission('project_manager'), async (req, res, next) => {
  try {
    const { user_id, role, permissions } = req.body;
    const result = await pool.query(
      `INSERT INTO project_members (project_id, user_id, role, permissions)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (project_id, user_id) DO UPDATE SET role = $3, permissions = $4
       RETURNING *`,
      [req.params.projectId, user_id, role, JSON.stringify(permissions || {})]
    );

    await createNotification(user_id, 'assignment', 'Added to Project', `You have been added as ${role}`, 'project', req.params.projectId);
    res.status(201).json({ member: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

// EVENTS & NOTIFICATIONS
app.get('/api/v1/events', authenticateToken, async (req, res, next) => {
  try {
    const { since, project_id, event_type, limit = 100 } = req.query;
    let query = 'SELECT * FROM system_events WHERE 1=1';
    const params = [];
    
    if (since) { params.push(since); query += ` AND created_at > $${params.length}`; }
    if (project_id) { params.push(project_id); query += ` AND project_id = $${params.length}`; }
    if (event_type) { params.push(event_type); query += ` AND event_type = $${params.length}`; }
    
    query += ` ORDER BY created_at DESC LIMIT ${parseInt(limit)}`;
    const result = await pool.query(query, params);
    res.json({ events: result.rows });
  } catch (error) {
    next(error);
  }
});

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

app.put('/api/v1/notifications/:id/read', authenticateToken, async (req, res, next) => {
  try {
    await pool.query('UPDATE notifications SET is_read = true WHERE id = $1 AND user_id = $2', [req.params.id, req.user.userId]);
    res.json({ success: true });
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
  console.log(`✅ BuildPro API running on port ${PORT}`);
  console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
});

process.on('SIGTERM', () => {
  console.log('Shutting down gracefully...');
  pool.end();
  process.exit(0);
});