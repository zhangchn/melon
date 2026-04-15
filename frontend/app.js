/**
 * Web Disk Usage Analyzer - Main Application
 */

import { DiskAnalyzerApi } from './api/client.js';
import { buildHierarchy, formatSize, formatTime, buildPathArray } from './utils/transform.js';
import { SunburstChart } from './chart.js';
import { Breadcrumb } from './ui/breadcrumb.js';
import { DetailsPanel } from './ui/details-panel.js';
import { Tooltip } from './ui/tooltip.js';

class App {
  constructor() {
    this.api = new DiskAnalyzerApi('');
    this.currentData = null;
    this.currentRoot = null;
    this.scanStartTime = null;

    this._initComponents();
    this._bindEvents();
    this._checkHealth();
    this._loadFromUrl();
  }

  _initComponents() {
    // Initialize chart
    this.chart = new SunburstChart('#chart', {
      width: 600,
      height: 600,
    });

    // Initialize breadcrumb
    this.breadcrumb = new Breadcrumb('#breadcrumb');

    // Initialize details panel
    this.details = new DetailsPanel(document.getElementById('details'));

    // Initialize tooltip
    this.tooltip = new Tooltip();

    // Bind chart events
    this.chart
      .onNodeClick((node) => {
        this.details.render(this.chart.selectedNode, this.currentData?.root);
        this.details.show();
        this._updateStatus(`Selected: ${node.name} (${formatSize(node.size)})`);
      })
      .onNavigate((path) => {
        this.breadcrumb.render(path);
        this._updateUrl(path);
      });
  }

  _bindEvents() {
    // Chart segment interactions
    this._bindChartInteractions();

    // Path input
    const pathInput = document.getElementById('path-input');
    const scanBtn = document.getElementById('scan-btn');

    scanBtn.addEventListener('click', () => {
      const path = pathInput.value.trim();
      if (path) this.scan(path);
    });

    pathInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const path = pathInput.value.trim();
        if (path) this.scan(path);
      }
    });

    // Status bar buttons
    document.getElementById('search-btn').addEventListener('click', () => {
      this._toggleSearch();
    });

    document.getElementById('refresh-btn').addEventListener('click', () => {
      if (this.currentData) {
        this.scan(this.currentData.root, { force: true });
      }
    });

    // Progress overlay cancel
    document.getElementById('cancel-scan-btn').addEventListener('click', () => {
      this.api.cancelScan();
      this._hideProgress();
      this._updateStatus('Scan cancelled');
    });

    // Settings modal
    document.getElementById('settings-btn').addEventListener('click', () => {
      this._showSettings();
    });

    document.getElementById('save-settings-btn').addEventListener('click', () => {
      this._saveSettings();
    });

    document.getElementById('clear-cache-btn').addEventListener('click', async () => {
      try {
        await this.api.clearCache();
        this._updateStatus('Cache cleared');
        this._hideModal('settings-modal');
      } catch (err) {
        this._showError('Failed to clear cache');
      }
    });

    document.getElementById('max-depth').addEventListener('input', (e) => {
      document.getElementById('max-depth-value').textContent = e.target.value;
    });

    // Help modal
    document.getElementById('help-btn').addEventListener('click', () => {
      this._showModal('help-modal');
    });

    // Modal close buttons
    document.querySelectorAll('.modal-close').forEach((btn) => {
      btn.addEventListener('click', () => {
        this._hideAllModals();
      });
    });

    // Search panel
    document.querySelector('.search-close').addEventListener('click', () => {
      this._hideSearch();
    });

    document.getElementById('search-input').addEventListener('input', (e) => {
      this._debouncedSearch(e.target.value);
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      this._handleKeyboard(e);
    });

    // Close modals on backdrop click
    document.querySelectorAll('.modal').forEach((modal) => {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          this._hideAllModals();
        }
      });
    });
  }

  _bindChartInteractions() {
    // Handle segment clicks - use event delegation on the chart container
    d3.select('#chart').select('.sunburst-chart')
      .on('click', (event) => {
        event.stopPropagation();
      });
    
    // Bind to paths after they exist
    this._bindChartPaths();
    this._bindBreadcrumbNavigation();
  }
  
  _bindChartPaths() {
    if (!this.chart.paths) return;
    
    // Handle segment clicks
    this.chart.paths.on('click', (event, d) => {
      event.stopPropagation();
      this.chart.select(d);

      // Check if clicked node is the current center (root of current view)
      const currentRoot = this.chart.getCurrentNode();
      const isCenterClick = currentRoot && d.data.id === currentRoot.data.id;

      if (isCenterClick) {
        // Clicking center goes up one level
        this.chart.goUp();
        // Re-bind after goUp since paths are recreated
        setTimeout(() => this._bindChartPaths(), this.chart.options.animationDuration + 50);
      } else if (d.data.is_dir && d.children && d.children.length > 0) {
        // Clicking a non-center directory drills down
        this.chart.drillDown(d);
        // Re-bind after drill down since paths are recreated
        setTimeout(() => this._bindChartPaths(), this.chart.options.animationDuration + 50);
      }
    });

    // Handle hover
    this.chart.paths.on('mouseenter', (event, d) => {
      const rect = event.currentTarget.getBoundingClientRect();
      this.tooltip.show(d, {
        x: rect.left + rect.width / 2,
        y: rect.top,
      });
    });

    this.chart.paths.on('mouseleave', () => {
      this.tooltip.hide();
    });
  }

  _bindBreadcrumbNavigation() {
    // Breadcrumb navigation
    this.breadcrumb.onNavigate((index) => {
      // Navigate to that level
      let node = this.currentRoot;
      const path = this.breadcrumb.getPath();

      // Find the node at this level
      for (let i = 1; i <= index && node; i++) {
        const targetName = path[i];
        if (node.children) {
          node = node.children.find((c) => c.data.name === targetName);
        } else {
          node = null;
        }
      }

      if (node && node !== this.chart.currentNode) {
        this.chart.drillDown(node);
      }
    });

    // Details panel file selection
    this.details.onFileSelect((node) => {
      this.chart.select(node);

      if (node.data.is_dir && node.children) {
        this.chart.drillDown(node);
      }
    });
  }

  async _checkHealth() {
    try {
      await this.api.health();
      this._updateStatus('Connected to backend');
    } catch (err) {
      this._updateStatus('Backend not available - some features may not work');
      console.warn('Backend health check failed:', err);
    }
  }

  _loadFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const path = params.get('path');

    if (path) {
      this.scan(path, {}, true); // silent = true for URL loads
    }
  }

  /**
   * Scan a directory
   * @param {string} path - Directory path
   * @param {object} options - Scan options
   * @param {boolean} silent - If true, don't show alerts on error (for URL loads)
   */
  async scan(path, options = {}, silent = false) {
    try {
      this._showProgress();
      this.scanStartTime = Date.now();
      document.getElementById('progress-path').textContent = path;

      this.currentData = await this.api.scan(path, options);

      // Build hierarchy
      this.currentRoot = buildHierarchy(this.currentData);

      // Render chart
      this.chart.render(this.currentRoot);

      // Bind chart interactions after render
      this._bindChartPaths();

      // Update breadcrumb
      const pathArray = path.split('/').filter((p) => p.length > 0);
      this.breadcrumb.render(pathArray);

      // Update status
      const scanTime = Date.now() - this.scanStartTime;
      const { files, dirs } = this._countItems(this.currentRoot);
      this._updateStatus(
        `Scanned ${files} files, ${dirs} folders in ${formatTime(scanTime)} - Total: ${formatSize(this.currentData.total_size)}`
      );

      // Hide empty state
      document.getElementById('chart-empty').classList.add('hidden');

      this._hideProgress();
    } catch (err) {
      this._hideProgress();
      if (!silent) {
        this._showError(err.message);
      } else {
        console.warn('Scan failed (silent):', err.message);
        // Clear invalid path from URL
        const url = new URL(window.location);
        url.searchParams.delete('path');
        window.history.replaceState({}, '', url);
      }
      this._updateStatus(`Scan failed: ${err.message}`);
    }
  }

  _countItems(root) {
    let files = 0;
    let dirs = 0;

    root.each((child) => {
      if (child.data.is_dir) {
        dirs++;
      } else {
        files++;
      }
    });

    // Subtract 1 from dirs to exclude root
    if (root.data.is_dir) {
      dirs--;
    }

    return { files, dirs };
  }

  _showProgress() {
    document.getElementById('progress-overlay').classList.remove('hidden');
    document.getElementById('scan-btn').disabled = true;
  }

  _hideProgress() {
    document.getElementById('progress-overlay').classList.add('hidden');
    document.getElementById('scan-btn').disabled = false;
  }

  _updateStatus(message) {
    document.getElementById('status-info').textContent = message;
  }

  _showError(message) {
    // Simple error display - could be enhanced with toast notifications
    console.error(message);
    alert(`Error: ${message}`);
  }

  _updateUrl(path) {
    const pathStr = path.join('/');
    const url = new URL(window.location);
    url.searchParams.set('path', pathStr);
    window.history.pushState({ path: pathStr }, '', url);
  }

  // Search functionality
  _debouncedSearch = this._debounce((query) => {
    if (!query || !this.currentData) return;

    this._performSearch(query);
  }, 300);

  async _performSearch(query) {
    try {
      const results = await this.api.search(query, this.currentData.root, 20);
      this._renderSearchResults(results);
    } catch (err) {
      console.error('Search failed:', err);
    }
  }

  _renderSearchResults(results) {
    const container = document.getElementById('search-results');

    if (!results.results || results.results.length === 0) {
      container.innerHTML = '<p class="empty-message">No results found</p>';
      return;
    }

    container.innerHTML = results.results
      .map(
        (r) => `
      <div class="search-result" data-node-id="${r.id}">
        <div class="search-result-name">${r.name}</div>
        <div class="search-result-path">${r.path || ''}</div>
        <div class="search-result-size">${formatSize(r.size)}</div>
      </div>
    `
      )
      .join('');

    // Bind click events
    container.querySelectorAll('.search-result').forEach((el) => {
      el.addEventListener('click', () => {
        const nodeId = parseInt(el.dataset.nodeId);
        this._navigateToNode(nodeId);
        this._hideSearch();
      });
    });
  }

  _navigateToNode(nodeId) {
    // Find node in current data
    const node = this.currentData.nodes.find((n) => n.id === nodeId);
    if (!node) return;

    // Build path to node
    const nodeMap = new Map(this.currentData.nodes.map((n) => [n.id, n]));
    const path = [];
    let current = node;

    while (current) {
      path.unshift(current.name);
      current = current.parent_id !== null ? nodeMap.get(current.parent_id) : null;
    }

    // Update breadcrumb
    this.breadcrumb.render(path);

    // Note: Full navigation would require rebuilding the chart hierarchy
    // This is a simplified version
    this._updateStatus(`Navigated to ${node.name}`);
  }

  _toggleSearch() {
    const panel = document.getElementById('search-panel');
    panel.classList.toggle('hidden');

    if (!panel.classList.contains('hidden')) {
      document.getElementById('search-input').focus();
    }
  }

  _hideSearch() {
    document.getElementById('search-panel').classList.add('hidden');
  }

  // Settings
  _showSettings() {
    this._showModal('settings-modal');
  }

  _saveSettings() {
    // Get settings values
    const excludePatterns = Array.from(
      document.querySelectorAll('#exclude-patterns input:checked')
    ).map((el) => el.value);

    const maxDepth = parseInt(document.getElementById('max-depth').value);
    const followSymlinks = document.getElementById('follow-symlinks').checked;
    const theme = document.getElementById('theme-select').value;

    // Apply theme
    document.body.className = theme === 'auto' ? '' : `theme-${theme}`;

    // Store settings (in a real app, would save to backend or localStorage)
    console.log('Settings saved:', { excludePatterns, maxDepth, followSymlinks, theme });

    this._hideModal('settings-modal');
    this._updateStatus('Settings saved');
  }

  // Modal helpers
  _showModal(id) {
    document.getElementById(id).classList.remove('hidden');
  }

  _hideModal(id) {
    document.getElementById(id).classList.add('hidden');
  }

  _hideAllModals() {
    document.querySelectorAll('.modal').forEach((modal) => {
      modal.classList.add('hidden');
    });
  }

  // Keyboard shortcuts
  _handleKeyboard(e) {
    // Ignore if typing in input
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
      return;
    }

    const mod = e.ctrlKey || e.metaKey;

    if (mod && e.key === 'f') {
      e.preventDefault();
      this._toggleSearch();
    } else if (mod && e.key === 'r') {
      e.preventDefault();
      if (this.currentData) {
        this.scan(this.currentData.root, { force: true });
      }
    } else if (mod && e.key === 'o') {
      e.preventDefault();
      document.getElementById('path-input').focus();
    } else if (e.key === 'Escape') {
      this.chart.clearSelection();
      this._hideAllModals();
      this._hideSearch();
    } else if (e.key === 'Backspace') {
      this.chart.goUp();
    } else if (e.key === '0') {
      this.chart.resetZoom();
    } else if (e.key === '?' && !mod) {
      this._showModal('help-modal');
    }
  }

  // Utility: Debounce
  _debounce(func, wait) {
    let timeout;
    return (...args) => {
      clearTimeout(timeout);
      timeout = setTimeout(() => func.apply(this, args), wait);
    };
  }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.app = new App();
});
