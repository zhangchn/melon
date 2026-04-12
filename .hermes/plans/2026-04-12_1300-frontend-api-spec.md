# Frontend API Specification

## Overview

This document defines the API contract between the frontend and backend for the Web Disk Usage Analyzer. It includes endpoint specifications, sample data fixtures, and test cases for frontend conformance testing.

---

## API Endpoints Summary

| Endpoint | Method | Purpose | Frontend Component |
|----------|--------|---------|-------------------|
| `/api/scan` | GET | Scan directory | PathInput, ProgressOverlay |
| `/api/children` | GET | Lazy-load children | SunburstChart (on drill-down) |
| `/api/path` | GET | Reconstruct full path | Tooltip, Breadcrumb |
| `/api/search` | GET | Search nodes | SearchPanel |
| `/api/config` | GET | Get server config | Settings, PathInput |
| `/api/cache` | DELETE | Clear cache | Settings |
| `/health` | GET | Health check | App (on mount) |

---

## Endpoint Specifications

### 1. GET /api/scan

**Purpose:** Scan a directory and return complete hierarchy.

**Request:**
```http
GET /api/scan?path=/Users/cuser/Documents&force=false&compressed=false
```

**Query Parameters:**
| Param | Type | Default | Required | Description |
|-------|------|---------|----------|-------------|
| `path` | string | - | Yes | Directory path to scan |
| `force` | boolean | false | No | Force rescan (bypass cache) |
| `compressed` | boolean | false | No | Return gzipped response |

**Success Response (200 OK):**
```json
{
  "root": "/Users/cuser/Documents",
  "nodes": [
    {
      "id": 0,
      "parent_id": null,
      "name": "Documents",
      "size": 1073741824,
      "depth": 0,
      "is_dir": true,
      "error": null
    },
    {
      "id": 1,
      "parent_id": 0,
      "name": "github",
      "size": 536870912,
      "depth": 1,
      "is_dir": true,
      "error": null
    }
  ],
  "total_size": 1073741824,
  "total_files": 1523,
  "total_dirs": 87,
  "scan_time_ms": 234.5
}
```

**Error Responses:**
```json
// 400 Bad Request - Path is a file
{
  "error": "Bad Request",
  "detail": "Path is not a directory"
}

// 403 Forbidden - Path not allowed
{
  "error": "Forbidden",
  "detail": "Path not allowed. Allowed paths: /Users/cuser,/Volumes"
}

// 404 Not Found - Path doesn't exist
{
  "error": "Not Found",
  "detail": "Path does not exist"
}

// 500 Internal Server Error
{
  "error": "Internal Server Error",
  "detail": "Scan failed: Permission denied"
}
```

**Frontend Usage:**
```javascript
async function scanDirectory(path) {
  const url = `/api/scan?path=${encodeURIComponent(path)}`;
  const response = await fetch(url);
  
  if (!response.ok) {
    const error = await response.json();
    throw new ScanError(error.detail, response.status);
  }
  
  return await response.json();
}
```

---

### 2. GET /api/children

**Purpose:** Get immediate children of a directory (for lazy loading).

**Request:**
```http
GET /api/children?path=/Users/cuser/Documents/github&parent_id=42
```

**Query Parameters:**
| Param | Type | Default | Required | Description |
|-------|------|---------|----------|-------------|
| `path` | string | - | Conditional | Directory path (if not using parent_id) |
| `parent_id` | integer | - | Conditional | Node ID from cached scan |

**Success Response (200 OK):**
```json
{
  "parent_id": 42,
  "children": [
    {
      "id": 101,
      "parent_id": 42,
      "name": "melon",
      "size": 31457280,
      "depth": 2,
      "is_dir": true,
      "error": null
    },
    {
      "id": 102,
      "parent_id": 42,
      "name": "README.md",
      "size": 3137,
      "depth": 2,
      "is_dir": false,
      "error": null
    }
  ]
}
```

**Frontend Usage:**
```javascript
// When user clicks a directory segment to drill down
async function loadChildren(parentId) {
  const response = await fetch(`/api/children?parent_id=${parentId}`);
  const data = await response.json();
  return data.children;
}
```

---

### 3. GET /api/path

**Purpose:** Reconstruct full path for a node ID.

**Request:**
```http
GET /api/path?node_id=101&root=/Users/cuser/Documents
```

**Query Parameters:**
| Param | Type | Default | Required | Description |
|-------|------|---------|----------|-------------|
| `node_id` | integer | - | Yes | Node ID |
| `root` | string | - | Yes | Root path of the scan |

**Success Response (200 OK):**
```json
{
  "node_id": 101,
  "root": "/Users/cuser/Documents",
  "path": "/Users/cuser/Documents/github/melon"
}
```

**Frontend Usage:**
```javascript
// For tooltip display
async function getNodePath(nodeId, rootPath) {
  const response = await fetch(
    `/api/path?node_id=${nodeId}&root=${encodeURIComponent(rootPath)}`
  );
  const data = await response.json();
  return data.path;
}
```

---

### 4. GET /api/search

**Purpose:** Search for nodes by name.

**Request:**
```http
GET /api/search?query=.py&root=/Users/cuser/Documents&limit=50
```

**Query Parameters:**
| Param | Type | Default | Required | Description |
|-------|------|---------|----------|-------------|
| `query` | string | - | Yes | Search query (substring match) |
| `root` | string | - | Yes | Root path of cached scan |
| `limit` | integer | 50 | No | Maximum results |

**Success Response (200 OK):**
```json
{
  "query": ".py",
  "root": "/Users/cuser/Documents",
  "results": [
    {
      "id": 205,
      "parent_id": 101,
      "name": "main.py",
      "size": 12991,
      "depth": 3,
      "is_dir": false,
      "path": "/Users/cuser/Documents/github/melon/backend/main.py"
    },
    {
      "id": 206,
      "parent_id": 101,
      "name": "scanner.py",
      "size": 9888,
      "depth": 3,
      "is_dir": false,
      "path": "/Users/cuser/Documents/github/melon/backend/scanner.py"
    }
  ],
  "count": 2
}
```

**Frontend Usage:**
```javascript
// Debounced search input
async function searchNodes(query, rootPath, limit = 50) {
  const url = `/api/search?query=${encodeURIComponent(query)}&root=${encodeURIComponent(rootPath)}&limit=${limit}`;
  const response = await fetch(url);
  return await response.json();
}
```

---

### 5. GET /api/config

**Purpose:** Get server configuration.

**Request:**
```http
GET /api/config
```

**Success Response (200 OK):**
```json
{
  "allowed_paths": [
    "/Users/cuser",
    "/Volumes"
  ],
  "excluded_patterns": [
    ".git",
    ".svn",
    "node_modules",
    "__pycache__",
    ".pytest_cache",
    ".venv",
    "venv",
    ".DS_Store",
    "Thumbs.db"
  ],
  "max_depth": 50,
  "max_results": 100000
}
```

**Frontend Usage:**
```javascript
// On app mount
async function loadConfig() {
  const response = await fetch('/api/config');
  const config = await response.json();
  
  // Populate quick-select buttons
  config.allowed_paths.forEach(path => {
    addQuickSelectButton(path);
  });
  
  // Show excluded patterns in settings
  renderExcludePatterns(config.excluded_patterns);
}
```

---

### 6. DELETE /api/cache

**Purpose:** Clear scan cache.

**Request:**
```http
DELETE /api/cache
DELETE /api/cache?path=/Users/cuser/Documents
```

**Query Parameters:**
| Param | Type | Default | Required | Description |
|-------|------|---------|----------|-------------|
| `path` | string | - | No | Specific path to clear |

**Success Response (200 OK):**
```json
// Clear all
{
  "cleared": 5
}

// Clear specific path
{
  "cleared": ["/Users/cuser/Documents"]
}
```

---

### 7. GET /health

**Purpose:** Health check.

**Request:**
```http
GET /health
```

**Success Response (200 OK):**
```json
{
  "status": "healthy",
  "timestamp": 1775967524.702141
}
```

---

## Sample Data Fixtures

### Fixture 1: Small Directory (5 nodes)

**Use Case:** Unit testing, initial development

```json
{
  "root": "/test/small",
  "nodes": [
    {"id": 0, "parent_id": null, "name": "small", "size": 15360, "depth": 0, "is_dir": true, "error": null},
    {"id": 1, "parent_id": 0, "name": "file1.txt", "size": 1024, "depth": 1, "is_dir": false, "error": null},
    {"id": 2, "parent_id": 0, "name": "file2.txt", "size": 2048, "depth": 1, "is_dir": false, "error": null},
    {"id": 3, "parent_id": 0, "name": "subdir", "size": 12288, "depth": 1, "is_dir": true, "error": null},
    {"id": 4, "parent_id": 3, "name": "nested.txt", "size": 12288, "depth": 2, "is_dir": false, "error": null}
  ],
  "total_size": 15360,
  "total_files": 3,
  "total_dirs": 2,
  "scan_time_ms": 1.5
}
```

**Expected Chart:**
- Inner ring: `small` (100%)
- Middle ring: 3 segments (file1: 6.7%, file2: 13.3%, subdir: 80%)
- Outer ring: 1 segment under subdir (nested: 100% of subdir)

---

### Fixture 2: Medium Directory (25 nodes)

**Use Case:** Integration testing, typical user scenario

```json
{
  "root": "/Users/cuser/Documents/github/melon",
  "nodes": [
    {"id": 0, "parent_id": null, "name": "melon", "size": 51200, "depth": 0, "is_dir": true, "error": null},
    {"id": 1, "parent_id": 0, "name": "backend", "size": 35000, "depth": 1, "is_dir": true, "error": null},
    {"id": 2, "parent_id": 1, "name": "main.py", "size": 13000, "depth": 2, "is_dir": false, "error": null},
    {"id": 3, "parent_id": 1, "name": "scanner.py", "size": 10000, "depth": 2, "is_dir": false, "error": null},
    {"id": 4, "parent_id": 1, "name": "models.py", "size": 2500, "depth": 2, "is_dir": false, "error": null},
    {"id": 5, "parent_id": 1, "name": "test_api.py", "size": 9500, "depth": 2, "is_dir": false, "error": null},
    {"id": 6, "parent_id": 0, "name": "frontend", "size": 15000, "depth": 1, "is_dir": true, "error": null},
    {"id": 7, "parent_id": 6, "name": "index.html", "size": 2000, "depth": 2, "is_dir": false, "error": null},
    {"id": 8, "parent_id": 6, "name": "app.js", "size": 8000, "depth": 2, "is_dir": false, "error": null},
    {"id": 9, "parent_id": 6, "name": "chart.js", "size": 5000, "depth": 2, "is_dir": false, "error": null},
    {"id": 10, "parent_id": 0, "name": "README.md", "size": 1200, "depth": 1, "is_dir": false, "error": null}
  ],
  "total_size": 51200,
  "total_files": 8,
  "total_dirs": 3,
  "scan_time_ms": 5.2
}
```

**Expected Chart:**
- 3 segments in first ring (backend: 68%, frontend: 29%, README: 2%)
- backend has 4 file children
- frontend has 3 file children

---

### Fixture 3: Large Directory (100+ nodes)

**Use Case:** Performance testing, stress testing

```json
{
  "root": "/Users/cuser",
  "nodes": [
    {"id": 0, "parent_id": null, "name": "cuser", "size": 10737418240, "depth": 0, "is_dir": true, "error": null},
    {"id": 1, "parent_id": 0, "name": "Documents", "size": 5368709120, "depth": 1, "is_dir": true, "error": null},
    {"id": 2, "parent_id": 0, "name": "Downloads", "size": 3221225472, "depth": 1, "is_dir": true, "error": null},
    {"id": 3, "parent_id": 0, "name": "Pictures", "size": 2147483648, "depth": 1, "is_dir": true, "error": null},
    // ... 100+ more nodes
  ],
  "total_size": 10737418240,
  "total_files": 523,
  "total_dirs": 87,
  "scan_time_ms": 234.5
}
```

**Performance Requirements:**
- Initial render: < 2 seconds
- Drill-down animation: < 100ms
- Memory usage: < 50MB

---

### Fixture 4: Edge Cases

#### 4a: Empty Directory
```json
{
  "root": "/test/empty",
  "nodes": [
    {"id": 0, "parent_id": null, "name": "empty", "size": 0, "depth": 0, "is_dir": true, "error": null}
  ],
  "total_size": 0,
  "total_files": 0,
  "total_dirs": 1,
  "scan_time_ms": 0.5
}
```

**Frontend Handling:** Show "Empty directory" message, disable drill-down.

#### 4b: Permission Denied
```json
{
  "root": "/test/restricted",
  "nodes": [
    {"id": 0, "parent_id": null, "name": "restricted", "size": 10240, "depth": 0, "is_dir": true, "error": null},
    {"id": 1, "parent_id": 0, "name": "public", "size": 5120, "depth": 1, "is_dir": true, "error": null},
    {"id": 2, "parent_id": 0, "name": "private", "size": 5120, "depth": 1, "is_dir": true, "error": "Permission denied"}
  ],
  "total_size": 10240,
  "total_files": 0,
  "total_dirs": 3,
  "scan_time_ms": 2.1
}
```

**Frontend Handling:** Show warning icon on `private`, tooltip shows error message.

#### 4c: Deep Nesting (10 levels)
```json
{
  "root": "/test/deep",
  "nodes": [
    {"id": 0, "parent_id": null, "name": "deep", "size": 1024, "depth": 0, "is_dir": true, "error": null},
    {"id": 1, "parent_id": 0, "name": "l1", "size": 1024, "depth": 1, "is_dir": true, "error": null},
    {"id": 2, "parent_id": 1, "name": "l2", "size": 1024, "depth": 2, "is_dir": true, "error": null},
    {"id": 3, "parent_id": 2, "name": "l3", "size": 1024, "depth": 3, "is_dir": true, "error": null},
    {"id": 4, "parent_id": 3, "name": "l4", "size": 1024, "depth": 4, "is_dir": true, "error": null},
    {"id": 5, "parent_id": 4, "name": "l5", "size": 1024, "depth": 5, "is_dir": true, "error": null},
    {"id": 6, "parent_id": 5, "name": "l6", "size": 1024, "depth": 6, "is_dir": true, "error": null},
    {"id": 7, "parent_id": 6, "name": "l7", "size": 1024, "depth": 7, "is_dir": true, "error": null},
    {"id": 8, "parent_id": 7, "name": "l8", "size": 1024, "depth": 8, "is_dir": true, "error": null},
    {"id": 9, "parent_id": 8, "name": "l9", "size": 1024, "depth": 9, "is_dir": true, "error": null},
    {"id": 10, "parent_id": 9, "name": "l10", "size": 1024, "depth": 10, "is_dir": true, "error": null},
    {"id": 11, "parent_id": 10, "name": "file.txt", "size": 1024, "depth": 11, "is_dir": false, "error": null}
  ],
  "total_size": 1024,
  "total_files": 1,
  "total_dirs": 11,
  "scan_time_ms": 3.2
}
```

**Frontend Handling:** Chart should show 12 rings, may need zoom/scroll for outer rings.

#### 4d: Single Large File
```json
{
  "root": "/test/single",
  "nodes": [
    {"id": 0, "parent_id": null, "name": "single", "size": 1073741824, "depth": 0, "is_dir": true, "error": null},
    {"id": 1, "parent_id": 0, "name": "huge.iso", "size": 1073741824, "depth": 1, "is_dir": false, "error": null}
  ],
  "total_size": 1073741824,
  "total_files": 1,
  "total_dirs": 1,
  "scan_time_ms": 0.8
}
```

**Frontend Handling:** Single segment filling entire chart.

---

## Frontend Conformance Tests

### Test 1: Data Parsing

```javascript
// Test: Parse scan response correctly
function testParseScanResponse() {
  const fixture = loadFixture('small');
  const result = parseScanResponse(fixture);
  
  assert(result.root === '/test/small');
  assert(result.nodes.length === 5);
  assert(result.total_size === 15360);
  
  // Verify node structure
  const rootNode = result.nodes.find(n => n.parent_id === null);
  assert(rootNode.name === 'small');
  assert(rootNode.is_dir === true);
}
```

### Test 2: Tree Building

```javascript
// Test: Build hierarchy from flat array
function testBuildHierarchy() {
  const fixture = loadFixture('small');
  const tree = buildHierarchy(fixture);
  
  assert(tree.name === 'small');
  assert(tree.children.length === 3);
  
  const subdir = tree.children.find(c => c.name === 'subdir');
  assert(subdir.children.length === 1);
  assert(subdir.children[0].name === 'nested.txt');
}
```

### Test 3: Size Formatting

```javascript
// Test: Format sizes correctly
function testFormatSize() {
  assert(formatSize(512) === '512 B');
  assert(formatSize(1024) === '1 KB');
  assert(formatSize(1536) === '1.5 KB');
  assert(formatSize(1048576) === '1 MB');
  assert(formatSize(1073741824) === '1 GB');
}
```

### Test 4: Percentage Calculation

```javascript
// Test: Calculate percentages correctly
function testCalculatePercentage() {
  const parent = { size: 10000 };
  const child = { size: 2500 };
  
  const pct = calculatePercentage(child, parent);
  assert(pct === 25);
}
```

### Test 5: Error Handling

```javascript
// Test: Handle API errors gracefully
async function testErrorHandling() {
  // Mock 403 response
  mockFetch('/api/scan?path=/forbidden', { status: 403, body: { error: 'Forbidden', detail: 'Path not allowed' } });
  
  try {
    await scanDirectory('/forbidden');
    assert.fail('Should have thrown');
  } catch (err) {
    assert(err.status === 403);
    assert(err.message.includes('Path not allowed'));
  }
}
```

### Test 6: Empty Directory

```javascript
// Test: Handle empty directory
function testEmptyDirectory() {
  const fixture = loadFixture('empty');
  const tree = buildHierarchy(fixture);
  
  assert(tree.children.length === 0);
  assert(tree.size === 0);
  
  // Frontend should show "Empty directory" message
  const message = getEmptyStateMessage(tree);
  assert(message === 'This directory is empty');
}
```

### Test 7: Permission Errors

```javascript
// Test: Display permission errors
function testPermissionErrors() {
  const fixture = loadFixture('permission_denied');
  const privateNode = fixture.nodes.find(n => n.name === 'private');
  
  assert(privateNode.error === 'Permission denied');
  
  // Frontend should show warning icon
  const hasWarning = hasErrorIndicator(privateNode);
  assert(hasWarning === true);
}
```

### Test 8: Search Results

```javascript
// Test: Display search results
function testSearchResults() {
  const fixture = {
    query: '.py',
    results: [
      { id: 1, name: 'main.py', size: 1000, path: '/app/main.py' },
      { id: 2, name: 'test.py', size: 500, path: '/app/test.py' }
    ],
    count: 2
  };
  
  renderSearchResults(fixture);
  
  const resultItems = document.querySelectorAll('.search-result');
  assert(resultItems.length === 2);
  assert(resultItems[0].textContent.includes('main.py'));
}
```

### Test 9: Breadcrumb Navigation

```javascript
// Test: Build breadcrumb from path
function testBreadcrumb() {
  const path = '/Users/cuser/Documents/github/melon';
  const crumbs = buildBreadcrumb(path);
  
  assert(crumbs.length === 5);
  assert(crumbs[0].name === 'Users');
  assert(crumbs[1].name === 'cuser');
  assert(crumbs[4].name === 'melon');
  assert(crumbs[4].isCurrent === true);
}
```

### Test 10: Chart Rendering

```javascript
// Test: Render chart with fixture data
async function testChartRendering() {
  const fixture = loadFixture('medium');
  const tree = buildHierarchy(fixture);
  
  renderChart(tree);
  
  // Wait for D3 transitions
  await sleep(500);
  
  // Verify segments exist
  const segments = document.querySelectorAll('.chart-segment');
  assert(segments.length >= 3); // At least root children
  
  // Verify largest segment is backend
  const largest = getLargestSegment();
  assert(largest.dataset.name === 'backend');
}
```

---

## Mock API Server for Frontend Development

```javascript
// mock-api.js - In-browser mock for frontend development

const FIXTURES = {
  small: { /* ... fixture data ... */ },
  medium: { /* ... fixture data ... */ },
  large: { /* ... fixture data ... */ },
  empty: { /* ... fixture data ... */ },
};

class MockApiServer {
  constructor() {
    this.cache = new Map();
  }
  
  async scan(path, options = {}) {
    // Simulate network delay
    await sleep(100 + Math.random() * 200);
    
    // Return fixture based on path
    if (path.includes('small')) return FIXTURES.small;
    if (path.includes('medium')) return FIXTURES.medium;
    if (path.includes('empty')) return FIXTURES.empty;
    
    // Default to medium
    return FIXTURES.medium;
  }
  
  async children(parentId) {
    await sleep(50);
    
    // Find children in cached data
    const cached = this.cache.get('current');
    if (!cached) return { parent_id: parentId, children: [] };
    
    const children = cached.nodes.filter(n => n.parent_id === parentId);
    return { parent_id: parentId, children };
  }
  
  async search(query, root, limit = 50) {
    await sleep(100);
    
    const cached = this.cache.get('current');
    if (!cached) return { query, root, results: [], count: 0 };
    
    const results = cached.nodes
      .filter(n => n.name.toLowerCase().includes(query.toLowerCase()))
      .slice(0, limit);
    
    return { query, root, results, count: results.length };
  }
}

// Usage in frontend development
const api = new MockApiServer();
// Replace with real API when ready
// const api = new RealApiClient('http://localhost:8000');
```

---

## Data Transformation Utilities

```javascript
// utils/data-transform.js

/**
 * Convert flat node array to hierarchical tree
 */
function buildHierarchy(scanResult) {
  const { root: rootPath, nodes } = scanResult;
  
  // Create node map
  const nodeMap = new Map();
  nodes.forEach(n => {
    nodeMap.set(n.id, {
      ...n,
      children: [],
      value: n.size, // D3 expects 'value' for sizing
    });
  });
  
  // Build tree
  let rootNode = null;
  nodes.forEach(node => {
    if (node.parent_id === null) {
      rootNode = nodeMap.get(node.id);
    } else {
      const parent = nodeMap.get(node.parent_id);
      if (parent) {
        parent.children.push(nodeMap.get(node.id));
      }
    }
  });
  
  // Sort children by size (largest first for better visualization)
  const sortChildren = (node) => {
    node.children.sort((a, b) => b.size - a.size);
    node.children.forEach(sortChildren);
  };
  
  if (rootNode) {
    sortChildren(rootNode);
  }
  
  return rootNode;
}

/**
 * Calculate percentage of parent size
 */
function calculatePercentage(node, parent) {
  if (!parent || parent.size === 0) return 0;
  return Math.round((node.size / parent.size) * 1000) / 10;
}

/**
 * Format size in human-readable format
 */
function formatSize(bytes) {
  if (bytes === 0) return '0 B';
  
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + units[i];
}

/**
 * Format scan time
 */
function formatTime(ms) {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

/**
 * Get file icon based on extension
 */
function getFileIcon(filename, isDir) {
  if (isDir) return '📁';
  
  const ext = filename.split('.').pop().toLowerCase();
  const icons = {
    'py': '🐍',
    'js': '📜',
    'html': '🌐',
    'css': '🎨',
    'json': '📋',
    'md': '📝',
    'txt': '📄',
    'jpg': '🖼️',
    'png': '🖼️',
    'gif': '🖼️',
    'mp4': '🎬',
    'mp3': '🎵',
    'pdf': '📕',
    'zip': '📦',
    'git': '🔧',
  };
  
  return icons[ext] || '📄';
}
```

---

## Frontend API Client

```javascript
// api/client.js

class DiskAnalyzerApi {
  constructor(baseUrl = '') {
    this.baseUrl = baseUrl;
  }
  
  async request(endpoint, options = {}) {
    const url = `${this.baseUrl}${endpoint}`;
    const response = await fetch(url, options);
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new ApiError(error.detail || error.error || 'Unknown error', response.status);
    }
    
    return response.json();
  }
  
  async health() {
    return this.request('/health');
  }
  
  async getConfig() {
    return this.request('/api/config');
  }
  
  async scan(path, options = {}) {
    const params = new URLSearchParams({ path });
    if (options.force) params.append('force', 'true');
    if (options.compressed) params.append('compressed', 'true');
    
    return this.request(`/api/scan?${params}`);
  }
  
  async children(path, parentId = null) {
    const params = new URLSearchParams();
    if (parentId !== null) {
      params.append('parent_id', parentId.toString());
    } else {
      params.append('path', path);
    }
    
    return this.request(`/api/children?${params}`);
  }
  
  async path(nodeId, root) {
    const params = new URLSearchParams({
      node_id: nodeId.toString(),
      root,
    });
    
    return this.request(`/api/path?${params}`);
  }
  
  async search(query, root, limit = 50) {
    const params = new URLSearchParams({
      query,
      root,
      limit: limit.toString(),
    });
    
    return this.request(`/api/search?${params}`);
  }
  
  async clearCache(path = null) {
    const endpoint = path 
      ? `/api/cache?path=${encodeURIComponent(path)}`
      : '/api/cache';
    
    return this.request(endpoint, { method: 'DELETE' });
  }
}

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}
```

---

## Summary

### Required Endpoints for MVP

1. **`GET /api/scan`** - Core scanning (required)
2. **`GET /api/config`** - Path validation (required)
3. **`GET /health`** - Connection check (required)

### Required for Full Features

4. **`GET /api/children`** - Lazy loading (recommended)
5. **`GET /api/search`** - Search panel (optional)
6. **`GET /api/path`** - Path reconstruction (optional, can compute client-side)
7. **`DELETE /api/cache`** - Cache management (optional)

### Sample Fixtures Provided

- Small (5 nodes) - Unit tests
- Medium (25 nodes) - Integration tests
- Large (100+ nodes) - Performance tests
- Edge cases (empty, permission denied, deep, single file)

### Frontend Conformance Tests

10 test cases covering:
- Data parsing
- Tree building
- Size formatting
- Error handling
- Edge cases
- Search
- Breadcrumbs
- Chart rendering
