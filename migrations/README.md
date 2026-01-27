# Database Migrations Guide

## Overview

BuildPro uses a **simple check-and-run migration system** that runs automatically on server startup. Migrations are executed **only if their tables don't already exist** in the database.

## How It Works

1. **Server starts** → Database connects
2. **Migration checker runs** (`services/run-migrations.js`)
3. **Checks if tables exist** (one table per migration as a proxy)
4. **If tables missing** → Runs the SQL migration file
5. **If tables exist** → Skips migration (fast startup)

## Current Migrations

| File | Check Table | Purpose | Status |
|------|-------------|---------|--------|
| `009_workflow_engine.sql` | `workflow_templates` | Workflow engine tables, views, functions | ✅ Active |

## Adding a New Migration

### Step 1: Create the Migration File

Create a new `.sql` file in `migrations/` folder:

```bash
migrations/010_your_feature_name.sql
```

**Naming Convention:**
- Number it sequentially (010, 011, 012, etc.)
- Use descriptive name
- Use underscores (not spaces)
- Examples: `010_notifications.sql`, `011_file_versioning.sql`

### Step 2: Write the Migration SQL

```sql
-- ============================================================================
-- YOUR FEATURE NAME MIGRATION
-- Version: 1.0
-- Purpose: Brief description of what this migration does
-- ============================================================================

BEGIN;

-- Create tables
CREATE TABLE IF NOT EXISTS your_new_table (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_your_table_name ON your_new_table(name);

-- Seed data (if needed)
INSERT INTO your_new_table (name) VALUES ('Initial Data')
ON CONFLICT DO NOTHING;

COMMIT;
```

**Important Guidelines:**
- ✅ Always wrap in `BEGIN;` and `COMMIT;`
- ✅ Use `IF NOT EXISTS` for tables, indexes, and views
- ✅ Use `ON CONFLICT DO NOTHING` for seed data inserts
- ✅ Test locally before deploying to production
- ❌ Never use `DROP TABLE` unless absolutely necessary
- ❌ Don't modify existing tables without careful consideration

### Step 3: Update the Migration Runner

Edit `services/run-migrations.js` and add a new check:

```javascript
async function runMigrations(pool) {
  console.log('🔍 Checking for pending migrations...');
  const client = await pool.connect();

  try {
    // ========================================
    // MIGRATION 009: Workflow Engine
    // ========================================
    const workflowCheck = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = 'workflow_templates'
      );
    `);

    if (!workflowCheck.rows[0].exists) {
      console.log('📊 Running migration 009: Workflow Engine...');
      const sql009 = fs.readFileSync(
        path.join(__dirname, '..', 'migrations', '009_workflow_engine.sql'),
        'utf8'
      );
      await client.query(sql009);
      console.log('✅ Migration 009 completed');
    }

    // ========================================
    // MIGRATION 010: Your New Feature
    // ========================================
    const yourFeatureCheck = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = 'your_main_table_name'
      );
    `);

    if (!yourFeatureCheck.rows[0].exists) {
      console.log('📊 Running migration 010: Your New Feature...');
      const sql010 = fs.readFileSync(
        path.join(__dirname, '..', 'migrations', '010_your_feature_name.sql'),
        'utf8'
      );
      await client.query(sql010);
      console.log('✅ Migration 010 completed');
    }

    console.log('✅ All migrations up to date');

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error('⚠️  Server will continue but new features may not work');
  } finally {
    client.release();
  }
}
```

**Key Points:**
- Choose a **main table** from your migration to check for existence
- This table should be **unique** to your migration
- If this table exists, we assume the entire migration has been applied
- Use sequential numbering (009, 010, 011, etc.)

### Step 4: Test Locally

**Before deploying to production, ALWAYS test locally:**

```bash
# 1. Drop the test tables (local database only!)
psql -d buildpro -c "DROP TABLE IF EXISTS your_new_table CASCADE;"

# 2. Restart the server
npm start

# 3. Check the logs - you should see:
# 📊 Running migration 010: Your New Feature...
# ✅ Migration 010 completed

# 4. Verify tables were created
psql -d buildpro -c "\dt your_new_table"

# 5. Restart server again - migration should be skipped:
# ✅ All migrations up to date
```

### Step 5: Deploy to Production

```bash
# 1. Commit your changes
git add migrations/010_your_feature_name.sql
git add services/run-migrations.js
git commit -m "Add migration 010: Your Feature Name"
git push

# 2. Render auto-deploys backend
# 3. Watch Render logs for migration success
# 4. Verify tables exist in production database
```

## Testing New Migrations

### Local Testing Checklist

- [ ] Migration SQL file has `BEGIN;` and `COMMIT;`
- [ ] All `CREATE TABLE` statements use `IF NOT EXISTS`
- [ ] All `CREATE INDEX` statements use `IF NOT EXISTS`
- [ ] Seed data uses `ON CONFLICT DO NOTHING`
- [ ] Migration runner updated with existence check
- [ ] Tested with fresh database (tables don't exist)
- [ ] Tested with existing database (tables already exist)
- [ ] Server starts successfully both times
- [ ] No errors in console logs

### Production Deployment Checklist

- [ ] Tested locally first
- [ ] Migration file committed to git
- [ ] Migration runner updated
- [ ] Pushed to GitHub
- [ ] Render deployment triggered
- [ ] Watched Render logs for success
- [ ] Verified tables in production database
- [ ] Tested affected features in production UI

## Troubleshooting

### Migration Fails on Server Startup

**Symptom:** Server logs show migration error but server continues running

**Cause:** SQL syntax error or database permission issue

**Solution:**
1. Check Render logs for exact error message
2. Fix SQL syntax in migration file
3. Test locally to reproduce
4. Redeploy with fix

### Tables Already Exist Error

**Symptom:** Error like `relation "table_name" already exists`

**Cause:** Migration file doesn't use `IF NOT EXISTS`

**Solution:**
```sql
-- ❌ Wrong
CREATE TABLE my_table (...);

-- ✅ Correct
CREATE TABLE IF NOT EXISTS my_table (...);
```

### Migration Runs Every Time

**Symptom:** Migration runs on every server restart

**Cause:** Check table doesn't match actual table name

**Solution:**
- Verify table name matches exactly (case-sensitive)
- Check table was actually created in previous run
- Query database to confirm: `SELECT tablename FROM pg_tables WHERE tablename = 'your_table';`

### Migration Not Running

**Symptom:** New tables not created in production

**Cause 1:** Migration runner not updated
**Solution:** Add the new migration check to `services/run-migrations.js`

**Cause 2:** Check table already exists
**Solution:** The system thinks migration already ran. Manually run SQL or drop check table.

**Cause 3:** Code not deployed
**Solution:** Verify latest commit is deployed on Render

## Manual Migration Execution

If automatic migration fails, you can run manually:

### Via Render Shell

```bash
# 1. Open Render Shell for your backend service
# 2. Connect to database
psql $DATABASE_URL

# 3. Run migration manually
\i migrations/010_your_feature_name.sql

# 4. Verify
\dt your_new_table
\q
```

### Via Local Script

```bash
# Run a specific migration file
node -e "
const { Pool } = require('pg');
const fs = require('fs');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
(async () => {
  const sql = fs.readFileSync('./migrations/010_your_feature_name.sql', 'utf8');
  await pool.query(sql);
  console.log('Migration completed');
  await pool.end();
})();
"
```

## Best Practices

### DO ✅

- **Always test locally first** before deploying to production
- **Use IF NOT EXISTS** for all CREATE statements
- **Use transactions** (BEGIN/COMMIT) to ensure atomicity
- **Add comments** explaining what each migration does
- **Number migrations sequentially** (009, 010, 011...)
- **Choose unique check tables** that won't conflict
- **Keep migrations idempotent** (safe to run multiple times)
- **Document schema changes** in this README

### DON'T ❌

- **Don't modify production database manually** without updating migration files
- **Don't skip local testing** - always verify before deploying
- **Don't use DROP TABLE** unless absolutely necessary
- **Don't change existing migrations** after they've been deployed
- **Don't forget to update run-migrations.js** when adding new migrations
- **Don't deploy during high traffic** if migration is heavy
- **Don't assume migration will work** - always watch the logs

## Migration History

### 009_workflow_engine.sql (January 2026)

**Purpose:** Complete workflow engine implementation

**Tables Created:**
- `workflow_templates` - Workflow template definitions
- `workflow_stages` - Stages within workflows
- `workflow_transitions` - Allowed transitions between stages
- `workflow_instances` - Active workflow executions
- `workflow_instance_history` - Audit trail of actions
- `workflow_assignments` - User assignments per stage
- `workflow_escalations` - Escalation tracking
- `workflow_sla_violations` - SLA violation tracking
- `workflow_entity_mapping` - Legacy status mapping

**Views Created:**
- `active_workflow_tasks` - All active user tasks
- `workflow_performance_metrics` - Performance analytics

**Functions Created:**
- `get_workflow_for_entity()` - Get workflow for entity
- `get_user_pending_tasks_count()` - Count user's tasks

**Seed Data:**
- 6 default workflow templates (Submittals, RFIs, Change Orders, etc.)
- 4 stages for standard submittal workflow
- 3 transitions for submittal workflow

**Check Table:** `workflow_templates`

---

## Need Help?

If you're stuck or unsure:

1. **Check this README** for examples and troubleshooting
2. **Look at existing migrations** (like `009_workflow_engine.sql`) for reference
3. **Test locally first** - it's free to experiment on your local database
4. **Watch the logs** - they'll tell you what's happening
5. **Ask for review** before deploying major schema changes

Remember: **Database migrations are permanent**. Take your time, test thoroughly, and document everything!
