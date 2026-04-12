# Frontend Internal API Design

## Overview

This document defines the **internal frontend API** - how JavaScript components transform backend data into DOM/SVG/D3.js visualizations. This is the client-side architecture, not the backend HTTP API.

---

## Component Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  App (app.js) - Root component, state management            │
├─────────────────────────────────────────────────────────────┤
│  Header                                                     │
│  ├── PathInput (ui/path-input.js)                          │
│  └── Breadcrumb (ui/breadcrumb.js)                         │
├─────────────────────────────────────────────────────────────┤
│  Main                                                       │
│  └── SunburstChart (chart.js)                              │
│      ├── D3 Layout (d3.hierarchy, d3.partition)            │
│      ├── Arc Generator (d3.arc)                            │
│      ├── Interactions (click, hover, zoom)                 │
│      └── Transitions (d3.transition)                       │
├─────────────────────────────────────────────────────────────┤
│  Footer                                                     │
│  ├── DetailsPanel (ui/details-panel.js)                    │
│  ├── SearchPanel (ui/search-panel.js)                      │
│  └── StatusBar (ui/status-bar.js)                          │
└─────────────────────────────────────────────────────────────┘
```

---

## Data Flow Pipeline

```
Backend JSON
    │
    ▼
api/client.js → fetch() → ScanResponse
    │
    ▼
utils/transform.js → buildHierarchy() → D3 Hierarchy Node
    │
    ▼
chart.js → renderChart() → SVG <g> elements
    │
    ▼
D3 Transitions → Animated arcs
    │
    ▼
DOM Updates → Tooltip, Details, Breadcrumb
```

---

## Module 1: API Client (api/client.js)

### Interface

```javascript
class DiskAnalyzerApi {
  constructor(baseUrl: string)
  
  health(): Promise<HealthResponse>
  getConfig(): Promise<ConfigResponse>
  scan(path: string, options?: ScanOptions): Promise<ScanResponse>
  children(parentId: number): Promise<ChildrenResponse>
  search(query: string, root: string, limit?: number): Promise<SearchResponse>
  clearCache(path?: string): Promise<ClearCacheResponse>
}
```

### Implementation

```javascript
// api/client.js

export class DiskAnalyzerApi {
  constructor(baseUrl = '') {
    this.baseUrl = baseUrl;
  }
  
  async health() {
    const res = await fetch(`${this.baseUrl}/health`);
    if (!res.ok) throw new ApiError('Backend unhealthy', res.status);
    return res.json();
  }
  
  async getConfig() {
    const res = await fetch(`${this.baseUrl}/api/config`);
    if (!res.ok) throw new ApiError('Failed to load config', res.status);
    return res.json();
  }
  
  async scan(path, options = {}) {
    const params = new URLSearchParams({ path });
    if (options.force) params.set('force', 'true');
    
    const res = await fetch(`${this.baseUrl}/api/scan?${params}`);
    if (!res.ok) {
      const error = await res.json();
      throw new ScanError(error.detail, res.status, path);
    }
    return res.json();
  }
  
  async children(parentId) {
    const res = await fetch(`${this.baseUrl}/api/children?parent_id=${parentId}`);
    if (!res.ok) throw new ApiError('Failed to load children', res.status);
    return res.json();
  }
  
  async search(query, root, limit = 50) {
    const params = new URLSearchParams({ query, root, limit: String(limit) });
    const res = await fetch(`${this.baseUrl}/api/search?${params}`);
    if (!res.ok) throw new ApiError('Search failed', res.status);
    return res.json();
  }
  
  async clearCache(path = null) {
    const url = path 
      ? `${this.baseUrl}/api/cache?path=${encodeURIComponent(path)}`
      : `${this.baseUrl}/api/cache`;
    
    const res = await fetch(url, { method: 'DELETE' });
    if (!res.ok) throw new ApiError('Failed to clear cache', res.status);
    return res.json();
  }
}

export class ApiError extends Error {
  constructor(message, status, details = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

export class ScanError extends ApiError {
  constructor(message, status, path) {
    super(message, status);
    this.name = 'ScanError';
    this.path = path;
  }
}
```

### Usage Example

```javascript
// app.js
import { DiskAnalyzerApi, ScanError } from './api/client.js';

const api = new DiskAnalyzerApi('http://localhost:8000');

try {
  const data = await api.scan('/Users/cuser/Documents');
  // Process data...
} catch (err) {
  if (err instanceof ScanError) {
    showError(`Cannot scan ${err.path}: ${err.message}`);
  } else {
    showError(err.message);
  }
}
```

---

## Module 2: Data Transform (utils/transform.js)

### Interface

```javascript
// Convert flat node array to D3 hierarchy
buildHierarchy(scanResult: ScanResponse): D3HierarchyNode

// Build parent lookup map
buildNodeMap(nodes: Array<Node>): Map<nodeId, Node>

// Calculate percentage of parent
calculatePercentage(node: Node, parent: Node): number

// Format size for display
formatSize(bytes: number): string

// Format time for display
formatTime(ms: number): string

// Get file icon by extension
getFileIcon(filename: string, isDir: boolean): string

// Sort nodes by size
sortNodes(nodes: Array<Node>, by: 'size' | 'name' | 'depth'): Array<Node>
```

### Implementation

```javascript
// utils/transform.js

import { hierarchy } from 'd3-hierarchy';

/**
 * Convert flat node array to D3 hierarchy tree
 */
export function buildHierarchy(scanResult) {
  const { root: rootPath, nodes } = scanResult;
  
  // Build node map for quick lookup
  const nodeMap = new Map();
  nodes.forEach(n => {
    nodeMap.set(n.id, {
      ...n,
      children: [],
      value: n.size,  // D3 expects 'value' for sizing
      x0: 0, x1: 0,   // Will be set by partition layout
      y0: 0, y1: 0,
    });
  });
  
  // Build parent-child relationships
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
  
  if (!rootNode) {
    throw new Error('No root node found in scan data');
  }
  
  // Create D3 hierarchy
  const d3Root = hierarchy(rootNode)
    .sum(d => d.value)
    .sort((a, b) => b.value - a.value);  // Largest first
  
  // Attach metadata
  d3Root.rootPath = rootPath;
  
  return d3Root;
}

/**
 * Build lookup map from node array
 */
export function buildNodeMap(nodes) {
  return new Map(nodes.map(n => [n.id, n]));
}

/**
 * Calculate percentage of parent size
 */
export function calculatePercentage(node, parent) {
  if (!parent || parent.size === 0) return 0;
  return Math.round((node.size / parent.size) * 1000) / 10;
}

/**
 * Format bytes to human-readable string
 */
export function formatSize(bytes) {
  if (bytes === 0) return '0 B';
  if (bytes < 0) return 'Invalid size';
  
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const k = 1024;
  const i = Math.min(
    Math.floor(Math.log(bytes) / Math.log(k)),
    units.length - 1
  );
  
  const value = bytes / Math.pow(k, i);
  return `${value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)} ${units[i]}`;
}

/**
 * Format milliseconds to human-readable string
 */
export function formatTime(ms) {
  if (ms < 1) return '<1 ms';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

/**
 * Get file icon based on extension
 */
export function getFileIcon(filename, isDir) {
  if (isDir) return '📁';
  
  const ext = filename.split('.').pop().toLowerCase();
  const icons = {
    // Code
    'py': '🐍',
    'js': '📜',
    'ts': '📘',
    'jsx': '⚛️',
    'tsx': '⚛️',
    'html': '🌐',
    'css': '🎨',
    'scss': '🎨',
    'json': '📋',
    'yaml': '📋',
    'yml': '📋',
    'xml': '📋',
    
    // Documents
    'md': '📝',
    'txt': '📄',
    'rtf': '📄',
    'pdf': '📕',
    'doc': '📘',
    'docx': '📘',
    'xls': '📊',
    'xlsx': '📊',
    'ppt': '📽️',
    'pptx': '📽️',
    
    // Images
    'jpg': '🖼️',
    'jpeg': '🖼️',
    'png': '🖼️',
    'gif': '🖼️',
    'svg': '🖼️',
    'webp': '🖼️',
    'ico': '🖼️',
    'bmp': '🖼️',
    
    // Video/Audio
    'mp4': '🎬',
    'avi': '🎬',
    'mkv': '🎬',
    'mov': '🎬',
    'mp3': '🎵',
    'wav': '🎵',
    'flac': '🎵',
    'ogg': '🎵',
    
    // Archives
    'zip': '📦',
    'tar': '📦',
    'gz': '📦',
    'rar': '📦',
    '7z': '📦',
    
    // Config/System
    'git': '🔧',
    'gitignore': '🔧',
    'env': '⚙️',
    'log': '📜',
    'sh': '💻',
    'bash': '💻',
    'zsh': '💻',
  };
  
  return icons[ext] || '📄';
}

/**
 * Sort nodes by specified field
 */
export function sortNodes(nodes, by = 'size') {
  const comparators = {
    size: (a, b) => b.size - a.size,
    name: (a, b) => a.name.localeCompare(b.name),
    depth: (a, b) => a.depth - b.depth,
  };
  
  return [...nodes].sort(comparators[by] || comparators.size);
}

/**
 * Get color for node based on type and depth
 */
export function getNodeColor(node, colorScale) {
  return colorScale(node.is_dir ? 'dir' : 'file', node.depth);
}
```

### Usage Example

```javascript
// chart.js
import { buildHierarchy, formatSize, calculatePercentage } from './utils/transform.js';

const scanData = await api.scan('/Users/cuser');
const root = buildHierarchy(scanData);

// Access formatted values
root.each(node => {
  node.displaySize = formatSize(node.data.size);
  node.parentPercent = calculatePercentage(node.data, node.parent?.data);
});
```

---

## Module 3: Sunburst Chart (chart.js)

### Interface

```javascript
class SunburstChart {
  constructor(container: HTMLElement, options?: ChartOptions)
  
  render(data: D3HierarchyNode): void
  update(data: D3HierarchyNode): void
  destroy(): void
  
  // Navigation
  drillDown(node: D3HierarchyNode): void
  goUp(): void
  goToRoot(): void
  
  // Selection
  select(node: D3HierarchyNode): void
  clearSelection(): void
  
  // Zoom
  zoomIn(): void
  zoomOut(): void
  resetZoom(): void
  
  // Events
  onNodeClick(callback: (node) => void): this
  onNodeHover(callback: (node) => void): this
  onNavigate(callback: (path) => void): this
}
```

### Implementation

```javascript
// chart.js

import { partition, hierarchy } from 'd3-hierarchy';
import { arc } from 'd3-shape';
import { scaleLinear, scaleOrdinal } from 'd3-scale';
import { select } from 'd3-selection';
import { transition } from 'd3-transition';
import { interpolate } from 'd3-interpolate';
import { zoom } from 'd3-zoom';

const DEFAULTS = {
  width: 600,
  height: 600,
  radius: 280,
  animationDuration: 750,
  colors: {
    dir: ['#3B82F6', '#8B5CF6', '#A78BFA', '#C4B5FD'],
    file: ['#10B981', '#14B8A6', '#2DD4BF', '#5EEAD4'],
  },
};

export class SunburstChart {
  constructor(container, options = {}) {
    this.options = { ...DEFAULTS, ...options };
    this.container = select(container);
    this.currentNode = null;
    this.selectedNode = null;
    
    this._initSvg();
    this._initScales();
    this._initArc();
    this._initZoom();
    this._bindEvents();
  }
  
  _initSvg() {
    const { width, height } = this.options;
    
    this.svg = this.container
      .append('svg')
      .attr('width', width)
      .attr('height', height)
      .attr('viewBox', [-width/2, -height/2, width, height])
      .attr('style', 'max-width: 100%; height: auto;');
    
    this.g = this.svg
      .append('g')
      .attr('class', 'sunburst-chart');
  }
  
  _initScales() {
    const { colors } = this.options;
    
    // Color scale for directories (by depth)
    this.dirColorScale = scaleOrdinal()
      .domain([0, 1, 2, 3, 4])
      .range(colors.dir);
    
    // Color scale for files (by depth)
    this.fileColorScale = scaleOrdinal()
      .domain([0, 1, 2, 3, 4])
      .range(colors.file);
    
    // Opacity scale for hover effects
    this.opacityScale = scaleLinear()
      .domain([0, 1])
      .range([0.5, 1]);
  }
  
  _initArc() {
    this.arcGenerator = arc()
      .startAngle(d => d.x0)
      .endAngle(d => d.x1)
      .padAngle(d => Math.min((d.x1 - d.x0) / 2, 0.005))
      .padRadius(this.options.radius * 1.5)
      .innerRadius(d => d.y0)
      .outerRadius(d => Math.max(d.y0, d.y1 - 1));
  }
  
  _initZoom() {
    this.zoomBehavior = zoom()
      .scaleExtent([0.5, 4])
      .on('zoom', (event) => {
        this.g.attr('transform', event.transform);
      });
    
    this.svg.call(this.zoomBehavior);
  }
  
  _bindEvents() {
    // Keyboard navigation
    select(document).on('keydown.chart', (e) => {
      if (e.key === 'Escape') this.clearSelection();
      if (e.key === 'Backspace') this.goUp();
      if (e.key === '0') this.resetZoom();
    });
  }
  
  render(data) {
    // Apply partition layout
    const root = partition()
      .size([2 * Math.PI, this.options.radius])
      (data);
    
    this.root = root;
    this.currentNode = root;
    
    // Create color function
    const getColor = (d) => {
      const scale = d.data.is_dir ? this.dirColorScale : this.fileColorScale;
      return scale(d.depth);
    };
    
    // Create arcs
    this.paths = this.g
      .selectAll('path')
      .data(root.descendants())
      .join('path')
      .attr('class', d => `chart-segment ${d.data.is_dir ? 'dir' : 'file'}`)
      .attr('fill', getColor)
      .attr('stroke', '#FFFFFF')
      .attr('stroke-width', 1)
      .attr('cursor', 'pointer')
      .attr('d', this.arcGenerator)
      .each(this._storeInteractivity.bind(this));
    
    // Add labels for large segments
    this.labels = this.g
      .selectAll('text')
      .data(root.descendants().filter(d => {
        const angle = d.x1 - d.x0;
        const radius = (d.y0 + d.y1) / 2;
        return angle > 0.05 && radius < this.options.radius * 0.9;
      }))
      .join('text')
      .attr('class', 'chart-label')
      .attr('transform', d => {
        const x = ((d.x0 + d.x1) / 2) * 180 / Math.PI;
        const y = (d.y0 + d.y1) / 2;
        return `translate(${Math.cos((x - 90) * Math.PI / 180) * y},${Math.sin((x - 90) * Math.PI / 180) * y}) rotate(${x - 90})`;
      })
      .attr('text-anchor', d => {
        const x = (d.x0 + d.x1) / 2 * 180 / Math.PI;
        return x > 180 ? 'end' : 'start';
      })
      .attr('dx', d => {
        const x = (d.x0 + d.x1) / 2 * 180 / Math.PI;
        return x > 180 ? -6 : 6;
      })
      .attr('dy', '0.35em')
      .attr('font-size', '10px')
      .attr('fill', '#FFFFFF')
      .attr('pointer-events', 'none')
      .text(d => d.data.name.length > 20 
        ? d.data.name.slice(0, 18) + '…' 
        : d.data.name
      );
    
    // Hide center (root takes full circle initially)
    this._updateView(root);
  }
  
  _storeInteractivity(d) {
    // Store reference for event handlers
    d.element = this;
  }
  
  _updateView(target) {
    const duration = this.options.animationDuration;
    
    // Calculate new view
    const interpolateZoom = this._interpolateZoom(target);
    
    // Animate transition
    this.g
      .transition()
      .duration(duration)
      .tween('zoom', () => {
        const fn = interpolateZoom;
        return t => {
          const transform = fn(t);
          this.svg.call(this.zoomBehavior.transform, transform);
        };
      });
    
    // Update arc visibility
    this.paths
      .transition()
      .duration(duration)
      .attrTween('d', d => {
        const interpolate = this._interpolateArc(d, target);
        return t => this.arcGenerator(interpolate(t));
      });
    
    // Fade out tiny segments
    this.paths
      .style('opacity', d => {
        const angle = d.x1 - d.x0;
        return angle < 0.005 ? 0 : 1;
      });
  }
  
  _interpolateZoom(target) {
    const view = {
      x: target.x0,
      dx: target.x1 - target.x0,
      y: target.y0,
      dy: target.y1 - target.y0,
    };
    
    return t => {
      const x = interpolate(view.x, 0)(t);
      const dx = interpolate(view.dx, 2 * Math.PI)(t);
      const y = interpolate(view.y, 0)(t);
      const dy = interpolate(view.dy, this.options.radius)(t);
      
      return zoomIdentity
        .translate(this.options.width / 2, this.options.height / 2)
        .scale(Math.min(this.options.width, this.options.height) / dy)
        .rotate(-x * 180 / Math.PI - 90);
    };
  }
  
  _interpolateArc(d, target) {
    const i = interpolate({
      x0: d.x0,
      x1: d.x1,
      y0: d.y0,
      y1: d.y1,
    }, {
      x0: target.x0,
      x1: target.x1,
      y0: target.y0,
      y1: target.y1,
    });
    
    return t => {
      const state = i(t);
      return {
        ...d,
        x0: state.x0,
        x1: state.x1,
        y0: state.y0,
        y1: state.y1,
      };
    };
  }
  
  drillDown(node) {
    if (!node.children || node.children.length === 0) return;
    
    this.currentNode = node;
    this._updateView(node);
    
    // Trigger navigation callback
    if (this._onNavigate) {
      const path = this._buildPath(node);
      this._onNavigate(path);
    }
  }
  
  goUp() {
    if (this.currentNode.parent) {
      this.currentNode = this.currentNode.parent;
      this._updateView(this.currentNode);
      
      if (this._onNavigate) {
        const path = this._buildPath(this.currentNode);
        this._onNavigate(path);
      }
    }
  }
  
  goToRoot() {
    this.currentNode = this.root;
    this._updateView(this.root);
    
    if (this._onNavigate) {
      this._onNavigate([this.root.data.name]);
    }
  }
  
  select(node) {
    // Clear previous selection
    this.paths.classed('selected', false);
    
    // Select new node
    this.selectedNode = node;
    
    // Find and highlight the path
    this.paths
      .filter(d => d === node)
      .classed('selected', true)
      .raise();  // Bring to front
    
    // Trigger callback
    if (this._onNodeClick) {
      this._onNodeClick(node.data);
    }
  }
  
  clearSelection() {
    this.paths.classed('selected', false);
    this.selectedNode = null;
  }
  
  zoomIn() {
    this.svg.transition().call(this.zoomBehavior.scaleBy, 1.3);
  }
  
  zoomOut() {
    this.svg.transition().call(this.zoomBehavior.scaleBy, 0.7);
  }
  
  resetZoom() {
    this.svg.transition().call(this.zoomBehavior.transform, zoomIdentity);
  }
  
  _buildPath(node) {
    const path = [];
    let current = node;
    
    while (current) {
      path.unshift(current.data.name);
      current = current.parent;
    }
    
    return path;
  }
  
  // Event handlers
  onNodeClick(callback) {
    this._onNodeClick = callback;
    return this;
  }
  
  onNodeHover(callback) {
    this._onNodeHover = callback;
    return this;
  }
  
  onNavigate(callback) {
    this._onNavigate = callback;
    return this;
  }
  
  destroy() {
    select(document).on('keydown.chart', null);
    this.container.html('');
  }
}

// D3 zoom identity
const zoomIdentity = {
  translate: (x, y) => ({ x, y, k: 1, transform: (point) => ({ x: point.x + x, y: point.y + y }) }),
  scale: (k) => ({ x: 0, y: 0, k, transform: (point) => ({ x: point.x * k, y: point.y * k }) }),
};
```

### Usage Example

```javascript
// app.js
import { SunburstChart } from './chart.js';
import { buildHierarchy } from './utils/transform.js';

// Initialize chart
const chart = new SunburstChart('#chart-container', {
  width: 600,
  height: 600,
  colors: {
    dir: ['#3B82F6', '#8B5CF6', '#A78BFA'],
    file: ['#10B981', '#14B8A6', '#2DD4BF'],
  },
});

// Load and render data
const scanData = await api.scan('/Users/cuser');
const hierarchy = buildHierarchy(scanData);
chart.render(hierarchy);

// Handle interactions
chart
  .onNodeClick((node) => {
    showDetails(node);
    updateTooltip(node);
  })
  .onNodeHover((node) => {
    showTooltip(node);
  })
  .onNavigate((path) => {
    updateBreadcrumb(path);
    updateUrl(path);
  });

// Handle segment clicks
chart.paths.on('click', function(event, d) {
  event.stopPropagation();
  chart.select(d);
  
  if (d.data.is_dir) {
    chart.drillDown(d);
  }
});

// Handle hover
chart.paths
  .on('mouseenter', function(event, d) {
    select(this).attr('opacity', 0.8);
    chart._onNodeHover?.(d.data);
  })
  .on('mouseleave', function(event, d) {
    select(this).attr('opacity', 1);
  });
```

---

## Module 4: Breadcrumb (ui/breadcrumb.js)

### Interface

```javascript
class Breadcrumb {
  constructor(container: HTMLElement)
  
  render(path: Array<string>): void
  highlight(index: number): void
  onNavigate(callback: (index: number) => void): this
}
```

### Implementation

```javascript
// ui/breadcrumb.js

import { select } from 'd3-selection';

export class Breadcrumb {
  constructor(container) {
    this.container = select(container);
    this.path = [];
    this._onNavigate = null;
    
    this._init();
  }
  
  _init() {
    this.container
      .attr('class', 'breadcrumb')
      .attr('role', 'navigation')
      .attr('aria-label', 'Directory navigation');
  }
  
  render(pathArray) {
    this.path = pathArray;
    
    // Clear existing
    this.container.html('');
    
    // Create breadcrumb items
    const items = this.container
      .selectAll('.breadcrumb-item')
      .data(pathArray.map((name, i) => ({ name, index: i })))
      .join('span')
      .attr('class', 'breadcrumb-item')
      .html((d, i, nodes) => {
        const isLast = i === pathArray.length - 1;
        const separator = i < pathArray.length - 1 
          ? '<span class="breadcrumb-separator">›</span>' 
          : '';
        
        return `
          <button 
            class="breadcrumb-link ${isLast ? 'current' : ''}"
            data-index="${i}"
            ${isLast ? 'aria-current="page"' : ''}
          >
            ${this._truncateName(name)}
          </button>
          ${separator}
        `;
      });
    
    // Bind click events
    this.container.selectAll('.breadcrumb-link').on('click', (e) => {
      const index = parseInt(e.target.dataset.index);
      this._onNavigate?.(index);
    });
  }
  
  _truncateName(name, maxLength = 25) {
    if (name.length <= maxLength) return name;
    return name.slice(0, maxLength - 2) + '…';
  }
  
  highlight(index) {
    this.container
      .selectAll('.breadcrumb-link')
      .classed('current', (d, i) => i === index)
      .attr('aria-current', (d, i) => i === index ? 'page' : null);
  }
  
  onNavigate(callback) {
    this._onNavigate = callback;
    return this;
  }
}
```

### Usage Example

```javascript
// app.js
const breadcrumb = new Breadcrumb('#breadcrumb');

breadcrumb
  .render(['Users', 'cuser', 'Documents', 'github', 'melon'])
  .onNavigate((index) => {
    // Navigate to that level
    const newPath = currentPath.slice(0, index + 1);
    navigateTo(newPath);
  });
```

---

## Module 5: Details Panel (ui/details-panel.js)

### Interface

```javascript
class DetailsPanel {
  constructor(container: HTMLElement)
  
  render(node: D3HierarchyNode): void
  update(node: D3HierarchyNode): void
  show(): void
  hide(): void
  onFileSelect(callback: (node) => void): this
}
```

### Implementation

```javascript
// ui/details-panel.js

import { select } from 'd3-selection';
import { formatSize, calculatePercentage, getFileIcon } from '../utils/transform.js';

export class DetailsPanel {
  constructor(container) {
    this.container = select(container);
    this.currentNode = null;
    this._onFileSelect = null;
    
    this._init();
  }
  
  _init() {
    this.container
      .attr('class', 'details-panel')
      .html(`
        <div class="details-header">
          <h3 class="details-title">Contents</h3>
          <button class="details-close" aria-label="Close panel">&times;</button>
        </div>
        <div class="details-content">
          <div class="details-summary"></div>
          <table class="details-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Size</th>
                <th>Type</th>
                <th>% of Parent</th>
              </tr>
            </thead>
            <tbody></tbody>
          </table>
        </div>
      `);
    
    // Close button
    this.container.select('.details-close').on('click', () => this.hide());
  }
  
  render(node) {
    this.currentNode = node;
    
    // Update header
    const icon = getFileIcon(node.data.name, node.data.is_dir);
    this.container.select('.details-title')
      .html(`${icon} ${node.data.name}`);
    
    // Update summary
    const summary = this.container.select('.details-summary');
    if (node.data.is_dir) {
      const fileCount = node.sum(d => d.data.is_dir ? 0 : 1).value;
      const dirCount = node.children?.filter(c => c.data.is_dir).length || 0;
      
      summary.html(`
        <div class="summary-stat">
          <span class="stat-value">${formatSize(node.data.size)}</span>
          <span class="stat-label">Total Size</span>
        </div>
        <div class="summary-stat">
          <span class="stat-value">${fileCount}</span>
          <span class="stat-label">Files</span>
        </div>
        <div class="summary-stat">
          <span class="stat-value">${dirCount}</span>
          <span class="stat-label">Folders</span>
        </div>
      `);
    } else {
      summary.html(`
        <div class="summary-stat">
          <span class="stat-value">${formatSize(node.data.size)}</span>
          <span class="stat-label">File Size</span>
        </div>
        <div class="summary-stat">
          <span class="stat-value">${node.data.name.split('.').pop()}</span>
          <span class="stat-label">Extension</span>
        </div>
      `);
    }
    
    // Update table
    const tbody = this.container.select('.details-table tbody');
    
    if (node.data.is_dir && node.children) {
      const rows = tbody
        .selectAll('tr')
        .data(node.children)
        .join('tr')
        .attr('class', d => `details-row ${d.data.is_dir ? 'dir' : 'file'}`)
        .html(d => `
          <td class="col-name">
            <span class="file-icon">${getFileIcon(d.data.name, d.data.is_dir)}</span>
            <span class="file-name">${d.data.name}</span>
          </td>
          <td class="col-size">${formatSize(d.data.size)}</td>
          <td class="col-type">${d.data.is_dir ? 'Folder' : 'File'}</td>
          <td class="col-percent">${calculatePercentage(d.data, node.data).toFixed(1)}%</td>
        `);
      
      // Row click
      rows.on('click', (e, d) => {
        this._onFileSelect?.(d);
      });
      
      // Sort by size
      rows.sort((a, b) => b.data.size - a.data.size);
    } else {
      tbody.html('<tr><td colspan="4" class="empty-message">No contents to display</td></tr>');
    }
  }
  
  show() {
    this.container.classed('hidden', false);
  }
  
  hide() {
    this.container.classed('hidden', true);
  }
  
  onFileSelect(callback) {
    this._onFileSelect = callback;
    return this;
  }
}
```

---

## Module 6: Tooltip (ui/tooltip.js)

### Interface

```javascript
class Tooltip {
  constructor(container: HTMLElement)
  
  show(node: D3HierarchyNode, position: {x, y}): void
  hide(): void
  update(node: D3HierarchyNode): void
}
```

### Implementation

```javascript
// ui/tooltip.js

import { select } from 'd3-selection';
import { formatSize, calculatePercentage, getFileIcon } from '../utils/transform.js';

export class Tooltip {
  constructor(container = document.body) {
    this.container = select(container);
    this.tooltip = null;
    this._init();
  }
  
  _init() {
    this.tooltip = this.container
      .append('div')
      .attr('class', 'tooltip')
      .attr('role', 'tooltip')
      .style('position', 'absolute')
      .style('pointer-events', 'none')
      .style('opacity', 0)
      .style('transition', 'opacity 0.15s ease')
      .html(`
        <div class="tooltip-icon"></div>
        <div class="tooltip-content">
          <div class="tooltip-name"></div>
          <div class="tooltip-size"></div>
          <div class="tooltip-percent"></div>
          <div class="tooltip-path"></div>
        </div>
      `)
      .style('visibility', 'hidden');
  }
  
  show(node, position) {
    const { x, y } = position;
    
    // Update content
    const icon = getFileIcon(node.data.name, node.data.is_dir);
    this.tooltip.select('.tooltip-icon').text(icon);
    this.tooltip.select('.tooltip-name').text(node.data.name);
    this.tooltip.select('.tooltip-size').text(formatSize(node.data.size));
    
    const parentPercent = node.parent 
      ? `${calculatePercentage(node.data, node.parent.data)}% of parent`
      : 'Root directory';
    this.tooltip.select('.tooltip-percent').text(parentPercent);
    
    // Path (if available)
    if (node.data.path) {
      this.tooltip.select('.tooltip-path')
        .text(node.data.path)
        .style('display', 'block');
    } else {
      this.tooltip.select('.tooltip-path').style('display', 'none');
    }
    
    // Position
    this.tooltip
      .style('left', `${x + 15}px`)
      .style('top', `${y + 15}px`)
      .style('visibility', 'visible')
      .style('opacity', 1);
  }
  
  hide() {
    this.tooltip
      .style('visibility', 'hidden')
      .style('opacity', 0);
  }
  
  update(node) {
    if (this.tooltip.style('visibility') !== 'hidden') {
      // Content already updated in show()
    }
  }
}
```

---

## CSS Styles (styles/chart.css)

```css
/* Sunburst Chart */
.sunburst-chart {
  font-family: 'Inter', system-ui, sans-serif;
}

.chart-segment {
  transition: opacity 0.15s ease, filter 0.15s ease;
}

.chart-segment:hover {
  filter: brightness(1.1);
}

.chart-segment.selected {
  stroke: #FFFFFF;
  stroke-width: 3;
  filter: brightness(1.15);
}

.chart-segment.dir {
  /* Colors applied via D3 scale */
}

.chart-segment.file {
  /* Colors applied via D3 scale */
}

.chart-label {
  font-size: 10px;
  fill: #FFFFFF;
  pointer-events: none;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
}

/* Tooltip */
.tooltip {
  background: rgba(15, 23, 42, 0.95);
  color: #F1F5F9;
  padding: 12px 16px;
  border-radius: 8px;
  font-size: 13px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  z-index: 1000;
  max-width: 300px;
}

.tooltip-icon {
  font-size: 24px;
  margin-bottom: 8px;
}

.tooltip-name {
  font-weight: 600;
  font-size: 14px;
  margin-bottom: 4px;
}

.tooltip-size {
  color: #94A3B8;
  font-size: 12px;
}

.tooltip-percent {
  color: #60A5FA;
  font-size: 12px;
  margin-top: 4px;
}

.tooltip-path {
  color: #64748B;
  font-size: 11px;
  font-family: 'JetBrains Mono', monospace;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid #334155;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Breadcrumb */
.breadcrumb {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 8px 16px;
  background: #F8FAFC;
  border-bottom: 1px solid #E2E8F0;
  font-size: 14px;
}

.breadcrumb-item {
  display: flex;
  align-items: center;
}

.breadcrumb-link {
  background: none;
  border: none;
  padding: 4px 8px;
  color: #3B82F6;
  cursor: pointer;
  border-radius: 4px;
  transition: background 0.15s;
}

.breadcrumb-link:hover {
  background: #EFF6FF;
}

.breadcrumb-link.current {
  color: #1E293B;
  font-weight: 500;
  cursor: default;
}

.breadcrumb-link.current:hover {
  background: none;
}

.breadcrumb-separator {
  color: #94A3B8;
  padding: 0 4px;
}

/* Details Panel */
.details-panel {
  background: #FFFFFF;
  border-top: 1px solid #E2E8F0;
  padding: 16px;
  max-height: 300px;
  overflow-y: auto;
}

.details-panel.hidden {
  display: none;
}

.details-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.details-title {
  font-size: 16px;
  font-weight: 600;
  color: #1E293B;
  margin: 0;
}

.details-close {
  background: none;
  border: none;
  font-size: 24px;
  color: #64748B;
  cursor: pointer;
  padding: 4px 8px;
}

.details-summary {
  display: flex;
  gap: 24px;
  margin-bottom: 16px;
  padding-bottom: 16px;
  border-bottom: 1px solid #E2E8F0;
}

.summary-stat {
  text-align: center;
}

.stat-value {
  display: block;
  font-size: 20px;
  font-weight: 600;
  color: #1E293B;
}

.stat-label {
  font-size: 12px;
  color: #64748B;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.details-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.details-table th {
  text-align: left;
  padding: 8px 12px;
  background: #F8FAFC;
  color: #64748B;
  font-weight: 500;
  text-transform: uppercase;
  font-size: 11px;
  letter-spacing: 0.5px;
}

.details-table td {
  padding: 10px 12px;
  border-bottom: 1px solid #F1F5F9;
}

.details-row:hover {
  background: #F8FAFC;
  cursor: pointer;
}

.col-name {
  display: flex;
  align-items: center;
  gap: 8px;
}

.file-icon {
  font-size: 16px;
}

.file-name {
  font-family: 'JetBrains Mono', monospace;
  font-size: 12px;
}

.col-size, .col-percent {
  font-family: 'JetBrains Mono', monospace;
  color: #475569;
}

.col-type {
  color: #64748B;
  text-transform: capitalize;
}

.empty-message {
  text-align: center;
  color: #94A3B8;
  padding: 24px;
}

/* Dark mode */
@media (prefers-color-scheme: dark) {
  .breadcrumb {
    background: #1E293B;
    border-color: #334155;
  }
  
  .breadcrumb-link {
    color: #60A5FA;
  }
  
  .breadcrumb-link.current {
    color: #F1F5F9;
  }
  
  .breadcrumb-link:hover {
    background: #334155;
  }
  
  .details-panel {
    background: #1E293B;
    border-color: #334155;
  }
  
  .details-title {
    color: #F1F5F9;
  }
  
  .stat-value {
    color: #F1F5F9;
  }
  
  .details-table th {
    background: #334155;
    color: #94A3B8;
  }
  
  .details-table td {
    border-color: #334155;
  }
  
  .details-row:hover {
    background: #334155;
  }
}
```

---

## Complete Usage Example (app.js)

```javascript
// app.js - Main application entry point

import { DiskAnalyzerApi } from './api/client.js';
import { buildHierarchy, formatSize } from './utils/transform.js';
import { SunburstChart } from './chart.js';
import { Breadcrumb } from './ui/breadcrumb.js';
import { DetailsPanel } from './ui/details-panel.js';
import { Tooltip } from './ui/tooltip.js';

class App {
  constructor() {
    this.api = new DiskAnalyzerApi('http://localhost:8000');
    this.currentData = null;
    this.currentRoot = null;
    
    this._initComponents();
    this._bindEvents();
    this._checkHealth();
  }
  
  _initComponents() {
    this.chart = new SunburstChart('#chart', {
      width: 600,
      height: 600,
    });
    
    this.breadcrumb = new Breadcrumb('#breadcrumb');
    this.details = new DetailsPanel('#details');
    this.tooltip = new Tooltip();
  }
  
  _bindEvents() {
    // Chart interactions
    this.chart
      .onNodeClick((node) => {
        this.details.render(this.chart.selectedNode);
        this.details.show();
      })
      .onNodeHover((node) => {
        const rect = event.target.getBoundingClientRect();
        this.tooltip.show(node, { x: rect.left, y: rect.top });
      })
      .onNavigate((path) => {
        this.breadcrumb.render(path);
        this._updateUrl(path);
      });
    
    // Chart segment clicks
    this.chart.paths?.on('click', (event, d) => {
      event.stopPropagation();
      this.chart.select(d);
      
      if (d.data.is_dir) {
        this.chart.drillDown(d);
      }
    });
    
    // Chart hover
    this.chart.paths?.on('mouseenter', (event, d) => {
      const [mx, my] = select(event.currentTarget).node().getBoundingClientRect();
      this.tooltip.show(d, { x: mx, y: my });
    });
    
    this.chart.paths?.on('mouseleave', () => {
      this.tooltip.hide();
    });
    
    // Breadcrumb navigation
    this.breadcrumb.onNavigate((index) => {
      // Navigate to that level in chart
      let node = this.currentRoot;
      for (let i = 0; i < index; i++) {
        node = node.children?.[0];  // Simplified - would need proper lookup
      }
      if (node) this.chart.drillDown(node);
    });
    
    // Details panel file selection
    this.details.onFileSelect((node) => {
      this.chart.select(node);
    });
    
    // Path input
    document.getElementById('scan-btn')?.addEventListener('click', () => {
      const path = document.getElementById('path-input').value;
      if (path) this.scan(path);
    });
  }
  
  async _checkHealth() {
    try {
      await this.api.health();
      console.log('Backend connected');
    } catch (err) {
      console.warn('Backend not available');
    }
  }
  
  async scan(path) {
    try {
      this._showProgress(true);
      
      const scanData = await this.api.scan(path);
      this.currentData = scanData;
      
      // Build hierarchy
      this.currentRoot = buildHierarchy(scanData);
      
      // Render chart
      this.chart.render(this.currentRoot);
      
      // Update breadcrumb
      const pathArray = path.split('/').filter(Boolean);
      this.breadcrumb.render(pathArray);
      
      this._showProgress(false);
    } catch (err) {
      this._showError(err.message);
      this._showProgress(false);
    }
  }
  
  _showProgress(showing) {
    const overlay = document.getElementById('progress-overlay');
    if (overlay) {
      overlay.style.display = showing ? 'flex' : 'none';
    }
  }
  
  _showError(message) {
    // Show error toast/notification
    console.error(message);
  }
  
  _updateUrl(path) {
    const pathStr = path.join('/');
    window.history.pushState({ path: pathStr }, '', `?path=${encodeURIComponent(pathStr)}`);
  }
}

// Initialize app
const app = new App();

// Check for path in URL
const params = new URLSearchParams(window.location.search);
const initialPath = params.get('path');
if (initialPath) {
  app.scan(initialPath);
}
```

---

## Summary

### Frontend Modules

| Module | Purpose | Key Methods |
|--------|---------|-------------|
| `api/client.js` | Backend HTTP communication | `scan()`, `search()`, `children()` |
| `utils/transform.js` | Data transformation | `buildHierarchy()`, `formatSize()` |
| `chart.js` | D3 sunburst rendering | `render()`, `drillDown()`, `select()` |
| `ui/breadcrumb.js` | Path navigation | `render()`, `onNavigate()` |
| `ui/details-panel.js` | File list view | `render()`, `show()`, `hide()` |
| `ui/tooltip.js` | Hover info | `show()`, `hide()` |

### Data Flow

```
API JSON → buildHierarchy() → D3 Hierarchy → partition() → arc() → SVG <path>
```

### Key D3 APIs Used

- `d3-hierarchy`: `hierarchy()`, `partition()`
- `d3-shape`: `arc()`
- `d3-scale`: `scaleLinear()`, `scaleOrdinal()`
- `d3-selection`: `select()`, `selectAll()`, `join()`
- `d3-transition`: `transition()`, `duration()`, `attrTween()`
- `d3-interpolate`: `interpolate()`
- `d3-zoom`: `zoom()`

### Sample Fixtures

See `2026-04-12_1300-frontend-api-spec.md` for backend data fixtures to test conformance.
