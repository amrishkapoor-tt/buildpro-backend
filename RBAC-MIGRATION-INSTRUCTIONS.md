# RBAC Migration Instructions

## What This Migration Does

This migration adds Role-Based Access Control (RBAC) enhancements to your BuildPro production database:

1. **Creates `audit_logs` table** (if it doesn't exist)
   - Tracks all team management actions for security compliance
   - Required for add/remove/change role operations

2. **Adds project ownership columns** to `projects` table
   - `created_by` - User who created the project
   - `owner_user_id` - Current project owner
   - Future-proofing for ownership transfer features

3. **Creates performance indexes**
   - Optimizes queries for audit logs and project ownership

## Is This Migration Safe?

✅ **YES - 100% SAFE**

- Uses `IF NOT EXISTS` clauses - won't fail if columns already exist
- Uses `BEGIN/COMMIT` transaction - rolls back on any error
- Read-only checks before making changes
- Can be run multiple times without issues

## How to Run

### Option 1: Local Database (Development)

```bash
cd backend
export DATABASE_URL="postgresql://localhost:5432/buildpro"
node run-rbac-migration.js
```

### Option 2: Production Database

```bash
cd backend
DATABASE_URL="your-production-database-url" node run-rbac-migration.js
```

**Example with Render PostgreSQL:**
```bash
DATABASE_URL="postgresql://user:pass@dpg-xxxxx.oregon-postgres.render.com/dbname" node run-rbac-migration.js
```

## Expected Output

```
📊 RBAC Migration
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Database: buildpro @ localhost:5432
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔍 Step 1/3: Checking for audit_logs table...
   ✅ audit_logs table exists

🔍 Step 2/3: Checking projects table columns...
   ℹ️  No ownership columns found - will add

🚀 Step 3/3: Applying RBAC migration...
   This is SAFE - uses IF NOT EXISTS clauses

   📝 Adding project ownership columns...
   ✅ Columns added
   📝 Creating indexes for performance...
   ✅ Indexes created

🔍 Verifying migration...

✅ Migration completed successfully!

📋 Projects table now has:
   - created_by (uuid)
   - owner_user_id (uuid)

✅ audit_logs table is ready

🎉 RBAC system is now fully configured!
```

## Troubleshooting

### Error: "DATABASE_URL environment variable is required"
**Solution:** Make sure you're setting the DATABASE_URL when running the script.

### Error: "relation 'users' does not exist"
**Solution:** Your database schema is incomplete. Run the main schema.sql first.

### Error: "permission denied"
**Solution:** Your database user needs CREATE TABLE and ALTER TABLE permissions.

## After Migration

1. **Deploy backend** - Push your code to production (Render/Railway/etc.)
2. **Deploy frontend** - Push frontend code to production
3. **Test the system:**
   - Login as a user
   - Go to Team tab
   - Try adding a team member
   - Try changing roles
   - Try removing a member

## Rollback (if needed)

If you need to undo the migration:

```sql
-- Remove ownership columns
ALTER TABLE projects DROP COLUMN IF EXISTS created_by;
ALTER TABLE projects DROP COLUMN IF EXISTS owner_user_id;

-- Remove audit_logs table (only if you don't need it)
DROP TABLE IF EXISTS audit_logs;
```

**Note:** Only rollback if absolutely necessary. The columns are non-breaking and future-proof.

## Questions?

The migration is designed to be safe and idempotent. You can run it multiple times without issues.
