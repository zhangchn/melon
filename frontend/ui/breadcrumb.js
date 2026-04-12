/**
 * Breadcrumb Navigation Component
 * Shows current path and allows quick navigation
 */

import { truncate } from '../utils/transform.js';

export class Breadcrumb {
  constructor(container) {
    this.container = d3.select(container);
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

  /**
   * Render breadcrumb with path array
   * @param {Array<string>} pathArray - Path components
   */
  render(pathArray) {
    this.path = pathArray;

    // Clear existing
    this.container.html('');

    // Handle empty path
    if (!pathArray || pathArray.length === 0) {
      this.container.html('<span class="breadcrumb-placeholder">Scan a directory to begin</span>');
      return this;
    }

    // Create breadcrumb items
    const items = this.container
      .selectAll('.breadcrumb-item')
      .data(pathArray.map((name, i) => ({ name, index: i })))
      .join('span')
      .attr('class', 'breadcrumb-item');

    // Add each item with separator
    items.each(function (d, i) {
      const isLast = i === pathArray.length - 1;
      const item = d3.select(this);

      // Add link button
      item
        .append('button')
        .attr('class', `breadcrumb-link ${isLast ? 'current' : ''}`)
        .attr('data-index', i)
        .attr('aria-current', isLast ? 'page' : null)
        .attr('title', pathArray[i])
        .text(truncate(pathArray[i], 30));

      // Add separator if not last
      if (!isLast) {
        item.append('span').attr('class', 'breadcrumb-separator').text('›');
      }
    });

    // Bind click events
    this.container.selectAll('.breadcrumb-link').on('click', (event) => {
      const index = parseInt(event.target.dataset.index);
      if (this._onNavigate) {
        this._onNavigate(index);
      }
    });

    return this;
  }

  /**
   * Highlight a specific breadcrumb index
   * @param {number} index - Index to highlight
   */
  highlight(index) {
    this.container
      .selectAll('.breadcrumb-link')
      .classed('current', (d, i) => i === index)
      .attr('aria-current', (d, i) => (i === index ? 'page' : null));
  }

  /**
   * Set navigation handler
   * @param {function} callback - Callback receiving index
   * @returns {this}
   */
  onNavigate(callback) {
    this._onNavigate = callback;
    return this;
  }

  /**
   * Get current path array
   * @returns {Array<string>}
   */
  getPath() {
    return this.path;
  }

  /**
   * Clear breadcrumb
   */
  clear() {
    this.path = [];
    this.container.html('<span class="breadcrumb-placeholder">Scan a directory to begin</span>');
  }
}
