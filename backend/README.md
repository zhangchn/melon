# Backend API

FastAPI-based backend for the Web Disk Usage Analyzer.

## Installation

```bash
pip install -r requirements.txt
```

## Configuration

Environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `ALLOWED_PATHS` | `~/,/Volumes` | Comma-separated list of allowed root paths |
| `EXCLUDED_PATTERNS` | `.git,.svn,node_modules,...` | Comma-separated patterns to exclude |
| `MAX_DEPTH` | `50` | Maximum directory depth to scan |
| `MAX_RESULTS` | `100000` | Maximum number of nodes to return |
| `FOLLOW_SYMLINKS` | `false` | Whether to follow symbolic links |

## Running

```bash
# Development
python main.py

# Or with uvicorn directly
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

## API Endpoints

### `GET /health`
Health check.

### `GET /api/config`
Get server configuration.

### `GET /api/scan`
Scan a directory.

**Query params:**
- `path` (required): Directory to scan
- `force` (optional): Force rescan even if cached
- `compressed` (optional): Return gzipped response

**Response:**
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

### `GET /api/children`
Get immediate children (for lazy loading).

**Query params:**
- `path`: Scan this path shallowly
- `parent_id`: Get children from cached scan

### `GET /api/path`
Reconstruct full path for a node ID.

### `GET /api/search`
Search nodes by name.

### `DELETE /api/cache`
Clear scan cache.

## Data Format

Nodes are stored as a flat array with parent references:

```python
{
    "id": 42,           # Unique node ID
    "parent_id": 5,     # Parent node ID (null for root)
    "name": "file.txt", # File/directory name
    "size": 1024,       # Size in bytes
    "depth": 2,         # Depth from root
    "is_dir": false,    # True if directory
    "error": null       # Error message if any
}
```

This format is:
- **Compact**: No path repetition
- **Efficient**: Easy to reconstruct tree for any node
- **Serializable**: Simple JSON encoding

## Caching

Scan results are cached in memory for 5 minutes. Use `force=true` to rescan.

## Security

- Path validation prevents scanning outside allowed directories
- Symlink loops are detected and prevented
- Permission errors are handled gracefully (noted in node error field)
