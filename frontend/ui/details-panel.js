/**
 * Details Panel Component
 * Shows contents of selected directory in table format
 */

import { formatSize, calculatePercentage, getFileIcon, countItems } from '../utils/transform.js';
import { api } from '../api/client.js';

export class DetailsPanel {
  constructor(container) {
    this.container = d3.select(container);
    this.currentNode = null;
    this.currentRoot = null;
    this._onFileSelect = null;

    this._init();
  }

  _init() {
    this.container.attr('class', 'details-panel');

    // Close button handler
    this.container.select('.details-close').on('click', () => this.hide());

    // Initialize image viewer
    this._initImageViewer();
  }

  _initImageViewer() {
    const viewer = d3.select('#image-viewer');
    const viewerImg = d3.select('#image-viewer-img');

    // Click on background to close
    viewer.on('click', () => {
      viewer.classed('hidden', true);
    });

    // Prevent click on image from closing
    viewerImg.on('click', (event) => {
      event.stopPropagation();
    });

    // Escape key to close
    d3.select(document).on('keydown.imageViewer', (event) => {
      if (event.key === 'Escape' && !viewer.classed('hidden')) {
        viewer.classed('hidden', true);
      }
    });
  }

  _showImageFullscreen(src) {
    d3.select('#image-viewer-img').attr('src', src);
    d3.select('#image-viewer').classed('hidden', false);
  }

  /**
   * Render details for a node
   * @param {object} node - D3 hierarchy node
   * @param {string} rootPath - Root path of the scan (for thumbnail API)
   */
  render(node, rootPath = null) {
    this.currentNode = node;
    this.currentRoot = rootPath;
    console.log('DEBUG render: rootPath=', rootPath, 'currentRoot=', this.currentRoot);

    if (!node) {
      this.hide();
      return this;
    }

    // Update header
    const icon = getFileIcon(node.data.name, node.data.is_dir);
    this.container
      .select('.details-title')
      .html(`${icon} ${node.data.name}`);

    // Update summary
    const summary = this.container.select('.details-summary');
    if (node.data.is_dir) {
      const { files, dirs } = countItems(node);

      summary.html(`
        <div class="summary-stat">
          <span class="stat-value">${formatSize(node.data.size)}</span>
          <span class="stat-label">Total Size</span>
        </div>
        <div class="summary-stat">
          <span class="stat-value">${files}</span>
          <span class="stat-label">Files</span>
        </div>
        <div class="summary-stat">
          <span class="stat-value">${dirs}</span>
          <span class="stat-label">Folders</span>
        </div>
      `);
} else {
      const ext = node.data.name.split('.').pop().toLowerCase();
      
      // Build summary stats
      let summaryHtml = `
        <div class="summary-stat">
          <span class="stat-value">${formatSize(node.data.size)}</span>
          <span class="stat-label">File Size</span>
        </div>
        <div class="summary-stat">
          <span class="stat-value">${ext.toUpperCase()}</span>
          <span class="stat-label">Extension</span>
        </div>
      `;
      
      // Add video metadata if available
      if (node.data.video_metadata) {
        const vm = node.data.video_metadata;
        if (vm.duration) {
          const mins = Math.floor(vm.duration / 60);
          const secs = Math.floor(vm.duration % 60);
          summaryHtml += `
            <div class="summary-stat">
              <span class="stat-value">${mins}:${secs.toString().padStart(2, '0')}</span>
              <span class="stat-label">Duration</span>
            </div>
          `;
        }
        if (vm.width && vm.height) {
          summaryHtml += `
            <div class="summary-stat">
              <span class="stat-value">${vm.width}x${vm.height}</span>
              <span class="stat-label">Resolution</span>
            </div>
          `;
        }
        if (vm.codec) {
          summaryHtml += `
            <div class="summary-stat">
              <span class="stat-value">${vm.codec}</span>
              <span class="stat-label">Codec</span>
            </div>
          `;
        }
      }
      
      summary.html(summaryHtml);
    }

    // Update table
    const tbody = this.container.select('.details-table tbody');

    if (node.data.is_dir && node.children && node.children.length > 0) {
      // Sort children by size (largest first)
      const sortedChildren = [...node.children].sort((a, b) => b.data.size - a.data.size);

      const rows = tbody
        .selectAll('tr')
        .data(sortedChildren)
        .join('tr')
        .attr('class', (d) => `details-row ${d.data.is_dir ? 'dir' : 'file'}`)
        .attr('tabindex', '0')
        .html(
          (d) => {
            const isImage = d.data.preview_url;
            const previewHtml = isImage 
              ? `<div class="file-preview" style="display: flex; align-items: center; gap: 8px; margin-top: 4px;">
                   <img src="${d.data.preview_url}" class="preview-clickable" style="width: 32px; height: 32px; border-radius: 4px; object-fit: cover; cursor: pointer;" />
                 </div>`
              : '';
            return `
          <td class="col-name">
            <span class="file-icon">${getFileIcon(d.data.name, d.data.is_dir)}</span>
            <span class="file-name">${d.data.name}</span>
            ${d.data.error ? `<span class="error-indicator" title="${d.data.error}">⚠️</span>` : ''}
            ${previewHtml}
          </td>
          <td class="col-size">${formatSize(d.data.size)}</td>
          <td class="col-type">${d.data.is_dir ? 'Folder' : 'File'}</td>
          <td class="col-percent">${calculatePercentage(d.data, node.data).toFixed(1)}%</td>
        `;
          }
        );

      // Row click
      rows.on('click', (event, d) => {
        if (this._onFileSelect) {
          this._onFileSelect(d);
        }
      });

      // Keyboard navigation
      rows.on('keydown', (event, d) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          if (this._onFileSelect) {
            this._onFileSelect(d);
          }
        }
      });

      // Click on preview thumbnails to show fullscreen
      rows.selectAll('.preview-clickable').on('click', (event, d) => {
        event.stopPropagation();
        if (d.data.preview_url) {
          this._showImageFullscreen(d.data.preview_url);
        }
      });
    } else {
      const message = node.data.is_dir
        ? 'This folder is empty'
        : 'No contents to display';
      tbody.html(`<tr><td colspan="4" class="empty-message">${message}</td></tr>`);
    }

// Preview section for image/video files (after table)
    const previewContainer = this.container.select('.details-preview-section');
    if (!node.data.is_dir) {
      const ext = node.data.name.split('.').pop().toLowerCase();
      const isImage = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg'].includes(ext);
      const isVideo = node.data.video_metadata != null;
      
      if (isImage && node.data.preview_url) {
        previewContainer.html(`
          <div class="details-preview" style="margin-top: 16px; text-align: center;">
            <img src="${node.data.preview_url}" class="preview-clickable" style="max-width: 100%; max-height: 300px; border-radius: 8px; object-fit: contain; cursor: pointer;" />
          </div>
        `);
        previewContainer.classed('hidden', false);
        // Click to show fullscreen
        previewContainer.select('.preview-clickable').on('click', () => {
          this._showImageFullscreen(node.data.preview_url);
        });
      } else if (isVideo && this.currentRoot) {
        // Compute full path from hierarchy for cache fallback
        const filePath = this._getNodePath(node);
        const thumbUrl = api.getThumbnailUrl(node.data.id, this.currentRoot, filePath);
        previewContainer.html(`
          <div class="video-thumbnail-section" style="margin-top: 16px;">
            <div class="video-thumbnail-header" style="font-size: 12px; color: #888; margin-bottom: 8px;">
              Video Preview
            </div>
            <div class="video-thumbnail-container" style="text-align: center;">
              <img 
                src="${thumbUrl}" 
                class="video-thumbnail-img preview-clickable"
                style="max-width: 100%; border-radius: 8px; background: #1a1a1a; cursor: pointer;"
                onerror="this.parentElement.innerHTML='<div style=\\'padding: 20px; color: #666; font-size: 12px;\\'>Thumbnail unavailable</div>'"
              />
            </div>
          </div>
        `);
        previewContainer.classed('hidden', false);
        // Click to show fullscreen
        previewContainer.select('.preview-clickable').on('click', () => {
          this._showImageFullscreen(thumbUrl);
        });
      } else {
        previewContainer.classed('hidden', true);
      }
    } else {
      previewContainer.classed('hidden', true);
    }
    return this;
  }

  /**
   * Get the full path of a node by traversing up the hierarchy
   * @param {Object} node - D3 hierarchy node
   * @returns {string} Full path
   */
  _getNodePath(node) {
    const parts = [];
    let current = node;
    while (current) {
      if (current.data.name) {
        parts.unshift(current.data.name);
      }
      current = current.parent;
    }
    console.log('DEBUG _getNodePath BEFORE: parts=', parts, 'currentRoot=', this.currentRoot);
    
    // parts[0] is the root name, replace with actual root path
    if (parts.length > 0 && this.currentRoot) {
      // Remove the root name (parts[0]) and prepend full root path
      parts.shift();
      const fullPath = this.currentRoot + (parts.length > 0 ? '/' + parts.join('/') : '');
      console.log('DEBUG _getNodePath AFTER: parts=', parts, 'fullPath=', fullPath);
      return fullPath;
    }
    console.log('DEBUG _getNodePath FALLBACK: returning /' + parts.join('/'));
    return '/' + parts.join('/');
  }

  /**
   * Update details for current node
   * @param {object} node - D3 hierarchy node
   */
  update(node) {
    this.render(node);
  }

  /**
   * Show the panel
   */
  show() {
    this.container.classed('hidden', false);
  }

  /**
   * Hide the panel
   */
  hide() {
    this.container.classed('hidden', true);
  }

  /**
   * Toggle visibility
   */
  toggle() {
    this.container.classed('hidden', (d) => !d);
  }

  /**
   * Set file select handler
   * @param {function} callback - Callback receiving node data
   * @returns {this}
   */
  onFileSelect(callback) {
    this._onFileSelect = callback;
    return this;
  }

  /**
   * Get current node
   * @returns {object|null}
   */
  getCurrentNode() {
    return this.currentNode;
  }

  /**
   * Check if panel is visible
   * @returns {boolean}
   */
  isVisible() {
    return !this.container.classed('hidden');
  }
}
