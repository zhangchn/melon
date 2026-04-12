# Frontend Features Design

## Overview

A web-based disk usage analyzer with an interactive sunburst chart inspired by DaisyDisk. The frontend provides visual exploration of directory structures with drill-down navigation.

## Core User Experience

### User Journey

1. **Enter Path** → User inputs or selects a directory to scan
2. **Scan Progress** → Real-time progress indicator during scan
3. **Visualization** → Sunburst chart displays directory hierarchy
4. **Explore** → Click segments to drill down, hover for details
5. **Navigate** → Use breadcrumbs or ring clicks to move around
6. **Analyze** → Sort, filter, search to find large files

---

## Visual Design

### Layout

```
┌─────────────────────────────────────────────────────────────┐
│  📁 Web Disk Analyzer                              [⚙️] [?]  │
├─────────────────────────────────────────────────────────────┤
│  📂 /Users/cuser/Documents  ›  github  ›  melon             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   ┌─────────────────────────────────────────────────────┐   │
│   │                                                     │   │
│   │              ╭─────────────╮                        │   │
│   │           ╭──┤  melon      ├──╮                     │   │
│   │         ╭─┤  ╰─────────────╯ ├─╮                   │   │
│   │        │  ╭───╮         ╭───╮  │                   │   │
│   │        │  │backend│       │.hermes│ │                   │   │
│   │        │  ╰───╯         ╰───╯  │                   │   │
│   │         ╰─────────────────────╯                     │   │
│   │                                                     │   │
│   └─────────────────────────────────────────────────────┘   │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│  Selected: backend/ (29.4 KB)                               │
│  ├── main.py (12.7 KB)                                      │
│  ├── scanner.py (9.6 KB)                                    │
│  └── test_api.py (13.5 KB)                                  │
├─────────────────────────────────────────────────────────────┤
│  [Scan New]  [Refresh]  [Export]         🔍 Search...       │
└─────────────────────────────────────────────────────────────┘
```

### Color Scheme

**Light Mode:**
- Background: `#FFFFFF`
- Text: `#1A1A1A`
- Primary: `#3B82F6` (blue)
- Directories: Gradient `#3B82F6` → `#8B5CF6` (blue to purple)
- Files: Gradient `#10B981` → `#14B8A6` (green to teal)
- Hover: `#EFF6FF` (light blue)
- Selected: `#DBEAFE` (selected blue)
- Borders: `#E5E7EB`

**Dark Mode:**
- Background: `#0F172A`
- Text: `#F1F5F9`
- Directories: Gradient `#60A5FA` → `#A78BFA`
- Files: Gradient `#34D399` → `#2DD4BF`
- Hover: `#1E293B`
- Selected: `#1E3A5F`
- Borders: `#334155`

### Typography

- Headings: Inter, system-ui, sans-serif
- Monospace: JetBrains Mono, Fira Code, monospace (for paths, sizes)
- Sizes: 14px base, 12px small, 18px large

---

## Components

### 1. Path Input Bar

**Location:** Top of page
**Purpose:** Enter directory path to scan

**Features:**
- Text input with path validation
- Quick-select buttons for common paths (`~`, `~/Documents`, `~/Downloads`)
- Browse button (opens file picker via backend)
- Path history dropdown (last 10 scanned paths)
- Validation feedback (green check / red error)

**States:**
- Empty: "Enter directory path..."
- Typing: Live validation
- Valid: Green border, scan button enabled
- Invalid: Red border, error message
- Scanning: Disabled, loading indicator

---

### 2. Breadcrumb Navigation

**Location:** Below header, above chart
**Purpose:** Show current location, enable quick navigation

**Features:**
- Clickable segments (click to jump to that level)
- Current segment highlighted
- Overflow handling (ellipsis for long paths)
- Copy path button

**Example:**
```
📁 /Users  ›  cuser  ›  Documents  ›  github  ›  melon  [📋]
```

---

### 3. Sunburst Chart (Main Visualization)

**Location:** Center of page
**Purpose:** Visual representation of directory hierarchy

**D3.js Implementation:**

```javascript
// Data structure expected from API
{
  root: "/Users/cuser/Documents",
  nodes: [
    {id: 0, parent_id: null, name: "Documents", size: 1073741824, depth: 0, is_dir: true},
    {id: 1, parent_id: 0, name: "github", size: 536870912, depth: 1, is_dir: true},
    // ...
  ]
}
```

**Visual Properties:**
- Inner ring = root directory
- Outer rings = subdirectories (each depth level)
- Arc angle = proportional to size
- Arc radius = depth level
- Color = type (directory vs file) + depth

**Interactions:**

| Action | Behavior |
|--------|----------|
| Click segment | Drill down (make selected the new center) |
| Click inner ring | Navigate up one level |
| Hover segment | Highlight + show tooltip |
| Right-click segment | Context menu (reveal in Finder, etc.) |
| Double-click segment | Drill down + animate transition |
| Scroll wheel | Zoom in/out |
| Drag | Rotate the chart |

**Animation:**
- Smooth transitions on drill-down (300ms ease-in-out)
- Arcs grow/shrink with size changes
- Color interpolation on hover
- Loading skeleton during scan

---

### 4. Tooltip

**Location:** Follows cursor near hovered segment
**Purpose:** Show details about hovered item

**Content:**
```
📁 backend/
Size: 29.4 KB (47.2% of parent)
Depth: Level 2
Items: 7 files, 1 folder

Path: /Users/cuser/Documents/github/melon/backend
```

**Features:**
- File icon based on extension
- Size with unit (KB, MB, GB)
- Percentage of parent
- File count for directories
- Full path (truncated if long)
- Error indicator if scan had issues

---

### 5. Details Panel

**Location:** Bottom of page (collapsible)
**Purpose:** Show contents of selected directory

**Features:**
- List view of immediate children
- Sortable columns (Name, Size, Type, Date)
- File icons by extension
- Click row to select in chart
- Double-click directory to drill down
- Checkbox for multi-select (future: batch operations)

**Columns:**
| Name | Size | Type | % of Parent |
|------|------|------|-------------|
| 📄 main.py | 12.7 KB | Python | 43.2% |
| 📄 scanner.py | 9.6 KB | Python | 32.7% |
| 📁 __pycache__/ | 4.1 KB | Folder | 13.9% |

---

### 6. Search Panel

**Location:** Slide-in panel from right
**Purpose:** Find files/directories by name

**Features:**
- Text input with live results
- Filter by type (files only, directories only)
- Filter by size (>1MB, >100KB, etc.)
- Results list with path and size
- Click result to highlight in chart
- Keyboard shortcut: `Cmd/Ctrl + F`

**Results:**
```
📄 test_api.py
   /Users/cuser/Documents/github/melon/backend
   13.5 KB

📁 .git
   /Users/cuser/Documents/github/melon/.git
   2.4 MB (excluded from scan)
```

---

### 7. Scan Progress Overlay

**Location:** Full screen overlay
**Purpose:** Show scan progress

**Features:**
- Animated spinner or progress bar
- Current path being scanned
- Running count (files scanned, total size)
- Estimated time remaining
- Cancel button

**States:**
```
Scanning...
/Users/cuser/Documents/github/melon/backend

📊 234 files • 47.3 MB scanned
⏱️ ~2 seconds remaining

[Cancel]
```

---

### 8. Settings Panel

**Location:** Modal dialog
**Purpose:** Configure scan behavior

**Options:**
- Exclude patterns (checkboxes for common patterns)
- Max depth slider (1-50)
- Follow symlinks (toggle)
- Auto-refresh interval (for watched directories)
- Theme (Light/Dark/Auto)
- Language (future)

---

## Interactive Features

### Drill-Down Navigation

**Flow:**
1. User clicks a segment
2. Chart animates: selected segment grows to fill center
3. Outer rings shift/rotate to new position
4. Breadcrumb updates
5. Details panel shows new contents
6. URL updates (for shareability, browser history)

**Animation:**
```javascript
// Pseudo-code for D3 transition
chart.transition()
  .duration(300)
  .ease(d3.easeCubicInOut)
  .attrTween('d', arcTween(newAngle))
  .styleTween('fill', colorTween);
```

### Hover Effects

- Segment brightens on hover
- Related segments highlight (same depth, same parent)
- Tooltip appears with delay (100ms to avoid flicker)
- Cursor changes to pointer for clickable segments

### Selection States

- Clicked segment stays highlighted until another is clicked
- Selected segment has thicker border
- Selection persists across navigation
- Clear selection by clicking empty space

---

## Responsive Design

### Desktop (≥1024px)
- Full sunburst chart (600px diameter)
- Details panel visible
- All controls in header

### Tablet (768px - 1023px)
- Medium chart (400px diameter)
- Details panel collapsible
- Compact header

### Mobile (<768px)
- Small chart (300px diameter)
- Details panel hidden (tap to show)
- Hamburger menu for controls
- Touch-optimized interactions (larger tap targets)

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl + O` | Open path dialog |
| `Cmd/Ctrl + F` | Open search |
| `Cmd/Ctrl + R` | Refresh scan |
| `Escape` | Close panel / Clear selection |
| `Arrow keys` | Navigate between segments |
| `Enter` | Drill down into selected |
| `Backspace` | Go up one level |
| `Cmd/Ctrl + +` | Zoom in |
| `Cmd/Ctrl + -` | Zoom out |
| `0` | Reset zoom |
| `?` | Show keyboard shortcuts help |

---

## Accessibility

### ARIA Labels
- Chart: `role="img" aria-label="Directory visualization"`
- Segments: `role="button" aria-label="backend folder, 29.4 KB"`
- Breadcrumbs: `nav aria-label="Breadcrumb"`

### Keyboard Navigation
- Tab through interactive elements
- Arrow keys navigate chart segments
- Enter/Space activate selected segment
- Focus indicators visible

### Screen Reader Support
- Alternative text description of chart
- Table view of data (hidden visually, available to SR)
- Announce scan progress updates

### Color Contrast
- WCAG AA compliance (4.5:1 for text)
- Don't rely on color alone (use icons, patterns)
- Dark mode for low-light environments

---

## Performance Considerations

### Large Directory Handling

**Problem:** 10,000+ nodes can slow rendering

**Solutions:**
1. **Progressive Loading**
   - Initial scan: depth 2 only
   - Load children on demand when drilling down
   - Show "Load more" for large directories

2. **Canvas Rendering**
   - Use D3 + Canvas for >1000 segments
   - SVG for smaller directories (better interactivity)

3. **Viewport Culling**
   - Only render visible segments
   - Skip tiny arcs (<1 degree)

4. **Web Workers**
   - Parse JSON in worker thread
   - Compute layout off main thread

### Memory Management

- Limit cached scans (max 5)
- Clear chart data when scanning new path
- Debounce resize handlers
- Use object pooling for tooltip updates

---

## API Integration

### Scan Request

```javascript
async function scanDirectory(path) {
  const response = await fetch(`/api/scan?path=${encodeURIComponent(path)}`);
  if (!response.ok) throw new Error(await response.text());
  return await response.json();
}
```

### Data Transformation

```javascript
function buildHierarchy(scanResult) {
  const { root, nodes } = scanResult;
  
  // Build tree from flat array
  const nodeMap = new Map();
  nodes.forEach(n => nodeMap.set(n.id, { ...n, children: [] }));
  
  let root_node;
  nodes.forEach(node => {
    if (node.parent_id === null) {
      root_node = nodeMap.get(node.id);
    } else {
      const parent = nodeMap.get(node.parent_id);
      if (parent) parent.children.push(nodeMap.get(node.id));
    }
  });
  
  // Sort children by size (largest first)
  const sortChildren = (n) => {
    n.children.sort((a, b) => b.size - a.size);
    n.children.forEach(sortChildren);
  };
  sortChildren(root_node);
  
  return root_node;
}
```

### Error Handling

```javascript
try {
  const data = await scanDirectory(path);
  renderChart(data);
} catch (error) {
  if (error.status === 403) {
    showError('Path not allowed. Check server configuration.');
  } else if (error.status === 404) {
    showError('Path does not exist.');
  } else {
    showError(`Scan failed: ${error.message}`);
  }
}
```

---

## File Structure

```
melon/frontend/
├── index.html          # Main HTML page
├── app.js              # Application entry point
├── chart.js            # D3 sunburst visualization
├── api.js              # API client
├── ui/
│   ├── breadcrumb.js   # Breadcrumb navigation
│   ├── details.js      # Details panel
│   ├── search.js       # Search panel
│   ├── settings.js     # Settings modal
│   └── progress.js     # Scan progress overlay
├── styles/
│   ├── main.css        # Main styles
│   ├── chart.css       # Chart-specific styles
│   ├── components.css  # Component styles
│   └── themes/
│       ├── light.css   # Light theme
│       └── dark.css    # Dark theme
├── utils/
│   ├── format.js       # Size/date formatting
│   ├── icons.js        # File type icons
│   └── storage.js      # LocalStorage wrapper
└── vendor/
    └── d3.min.js       # D3 library (or CDN)
```

---

## Implementation Phases

### Phase 1: MVP (Week 1)
- [ ] Basic HTML structure
- [ ] Path input and scan button
- [ ] Static sunburst chart (D3)
- [ ] Click to drill down
- [ ] Breadcrumb navigation
- [ ] Basic tooltip

### Phase 2: Polish (Week 2)
- [ ] Smooth animations
- [ ] Details panel
- [ ] Search functionality
- [ ] Settings panel
- [ ] Dark mode
- [ ] Keyboard shortcuts

### Phase 3: Advanced (Week 3)
- [ ] Progressive loading for large dirs
- [ ] Canvas rendering fallback
- [ ] Export functionality
- [ ] File type icons
- [ ] Right-click context menu
- [ ] Mobile optimizations

---

## Success Metrics

- **Load Time:** Chart renders in <2 seconds for 1000 nodes
- **Interaction:** Click to drill-down response <100ms
- **Accessibility:** Passes WCAG 2.1 AA
- **Browser Support:** Chrome, Firefox, Safari, Edge (latest 2 versions)
- **Mobile:** Usable on iPhone SE (375px width)

---

## Open Questions

1. **File preview?** - Show file content preview on hover/click?
2. **Comparison mode?** - Compare two scans side-by-side?
3. **Cleanup actions?** - Allow delete from UI (risky)?
4. **Cloud storage?** - Support Google Drive, Dropbox?
5. **Real-time updates?** - Watch for file changes and update chart?
