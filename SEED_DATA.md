# BuildPro Seed Data

This document explains how to use the seed data script to populate your BuildPro database with sample data for demos and testing.

## What Gets Created

The seed script creates a fully populated sample project with realistic construction management data:

### Demo Project
- **Name**: Demo Construction Project
- **Type**: Mixed-use development (retail, office, residential)
- **Location**: 123 Main Street, San Francisco, CA 94102
- **Budget**: $5,500,000
- **Timeline**: 240 days (60 days in progress, 180 days remaining)

### Users (4 users)
| Email | Password | Role |
|-------|----------|------|
| demo@buildpro.com | demo123 | Project Manager |
| sarah@buildpro.com | demo123 | Engineer |
| mike@buildpro.com | demo123 | Superintendent |
| emily@buildpro.com | demo123 | Subcontractor |

### Populated Data Across All Modules

#### Documents (7 items)
- Project Plans - Architectural.pdf
- Building Permit Application.pdf
- Safety Plan 2024.pdf
- Contract - General Contractor.pdf
- Weekly Progress Report.pdf
- Material Specifications.pdf
- Change Order #001.pdf

*All documents are mock PDFs generated with realistic titles and content*

#### RFIs (5 items)
- Foundation Depth Clarification (High Priority, Open)
- Electrical Panel Location (Critical Priority, Open)
- Window Schedule Revision (Medium Priority, Answered)
- Concrete Mix Design (High Priority, Answered)
- Stair Railing Detail (Low Priority, Closed)

*Includes responses from team members*

#### Drawings (3 sets)
- Architectural Plans (Set A)
- Structural Plans (Set S)
- MEP Plans (Set M)

*Each set includes mock PDF drawing sheets*

#### Photos (6 photos in 3 albums)
- Site Progress - Foundation (3 photos)
- Safety Inspections (2 photos)
- Material Deliveries (1 photo)

*All photos are mock PNG images*

#### Submittals (4 items in 2 packages)
- Structural Steel Submittals
  - Steel beam specifications (Approved)
  - Connection details (Approved as Noted)
- Mechanical Equipment Submittals
  - HVAC equipment cut sheets (Pending Review)
  - Ductwork shop drawings (Rejected)

#### Daily Logs (3 entries)
- Recent 3 days of construction activity logs
- Weather conditions, work performed, delays, safety incidents

#### Punch List (5 items)
- Touch up paint (Low, Open)
- Replace cracked tile (Medium, Open)
- Fix leaking faucet (High, In Progress)
- Adjust door alignment (Medium, Open)
- Clean roof debris (Low, Completed)

#### Financials
- **Budget Lines**: 6 cost codes totaling $5,500,000
  - General Conditions, Concrete, Metals, Finishes, Mechanical, Electrical
- **Commitments**: 3 active commitments totaling $2,910,000
  - ABC Steel Company ($1,150,000)
  - XYZ Concrete ($780,000)
  - Elite Mechanical ($980,000)
- **Change Orders**: 2 change orders totaling $73,000
  - Additional structural support ($45,000, Approved)
  - Upgrade lobby flooring ($28,000, Pending)

#### Schedule (12 tasks, 6 milestones)
- Complete task hierarchy with dependencies
- Tasks span from site prep through final inspections
- Critical path identified
- Milestones:
  - Foundation Complete (Achieved)
  - Structural Frame Complete (Achieved)
  - Building Dried-In (Pending)
  - MEP Rough-In Complete (Pending)
  - Substantial Completion (Pending)
  - Final Completion (Pending)

#### Activity Feed
- 8 recent system events across all modules
- Includes document uploads, RFI creation, task completion, milestone achievements

## How to Use

### Prerequisites

1. PostgreSQL database running
2. Database schema applied (`schema.sql`)
3. Environment variables configured (`.env` file)

### Running the Seed Script

```bash
cd backend
npm run seed
```

The script will:
1. Check if demo project already exists (prevents duplicate seeding)
2. Create 4 demo users with hashed passwords
3. Create the demo organization
4. Create the sample project with all team members
5. Generate mock PDFs and images
6. Populate all 11 modules with realistic data
7. Create activity feed events
8. Display a summary of created data

### Expected Output

```
🌱 Starting database seeding...

👤 Creating demo users...
   ✓ Created 4 users
   📧 Demo login: demo@buildpro.com / demo123

🏢 Creating demo organization...
   ✓ Created organization

🏗️  Creating demo project...
   ✓ Created project: Demo Construction Project

👥 Adding team members...
   ✓ Added 4 team members

📄 Creating documents with mock PDFs...
   ✓ Created 7 documents

[... continues for all modules ...]

✅ Database seeding completed successfully!

============================================================
📊 SEED DATA SUMMARY
============================================================
Project: Demo Construction Project (ID: 123)
Location: 123 Main Street, San Francisco, CA 94102
Budget: $5,500,000

Users created:
  • demo@buildpro.com (Password: demo123) - Project Manager
  • sarah@buildpro.com (Password: demo123) - Engineer
  • mike@buildpro.com (Password: demo123) - Superintendent
  • emily@buildpro.com (Password: demo123) - Subcontractor

Data populated:
  • 7 Documents with mock PDFs
  • 5 RFIs with responses
  • 3 Drawing sets with sheets
  • 3 Photo albums with 6 photos
  • 2 Submittal packages with 4 items
  • 3 Daily logs
  • 5 Punch list items
  • 6 Budget lines
  • 3 Commitments
  • 2 Change orders
  • 12 Schedule tasks with dependencies
  • 6 Milestones
  • Activity feed populated
============================================================

🎉 You can now log in with demo@buildpro.com to see the fully populated project!
```

### Login to See the Data

1. Start the backend server: `npm start`
2. Open the frontend application
3. Login with:
   - **Email**: `demo@buildpro.com`
   - **Password**: `demo123`
4. You'll see the "Demo Construction Project" in your project list
5. Navigate through all modules to see the populated data

## Re-Seeding

The seed script is **idempotent** and will skip seeding if it detects that the "Demo Construction Project" already exists.

To re-seed:

1. Delete the demo project through the UI or database
2. Run `npm run seed` again

Alternatively, to completely reset:

```bash
# Drop and recreate database
psql -U your_username -d postgres -c "DROP DATABASE IF EXISTS buildpro;"
psql -U your_username -d postgres -c "CREATE DATABASE buildpro;"

# Reapply schema
psql -U your_username -d buildpro -f schema.sql

# Run seed
npm run seed
```

## Use Cases

### 1. Demo Presentations
Perfect for showcasing BuildPro's features to potential clients or stakeholders. Every module is populated with realistic data.

### 2. Development Testing
Use the seed data as a baseline for testing new features without manually creating test data.

### 3. UI/UX Testing
Test dashboard analytics, reports, and visualizations with a complete dataset.

### 4. Training
Onboard new users by letting them explore a fully populated project before creating their own.

### 5. Screenshots & Documentation
Capture screenshots for documentation with real-looking data instead of empty states.

## File Generation

The seed script generates real files in the `uploads/` directory:

- **PDFs**: Generated using `pdf-lib` with realistic titles and content
- **Images**: Simple PNG images for photo albums
- **File Sizes**: Realistic file sizes for proper storage testing

All generated files are stored in the `./uploads` directory and referenced in the database with proper paths.

## Cleanup

To remove all seed data:

### Option 1: Delete Project via UI
1. Login as demo@buildpro.com
2. Navigate to project settings
3. Delete the "Demo Construction Project"

### Option 2: Database Cleanup
```sql
-- Find the demo project ID
SELECT id FROM projects WHERE name = 'Demo Construction Project';

-- Delete all related data (cascade will handle it)
DELETE FROM projects WHERE name = 'Demo Construction Project';

-- Optionally delete demo users
DELETE FROM users WHERE email LIKE '%@buildpro.com';
```

### Option 3: Clean Files
```bash
# Remove generated files
rm -rf backend/uploads/demo-*
rm -rf backend/uploads/photo-*
rm -rf backend/uploads/drawing-*
```

## Troubleshooting

### Error: "Demo project already exists"
**Solution**: The project already exists. Delete it first or skip seeding.

### Error: "Cannot connect to database"
**Solution**: Check your `.env` file and ensure PostgreSQL is running.

### Error: "Permission denied writing to uploads/"
**Solution**: Ensure the `uploads/` directory exists and has write permissions.

### Error: "Missing pdf-lib dependency"
**Solution**: Run `npm install` to install all dependencies including pdf-lib.

### Files not showing in UI
**Solution**:
- Check that `STORAGE_TYPE=local` in `.env`
- Verify files exist in `./uploads` directory
- Ensure Express is serving static files from uploads directory

## Customization

To customize the seed data, edit `seed.js`:

- **Change project details**: Modify the project INSERT statement (line ~150)
- **Add more users**: Add entries to the users INSERT
- **Modify financial amounts**: Update budget_lines, commitments, change_orders
- **Adjust timeline**: Change task dates and durations
- **Add more documents**: Extend the documents array

After making changes, run `npm run seed` to apply them.

## Support

For issues or questions about seed data:
1. Check this documentation first
2. Review the console output when running seed
3. Check database logs for errors
4. Open an issue on GitHub with the error message

---

**Happy Building! 🏗️**
