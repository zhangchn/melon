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

    // Store original full hierarchy for navigation
    this.originalRoot = data;

    // Apply partition layout
    const root = d3
      .partition()
      .size([2 * Math.PI, this.options.radius])(data);

    this.root = root;
    this.currentNode = root;
    
    // Track path of data nodes (not partitioned nodes) for navigation
    this.currentPath = [root.data];

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
   * Update the view to focus on a target node (DaisyDisk-style drill down)
   * When clicking a directory, it moves up to replace its parent,
   * and ALL children are recursively raised with angles recalculated to fill 360°.
   * @param {object} target - Target node to focus on
   * @param {boolean} animate - Whether to animate transition
   */
  _updateView(target, animate = true) {
    const duration = animate ? this.options.animationDuration : 0;
    const radius = this.options.radius;

    // Build new hierarchy from target's subtree
    // This recursively raises all children by one level
    const subtree = d3
      .hierarchy(target.data)
      .sum((d) => d.size)
      .sort((a, b) => b.value - a.value);

    // Partition the subtree - children will automatically fill 360°
    const newRoot = d3
      .partition()
      .size([2 * Math.PI, radius])(subtree);

    // Create map of old positions for transition
    const oldPositions = new Map();
    if (this.root) {
      this.root.each((d) => {
        oldPositions.set(d.data.id, {
          x0: d.x0,
          x1: d.x1,
          y0: d.y0,
          y1: d.y1,
        });
      });
    }

    // Update arc generator
    const arc = d3
      .arc()
      .startAngle((d) => d.x0)
      .endAngle((d) => d.x1)
      .innerRadius((d) => Math.max(0, d.y0))
      .outerRadius((d) => Math.max(d.y0, d.y1 - 1));

    // Animate paths with smooth transition
    this.paths
      .data(newRoot.descendants(), (d) => d.data.id)
      .join(
        // Enter: new nodes fade in from center
        (enter) => enter
          .append('path')
          .attr('class', (d) => `chart-segment ${d.data.is_dir ? 'dir' : 'file'}`)
          .attr('fill', (d) => this._getColor(d))
          .attr('stroke', '#FFFFFF')
          .attr('stroke-width', 1)
          .attr('cursor', 'pointer')
          .each(function(d) {
            // Start from old position if exists, or from center
            const old = oldPositions.get(d.data.id);
            if (old) {
              d.x0 = old.x0;
              d.x1 = old.x1;
              d.y0 = old.y0;
              d.y1 = old.y1;
            } else {
              // New node: start from center
              d.x0 = 0;
              d.x1 = 0;
              d.y0 = 0;
              d.y1 = 0;
            }
          })
          .attr('d', arc)
          .style('opacity', 0)
          .call((enter) => enter
            .transition()
            .duration(duration)
            .attrTween('d', function(d) {
              // Interpolate from old to new position
              const old = oldPositions.get(d.data.id);
              const interpolate = d3.interpolate(
                old || { x0: 0, x1: 0, y0: 0, y1: 0 },
                d
              );
              return (t) => arc(interpolate(t));
            })
            .style('opacity', (d) => {
              const angle = d.x1 - d.x0;
              return angle < 0.005 ? 0 : 1;
            })
          ),
        // Update: existing nodes animate to new positions
        (update) => update
          .each(function(d) {
            // Store old position for interpolation
            const old = oldPositions.get(d.data.id);
            if (old) {
              d._prev = old;
            }
          })
          .call((update) => update
            .transition()
            .duration(duration)
            .attrTween('d', function(d) {
              const old = d._prev || oldPositions.get(d.data.id) || { x0: d.x0, x1: d.x1, y0: d.y0, y1: d.y1 };
              const interpolate = d3.interpolate(old, d);
              return (t) => arc(interpolate(t));
            })
            .style('opacity', (d) => {
              const angle = d.x1 - d.x0;
              return angle < 0.005 ? 0 : 1;
            })
          ),
        // Exit: nodes that are no longer visible fade out
        (exit) => exit
          .call((exit) => exit
            .transition()
            .duration(duration)
            .style('opacity', 0)
            .attr('d', (d) => {
              // Shrink to center
              const shrink = { ...d, x0: d.x0, x1: d.x0, y0: d.y1, y1: d.y1 };
              return arc(shrink);
            })
            .remove()
          )
      );

    // Update labels with transition
    const maxLabelRadius = this.options.radius * 0.9;
    this.labels
      .data(
        newRoot.descendants().filter((d) => {
          const angle = d.x1 - d.x0;
          const r = (d.y0 + d.y1) / 2;
          return angle > 0.05 && r < maxLabelRadius && d.data.name.length > 0;
        }),
        (d) => d.data.id
      )
      .join(
        (enter) => enter
          .append('text')
          .attr('class', 'chart-label')
          .style('opacity', 0)
          .attr('transform', (d) => {
            const old = oldPositions.get(d.data.id);
            if (old) {
              const x = ((old.x0 + old.x1) / 2) * (180 / Math.PI);
              const y = (old.y0 + old.y1) / 2;
              return `translate(${Math.cos(((x - 90) * Math.PI) / 180) * y},${Math.sin(((x - 90) * Math.PI) / 180) * y}) rotate(${x - 90})`;
            }
            return `translate(0,0)`;
          })
          .each(function(d) {
            const old = oldPositions.get(d.data.id);
            if (old) {
              d._prevLabel = {
                x0: old.x0,
                x1: old.x1,
                y0: old.y0,
                y1: old.y1,
              };
            }
          })
          .call((enter) => enter
            .transition()
            .duration(duration)
            .attr('transform', (d) => {
              const x = ((d.x0 + d.x1) / 2) * (180 / Math.PI);
              const y = (d.y0 + d.y1) / 2;
              return `translate(${Math.cos(((x - 90) * Math.PI) / 180) * y},${Math.sin(((x - 90) * Math.PI) / 180) * y}) rotate(${x - 90})`;
            })
            .style('opacity', 1)
          )
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
          .text((d) => (d.data.name.length > 20 ? d.data.name.slice(0, 18) + '…' : d.data.name)),
        (update) => update
          .each(function(d) {
            const old = oldPositions.get(d.data.id);
            if (old) {
              d._prevLabel = old;
            }
          })
          .call((update) => update
            .transition()
            .duration(duration)
            .attrTween('transform', (d) => {
              const prev = d._prevLabel || oldPositions.get(d.data.id);
              if (!prev) return null;
              const interpolateX = d3.interpolate((prev.x0 + prev.x1) / 2, (d.x0 + d.x1) / 2);
              const interpolateY = d3.interpolate((prev.y0 + prev.y1) / 2, (d.y0 + d.y1) / 2);
              return (t) => {
                const x = interpolateX(t) * (180 / Math.PI);
                const y = interpolateY(t);
                return `translate(${Math.cos(((x - 90) * Math.PI) / 180) * y},${Math.sin(((x - 90) * Math.PI) / 180) * y}) rotate(${x - 90})`;
              };
            })
            .style('opacity', 1)
          ),
        (exit) => exit
          .call((exit) => exit
            .transition()
            .duration(duration)
            .style('opacity', 0)
            .remove()
          )
      );

    // Store new root and paths
    this.root = newRoot;
    this.paths = this.g.selectAll('path.chart-segment');
    this.labels = this.g.selectAll('text.chart-label');

    // Re-bind events to new paths
    this._bindChartPaths();
  }

  _getColor(d) {
    return d.data.is_dir 
      ? ['#3B82F6', '#6366F1', '#8B5CF6', '#A78BFA', '#C4B5FD'][d.depth % 5]
      : ['#10B981', '#14B8A6', '#2DD4BF', '#5EEAD4', '#99F6E4'][d.depth % 5];
  }

  _bindChartPaths() {
    // This will be called by app.js after render
  }

  /**
   * Drill down into a directory node
   * @param {object} node - Node to drill into (partitioned node)
   */
  drillDown(node) {
    if (!node.children || node.children.length === 0) return;

    // Add data node to path (not partitioned node)
    this.currentPath.push(node.data);
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
   * Re-renders the chart showing the parent and all its children (siblings)
   */
  goUp() {
    // Remove current data node from path
    if (this.currentPath.length > 1) {
      this.currentPath.pop();
      
      // Get the new current data node (parent level)
      const newCurrentData = this.currentPath[this.currentPath.length - 1];
      
      // Re-build hierarchy from this data node
      // This includes all siblings because we're using the original data
      const subtree = d3
        .hierarchy(newCurrentData)
        .sum((d) => d.size)
        .sort((a, b) => b.value - a.value);
      
      const newRoot = d3
        .partition()
        .size([2 * Math.PI, this.options.radius])(subtree);
      
      this.currentNode = newRoot;
      this.root = newRoot;
      this._updateView(newRoot);

      if (this._onNavigate) {
        const path = this._buildPath(newRoot);
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
