/**
 * Sunburst Chart Component
 * D3.js-based interactive sunburst visualization for disk usage
 */

import { getNodeColor } from './utils/transform.js';

const DEFAULTS = {
  animationDuration: 750,
};

export class SunburstChart {
  constructor(container, options = {}) {
    this.options = { ...DEFAULTS, ...options };
    this.container = d3.select(container);
    // Resolve container to DOM element (handles both selector strings and elements)
    this.containerElement = typeof container === 'string'
      ? document.querySelector(container)
      : container;
    this.currentNode = null;
    this.selectedNode = null;
    this.root = null;
    this.paths = null;
    this.labels = null;
    this.originalData = null;
    
    // Get initial dimensions from container
    const { width, height, radius } = this._getContainerSize();
    this.options.width = width;
    this.options.height = height;
    this.options.radius = radius;
    
    // Debounced resize handler
    this._resizeHandler = this._debounce(() => this.resize(), 150);

    this._initSvg();
    this._initZoom();
    this._initResizeListener();
  }

  _debounce(fn, delay) {
    let timeout;
    return (...args) => {
      clearTimeout(timeout);
      timeout = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  _getContainerSize() {
    if (!this.containerElement) {
      return { width: 600, height: 600, radius: 280 };
    }
    const rect = this.containerElement.getBoundingClientRect();
    const width = Math.max(200, Math.floor(rect.width));
    const height = Math.max(200, Math.floor(rect.height));
    // Radius is half of the smaller dimension, with some padding
    const radius = Math.min(width, height) / 2 - 20;
    return { width, height, radius: Math.max(80, radius) };
  }

  _initResizeListener() {
    window.addEventListener('resize', this._resizeHandler);
  }

  _removeResizeListener() {
    window.removeEventListener('resize', this._resizeHandler);
  }

  /**
   * Resize the chart to fit its container
   */
  resize() {
    const { width, height, radius } = this._getContainerSize();
    
    // Update options
    this.options.width = width;
    this.options.height = height;
    this.options.radius = radius;

    // Update SVG viewBox for new dimensions
    this.svg
      .attr('viewBox', [-width / 2, -height / 2, width, height]);

    // Re-render if we have data
    if (this.originalData && this.currentNode) {
      // _updateView will re-partition with the new radius
      this._updateView(this.currentNode, false);
    }
  }

  _initSvg() {
    const { width, height, radius } = this._getContainerSize();
    
    // Store radius in options for use by render/updateView
    this.options.radius = radius;

    this.svg = this.container
      .append('svg')
      .attr('width', '100%')
      .attr('height', '100%')
      .attr('viewBox', [-width / 2, -height / 2, width, height])
      .attr('preserveAspectRatio', 'xMidYMid meet')
      .attr('style', 'font-family: Inter, system-ui, sans-serif;');

    this.g = this.svg.append('g').attr('class', 'sunburst-chart');

    // Separate groups for paths and labels to ensure correct z-order
    // Paths group is added first (bottom layer)
    this.pathsGroup = this.g.append('g').attr('class', 'paths-layer');
    // Labels group is added second (top layer) - always above paths
    this.labelsGroup = this.g.append('g').attr('class', 'labels-layer');
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
   * @param {object} data - D3 hierarchy node (from buildHierarchy, BEFORE partition)
   */
  render(data) {
    // Clear existing paths and labels (but keep the groups for z-order)
    this.pathsGroup.selectAll('*').remove();
    this.labelsGroup.selectAll('*').remove();

    // Store original HIERARCHY (before partition) for navigation
    // This is critical - we need the unmodified tree structure
    this.originalData = data;

    // Apply partition layout
    const root = d3
      .partition()
      .size([2 * Math.PI, this.options.radius])(data);

    this.root = root;
    this.currentNode = root;
    
    // Track path of partitioned nodes for navigation
    this.currentPath = [root];

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

    // Find target node in original unmodified data
    const originalNode = this._findNodeInOriginal(target.data.id);
    
    if (!originalNode) {
      console.error('Could not find node in original data:', target.data.id);
      return;
    }

    // Clone original data to avoid modifying it
    const cloneData = (node) => {
      const clone = { ...node.data };
      if (node.children) {
        clone.children = node.children.map(cloneData);
      }
      if (node.is_dir) {
        clone.value = 0;
      }
      return clone;
    };

    const clonedData = cloneData(originalNode);
    const subtree = d3
      .hierarchy(clonedData)
      .sum((d) => d.value)
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

    // Animate paths with smooth transition (use pathsGroup for correct z-order)
    this.pathsGroup
      .selectAll('path.chart-segment')
      .data(newRoot.descendants(), (d) => d.data.id)
      .join(
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

    // Update labels with transition (use labelsGroup for correct z-order)
    const maxLabelRadius = this.options.radius * 0.9;
    this.labelsGroup
      .selectAll('text.chart-label')
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
          .attr('text-anchor', 'middle')
          .attr('dy', '0.35em')
          .attr('font-size', '6px')
          .attr('fill', '#FFFFFF')
          .attr('pointer-events', 'none')
          .attr('text-shadow', '0 1px 2px rgba(0,0,0,0.5)')
          .text((d) => (d.data.name.length > 15 ? d.data.name.slice(0, 13) + '…' : d.data.name)),
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
    this.paths = this.pathsGroup.selectAll('path.chart-segment');
    this.labels = this.labelsGroup.selectAll('text.chart-label');

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

    // Add partitioned node to path
    this.currentPath.push(node);
    this.currentNode = node;
    this._updateView(node);

    // Trigger navigation callback
    if (this._onNavigate) {
      const path = this._buildPath(node);
      this._onNavigate(path);
    }
  }
  
  /**
   * Find a node by ID in the original hierarchy
   * @param {number} nodeId - Node ID to find
   * @returns {object|null} Found node or null
   */
  _findNodeInOriginal(nodeId) {
    let found = null;
    this.originalData.each((n) => {
      if (n.data.id === nodeId) found = n;
    });
    return found;
  }

  /**
   * Navigate up one level
   * Re-renders the chart showing the parent and all its children (siblings)
   */
  goUp() {
    if (this.currentPath.length > 1) {
      this.currentPath.pop();
      const parentNode = this.currentPath[this.currentPath.length - 1];
      
      // Find parent in original unmodified data
      const originalNode = this._findNodeInOriginal(parentNode.data.id);
      
      if (!originalNode) {
        console.error('Could not find node in original data:', parentNode.data.id);
        return;
      }
      
      // Clone original data
      const cloneData = (node) => {
        const clone = { ...node.data };
        if (node.children) {
          clone.children = node.children.map(cloneData);
        }
        if (node.is_dir) {
          clone.value = 0;
        }
        return clone;
      };
      
      const clonedData = cloneData(originalNode);
      const subtree = d3
        .hierarchy(clonedData)
        .sum((d) => d.value)
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
   * Get siblings of a node (children of same parent, sorted by angular position)
   * @param {object} node - Node to get siblings for
   * @returns {Array} Sorted siblings array
   */
  getSiblings(node) {
    if (!node || !node.parent) return [];
    // Sort by x0 angle for clockwise navigation
    return [...node.parent.children].sort((a, b) => a.x0 - b.x0);
  }

  /**
   * Select next sibling (clockwise in chart view)
   */
  selectNextSibling() {
    if (!this.selectedNode) return;
    const siblings = this.getSiblings(this.selectedNode);
    if (siblings.length <= 1) return;
    
    // Find current index in sorted siblings
    const currentIndex = siblings.findIndex((s) => s.data.id === this.selectedNode.data.id);
    const nextIndex = (currentIndex + 1) % siblings.length;
    this.select(siblings[nextIndex]);
  }

  /**
   * Select previous sibling (counter-clockwise in chart view)
   */
  selectPrevSibling() {
    if (!this.selectedNode) return;
    const siblings = this.getSiblings(this.selectedNode);
    if (siblings.length <= 1) return;
    
    // Find current index in sorted siblings
    const currentIndex = siblings.findIndex((s) => s.data.id === this.selectedNode.data.id);
    const prevIndex = (currentIndex - 1 + siblings.length) % siblings.length;
    this.select(siblings[prevIndex]);
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
    this._removeResizeListener();
    this.container.html('');
    this.svg = null;
    this.g = null;
    this.paths = null;
    this.labels = null;
    this.originalData = null;
  }
}
