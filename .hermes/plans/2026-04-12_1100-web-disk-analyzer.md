# Web-Based Disk Usage Analyzer (DaisyDisk Clone)

## Goal

Build a web-based hierarchical disk usage analysis tool that:
1. Scans a directory and calculates file/folder sizes
2. Visualizes data as an interactive multi-ring sunburst/pie chart
3. Allows users to click segments to drill down into subdirectories
4. Provides a clean, responsive web UI

## Current Context / Assumptions

- Starting from the `melon` git repository (currently has only README.md)
- Web-based: requires both backend (file system access) and frontend (visualization)
- Target platforms: macOS/Linux (Unix-like file systems)
- Single-user local tool (not multi-tenant cloud service)

## Proposed Approach

### Architecture

```
┌─────────────────┐     HTTP/JSON     ┌─────────────────┐
│   Frontend      │◄─────────────────►│    Backend      │
│   (React/Vue)   │                   │   (Python/Node) │
│   Sunburst viz  │                   │   File scanner  │
│   Interactive   │                   │   API server    │
└─────────────────┘                   └─────────────────┘
                                              │
                                              ▼
                                      ┌───────────────┐
                                      │  File System  │
                                      └───────────────┘
```

### Tech Stack

**Backend:**
- Python with FastAPI (lightweight, async, auto OpenAPI docs)
- `os.scandir` / `pathlib` for efficient file system traversal
- Optional: `watchdog` for real-time updates

**Frontend:**
- React or vanilla JS (keep it simple)
- D3.js for sunburst visualization (industry standard for hierarchical data)
- Tailwind CSS for styling

**Alternative (simpler):**
- Single-page app with Python backend serving static files
- No build step, minimal dependencies

## Step-by-Step Plan

### Phase 1: Backend Core (File Scanner API)

1. **Set up Python project structure**
   ```
   melon/
   ├── backend/
   │   ├── main.py          # FastAPI app
   │   ├── scanner.py       # Disk scanning logic
   │   └── requirements.txt
   └── frontend/
   ```

2. **Implement directory scanner**
   - Recursive traversal with size calculation
   - Return hierarchical JSON structure
   - Handle permissions errors gracefully
   - Support excluding patterns (`.git`, `node_modules`, etc.)

3. **Create API endpoints**
   - `GET /api/scan?path=/some/dir` - Scan and return tree
   - `GET /api/scan/progress` - WebSocket/SSE for progress updates
   - `GET /api/files?path=...` - List files in directory

### Phase 2: Frontend Visualization

4. **Set up basic HTML/CSS structure**
   - Single page layout
   - Path breadcrumb navigation
   - Size summary panel

5. **Implement sunburst chart with D3.js**
   - Multi-ring pie chart (each ring = directory depth)
   - Arc size proportional to file/folder size
   - Color coding by file type or depth

6. **Add interactivity**
   - Click segment to drill down
   - Breadcrumb navigation
   - Hover tooltips with size info
   - Click parent ring to go up

### Phase 3: Polish & Features

7. **Add useful features**
   - Sort by size/name
   - Filter by file type
   - Search within current directory
   - Export scan results (JSON)
   - Dark/light theme

8. **Performance optimizations**
   - Lazy loading for large directories
   - Debounced scan requests
   - Cache scan results
   - Web Workers for heavy computation

9. **Error handling & UX**
   - Permission denied warnings
   - Scan progress indicator
   - Empty directory states
   - Keyboard navigation

## Files to Create

```
melon/
├── backend/
│   ├── main.py              # FastAPI application
│   ├── scanner.py           # File system scanner
│   ├── models.py            # Pydantic models
│   └── requirements.txt
├── frontend/
│   ├── index.html           # Main page
│   ├── app.js               # Application logic
│   ├── sunburst.js          # D3 visualization
│   ├── styles.css           # Styling
│   └── vendor/
│       └── d3.min.js        # D3 library (or CDN)
├── README.md                # Update with usage instructions
└── .env                     # Configuration (optional)
```

## API Specification

### `GET /api/scan`

**Query params:**
- `path` (required): Directory path to scan
- `depth` (optional): Max depth to scan (default: unlimited)
- `exclude` (optional): Comma-separated patterns to exclude

**Response:**
```json
{
  "path": "/Users/cuser/Documents",
  "size": 1073741824,
  "items": [
    {
      "name": "github",
      "path": "/Users/cuser/Documents/github",
      "size": 536870912,
      "type": "directory",
      "items": [...]
    },
    {
      "name": "file.pdf",
      "path": "/Users/cuser/Documents/file.pdf",
      "size": 1048576,
      "type": "file",
      "extension": "pdf"
    }
  ]
}
```

### `GET /api/config`

**Response:**
```json
{
  "allowedPaths": ["/Users/cuser"],
  "excludedPatterns": [".git", "node_modules", "__pycache__"],
  "maxDepth": 50
}
```

## Tests / Validation

1. **Backend tests** (pytest)
   - Scanner handles empty directories
   - Scanner handles permission errors
   - Scanner respects exclude patterns
   - API returns correct JSON structure

2. **Frontend tests**
   - Sunburst renders correctly
   - Click navigation works
   - Breadcrumb updates correctly
   - Responsive layout on different screen sizes

3. **Manual testing**
   - Scan home directory (~100GB)
   - Verify performance with 10k+ files
   - Test with symlinks (should not follow by default)
   - Test with special characters in filenames

## Risks & Tradeoffs

| Risk | Mitigation |
|------|------------|
| Large directories cause slow scans | Add progress indicator, async scanning, depth limits |
| Permission errors on system dirs | Graceful error handling, show warnings not failures |
| Browser memory with huge trees | Limit initial depth, lazy load on click |
| Symlink loops | Track visited inodes, don't follow symlinks by default |
| Cross-platform path handling | Use `pathlib`, test on macOS/Linux |

## Open Questions

1. **Single user vs multi-user?** - Assuming single-user local tool for now
2. **Real-time updates?** - Can add `watchdog` later for live file changes
3. **Authentication?** - Not needed for local tool, but consider if exposing remotely
4. **Mobile support?** - Focus on desktop first, responsive design as bonus
5. **Export formats?** - JSON first, maybe CSV/Treemap visualization later

## Success Criteria

- [ ] Can scan a directory and display results in sunburst chart
- [ ] Clicking a segment drills down into that directory
- [ ] Breadcrumb shows current path and allows navigation
- [ ] Handles directories with 10k+ files without crashing
- [ ] Scan completes in <10 seconds for typical user directories
- [ ] Clean, intuitive UI that requires no explanation

## Future Enhancements (Post-MVP)

- Real-time file system watching
- Comparison between two scans (what changed)
- Cleanup suggestions (large files, duplicates)
- Integration with cloud storage
- Treemap view alternative
- Keyboard shortcuts
- PWA for offline use
