/**
 * Details Panel Component
 * Shows contents of selected directory in table format
 */

import { formatSize, calculatePercentage, getFileIcon, countItems } from '../utils/transform.js';

export class DetailsPanel {
  constructor(container) {
    this.container = d3.select(container);
    this.currentNode = null;
    this._onFileSelect = null;

    this._init();
  }

  _init() {
    this.container.attr('class', 'details-panel');

    // Close button handler
    this.container.select('.details-close').on('click', () => this.hide());
  }

  /**
   * Render details for a node
   * @param {object} node - D3 hierarchy node
   */
  render(node) {
    this.currentNode = node;

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
      summary.html(`
        <div class="summary-stat">
          <span class="stat-value">${formatSize(node.data.size)}</span>
          <span class="stat-label">File Size</span>
        </div>
        <div class="summary-stat">
          <span class="stat-value">${ext.toUpperCase()}</span>
          <span class="stat-label">Extension</span>
        </div>
      `);
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
                   <img src="${d.data.preview_url}" style="width: 32px; height: 32px; border-radius: 4px; object-fit: cover;" />
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
    } else {
      const message = node.data.is_dir
        ? 'This folder is empty'
        : 'No contents to display';
      tbody.html(`<tr><td colspan="4" class="empty-message">${message}</td></tr>`);
    }

    // Preview section for image files (after table)
    const previewContainer = this.container.select('.details-preview-section');
    if (!node.data.is_dir) {
      const ext = node.data.name.split('.').pop().toLowerCase();
      const isImage = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg'].includes(ext);
      if (isImage && node.data.preview_url) {
        previewContainer.html(`
          <div class="details-preview" style="margin-top: 16px; text-align: center;">
            <img src="${node.data.preview_url}" style="max-width: 100%; max-height: 300px; border-radius: 8px; object-fit: contain;" />
          </div>
        `);
        previewContainer.classed('hidden', false);
      } else {
        previewContainer.classed('hidden', true);
      }
    } else {
      previewContainer.classed('hidden', true);
    }

    return this;
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
