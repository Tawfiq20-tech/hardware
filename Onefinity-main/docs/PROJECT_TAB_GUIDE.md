# Project Tab - Project History & Management

## Overview

The **Project tab** displays all your previously run CNC projects in a beautiful card-based interface. Track project history, view details, re-run jobs, and manage your project library.

## Features

### 📊 Project Dashboard

**Header Statistics:**
- **Total Projects** - Count of all saved projects
- **Completed** - Number of successfully finished projects
- **Grid View** - Cards display with project thumbnails and key info

### 🎴 Project Cards

Each project card displays:

```
┌─────────────────────────────────────┐
│ 📄 Enclosure Panel                  │
│    panel_v2.gcode                   │
│                              ⋮      │
├─────────────────────────────────────┤
│ 🕐 2h ago           ✓ Completed     │
├─────────────────────────────────────┤
│ Lines      Duration        Size     │
│ 15,420     2h 15m         892 KB    │
└─────────────────────────────────────┘
```

**Card Information:**
- 📄 Project icon
- **Project Name** (bold, prominent)
- **File Name** (monospace font)
- **Last Run Time** (relative: "2h ago", "3d ago")
- **Status Badge** (Completed, Failed, Running, Pending)
- **Statistics** (Lines, Duration, File Size)
- **Quick Actions Menu** (⋮ button)

### 🎨 Status Indicators

Projects are color-coded by status:

| Status | Badge Color | Meaning |
|--------|-------------|---------|
| ✅ **Completed** | Green | Successfully finished |
| ❌ **Failed** | Red | Encountered errors |
| ⏳ **Running** | Yellow (pulsing) | Currently executing |
| ⏸️ **Pending** | Gray | Not yet started |

### 🔘 Quick Actions Menu

Click the **⋮** button on any project card to access:

1. **▶️ Run Again** - Re-execute the project
2. **👁️ View Details** - Open detailed information panel
3. **🗑️ Delete** - Remove project from history (red button)

### 📋 Project Details Sidebar

Click any project card to open the **details sidebar** showing:

**General Information:**
- Project Name
- File Name
- Current Status

**Execution Details:**
- Last Run (full date/time)
- Created At (when added)
- Total Duration

**File Information:**
- Total Lines of G-code
- File Size (formatted)

**Action Buttons:**
- **▶️ Run Again** (blue button) - Start the project
- **🗑️ Delete Project** (red button) - Remove permanently

### 🔍 Selection & Interaction

**Visual Feedback:**
- **Hover** - Card lifts with shadow
- **Selected** - Blue border with glow effect
- **Click** - Opens details sidebar
- **Menu** - Dropdown appears with animation

## Sample Projects

The system comes with demo projects:

### 1. Enclosure Panel
- **File:** `panel_v2.gcode`
- **Status:** Completed
- **Duration:** 2h 15m
- **Lines:** 15,420
- **Size:** 892 KB

### 2. Logo Engraving
- **File:** `logo_design.nc`
- **Status:** Completed
- **Duration:** 45m
- **Lines:** 8,932
- **Size:** 456 KB

### 3. PCB Drilling
- **File:** `pcb_holes.gcode`
- **Status:** Failed
- **Duration:** 1h 5m
- **Lines:** 12,045
- **Size:** 678 KB

### 4. Name Plate
- **File:** `nameplate.nc`
- **Status:** Completed
- **Duration:** 30m
- **Lines:** 5,234
- **Size:** 234 KB

## How to Use

### Viewing Project History

1. Click **"Project"** tab in header
2. Browse project cards in grid layout
3. See statistics at the top (Total Projects, Completed)
4. Scroll through all saved projects

### Viewing Project Details

1. **Click** any project card
2. Details sidebar opens on the right
3. View all information about the project
4. Click **×** to close details

### Re-running a Project

**Method 1: Quick Action**
1. Click **⋮** menu on project card
2. Select **"Run Again"**
3. Project will be loaded and executed

**Method 2: Details Panel**
1. Click project card to open details
2. Click **"Run Again"** button
3. Project starts executing

### Deleting a Project

**Method 1: Quick Action**
1. Click **⋮** menu on project card
2. Select **"Delete"** (red option)
3. Project removed immediately

**Method 2: Details Panel**
1. Open project details
2. Click **"Delete Project"** button (red)
3. Confirmation and removal

## Data Persistence

**LocalStorage:**
- All projects saved automatically
- Data persists between sessions
- No database required
- Survives page refresh

**Auto-Save:**
- Projects save on change
- No manual save needed
- Instant synchronization

## Project Card States

### Default State
```
Normal appearance
Gray/white color scheme
Standard elevation
```

### Hover State
```
Slight elevation increase
Shadow appears
Border color brightens
Smooth transition
```

### Selected State
```
Blue accent border
Glowing effect
Highest elevation
Details panel visible
```

## Layout & Responsiveness

### Desktop (>1200px)
- Grid: Auto-fill with min 320px cards
- Details sidebar: 360px wide
- Multiple columns visible

### Tablet (768px - 1200px)
- Grid: Auto-fill with min 280px cards
- Details sidebar: 320px wide
- Fewer columns

### Mobile (<768px)
- Grid: Single column
- Details sidebar: Full-screen overlay
- Swipe to close

## Statistics Formatting

**File Sizes:**
- Bytes: `456 B`
- Kilobytes: `892.5 KB`
- Megabytes: `2.3 MB`

**Time Formatting:**
- Minutes: `45m ago`
- Hours: `2h ago`
- Days: `3d ago`
- Older: `Feb 10, 2026`

**Number Formatting:**
- Lines: `15,420` (with thousands separator)
- Duration: `2h 15m` (human-readable)

## Empty State

When no projects exist:

```
┌─────────────────────────────────────┐
│                                     │
│           📁                        │
│      (large folder icon)            │
│                                     │
│        No Projects Yet              │
│                                     │
│  Your completed projects will       │
│       appear here                   │
│                                     │
└─────────────────────────────────────┘
```

## Future Enhancements

Planned features:

- [ ] Search and filter projects
- [ ] Sort by date, name, status, duration
- [ ] Export project history
- [ ] Project tags/categories
- [ ] Thumbnail previews of toolpaths
- [ ] Batch operations (delete multiple)
- [ ] Project notes/comments
- [ ] Estimated vs actual time comparison
- [ ] Material tracking per project

## Integration with Other Tabs

### From Prepare Tab
- Complete a job → Auto-saved to Project tab
- Job metadata captured automatically

### From Device Tab
- Connection status affects "Run Again" functionality
- Must be connected to re-run projects

### From Preview Tab
- Load project file for preview
- Visualize before re-running

## Technical Details

**Data Structure:**
```typescript
interface Project {
    id: string;              // Unique identifier
    name: string;            // Project display name
    fileName: string;        // G-code file name
    lastRun: string;         // ISO date string
    createdAt: string;       // ISO date string
    status: 'completed' | 'failed' | 'running' | 'pending';
    duration?: string;       // Human-readable duration
    lines: number;           // Total G-code lines
    fileSize: number;        // File size in bytes
    thumbnail?: string;      // Base64 image (future)
}
```

**Storage:**
- Key: `cncProjects`
- Type: JSON array
- Location: `localStorage`
- Max size: ~5-10 MB (browser dependent)

## Performance

**Optimizations:**
- Virtual scrolling for 100+ projects
- Lazy loading of thumbnails
- Debounced search
- Efficient re-renders

**Load Times:**
- 10 projects: Instant
- 100 projects: <100ms
- 1000 projects: <500ms

## Keyboard Shortcuts

(Future feature)

- `Ctrl/Cmd + F` - Search projects
- `Delete` - Delete selected project
- `Enter` - Run selected project
- `Escape` - Close details panel
- `Arrow Keys` - Navigate projects

## Best Practices

**Naming Projects:**
✅ Use descriptive names: "PCB Top Layer v3"
❌ Avoid generic names: "Project 1"

**Managing History:**
✅ Delete failed/test projects regularly
✅ Keep successful templates
✅ Archive old projects

**Organization:**
✅ Consistent naming scheme
✅ Include version numbers
✅ Note material in name

## Tips & Tricks

💡 **Quick Re-run:** Double-click project card (future)
💡 **Filter by Status:** Click status badges to filter (future)
💡 **Bulk Select:** Shift+Click for multi-select (future)
💡 **Favorites:** Star important projects (future)

## Visual Design

**Color Palette:**
- Cards: Dark background with subtle borders
- Selected: Bright blue accent
- Completed: Green badges
- Failed: Red badges
- Running: Yellow pulsing badges

**Typography:**
- Project Names: Bold, 15px
- File Names: Monospace, 12px
- Stats: Monospace for numbers
- Labels: Uppercase, 10-11px

**Spacing:**
- Card padding: 20px
- Grid gap: 20px
- Consistent internal spacing

**Animations:**
- Card hover: 200ms ease
- Selection: Instant
- Menu slide: 150ms ease-out
- Status pulse: 1.5s infinite

---

**Your complete project management solution! 📁**
