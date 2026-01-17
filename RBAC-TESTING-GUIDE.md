# RBAC Testing Guide

## Complete Test Plan to Verify Role-Based Access Control

This guide will help you verify that the RBAC system is working correctly by testing different user roles and permissions.

---

## Role Permissions Reference

This section explicitly lists what each role can and cannot do across all modules.

### Role Hierarchy
Roles inherit permissions from lower roles:
- **Level 1:** Viewer (Read-only)
- **Level 2:** Subcontractor (+ Basic creation)
- **Level 3:** Engineer (+ Technical management)
- **Level 4:** Superintendent (+ Verification & deletion)
- **Level 5:** Project Manager (+ Team & budget management)
- **Level 6:** Admin (Full access)

---

### 1. Viewer (Level 1) - Read-Only Access

#### ✅ CAN DO:
- View all documents, folders, and files
- View all RFIs and their responses
- View all submittals and their status
- View daily logs
- View punch list items
- View schedule and tasks
- View photos and albums
- View drawings
- View team members and their roles
- View role information

#### ❌ CANNOT DO:
- Upload or delete documents
- Create or edit folders
- Create, edit, or respond to RFIs
- Change RFI status
- Create submittals or review them
- Create or edit daily logs
- Create, verify, or close punch items
- Create or edit schedule tasks
- Upload or delete photos
- Create albums
- Upload or delete drawings
- View financials/budget
- Create change events
- Approve change orders
- Add or remove team members
- Change team member roles

---

### 2. Subcontractor (Level 2) - Basic Creation Rights

#### ✅ CAN DO (Everything Viewer can do, PLUS):
- **Documents:** Upload documents (but cannot delete)
- **RFIs:** Create RFIs and add responses
- **Submittals:** Create submittal packages and submittals
- **Daily Logs:** Create and edit daily logs
- **Photos:** Upload photos to existing albums
- **Drawings:** Create markups on drawings

#### ❌ CANNOT DO:
- **Documents:** Delete documents, create folders
- **RFIs:** Change RFI status (open/close)
- **Submittals:** Approve submittals
- **Schedule:** Create or edit tasks
- **Punch List:** Create, verify, or close punch items
- **Photos:** Create albums, delete photos
- **Drawings:** Upload drawing sets, delete drawings
- **Financials:** View budget, create change events, approve change orders
- **Team:** Add/remove members, change roles

---

### 3. Engineer (Level 3) - Technical Management

#### ✅ CAN DO (Everything Subcontractor can do, PLUS):
- **Documents:** Create folders, edit document metadata
- **RFIs:** Change RFI status (mark as answered, closed)
- **Schedule:** Create, edit, and delete tasks
- **Punch List:** Create punch items (but cannot verify or close)
- **Photos:** Create albums
- **Drawings:** Upload drawing sets and sheets
- **Financials:** Create change events
- **Daily Logs:** Edit any daily logs

#### ❌ CANNOT DO:
- **Documents:** Delete documents
- **Submittals:** Approve submittals
- **Punch List:** Verify or close punch items
- **Photos:** Delete photos
- **Drawings:** Delete drawings
- **Financials:** View full budget, edit budget, approve change orders
- **Team:** Add/remove members, change roles
- **Schedule:** Create baselines

---

### 4. Superintendent (Level 4) - Verification & Deletion Rights

#### ✅ CAN DO (Everything Engineer can do, PLUS):
- **Documents:** Delete documents
- **Submittals:** Approve submittals
- **Punch List:** Verify and close punch items
- **Photos:** Delete photos
- **Drawings:** Delete drawings
- **Financials:** View budget summary

#### ❌ CANNOT DO:
- **Financials:** Edit budget, approve change orders
- **Team:** Add/remove members, change roles
- **Schedule:** Create baselines

---

### 5. Project Manager (Level 5) - Team & Budget Management

#### ✅ CAN DO (Everything Superintendent can do, PLUS):
- **Team Management:**
  - Add team members to project
  - Remove team members from project
  - Change team member roles
  - Search for users in system
- **Financials:**
  - View full budget details
  - Edit budget lines
  - Approve change orders
  - Convert change events to change orders
- **Schedule:** Create baselines

#### ❌ CANNOT DO:
- Nothing - Project Managers have full access except Admin-level system settings

---

### 6. Admin (Level 6) - Full System Access

#### ✅ CAN DO:
- Everything a Project Manager can do
- System-wide administration (if implemented)
- Manage organization settings (if implemented)

---

## Permission Matrix by Module

### 📄 Documents Module
| Action | Viewer | Subcontractor | Engineer | Superintendent | PM | Admin |
|--------|--------|---------------|----------|----------------|-----|-------|
| View documents | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Upload documents | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Create folders | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ |
| Edit documents | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ |
| Delete documents | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ |

### 📝 RFIs Module
| Action | Viewer | Subcontractor | Engineer | Superintendent | PM | Admin |
|--------|--------|---------------|----------|----------------|-----|-------|
| View RFIs | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Create RFIs | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Respond to RFIs | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Change RFI status | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ |

### 📋 Submittals Module
| Action | Viewer | Subcontractor | Engineer | Superintendent | PM | Admin |
|--------|--------|---------------|----------|----------------|-----|-------|
| View submittals | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Create submittals | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Submit for review | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Approve submittals | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ |

### 📅 Daily Logs Module
| Action | Viewer | Subcontractor | Engineer | Superintendent | PM | Admin |
|--------|--------|---------------|----------|----------------|-----|-------|
| View logs | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Create logs | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Edit own logs | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Edit any logs | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ |

### 🔨 Punch List Module
| Action | Viewer | Subcontractor | Engineer | Superintendent | PM | Admin |
|--------|--------|---------------|----------|----------------|-----|-------|
| View punch items | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Create punch items | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ |
| Update status (open/in progress/completed) | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ |
| Verify punch items | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ |
| Close punch items | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ |

### 📅 Schedule Module
| Action | Viewer | Subcontractor | Engineer | Superintendent | PM | Admin |
|--------|--------|---------------|----------|----------------|-----|-------|
| View schedule | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Create tasks | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ |
| Edit tasks | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ |
| Delete tasks | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ |
| Create baselines | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |

### 📸 Photos Module
| Action | Viewer | Subcontractor | Engineer | Superintendent | PM | Admin |
|--------|--------|---------------|----------|----------------|-----|-------|
| View photos | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Upload photos | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Create albums | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ |
| Delete photos | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ |

### 📐 Drawings Module
| Action | Viewer | Subcontractor | Engineer | Superintendent | PM | Admin |
|--------|--------|---------------|----------|----------------|-----|-------|
| View drawings | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Create markups | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Upload drawings | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ |
| Delete drawings | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ |

### 💰 Financials Module
| Action | Viewer | Subcontractor | Engineer | Superintendent | PM | Admin |
|--------|--------|---------------|----------|----------------|-----|-------|
| View budget | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ |
| Edit budget | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |
| Create change events | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ |
| Approve change orders | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |

### 👥 Team Management Module
| Action | Viewer | Subcontractor | Engineer | Superintendent | PM | Admin |
|--------|--------|---------------|----------|----------------|-----|-------|
| View team members | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Add members | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |
| Remove members | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |
| Change roles | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |

---

## Prerequisites

1. ✅ Migration has been run (`run-rbac-migration.js`)
2. ✅ Backend deployed to production
3. ✅ Frontend deployed to production
4. ✅ At least 2 test users registered (to test team management)

---

## Test Setup: Create Test Users

You'll need users with different roles to test properly.

### Step 1: Register Test Users

Create these test accounts through your app's registration:

1. **Test User 1** (Will be Project Manager)
   - Email: `pm-test@example.com`
   - Password: `test123456`

2. **Test User 2** (Will be Engineer)
   - Email: `engineer-test@example.com`
   - Password: `test123456`

3. **Test User 3** (Will be Viewer)
   - Email: `viewer-test@example.com`
   - Password: `test123456`

### Step 2: Create a Test Project

1. Login as Test User 1
2. Create a new project: "RBAC Test Project"
3. Note the project ID from the URL

---

## Frontend Testing (Easiest - Use the UI)

### Test 1: Team Management UI (Project Manager)

**Login as:** Test User 1 (pm-test@example.com)

**Expected Behavior:**
- ✅ You should see "Add Member" button
- ✅ You should see "Role Info" button
- ✅ Your role badge should show "Project Manager"

**Actions to Test:**

1. **Click "Role Info" button**
   - ✅ Modal should open showing all 6 roles with descriptions
   - ✅ Should show hierarchy: Viewer(1) → Subcontractor(2) → Engineer(3) → Superintendent(4) → PM(5) → Admin(6)

2. **Click "Add Member" button**
   - ✅ Modal should open with search field
   - ✅ Type "engineer" in search box
   - ✅ Should show search results with engineer-test@example.com
   - ✅ Click the user to select them
   - ✅ Select role: "Engineer"
   - ✅ Click "Add Member"
   - ✅ Should add user and refresh the list
   - ✅ New member should appear with "Engineer" badge

3. **Add Third User as Viewer**
   - ✅ Click "Add Member" again
   - ✅ Search for viewer-test@example.com
   - ✅ Select role: "Viewer"
   - ✅ Add the member
   - ✅ Should appear with gray "Viewer" badge

4. **Change Member Role**
   - ✅ Find the Engineer user in the list
   - ✅ Click the role dropdown (should be enabled)
   - ✅ Change to "Superintendent"
   - ✅ Badge should update immediately to orange "Superintendent"

5. **Try to Remove Yourself**
   - ✅ Find your own entry (should have green dot indicator)
   - ✅ Should NOT have a trash/remove button
   - ✅ Your role dropdown should be disabled (grayed out)

6. **Remove a Member**
   - ✅ Find viewer-test@example.com
   - ✅ Click the red trash icon
   - ✅ Confirmation dialog should appear
   - ✅ Confirm removal
   - ✅ User should disappear from list

---

### Test 2: Viewer Permissions (Read-Only)

**Logout and login as:** Test User 3 (viewer-test@example.com)

**Add yourself back to the project:**
- Ask Test User 1 to add you back as "Viewer"

**Expected Behavior:**

1. **Team Tab**
   - ❌ "Add Member" button should NOT appear
   - ✅ "Role Info" button should appear
   - ✅ Should see all team members
   - ❌ Role dropdowns should NOT be editable (display only)
   - ❌ No trash icons for removing members

2. **Documents Tab**
   - ❌ "Upload Document" button should NOT appear
   - ❌ "New Folder" button should NOT appear
   - ✅ Can view existing documents
   - ❌ Cannot delete documents

3. **RFIs Tab**
   - ❌ "New RFI" button should NOT appear
   - ✅ Can view existing RFIs
   - ❌ Cannot change RFI status

4. **Schedule Tab**
   - ❌ "New Task" button should NOT appear
   - ✅ Can view schedule
   - ❌ Cannot edit tasks

5. **Financials Tab**
   - ❌ Should get "Access Denied" or not see financial data
   - Budget section should be hidden or show permission error

**Test Result:** If trying to perform any restricted action, you should get a 403 error in browser console (check Developer Tools → Network tab).

---

### Test 3: Engineer Permissions (Mid-Level)

**Logout and login as:** Test User 2 (engineer-test@example.com)

**Expected Behavior:**

1. **Team Tab**
   - ❌ "Add Member" button should NOT appear
   - ✅ Can view team members
   - ❌ Cannot change roles or remove members

2. **Documents Tab**
   - ✅ "Upload Document" button SHOULD appear
   - ✅ "New Folder" button SHOULD appear
   - ✅ Can upload documents
   - ✅ Can edit document details
   - ❌ "Delete" button should NOT appear (or should fail with 403)

3. **RFIs Tab**
   - ✅ "New RFI" button SHOULD appear
   - ✅ Can create RFIs
   - ✅ Can change RFI status (mark as resolved, etc.)

4. **Schedule Tab**
   - ✅ "New Task" button SHOULD appear
   - ✅ Can create and edit tasks
   - ❌ "Create Baseline" should NOT appear

5. **Punch List Tab**
   - ✅ "New Punch Item" button SHOULD appear
   - ✅ Can create punch items
   - ❌ "Verify" or "Close" buttons should NOT appear (or fail with 403)

6. **Financials Tab**
   - ✅ Can create change events
   - ❌ Cannot view full budget details
   - ❌ Cannot approve change orders

---

### Test 4: Superintendent Permissions (High-Level)

**Have Test User 1 change Test User 2's role to "Superintendent"**

**Stay logged in as:** Test User 2 (now Superintendent)

**Expected Behavior:**

1. **Documents Tab**
   - ✅ All engineer permissions PLUS
   - ✅ "Delete" button SHOULD now appear
   - ✅ Can delete documents

2. **Punch List Tab**
   - ✅ "Verify" button SHOULD appear
   - ✅ "Close" button SHOULD appear
   - ✅ Can verify and close punch items

3. **Financials Tab**
   - ✅ Can view budget summary
   - ✅ Can view change events
   - ❌ Cannot edit budget directly
   - ❌ Cannot approve change orders

---

## Backend API Testing (Advanced - Use Postman/cURL)

### Setup: Get Your Token

1. Login through the UI
2. Open Browser DevTools → Application → Local Storage
3. Copy the value of `buildpro_token`

### Test 5: Permission Enforcement on API

**Test A: Viewer tries to upload document (should fail)**

```bash
curl -X POST https://buildpro-api.onrender.com/api/v1/projects/YOUR_PROJECT_ID/documents \
  -H "Authorization: Bearer VIEWER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "Test Doc"}' \
  -v
```

**Expected Response:** `403 Forbidden`
```json
{
  "error": "Insufficient permissions. Requires subcontractor role or higher.",
  "user_role": "viewer",
  "required_role": "subcontractor"
}
```

---

**Test B: Engineer tries to delete document (should fail)**

```bash
curl -X DELETE https://buildpro-api.onrender.com/api/v1/documents/DOCUMENT_ID \
  -H "Authorization: Bearer ENGINEER_TOKEN" \
  -v
```

**Expected Response:** `403 Forbidden`
```json
{
  "error": "Insufficient permissions. Requires superintendent role or higher."
}
```

---

**Test C: Engineer tries to add team member (should fail)**

```bash
curl -X POST https://buildpro-api.onrender.com/api/v1/projects/YOUR_PROJECT_ID/members \
  -H "Authorization: Bearer ENGINEER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"user_id": "some-user-id", "role": "viewer"}' \
  -v
```

**Expected Response:** `403 Forbidden`
```json
{
  "error": "Insufficient permissions. Requires project_manager role or higher."
}
```

---

**Test D: Project Manager adds member (should succeed)**

```bash
curl -X POST https://buildpro-api.onrender.com/api/v1/projects/YOUR_PROJECT_ID/members \
  -H "Authorization: Bearer PM_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"email": "newuser@example.com", "role": "engineer"}' \
  -v
```

**Expected Response:** `201 Created`
```json
{
  "member": {
    "id": "uuid",
    "user_id": "uuid",
    "role": "engineer",
    "first_name": "User",
    "last_name": "Name"
  }
}
```

---

**Test E: Get Role Definitions (should work for anyone)**

```bash
curl https://buildpro-api.onrender.com/api/v1/roles \
  -H "Authorization: Bearer ANY_TOKEN" \
  -v
```

**Expected Response:** `200 OK`
```json
{
  "roles": [
    {
      "name": "viewer",
      "level": 1,
      "display_name": "Viewer",
      "description": "Read-only access to project information"
    },
    ...
  ]
}
```

---

**Test F: Search Users (Project Manager only)**

```bash
curl "https://buildpro-api.onrender.com/api/v1/users/search?q=test" \
  -H "Authorization: Bearer PM_TOKEN" \
  -v
```

**Expected Response (PM):** `200 OK` with user list

**Expected Response (Non-PM):** `403 Forbidden`

---

### Test 6: Audit Logging

**Check audit logs are being created:**

Use a database client to query:

```sql
SELECT * FROM audit_logs
WHERE entity_type = 'project_member'
ORDER BY created_at DESC
LIMIT 10;
```

**Expected:** Should see entries for:
- `action = 'create'` when you added members
- `action = 'update'` when you changed roles
- `action = 'delete'` when you removed members
- `changes` column contains JSON with details

---

## Quick Validation Checklist

Use this checklist to quickly verify RBAC is working:

### ✅ Team Management
- [ ] Project Manager can add members
- [ ] Project Manager can change roles
- [ ] Project Manager can remove members (except self)
- [ ] Non-PM users cannot see "Add Member" button
- [ ] Role Info modal displays correctly
- [ ] Search functionality works

### ✅ Permission Hierarchy
- [ ] Viewer: Read-only everywhere
- [ ] Subcontractor: Can upload docs, create RFIs, logs
- [ ] Engineer: + Can manage schedule, technical docs
- [ ] Superintendent: + Can delete, verify punch items
- [ ] Project Manager: + Can manage team and budget

### ✅ Security
- [ ] Viewer gets 403 when trying to upload document
- [ ] Engineer gets 403 when trying to delete document
- [ ] Non-PM gets 403 when trying to add team member
- [ ] Audit logs are being created in database

### ✅ UI Behavior
- [ ] Buttons hide based on permissions (not just disabled)
- [ ] Role badges display correct colors
- [ ] Current user shown with green indicator
- [ ] Cannot remove yourself from project

---

## Common Issues & Solutions

### Issue: "Add Member" button not appearing for PM
**Solution:**
1. Check if PermissionProvider is wrapping the Team component
2. Verify PM role is set correctly in database
3. Check browser console for errors

### Issue: Getting 403 even as PM
**Solution:**
1. Verify you're actually a member of the project
2. Check if role is correctly set: `SELECT * FROM project_members WHERE user_id = 'your-id'`
3. Verify backend code was deployed

### Issue: Audit logs not being created
**Solution:**
1. Verify `audit_logs` table exists
2. Check if migration was run successfully
3. Look at backend logs for audit errors

### Issue: Frontend shows buttons but API returns 403
**Solution:**
This is actually correct behavior! Backend enforces security even if frontend is bypassed.
- Fix: Add the permission checks to frontend components using `can()` function

---

## Automated Test Script

Here's a quick test you can run from browser console:

```javascript
// Run this in browser console when logged in
(async function testRBAC() {
  const token = localStorage.getItem('buildpro_token');
  const API = 'https://buildpro-api.onrender.com/api/v1';

  console.log('🧪 Testing RBAC System...\n');

  // Test 1: Get roles
  const rolesRes = await fetch(`${API}/roles`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  console.log('✅ Get Roles:', rolesRes.status === 200 ? 'PASS' : 'FAIL');

  // Test 2: Get team members
  const projectId = window.location.pathname.split('/')[2]; // Extract from URL
  const membersRes = await fetch(`${API}/projects/${projectId}/members`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const members = await membersRes.json();
  console.log('✅ Get Members:', membersRes.status === 200 ? 'PASS' : 'FAIL');
  console.log('   Team size:', members.members?.length);

  // Test 3: Check your role
  const user = JSON.parse(localStorage.getItem('buildpro_user'));
  const myMember = members.members?.find(m => m.user_id === user.id);
  console.log('✅ Your role:', myMember?.role);

  console.log('\n🎉 Basic RBAC tests complete!');
})();
```

---

## Success Criteria

Your RBAC system is working correctly if:

1. ✅ Different roles see different buttons
2. ✅ API returns 403 for unauthorized actions
3. ✅ Team management works (add/remove/change roles)
4. ✅ Role hierarchy is enforced (higher roles inherit lower permissions)
5. ✅ Audit logs capture all team changes
6. ✅ Cannot remove yourself from project
7. ✅ Permission errors show helpful messages

---

## Need Help?

If tests are failing:
1. Check browser console for errors
2. Check backend logs for permission errors
3. Verify migration was run successfully
4. Ensure latest code is deployed to production
5. Check database: `SELECT * FROM project_members WHERE project_id = 'your-project-id'`
