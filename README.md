# Web Disk Usage Analyzer

A web-based hierarchical disk usage analysis tool inspired by DaisyDisk. Visualizes disk usage as an interactive multi-ring sunburst chart.

## Features

- **Interactive Sunburst Chart**: Multi-ring pie chart showing directory hierarchy
- **Drill-down Navigation**: Click segments to explore subdirectories
- **Fast Scanning**: Efficient file system traversal with caching
- **Configurable**: Exclude patterns, depth limits, path restrictions
- **Web-based**: Access from any browser, no installation needed

## Project Structure

```
melon/
├── backend/           # FastAPI backend
│   ├── main.py       # API server
│   ├── scanner.py    # File system scanner
│   ├── models.py     # Pydantic models
│   └── requirements.txt
├── frontend/          # Web UI (to be implemented)
└── README.md
```

## Backend API

### Quick Start

```bash
cd backend
pip install -r requirements.txt
python main.py
```

Server runs at http://localhost:8000

### API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /health` | Health check |
| `GET /api/config` | Server configuration |
| `GET /api/scan?path=/some/dir` | Scan directory |
| `GET /api/children?path=/dir` | Get immediate children |
| `GET /api/search?query=txt&root=/dir` | Search nodes |
| `DELETE /api/cache` | Clear scan cache |

### Example Usage

```bash
# Scan a directory
curl "http://localhost:8000/api/scan?path=/Users/cuser/Documents"

# Get config
curl "http://localhost:8000/api/config"

# Search for files
curl "http://localhost:8000/api/search?query=.py&root=/Users/cuser"
```

### Configuration

Environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `ALLOWED_PATHS` | `~/,/Volumes` | Allowed root paths |
| `EXCLUDED_PATTERNS` | `.git,node_modules,...` | Patterns to exclude |
| `MAX_DEPTH` | `50` | Max scan depth |
| `MAX_RESULTS` | `100000` | Max nodes to return |

See [backend/README.md](backend/README.md) for full API documentation.

## Data Format

Scan results use a compact flat array format:

```json
{
  "root": "/Users/cuser/Documents",
  "nodes": [
    {"id": 0, "parent_id": null, "name": "Documents", "size": 1073741824, "depth": 0, "is_dir": true},
    {"id": 1, "parent_id": 0, "name": "github", "size": 536870912, "depth": 1, "is_dir": true}
  ],
  "total_size": 1073741824,
  "total_files": 150,
  "total_dirs": 25,
  "scan_time_ms": 234.5
}
```

Benefits:
- No path repetition (saves 80%+ space vs nested JSON)
- Easy to reconstruct tree for any node
- Efficient for compression

## Frontend (Planned)

The frontend will use D3.js to render an interactive sunburst chart:

- Each ring represents a directory depth level
- Arc size proportional to file/folder size
- Click to drill down, hover for details
- Breadcrumb navigation

See `.hermes/plans/` for the full implementation plan.

## Development

```bash
# Run backend
cd backend && python main.py

# Run tests
cd backend && python test_backend.py

# Start frontend (when implemented)
# Will be served automatically by backend at /
```

## License

MIT
