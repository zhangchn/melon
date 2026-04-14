/**
 * Tooltip Component
 * Shows hover information for chart segments
 */

import { formatSize, calculatePercentage, getFileIcon } from '../utils/transform.js';

export class Tooltip {
  constructor(container = document.body) {
    this.container = d3.select(container);
    this.tooltip = null;
    this.visible = false;

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
      .style('visibility', 'hidden')
      .style('transition', 'opacity 0.15s ease, visibility 0.15s ease')
      .html(`
        <div class="tooltip-icon"></div>
        <div class="tooltip-content">
          <div class="tooltip-name"></div>
          <div class="tooltip-size"></div>
          <div class="tooltip-percent"></div>
          <div class="tooltip-path"></div>
          ${'<div class="tooltip-error" style="display:none;"></div>'}
          ${'<div class="tooltip-preview" style="display:none; margin-top: 8px;"></div>'}
        </div>
      `);
  }

  /**
   * Show tooltip for a node
   * @param {object} node - D3 hierarchy node
   * @param {object} position - {x, y} position in pixels
   */
  show(node, position) {
    const { x, y } = position;

    // Update icon
    const icon = getFileIcon(node.data.name, node.data.is_dir);
    this.tooltip.select('.tooltip-icon').text(icon);

    // Update name
    this.tooltip.select('.tooltip-name').text(node.data.name);

    // Update size
    this.tooltip
      .select('.tooltip-size')
      .text(formatSize(node.data.size));

    // Update percentage
    const parentPercent = node.parent
      ? `${calculatePercentage(node.data, node.parent.data)}% of parent`
      : 'Root directory';
    this.tooltip.select('.tooltip-percent').text(parentPercent);

    // Update path (if available)
    const pathEl = this.tooltip.select('.tooltip-path');
    if (node.data.path) {
      pathEl.text(node.data.path).style('display', 'block');
    } else {
      pathEl.style('display', 'none');
    }

    // Update error (if present)
    const errorEl = this.tooltip.select('.tooltip-error');
    if (node.data.error) {
      errorEl.text(`⚠️ ${node.data.error}`).style('display', 'block');
    } else {
      errorEl.style('display', 'none');
    }

    // Update preview (if available - small images)
    const previewEl = this.tooltip.select('.tooltip-preview');
    if (node.data.preview_url) {
      previewEl.html(`<img src="${node.data.preview_url}" style="max-width: 100px; max-height: 100px; border-radius: 4px; object-fit: cover;" />`)
        .style('display', 'block');
    } else {
      previewEl.style('display', 'none');
    }

    // Position tooltip
    // Adjust position to keep tooltip in viewport
    const tooltipWidth = 250;
    const tooltipHeight = 150;
    const margin = 15;

    let posX = x + margin;
    let posY = y + margin;

    // Check if tooltip would go off right edge
    if (posX + tooltipWidth > window.innerWidth) {
      posX = x - tooltipWidth - margin;
    }

    // Check if tooltip would go off bottom edge
    if (posY + tooltipHeight > window.innerHeight) {
      posY = y - tooltipHeight - margin;
    }

    this.tooltip
      .style('left', `${posX}px`)
      .style('top', `${posY}px`)
      .style('visibility', 'visible')
      .style('opacity', 1);

    this.visible = true;
  }

  /**
   * Hide tooltip
   */
  hide() {
    this.tooltip
      .style('visibility', 'hidden')
      .style('opacity', 0);

    this.visible = false;
  }

  /**
   * Update tooltip content for current node
   * @param {object} node - D3 hierarchy node
   */
  update(node) {
    if (this.visible) {
      // Content update only (position stays same)
      const icon = getFileIcon(node.data.name, node.data.is_dir);
      this.tooltip.select('.tooltip-icon').text(icon);
      this.tooltip.select('.tooltip-name').text(node.data.name);
      this.tooltip.select('.tooltip-size').text(formatSize(node.data.size));

      const parentPercent = node.parent
        ? `${calculatePercentage(node.data, node.parent.data)}% of parent`
        : 'Root directory';
      this.tooltip.select('.tooltip-percent').text(parentPercent);
    }
  }

  /**
   * Check if tooltip is visible
   * @returns {boolean}
   */
  isVisible() {
    return this.visible;
  }

  /**
   * Destroy tooltip
   */
  destroy() {
    this.tooltip.remove();
    this.tooltip = null;
  }
}
