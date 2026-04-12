/**
 * Sunburst Chart Component
 * D3.js-based interactive sunburst visualization for disk usage
 */

import { getNodeColor } from './utils/transform.js';

const DEFAULTS = {
  width: 600,
  height: 600,
  radius: 280,
  animationDuration: 750,
};

export class SunburstChart {
  constructor(container, options = {}) {
    this.options = { ...DEFAULTS, ...options };
    this.container = d3.select(container);
    this.currentNode = null;
    this.selectedNode = null;
    this.root = null;
    this.paths = null;
    this.labels = null;

    this._initSvg();
    this._initZoom();
  }

  _initSvg() {
    const { width, height } = this.options;

    this.svg = this.container
      .append('svg')
      .attr('width', width)
      .attr('height', height)
      .attr('viewBox', [-width / 2, -height / 2, width, height])
      .attr('style', 'max-width: 100%; height: auto; font-family: Inter, system-ui, sans-serif;');

    this.g = this.svg.append('g').attr('class', 'sunburst-chart');
  }

  _initZoom() {
    this.zoomBehavior = d3
      .zoom()
      .scaleExtent([0.5, 4])
      .on('zoom', (event) => {
        this.g.attr('transform', event.transform);
      });

    this.svg.call(this.zoomBehavior);

    // Double-click to reset zoom
    this.svg.on('dblclick.zoom', (event) => {
      event.stopPropagation();
      this.resetZoom();
    });
  }

  /**
   * Render the chart with hierarchy data
   * @param {object} data - D3 hierarchy node
   */
  render(data) {
    // Clear existing
    this.g.selectAll('*').remove();

    // Apply partition layout
    const root = d3
      .partition()
      .size([2 * Math.PI, this.options.radius])(data);

    this.root = root;
    this.currentNode = root;

    // Create arc generator
    const arc = d3
      .arc()
      .startAngle((d) => d.x0)
      .endAngle((d) => d.x1)
      .padAngle((d) => Math.min((d.x1 - d.x0) / 2, 0.005))
      .padRadius(this.options.radius * 1.5)
      .innerRadius((d) => d.y0)
      .outerRadius((d) => Math.max(d.y0, d.y1 - 1));

    // Create color function
    const getColor = (d) => getNodeColor(d, d.data.is_dir);

    // Create arcs
    this.paths = this.g
      .selectAll('path')
      .data(root.descendants())
      .join('path')
      .attr('class', (d) => `chart-segment ${d.data.is_dir ? 'dir' : 'file'}`)
      .attr('fill', getColor)
      .attr('stroke', '#FFFFFF')
      .attr('stroke-width', 1)
      .attr('cursor', 'pointer')
      .attr('d', arc)
      .style('opacity', (d) => {
        const angle = d.x1 - d.x0;
        return angle < 0.005 ? 0 : 1;
      });

    // Add labels for large segments
    this.labels = this.g
      .selectAll('text')
      .data(
        root.descendants().filter((d) => {
          const angle = d.x1 - d.x0;
          const radius = (d.y0 + d.y1) / 2;
          return (
            angle > 0.05 &&
            radius < this.options.radius * 0.9 &&
            d.data.name.length > 0
          );
        })
      )
      .join('text')
      .attr('class', 'chart-label')
      .attr('transform', (d) => {
        const x = ((d.x0 + d.x1) / 2) * (180 / Math.PI);
        const y = (d.y0 + d.y1) / 2;
        return `translate(${Math.cos(((x - 90) * Math.PI) / 180) * y},${Math.sin(((x - 90) * Math.PI) / 180) * y}) rotate(${x - 90})`;
      })
      .attr('text-anchor', (d) => {
        const x = (d.x0 + d.x1) / 2 * (180 / Math.PI);
        return x > 180 ? 'end' : 'start';
      })
      .attr('dx', (d) => {
        const x = (d.x0 + d.x1) / 2 * (180 / Math.PI);
        return x > 180 ? -6 : 6;
      })
      .attr('dy', '0.35em')
      .attr('font-size', '10px')
      .attr('fill', '#FFFFFF')
      .attr('pointer-events', 'none')
      .attr('text-shadow', '0 1px 2px rgba(0,0,0,0.5)')
      .text((d) => (d.data.name.length > 20 ? d.data.name.slice(0, 18) + '…' : d.data.name));

    // Hide center (root takes full circle initially)
    this._updateView(root, false);
  }

  /**
   * Update the view to focus on a target node
   * @param {object} target - Target node to focus on
   * @param {boolean} animate - Whether to animate transition
   */
  _updateView(target, animate = true) {
    const duration = animate ? this.options.animationDuration : 0;

    // Calculate new view
    const interpolateZoom = this._interpolateZoom(target);

    // Animate transition
    this.g
      .transition()
      .duration(duration)
      .tween('zoom', () => {
        const fn = interpolateZoom;
        return (t) => {
          const transform = fn(t);
          this.svg.call(this.zoomBehavior.transform, transform);
        };
      });

    // Update arc visibility
    if (this.paths) {
      this.paths.style('opacity', (d) => {
        const angle = d.x1 - d.x0;
        return angle < 0.005 ? 0 : 1;
      });
    }
  }

  _interpolateZoom(target) {
    const view = {
      x: target.x0,
      dx: target.x1 - target.x0,
      y: target.y0,
      dy: target.y1 - target.y0,
    };

    return (t) => {
      const x = d3.interpolate(view.x, 0)(t);
      const dx = d3.interpolate(view.dx, 2 * Math.PI)(t);
      const y = d3.interpolate(view.y, 0)(t);
      const dy = d3.interpolate(view.dy, this.options.radius)(t);

      const scale = Math.min(this.options.width, this.options.height) / dy;
      
      // Apply full transform including rotation directly to the group
      const rotate = (-x * 180 / Math.PI - 90);
      this.g.attr('transform', 
        `translate(${this.options.width / 2},${this.options.height / 2}) scale(${scale}) rotate(${rotate})`
      );
      
      // Return a basic transform for the zoom behavior
      return d3.zoomIdentity.scale(scale);
    };
  }

  /**
   * Drill down into a directory node
   * @param {object} node - Node to drill into
   */
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

  /**
   * Navigate up one level
   */
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

  /**
   * Navigate to root
   */
  goToRoot() {
    this.currentNode = this.root;
    this._updateView(this.root);

    if (this._onNavigate) {
      this._onNavigate([this.root.data.name]);
    }
  }

  /**
   * Select a node
   * @param {object} node - Node to select
   */
  select(node) {
    // Clear previous selection
    if (this.paths) {
      this.paths.classed('selected', false);
    }

    // Select new node
    this.selectedNode = node;

    // Find and highlight the path
    if (this.paths) {
      this.paths
        .filter((d) => d === node)
        .classed('selected', true)
        .raise(); // Bring to front
    }

    // Trigger callback
    if (this._onNodeClick) {
      this._onNodeClick(node.data);
    }
  }

  /**
   * Clear selection
   */
  clearSelection() {
    if (this.paths) {
      this.paths.classed('selected', false);
    }
    this.selectedNode = null;
  }

  /**
   * Zoom in
   */
  zoomIn() {
    this.svg.transition().call(this.zoomBehavior.scaleBy, 1.3);
  }

  /**
   * Zoom out
   */
  zoomOut() {
    this.svg.transition().call(this.zoomBehavior.scaleBy, 0.7);
  }

  /**
   * Reset zoom to default
   */
  resetZoom() {
    this.svg
      .transition()
      .duration(500)
      .call(this.zoomBehavior.transform, d3.zoomIdentity);
  }

  /**
   * Build path array from node
   * @param {object} node - Node
   * @returns {Array<string>} Path components
   */
  _buildPath(node) {
    const path = [];
    let current = node;

    while (current) {
      path.unshift(current.data.name);
      current = current.parent;
    }

    return path;
  }

  /**
   * Set node click handler
   * @param {function} callback - Callback receiving node data
   * @returns {this}
   */
  onNodeClick(callback) {
    this._onNodeClick = callback;
    return this;
  }

  /**
   * Set node hover handler
   * @param {function} callback - Callback receiving node data
   * @returns {this}
   */
  onNodeHover(callback) {
    this._onNodeHover = callback;
    return this;
  }

  /**
   * Set navigation handler
   * @param {function} callback - Callback receiving path array
   * @returns {this}
   */
  onNavigate(callback) {
    this._onNavigate = callback;
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
   * Get selected node
   * @returns {object|null}
   */
  getSelectedNode() {
    return this.selectedNode;
  }

  /**
   * Destroy the chart and clean up
   */
  destroy() {
    this.container.html('');
    this.svg = null;
    this.g = null;
    this.paths = null;
    this.labels = null;
  }
}
