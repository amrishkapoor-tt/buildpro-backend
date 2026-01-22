require('dotenv').config();
const { Pool } = require('pg');

const isRemoteDatabase = process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('localhost');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isRemoteDatabase ? { rejectUnauthorized: false } : false
});

async function testDrawingWorkflow() {
  const client = await pool.connect();

  try {
    console.log('Testing Drawing Workflow Tables...\n');

    // Check drawing workflow states
    const workflowStates = await client.query('SELECT COUNT(*) FROM drawing_workflow_states');
    console.log(`✓ Drawing Workflow States: ${workflowStates.rows[0].count} records`);

    // Check markups
    const markups = await client.query('SELECT COUNT(*) FROM drawing_markups');
    console.log(`✓ Drawing Markups: ${markups.rows[0].count} records`);

    // Check reviews
    const reviews = await client.query('SELECT COUNT(*) FROM drawing_reviews');
    console.log(`✓ Drawing Reviews: ${reviews.rows[0].count} records`);

    // Check distributions
    const distributions = await client.query('SELECT COUNT(*) FROM drawing_distributions');
    console.log(`✓ Drawing Distributions: ${distributions.rows[0].count} records`);

    // Check ASIs
    const asis = await client.query('SELECT COUNT(*) FROM asis');
    console.log(`✓ ASIs: ${asis.rows[0].count} records`);

    // Check documents with drawing metadata
    const drawingDocs = await client.query(`
      SELECT COUNT(*)
      FROM documents
      WHERE category = 'Drawings'
    `);
    console.log(`✓ Documents categorized as Drawings: ${drawingDocs.rows[0].count} records`);

    console.log('\n✅ All tables are ready!\n');

    // Show sample data if any exists
    const sampleWorkflow = await client.query(`
      SELECT dws.*, d.name as document_name
      FROM drawing_workflow_states dws
      JOIN documents d ON dws.document_id = d.id
      ORDER BY dws.created_at DESC
      LIMIT 3
    `);

    if (sampleWorkflow.rows.length > 0) {
      console.log('Recent workflow activity:');
      sampleWorkflow.rows.forEach(row => {
        console.log(`  - ${row.document_name}: ${row.workflow_state}`);
      });
    } else {
      console.log('No workflow activity yet. Start testing!');
    }

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    client.release();
    await pool.end();
  }
}

testDrawingWorkflow();
