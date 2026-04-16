/**
 * Data Transformation Utilities
 * Convert backend API data to D3-friendly formats and format for display
 */

/**
 * Convert flat node array to D3 hierarchy tree
 * @param {object} scanResult - Backend scan response
 * @returns {object} D3 hierarchy node
 */
export function buildHierarchy(scanResult) {
  const { root: rootPath, nodes } = scanResult;

  if (!nodes || nodes.length === 0) {
    throw new Error('No nodes in scan result');
  }

  // Build node map for quick lookup
  const nodeMap = new Map();
  nodes.forEach((n) => {
    nodeMap.set(n.id, {
      ...n,
      children: [],
      value: n.is_dir ? 0 : n.size, // D3 expects 'value' for sizing
      rootPath: rootPath, // Add root path for preview URL
    });
  });

  // Build parent-child relationships
  let rootNode = null;
  nodes.forEach((node) => {
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
  const d3Root = d3
    .hierarchy(rootNode)
    .sum((d) => d.value)
    .sort((a, b) => b.value - a.value); // Largest first

  // Attach metadata
  d3Root.rootPath = rootPath;

  // Add rootPath to all nodes in the hierarchy
  d3Root.each((node) => {
    node.data.rootPath = rootPath;
    // Update preview_url to include root and path parameters
    if (node.data.preview_url) {
      // Build the full path from hierarchy for fallback when cache expires
      const nodePath = _buildNodePath(node, rootPath);
      const separator = node.data.preview_url.includes('?') ? '&' : '?';
      node.data.preview_url = `${node.data.preview_url}${separator}root=${encodeURIComponent(rootPath)}&path=${encodeURIComponent(nodePath)}`;
    }
  });

  return d3Root;
}

/**
 * Build the full path for a node by traversing up the hierarchy
 * @param {object} node - D3 hierarchy node
 * @param {string} rootPath - Root path from scan
 * @returns {string} Full absolute path
 */
function _buildNodePath(node, rootPath) {
  const parts = [];
  let current = node;
  while (current) {
    if (current.data.name) {
      parts.unshift(current.data.name);
    }
    current = current.parent;
  }
  // parts[0] is the root name, replace with actual root path
  if (parts.length > 0 && rootPath) {
    parts.shift(); // Remove root name
    return rootPath + (parts.length > 0 ? '/' + parts.join('/') : '');
  }
  return '/' + parts.join('/');
}

/**
 * Build lookup map from node array
 * @param {Array} nodes - Flat node array
 * @returns {Map} Map of nodeId -> node
 */
export function buildNodeMap(nodes) {
  return new Map(nodes.map((n) => [n.id, n]));
}

/**
 * Calculate percentage of parent size
 * @param {object} node - Child node
 * @param {object} parent - Parent node
 * @returns {number} Percentage (0-100)
 */
export function calculatePercentage(node, parent) {
  if (!parent || parent.size === 0) return 0;
  return Math.round((node.size / parent.size) * 1000) / 10;
}

/**
 * Format bytes to human-readable string
 * @param {number} bytes - Size in bytes
 * @returns {string} Formatted size
 */
export function formatSize(bytes) {
  if (bytes === 0) return '0 B';
  if (bytes < 0) return 'Invalid size';
  if (!isFinite(bytes)) return 'Unknown';

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
 * @param {number} ms - Time in milliseconds
 * @returns {string} Formatted time
 */
export function formatTime(ms) {
  if (ms < 1) return '<1 ms';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

/**
 * Get file icon based on extension
 * @param {string} filename - File name
 * @param {boolean} isDir - Is directory
 * @returns {string} Emoji icon
 */
export function getFileIcon(filename, isDir) {
  if (isDir) return '📁';

  const ext = filename.split('.').pop().toLowerCase();
  const icons = {
    // Code
    py: '🐍',
    js: '📜',
    ts: '📘',
    jsx: '⚛️',
    tsx: '⚛️',
    html: '🌐',
    css: '🎨',
    scss: '🎨',
    json: '📋',
    yaml: '📋',
    yml: '📋',
    xml: '📋',

    // Documents
    md: '📝',
    txt: '📄',
    rtf: '📄',
    pdf: '📕',
    doc: '📘',
    docx: '📘',
    xls: '📊',
    xlsx: '📊',
    ppt: '📽️',
    pptx: '📽️',

    // Images
    jpg: '🖼️',
    jpeg: '🖼️',
    png: '🖼️',
    gif: '🖼️',
    svg: '🖼️',
    webp: '🖼️',
    ico: '🖼️',
    bmp: '🖼️',

    // Video/Audio
    mp4: '🎬',
    avi: '🎬',
    mkv: '🎬',
    mov: '🎬',
    mp3: '🎵',
    wav: '🎵',
    flac: '🎵',
    ogg: '🎵',

    // Archives
    zip: '📦',
    tar: '📦',
    gz: '📦',
    rar: '📦',
    '7z': '📦',

    // Config/System
    git: '🔧',
    gitignore: '🔧',
    env: '⚙️',
    log: '📜',
    sh: '💻',
    bash: '💻',
    zsh: '💻',
  };

  return icons[ext] || '📄';
}

/**
 * Sort nodes by specified field
 * @param {Array} nodes - Node array
 * @param {string} by - Sort field ('size', 'name', 'depth')
 * @returns {Array} Sorted nodes
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
 * @param {object} node - D3 hierarchy node
 * @param {boolean} isDir - Is directory
 * @returns {string} Color value
 */
export function getNodeColor(node, isDir) {
  const depth = node.depth || 0;

  if (isDir) {
    const colors = ['#3B82F6', '#6366F1', '#8B5CF6', '#A78BFA', '#C4B5FD'];
    return colors[depth % colors.length];
  } else {
    const colors = ['#10B981', '#14B8A6', '#2DD4BF', '#5EEAD4', '#99F6E4'];
    return colors[depth % colors.length];
  }
}

/**
 * Truncate string with ellipsis
 * @param {string} str - String to truncate
 * @param {number} maxLength - Maximum length
 * @returns {string} Truncated string
 */
export function truncate(str, maxLength = 25) {
  if (!str || str.length <= maxLength) return str;
  return str.slice(0, maxLength - 2) + '…';
}

/**
 * Build path array from hierarchy node
 * @param {object} node - D3 hierarchy node
 * @returns {Array<string>} Path components
 */
export function buildPathArray(node) {
  const path = [];
  let current = node;

  while (current) {
    path.unshift(current.data.name);
    current = current.parent;
  }

  return path;
}

/**
 * Count files and directories in a node's subtree
 * @param {object} node - D3 hierarchy node
 * @returns {{files: number, dirs: number}}
 */
export function countItems(node) {
  let files = 0;
  let dirs = 0;

  node.each((child) => {
    if (child.data.is_dir) {
      dirs++;
    } else {
      files++;
    }
  });

  // Subtract 1 from dirs to exclude the root itself if it's a dir
  if (node.data.is_dir) {
    dirs--;
  }

  return { files, dirs };
}
