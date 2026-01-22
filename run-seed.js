#!/usr/bin/env node
/**
 * Run Seed Script Against Production Database
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." node run-seed.js
 */

require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const fs = require('fs');
const path = require('path');
const { PDFDocument, rgb } = require('pdf-lib');
const { v4: uuidv4 } = require('uuid');

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('❌ Error: DATABASE_URL environment variable is required');
  console.error('\nUsage:');
  console.error('  DATABASE_URL="postgresql://..." node run-seed.js');
  process.exit(1);
}

const sslConfig = DATABASE_URL.includes('localhost')
  ? false
  : { rejectUnauthorized: false };

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: sslConfig
});

// Helper to generate mock PDF
async function generateMockPDF(title, content) {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([612, 792]);
  const { height } = page.getSize();

  page.drawText(title, {
    x: 50,
    y: height - 50,
    size: 20,
    color: rgb(0, 0, 0),
  });

  page.drawText(content, {
    x: 50,
    y: height - 100,
    size: 12,
    color: rgb(0.2, 0.2, 0.2),
  });

  return await pdfDoc.save();
}

async function runSeed() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    console.log('🌱 Starting database seeding...\n');

    // Check if demo project already exists
    const existingDemo = await client.query(
      "SELECT id FROM projects WHERE name = 'Demo Construction Project'"
    );

    if (existingDemo.rows.length > 0) {
      console.log('⚠️  Demo project already exists. Skipping seed.');
      console.log('   To re-seed, delete the demo project first.\n');
      await client.query('ROLLBACK');
      return;
    }

    // Create uploads directory
    const uploadsDir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    // Create demo users
    console.log('👤 Creating demo users...');
    const demoPassword = await bcrypt.hash('demo123', 10);

    const userResult = await client.query(
      `INSERT INTO users (first_name, last_name, email, password_hash)
       VALUES
         ('John', 'Smith', 'demo@buildpro.com', $1),
         ('Sarah', 'Johnson', 'sarah@buildpro.com', $1),
         ('Mike', 'Chen', 'mike@buildpro.com', $1),
         ('Emily', 'Davis', 'emily@buildpro.com', $1)
       ON CONFLICT (email) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name
       RETURNING id, first_name, last_name, email`,
      [demoPassword]
    );

    const [demoUser, sarah, mike, emily] = userResult.rows;
    console.log(`   ✓ Created ${userResult.rows.length} users`);
    console.log(`   📧 Demo login: demo@buildpro.com / demo123\n`);

    // Create demo organization
    console.log('🏢 Creating demo organization...');
    const orgResult = await client.query(
      `INSERT INTO organizations (name, created_by)
       VALUES ('BuildPro Construction LLC', $1)
       RETURNING id`,
      [demoUser.id]
    );
    const orgId = orgResult.rows[0].id;
    console.log(`   ✓ Created organization\n`);

    // Create demo project
    console.log('🏗️  Creating demo project...');
    const projectResult = await client.query(
      `INSERT INTO projects (name, description, location, status, start_date, end_date, budget, owner_id, organization_id)
       VALUES (
         'Demo Construction Project',
         'A comprehensive mixed-use development featuring retail, office, and residential spaces.',
         '123 Main Street, San Francisco, CA 94102',
         'active',
         CURRENT_DATE - INTERVAL '60 days',
         CURRENT_DATE + INTERVAL '180 days',
         5500000,
         $1,
         $2
       )
       RETURNING id`,
      [demoUser.id, orgId]
    );
    const projectId = projectResult.rows[0].id;
    console.log(`   ✓ Created project: Demo Construction Project\n`);

    // Add team members
    console.log('👥 Adding team members...');
    await client.query(
      `INSERT INTO project_members (project_id, user_id, role)
       VALUES
         ($1, $2, 'project_manager'),
         ($1, $3, 'engineer'),
         ($1, $4, 'superintendent'),
         ($1, $5, 'subcontractor')`,
      [projectId, demoUser.id, sarah.id, mike.id, emily.id]
    );
    console.log(`   ✓ Added 4 team members\n`);

    // Create documents
    console.log('📄 Creating sample documents...');
    const documents = [
      { name: 'Project Plans.pdf', category: 'Drawings', size: 2456789 },
      { name: 'Building Permit.pdf', category: 'Permits', size: 1234567 },
      { name: 'Safety Plan.pdf', category: 'Safety Documents', size: 987654 },
      { name: 'Contract.pdf', category: 'Contracts', size: 3456789 },
      { name: 'Progress Report.pdf', category: 'Reports', size: 654321 }
    ];

    for (const doc of documents) {
      const pdfBytes = await generateMockPDF(
        doc.name,
        `This is a sample ${doc.category.toLowerCase()} document.`
      );

      const filename = `demo-${Date.now()}-${Math.random().toString(36).substr(2, 9)}.pdf`;
      const filePath = path.join(uploadsDir, filename);
      fs.writeFileSync(filePath, pdfBytes);

      await client.query(
        `INSERT INTO documents (project_id, name, category, file_path, file_size, mime_type, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, 'application/pdf', $6)`,
        [projectId, doc.name, doc.category, filePath, doc.size, demoUser.id]
      );
    }
    console.log(`   ✓ Created ${documents.length} documents\n`);

    // Create RFIs
    console.log('📋 Creating RFIs...');
    await client.query(
      `INSERT INTO rfis (project_id, rfi_number, title, question, priority, status, created_by, assigned_to)
       VALUES
         ($1, 'RFI-001', 'Foundation Depth', 'Please confirm foundation depth.', 'high', 'open', $2, $3),
         ($1, 'RFI-002', 'Electrical Panel', 'Panel location conflicts.', 'urgent', 'open', $4, $2),
         ($1, 'RFI-003', 'Window Schedule', 'Window models discontinued.', 'normal', 'answered', $2, $3)`,
      [projectId, demoUser.id, sarah.id, mike.id]
    );
    console.log(`   ✓ Created 3 RFIs\n`);

    // Create budget lines
    console.log('💰 Creating financials...');
    await client.query(
      `INSERT INTO budget_lines (project_id, code, description, budget_amount, created_by)
       VALUES
         ($1, '01000', 'General Conditions', 450000, $2),
         ($1, '03000', 'Concrete', 850000, $2),
         ($1, '05000', 'Metals', 1200000, $2),
         ($1, '09000', 'Finishes', 950000, $2),
         ($1, '15000', 'Mechanical', 1100000, $2),
         ($1, '16000', 'Electrical', 950000, $2)`,
      [projectId, demoUser.id]
    );

    await client.query(
      `INSERT INTO commitments (project_id, commitment_number, vendor_name, description, amount, commitment_date, status, created_by)
       VALUES
         ($1, 'CO-001', 'ABC Steel', 'Structural steel', 1150000, CURRENT_DATE - INTERVAL '30 days', 'approved', $2),
         ($1, 'CO-002', 'XYZ Concrete', 'Concrete supply', 780000, CURRENT_DATE - INTERVAL '25 days', 'approved', $2)`,
      [projectId, demoUser.id]
    );
    console.log(`   ✓ Created financials\n`);

    // Create schedule tasks
    console.log('📊 Creating schedule tasks...');
    await client.query(
      `INSERT INTO schedule_tasks (project_id, name, description, planned_start_date, planned_end_date, duration_days, status, priority, created_by)
       VALUES
         ($1, 'Site Preparation', 'Clear and grade', CURRENT_DATE - INTERVAL '50 days', CURRENT_DATE - INTERVAL '43 days', 7, 'completed', 'high', $2),
         ($1, 'Foundation Work', 'Excavate and pour', CURRENT_DATE - INTERVAL '42 days', CURRENT_DATE - INTERVAL '28 days', 14, 'completed', 'critical', $2),
         ($1, 'Structural Steel', 'Erect frame', CURRENT_DATE - INTERVAL '27 days', CURRENT_DATE - INTERVAL '6 days', 21, 'completed', 'critical', $2),
         ($1, 'Exterior Walls', 'Install panels', CURRENT_DATE - INTERVAL '5 days', CURRENT_DATE + INTERVAL '15 days', 20, 'in_progress', 'high', $2)`,
      [projectId, demoUser.id]
    );
    console.log(`   ✓ Created schedule tasks\n`);

    // Create milestones
    console.log('🎯 Creating milestones...');
    await client.query(
      `INSERT INTO schedule_milestones (project_id, name, description, target_date, status, created_by)
       VALUES
         ($1, 'Foundation Complete', 'Foundation work done', CURRENT_DATE - INTERVAL '28 days', 'achieved', $2),
         ($1, 'Building Dried-In', 'Exterior complete', CURRENT_DATE + INTERVAL '15 days', 'pending', $2),
         ($1, 'Final Completion', 'All work complete', CURRENT_DATE + INTERVAL '90 days', 'pending', $2)`,
      [projectId, demoUser.id]
    );
    console.log(`   ✓ Created milestones\n`);

    await client.query('COMMIT');

    console.log('✅ Database seeding completed successfully!\n');
    console.log('='.repeat(60));
    console.log('📊 SEED DATA SUMMARY');
    console.log('='.repeat(60));
    console.log(`Project: Demo Construction Project (ID: ${projectId})`);
    console.log(`Budget: $5,500,000`);
    console.log('');
    console.log('Users created:');
    console.log('  • demo@buildpro.com (Password: demo123)');
    console.log('  • sarah@buildpro.com (Password: demo123)');
    console.log('  • mike@buildpro.com (Password: demo123)');
    console.log('  • emily@buildpro.com (Password: demo123)');
    console.log('');
    console.log('Data populated:');
    console.log('  • 5 Documents with mock PDFs');
    console.log('  • 3 RFIs');
    console.log('  • 6 Budget lines');
    console.log('  • 2 Commitments');
    console.log('  • 4 Schedule tasks');
    console.log('  • 3 Milestones');
    console.log('='.repeat(60));
    console.log('');
    console.log('🎉 Log in with demo@buildpro.com to see the demo project!\n');

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Error seeding database:', error.message);
    console.error(error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

runSeed()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
