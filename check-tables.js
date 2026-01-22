require('dotenv').config();
const { Pool } = require('pg');

const isRemoteDatabase = process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('localhost');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isRemoteDatabase ? { rejectUnauthorized: false } : false
});

async function checkTables() {
  const client = await pool.connect();

  try {
    console.log('Checking for existing drawing-related tables...\n');

    const result = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name LIKE '%drawing%'
        OR table_name LIKE '%asi%'
      ORDER BY table_name;
    `);

    if (result.rows.length === 0) {
      console.log('✓ No existing drawing or ASI tables found. Safe to run migration.');
    } else {
      console.log('Found existing tables:');
      result.rows.forEach(row => {
        console.log(`  - ${row.table_name}`);
      });

      console.log('\nChecking table structures...\n');

      for (const row of result.rows) {
        const columns = await client.query(`
          SELECT column_name, data_type
          FROM information_schema.columns
          WHERE table_name = $1
          ORDER BY ordinal_position;
        `, [row.table_name]);

        console.log(`Table: ${row.table_name}`);
        columns.rows.forEach(col => {
          console.log(`  - ${col.column_name} (${col.data_type})`);
        });
        console.log('');
      }
    }

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    client.release();
    await pool.end();
  }
}

checkTables();
