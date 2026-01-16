# BuildPro Scheduling System

## Overview

BuildPro's scheduling system provides comprehensive project scheduling and timeline management for construction projects. It includes task management, dependency tracking, critical path calculation, milestone tracking, resource allocation, and schedule baseline comparison.

## Features

### Core Scheduling
- ✅ **Tasks & Activities** - Create and manage project tasks with dates, duration, and status
- ✅ **Task Hierarchy** - Parent/child relationships (Work Breakdown Structure)
- ✅ **Task Dependencies** - Four dependency types (FS, SS, FF, SF) with lag time
- ✅ **Milestones** - Track key project deliverables and deadlines
- ✅ **Resource Assignments** - Assign team members to tasks
- ✅ **Status Tracking** - Not started, in progress, completed, delayed, on hold, cancelled
- ✅ **Progress Tracking** - Percentage complete for each task

### Advanced Features
- ✅ **Critical Path Calculation** - Automatic identification of critical tasks
- ✅ **Float/Slack Analysis** - Total float and free float calculation
- ✅ **Schedule Baselines** - Snapshot and compare original vs current schedule
- ✅ **Variance Analysis** - Track schedule deviations from baseline
- ✅ **Gantt Chart Data** - Structured data for Gantt chart visualization
- ✅ **Look-Ahead Scheduling** - View upcoming tasks (3-week, 6-week views)
- ✅ **Schedule Integration** - Link tasks to RFIs, submittals, punch items, documents
- ✅ **Work Calendars** - Define working days and holidays
- ✅ **Task Constraints** - Must start on, must finish by, etc.

## Database Schema

### Core Tables

**schedule_tasks** - Project tasks and activities
- Task identification (code, name, description)
- Date tracking (planned, actual, early, late)
- Progress (status, % complete)
- Critical path data (is_critical, total_float, free_float)
- Constraints and priorities
- Cost tracking (budgeted, actual)
- Hierarchical structure (parent_task_id)

**task_dependencies** - Task relationships
- Predecessor/successor linkage
- Dependency types: FS (Finish-to-Start), SS (Start-to-Start), FF (Finish-to-Finish), SF (Start-to-Finish)
- Lag time (positive or negative)

**schedule_milestones** - Key project milestones
- Milestone types (project, deliverable, phase, payment, inspection, regulatory)
- Date tracking (target, forecast, actual)
- Status (pending, on_track, at_risk, achieved, missed)

**task_assignments** - Resource allocation
- Assign users to tasks
- Role and allocation percentage
- Assignment date range

**schedule_baselines** - Schedule snapshots
- Baseline types (original, approved, what-if, forecast)
- Task snapshot (JSON)
- Active baseline tracking

**work_calendars** - Working time definitions
- Working days configuration
- Hours per day
- Calendar exceptions (holidays)

**schedule_links** - Integration with other modules
- Link tasks to RFIs, submittals, punch items, documents
- Track schedule impacts

## API Endpoints

### Tasks

#### Create Task
```
POST /api/v1/projects/:projectId/schedule/tasks
```

**Request Body:**
```json
{
  "parent_task_id": "uuid",
  "task_code": "A.1.2",
  "name": "Pour Foundation",
  "description": "Pour concrete foundation for building A",
  "planned_start_date": "2025-02-01",
  "planned_end_date": "2025-02-05",
  "duration_days": 5,
  "status": "not_started",
  "priority": "high",
  "task_type": "task",
  "constraint_type": "snet",
  "constraint_date": "2025-02-01",
  "budgeted_cost": 25000.00,
  "assigned_to": "user-uuid"
}
```

**Response:**
```json
{
  "task": {
    "id": "task-uuid",
    "project_id": "project-uuid",
    "name": "Pour Foundation",
    "planned_start_date": "2025-02-01",
    "planned_end_date": "2025-02-05",
    "status": "not_started",
    "created_at": "2025-01-16T10:00:00Z"
  }
}
```

#### Get Project Tasks
```
GET /api/v1/projects/:projectId/schedule/tasks
```

**Query Parameters:**
- `status` - Filter by status (not_started, in_progress, completed, delayed, on_hold, cancelled)
- `priority` - Filter by priority (low, normal, high, critical)
- `assigned_to` - Filter by assigned user ID
- `parent_only` - Set to "true" to get only top-level tasks

**Response:**
```json
{
  "tasks": [
    {
      "id": "task-uuid",
      "name": "Pour Foundation",
      "planned_start_date": "2025-02-01",
      "planned_end_date": "2025-02-05",
      "duration_days": 5,
      "status": "in_progress",
      "percent_complete": 60,
      "is_critical": true,
      "assigned_to_name": "John Doe",
      "subtask_count": 3
    }
  ]
}
```

#### Get Task Details
```
GET /api/v1/schedule/tasks/:id
```

Returns task with subtasks, dependencies, and assignments.

#### Update Task
```
PUT /api/v1/schedule/tasks/:id
```

#### Delete Task
```
DELETE /api/v1/schedule/tasks/:id
```

### Task Dependencies

#### Add Dependency
```
POST /api/v1/schedule/tasks/:taskId/dependencies
```

**Request Body:**
```json
{
  "predecessor_task_id": "task-uuid",
  "dependency_type": "FS",
  "lag_days": 2
}
```

**Dependency Types:**
- `FS` - Finish-to-Start (default): Successor starts when predecessor finishes
- `SS` - Start-to-Start: Successor starts when predecessor starts
- `FF` - Finish-to-Finish: Successor finishes when predecessor finishes
- `SF` - Start-to-Finish: Successor finishes when predecessor starts (rare)

**Lag Time:**
- Positive number = delay (e.g., 2 days after predecessor completes)
- Negative number = lead time (e.g., start 2 days before predecessor completes)

#### Get Task Dependencies
```
GET /api/v1/schedule/tasks/:taskId/dependencies
```

Returns predecessors and successors.

#### Delete Dependency
```
DELETE /api/v1/schedule/dependencies/:id
```

### Milestones

#### Create Milestone
```
POST /api/v1/projects/:projectId/schedule/milestones
```

**Request Body:**
```json
{
  "name": "Foundation Complete",
  "description": "All foundation work finished and inspected",
  "milestone_type": "phase",
  "target_date": "2025-02-15",
  "is_critical": true,
  "related_task_id": "task-uuid"
}
```

**Milestone Types:**
- `project` - Project milestone
- `deliverable` - Deliverable milestone
- `phase` - Phase completion
- `payment` - Payment milestone
- `inspection` - Inspection/approval
- `regulatory` - Regulatory/permit milestone

#### Get Project Milestones
```
GET /api/v1/projects/:projectId/schedule/milestones
```

Query parameters: `status`, `milestone_type`

#### Update Milestone
```
PUT /api/v1/schedule/milestones/:id
```

#### Delete Milestone
```
DELETE /api/v1/schedule/milestones/:id
```

### Resource Assignments

#### Assign User to Task
```
POST /api/v1/schedule/tasks/:taskId/assignments
```

**Request Body:**
```json
{
  "user_id": "user-uuid",
  "role": "Lead Carpenter",
  "allocation_percent": 100,
  "assigned_from": "2025-02-01",
  "assigned_to": "2025-02-05"
}
```

Creates notification for assigned user.

#### Get Task Assignments
```
GET /api/v1/schedule/tasks/:taskId/assignments
```

#### Get User's Assigned Tasks
```
GET /api/v1/users/:userId/assigned-tasks
```

Returns all tasks assigned to a specific user across all projects.

#### Remove Assignment
```
DELETE /api/v1/schedule/assignments/:id
```

### Schedule Baselines

#### Create Baseline Snapshot
```
POST /api/v1/projects/:projectId/schedule/baselines
```

**Request Body:**
```json
{
  "name": "Approved Schedule - January 2025",
  "description": "Initial approved project schedule",
  "baseline_type": "original"
}
```

**Baseline Types:**
- `original` - Original approved schedule
- `approved` - Re-baselined approved schedule
- `what_if` - What-if scenario
- `forecast` - Current forecast

Creates a snapshot of all current tasks for comparison.

#### Get Project Baselines
```
GET /api/v1/projects/:projectId/schedule/baselines
```

#### Get Baseline Details
```
GET /api/v1/schedule/baselines/:id
```

Includes full task snapshot.

#### Set Active Baseline
```
PUT /api/v1/schedule/baselines/:id/set-active
```

Sets this as the active baseline for variance analysis.

### Gantt Chart Data

#### Get Gantt Chart Data
```
GET /api/v1/projects/:projectId/schedule/gantt
```

**Response:**
```json
{
  "tasks": [
    {
      "id": "task-uuid",
      "name": "Pour Foundation",
      "start_date": "2025-02-01",
      "end_date": "2025-02-05",
      "duration": 5,
      "status": "in_progress",
      "percent_complete": 60,
      "is_critical": true,
      "parent_task_id": null,
      "assigned_to_name": "John Doe"
    }
  ],
  "dependencies": [
    {
      "id": "dep-uuid",
      "source": "task-1-uuid",
      "target": "task-2-uuid",
      "type": "FS",
      "lag": 2
    }
  ],
  "milestones": [
    {
      "id": "milestone-uuid",
      "name": "Foundation Complete",
      "date": "2025-02-15",
      "milestone_type": "phase",
      "status": "pending"
    }
  ]
}
```

Optimized data structure for Gantt chart libraries (dhtmlxGantt, Frappe Gantt, etc.)

### Critical Path Analysis

#### Calculate Critical Path
```
GET /api/v1/projects/:projectId/schedule/critical-path
```

**Response:**
```json
{
  "criticalPath": [
    {
      "id": "task-uuid",
      "name": "Excavation",
      "task_code": "A.1.1",
      "duration_days": 3,
      "early_start": "2025-01-20T00:00:00Z",
      "early_finish": "2025-01-23T00:00:00Z",
      "total_float": 0
    }
  ],
  "projectDuration": 120,
  "projectStart": "2025-01-20T00:00:00Z",
  "projectEnd": "2025-05-20T00:00:00Z",
  "criticalTaskCount": 15,
  "totalTaskCount": 45
}
```

**Algorithm:**
1. Forward pass: Calculate Early Start and Early Finish for all tasks
2. Backward pass: Calculate Late Start and Late Finish for all tasks
3. Calculate Total Float: Late Start - Early Start
4. Identify critical tasks: Total Float = 0
5. Update database with calculated values

### Schedule Analytics

#### Get Schedule Summary
```
GET /api/v1/projects/:projectId/schedule/summary
```

**Response:**
```json
{
  "summary": {
    "total_tasks": 45,
    "completed_tasks": 12,
    "in_progress_tasks": 8,
    "not_started_tasks": 20,
    "delayed_tasks": 5,
    "critical_tasks": 15,
    "avg_completion": 35.5,
    "project_start": "2025-01-20",
    "project_end": "2025-05-20",
    "total_milestones": 8,
    "achieved_milestones": 2,
    "missed_milestones": 1,
    "at_risk_milestones": 2,
    "total_budgeted": 500000.00,
    "total_actual": 185000.00,
    "variance": -15000.00,
    "upcoming_tasks": 6,
    "overdue_tasks": 3
  }
}
```

#### Get Schedule Variance Report
```
GET /api/v1/projects/:projectId/schedule/variance
```

Compares current schedule against active baseline.

**Response:**
```json
{
  "baseline": {
    "id": "baseline-uuid",
    "name": "Original Schedule",
    "baseline_date": "2025-01-01"
  },
  "summary": {
    "total_tasks": 45,
    "tasks_delayed": 12,
    "tasks_ahead": 5,
    "tasks_on_track": 28,
    "avg_variance_days": 3.2,
    "critical_tasks_delayed": 4
  },
  "variances": [
    {
      "task_id": "task-uuid",
      "task_name": "Pour Foundation",
      "task_code": "A.1.2",
      "baseline_start": "2025-02-01",
      "baseline_end": "2025-02-05",
      "current_start": "2025-02-03",
      "current_end": "2025-02-08",
      "variance_days": 3,
      "status": "delayed",
      "is_critical": true
    }
  ]
}
```

#### Get Look-Ahead Schedule
```
GET /api/v1/projects/:projectId/schedule/look-ahead?weeks=3
```

Returns tasks starting in the next N weeks, grouped by week.

**Query Parameters:**
- `weeks` - Number of weeks to look ahead (default: 3)

### Schedule Integration

#### Link Task to Other Entities
```
POST /api/v1/schedule/tasks/:taskId/links
```

**Request Body:**
```json
{
  "entity_type": "rfi",
  "entity_id": "rfi-uuid",
  "link_type": "blocks",
  "schedule_impact_days": 5
}
```

**Entity Types:** `rfi`, `submittal`, `punch_item`, `document`

**Link Types:**
- `blocks` - Entity blocks task completion
- `requires` - Task requires entity to be complete
- `related` - General relationship
- `impacts` - Entity impacts schedule

#### Get Task Links
```
GET /api/v1/schedule/tasks/:taskId/links
```

#### Get Schedule Impacts
```
GET /api/v1/projects/:projectId/schedule/impacts
```

Returns all schedule links with non-zero impact, sorted by impact magnitude.

## Usage Examples

### Creating a Simple Schedule

**1. Create parent task:**
```bash
POST /api/v1/projects/{project-id}/schedule/tasks
{
  "name": "Foundation Work",
  "planned_start_date": "2025-02-01",
  "planned_end_date": "2025-02-15",
  "duration_days": 10,
  "task_type": "phase"
}
```

**2. Create subtasks:**
```bash
POST /api/v1/projects/{project-id}/schedule/tasks
{
  "parent_task_id": "{foundation-task-id}",
  "name": "Excavation",
  "planned_start_date": "2025-02-01",
  "planned_end_date": "2025-02-03",
  "duration_days": 3,
  "assigned_to": "{user-id}"
}

POST /api/v1/projects/{project-id}/schedule/tasks
{
  "parent_task_id": "{foundation-task-id}",
  "name": "Formwork",
  "planned_start_date": "2025-02-04",
  "planned_end_date": "2025-02-06",
  "duration_days": 3
}

POST /api/v1/projects/{project-id}/schedule/tasks
{
  "parent_task_id": "{foundation-task-id}",
  "name": "Pour Concrete",
  "planned_start_date": "2025-02-07",
  "planned_end_date": "2025-02-08",
  "duration_days": 2
}
```

**3. Add dependencies:**
```bash
POST /api/v1/schedule/tasks/{formwork-task-id}/dependencies
{
  "predecessor_task_id": "{excavation-task-id}",
  "dependency_type": "FS",
  "lag_days": 0
}

POST /api/v1/schedule/tasks/{pour-concrete-task-id}/dependencies
{
  "predecessor_task_id": "{formwork-task-id}",
  "dependency_type": "FS",
  "lag_days": 0
}
```

**4. Add milestone:**
```bash
POST /api/v1/projects/{project-id}/schedule/milestones
{
  "name": "Foundation Complete",
  "target_date": "2025-02-15",
  "milestone_type": "phase",
  "related_task_id": "{foundation-task-id}",
  "is_critical": true
}
```

**5. Create baseline:**
```bash
POST /api/v1/projects/{project-id}/schedule/baselines
{
  "name": "Original Schedule",
  "baseline_type": "original"
}
```

**6. Calculate critical path:**
```bash
GET /api/v1/projects/{project-id}/schedule/critical-path
```

### Tracking Progress

**Update task status:**
```bash
PUT /api/v1/schedule/tasks/{task-id}
{
  "status": "in_progress",
  "percent_complete": 50,
  "actual_start_date": "2025-02-01"
}
```

**Complete a task:**
```bash
PUT /api/v1/schedule/tasks/{task-id}
{
  "status": "completed",
  "percent_complete": 100,
  "actual_end_date": "2025-02-03"
}
```

**Achieve a milestone:**
```bash
PUT /api/v1/schedule/milestones/{milestone-id}
{
  "status": "achieved",
  "actual_date": "2025-02-15"
}
```

## Task Status Workflow

```
not_started → in_progress → completed
              ↓
              on_hold → in_progress
              ↓
              delayed → in_progress
              ↓
              cancelled (terminal)
```

**Status Descriptions:**
- `not_started` - Task hasn't begun
- `in_progress` - Task is actively being worked on
- `completed` - Task is finished
- `on_hold` - Task is temporarily paused
- `delayed` - Task is behind schedule
- `cancelled` - Task was cancelled (won't be completed)

## Task Constraints

Constraints affect how tasks are scheduled:

- `asap` - As Soon As Possible (default, no constraint)
- `alap` - As Late As Possible
- `snet` - Start No Earlier Than {constraint_date}
- `snlt` - Start No Later Than {constraint_date}
- `fnet` - Finish No Earlier Than {constraint_date}
- `fnlt` - Finish No Later Than {constraint_date}
- `mso` - Must Start On {constraint_date} (hard constraint)
- `mfo` - Must Finish On {constraint_date} (hard constraint)

Example:
```json
{
  "name": "Concrete Pour",
  "constraint_type": "mso",
  "constraint_date": "2025-02-07",
  "planned_start_date": "2025-02-07"
}
```

## Critical Path Method (CPM)

The scheduling system uses the Critical Path Method to identify critical tasks:

**Key Concepts:**
- **Early Start (ES)**: Earliest a task can start
- **Early Finish (EF)**: Earliest a task can finish
- **Late Start (LS)**: Latest a task can start without delaying project
- **Late Finish (LF)**: Latest a task can finish without delaying project
- **Total Float**: LS - ES (how much a task can be delayed)
- **Critical Path**: Sequence of tasks with zero float

**Benefits:**
- Identify which tasks directly impact project completion
- Focus resources on critical tasks
- Understand schedule flexibility
- Predict project completion date

## Work Calendars

Define working days and holidays to calculate working duration accurately.

**Default Calendar:**
- Monday-Friday working days
- 8 hours per day
- Weekends excluded

**Custom Calendars:**
Create project-specific calendars with:
- Custom working days
- Different hours per day
- Holiday exceptions
- Special working day exceptions

*Note: Calendar functionality is defined in schema but API endpoints will be added in future update.*

## Performance Considerations

**Indexing:**
All key fields are indexed for performance:
- project_id
- parent_task_id
- planned dates
- status
- is_critical
- Dependencies (predecessor/successor)

**Large Projects:**
For projects with 1000+ tasks:
- Use pagination on task list endpoints
- Filter by status or date range
- Use parent_only parameter to get summary view
- Calculate critical path off-peak hours

**Critical Path Calculation:**
- Complexity: O(n + m) where n=tasks, m=dependencies
- Suitable for projects up to 5000 tasks
- Calculations update database atomically

## Integration with Other Modules

The scheduling system integrates with existing BuildPro modules:

**RFIs:**
```bash
# Link RFI to schedule task
POST /api/v1/schedule/tasks/{task-id}/links
{
  "entity_type": "rfi",
  "entity_id": "{rfi-id}",
  "link_type": "blocks",
  "schedule_impact_days": 7
}
```

**Submittals:**
Link submittal approval to schedule milestone.

**Punch Items:**
Link punch items to completion tasks.

**Documents:**
Attach specifications, drawings, and contracts to tasks.

## Frontend Integration

**Gantt Chart Libraries:**
- [dhtmlxGantt](https://dhtmlx.com/docs/products/dhtmlxGantt/)
- [Frappe Gantt](https://frappe.io/gantt)
- [BRYNTUM Gantt](https://www.bryntum.com/products/gantt/)

**Example (Frappe Gantt):**
```javascript
// Fetch Gantt data
const response = await fetch('/api/v1/projects/{id}/schedule/gantt');
const { tasks, dependencies } = await response.json();

// Transform for Frappe Gantt
const ganttTasks = tasks.map(task => ({
  id: task.id,
  name: task.name,
  start: task.start_date,
  end: task.end_date,
  progress: task.percent_complete,
  dependencies: task.id, // Will be mapped from dependencies array
  custom_class: task.is_critical ? 'bar-critical' : ''
}));

// Initialize Gantt
const gantt = new Gantt("#gantt", ganttTasks, {
  view_mode: 'Week'
});
```

## Permissions

**Task Management:**
- Create/Edit/Delete: `engineer`, `superintendent`, `project_manager`, `admin`
- View: All project members

**Baseline Management:**
- Create/Set Active: `project_manager`, `admin`
- View: All project members

**Assignments:**
- Assign/Unassign: `engineer`, `superintendent`, `project_manager`, `admin`
- View: All project members

## Best Practices

**1. Create a WBS (Work Breakdown Structure):**
- Start with major phases as parent tasks
- Break down into activities
- Keep task duration under 20 days

**2. Define Dependencies Carefully:**
- Use Finish-to-Start (FS) for 80%+ of dependencies
- Add lag time for curing, approvals, procurement
- Avoid circular dependencies

**3. Set Realistic Durations:**
- Use historical data
- Account for weather, crew size, complexity
- Include buffer for high-risk tasks

**4. Baseline Early:**
- Create original baseline after schedule approval
- Re-baseline only for approved scope changes
- Keep baseline snapshots for history

**5. Update Regularly:**
- Update progress weekly (minimum)
- Mark tasks complete promptly
- Update actual dates for variance tracking

**6. Monitor Critical Path:**
- Calculate critical path weekly
- Focus resources on critical tasks
- Investigate delays on critical path immediately

**7. Use Milestones Strategically:**
- Major project phases
- Client deliverables
- Payment milestones
- Regulatory approvals

## Future Enhancements

**Planned Features:**
- Work calendar API endpoints
- Resource leveling algorithm
- What-if scenario planning
- Schedule optimization suggestions
- Automated schedule updates from field progress
- Mobile app for field progress tracking
- Email notifications for critical path changes
- Integration with estimating/takeoff tools
- Advanced reporting (S-curves, histograms)
- Multi-project portfolio view

## Troubleshooting

**"Circular dependency detected":**
- Check task dependencies for loops (A → B → C → A)
- Remove or reorder dependencies to break the cycle

**"Critical path shows wrong tasks":**
- Verify all dependencies are correct
- Check constraint dates aren't overriding CPM logic
- Recalculate: GET /schedule/critical-path

**"Baseline comparison shows errors":**
- Ensure active baseline is set
- Verify baseline was created after all tasks
- Check task IDs haven't changed

**"Performance issues with large schedules":**
- Add pagination to task queries
- Filter by date range or status
- Consider breaking into sub-projects

## Support

For issues or questions about the scheduling system:
- Review this documentation
- Check API response error messages
- Test with Postman/curl to isolate frontend vs backend issues
- Review server logs for detailed error traces

## License

Part of BuildPro construction management platform.
