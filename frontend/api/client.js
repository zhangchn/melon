/**
 * Backend API Client
 * Handles all HTTP communication with the backend server
 */

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

export class DiskAnalyzerApi {
  constructor(baseUrl = '') {
    this.baseUrl = baseUrl;
    this.abortController = null;
  }

  /**
   * Make an API request
   * @param {string} endpoint - API endpoint
   * @param {object} options - Fetch options
   * @returns {Promise<any>} Response data
   */
  async request(endpoint, options = {}) {
    const url = `${this.baseUrl}${endpoint}`;
    
    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...(options.headers || {}),
        },
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new ApiError(
          error.detail || error.error || 'Request failed',
          response.status,
          error
        );
      }

      // Handle gzipped responses
      if (response.headers.get('Content-Encoding') === 'gzip') {
        const compressed = await response.blob();
        const text = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsText(compressed);
        });
        return JSON.parse(text);
      }

      return response.json();
    } catch (error) {
      if (error.name === 'TypeError' && error.message.includes('fetch')) {
        throw new ApiError('Cannot connect to backend server', 0);
      }
      throw error;
    }
  }

  /**
   * Health check
   * @returns {Promise<{status: string, timestamp: number}>}
   */
  async health() {
    return this.request('/health');
  }

  /**
   * Get server configuration
   * @returns {Promise<{allowed_paths: string[], excluded_patterns: string[], max_depth: number, max_results: number}>}
   */
  async getConfig() {
    return this.request('/api/config');
  }

  /**
   * Scan a directory
   * @param {string} path - Directory path to scan
   * @param {object} options - Scan options
   * @param {boolean} options.force - Force rescan (bypass cache)
   * @param {boolean} options.compressed - Request gzipped response
   * @param {function} options.onProgress - Progress callback
   * @returns {Promise<{root: string, nodes: Array, total_size: number, total_files: number, total_dirs: number, scan_time_ms: number}>}
   */
  async scan(path, options = {}) {
    const params = new URLSearchParams({ path });
    if (options.force) params.set('force', 'true');
    if (options.compressed) params.set('compressed', 'true');

    // Cancel any in-progress scan
    if (this.abortController) {
      this.abortController.abort();
    }
    this.abortController = new AbortController();

    try {
      const response = await fetch(
        `${this.baseUrl}/api/scan?${params}`,
        {
          signal: this.abortController.signal,
        }
      );

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new ScanError(
          error.detail || 'Scan failed',
          response.status,
          path
        );
      }

      return response.json();
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new ApiError('Scan cancelled', 0);
      }
      throw error;
    } finally {
      this.abortController = null;
    }
  }

  /**
   * Cancel in-progress scan
   */
  cancelScan() {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  /**
   * Get children of a node (for lazy loading)
   * @param {number} parentId - Parent node ID
   * @returns {Promise<{parent_id: number, children: Array}>}
   */
  async children(parentId) {
    return this.request(`/api/children?parent_id=${parentId}`);
  }

  /**
   * Get children by path (shallow scan)
   * @param {string} path - Directory path
   * @returns {Promise<{parent_id: number, children: Array}>}
   */
  async childrenByPath(path) {
    return this.request(`/api/children?path=${encodeURIComponent(path)}`);
  }

  /**
   * Reconstruct full path for a node
   * @param {number} nodeId - Node ID
   * @param {string} root - Root path of scan
   * @returns {Promise<{node_id: number, root: string, path: string}>}
   */
  async path(nodeId, root) {
    return this.request(`/api/path?node_id=${nodeId}&root=${encodeURIComponent(root)}`);
  }

  /**
   * Search for nodes by name
   * @param {string} query - Search query
   * @param {string} root - Root path of cached scan
   * @param {number} limit - Maximum results
   * @returns {Promise<{query: string, root: string, results: Array, count: number}>}
   */
  async search(query, root, limit = 50) {
    const params = new URLSearchParams({
      query,
      root,
      limit: limit.toString(),
    });
    return this.request(`/api/search?${params}`);
  }

  /**
   * Clear scan cache
   * @param {string|null} path - Specific path to clear, or null for all
   * @returns {Promise<{cleared: number|string[]}>}
   */
  async clearCache(path = null) {
    const endpoint = path
      ? `/api/cache?path=${encodeURIComponent(path)}`
      : '/api/cache';
    return this.request(endpoint, { method: 'DELETE' });
  }

  /**
   * Get thumbnail URL for a video file
   * @param {number} nodeId - Node ID of the video file
   * @param {string} root - Root path of the scan
   * @param {string} filePath - Optional file path fallback (for cache expiration)
   * @returns {string} Thumbnail URL
   */
  getThumbnailUrl(nodeId, root, filePath = null) {
    const params = new URLSearchParams({
      node_id: nodeId.toString(),
      root: root,
    });
    if (filePath) {
      params.set('path', filePath);
    }
    return `${this.baseUrl}/api/thumbnail?${params}`;
  }
}

// Export singleton for convenience
export const api = new DiskAnalyzerApi('');
