# Feature Plan: Background Click + Arrow Key Navigation

## Goal

1. Clicking on background (empty chart area) reverts details panel to show the current folder (central node)
2. Arrow left/right keys navigate among siblings when a file/directory is selected

## Current Context

### Architecture
- `frontend/app.js` - Main application, handles keyboard events in `_handleKeyboard()`
- `frontend/chart.js` - SunburstChart class, manages `currentNode` (center), `selectedNode`, `paths`
- `frontend/ui/details-panel.js` - DetailsPanel, shows selected node info

### Current Keyboard Handling (app.js:476-505)
- Escape: clears selection, hides modals/search
- Backspace: goUp()
- Ctrl+F/R/O: search/refresh/open path
- 0: reset zoom
- ?: help modal

### Current Click Handling (app.js:151-161)
- Chart segment click: handled via `_bindChartPaths()` on paths
- No handler for background/empty click

### Selection State
- `chart.selectedNode` - currently selected node (D3 hierarchy node)
- `chart.currentNode` - the central node of current view (root of displayed subtree)
- `details.currentNode` - node displayed in details panel

## Proposed Approach

### 1. Background Click Handler

Add click handler on chart container that:
- Detects if click target is NOT a path segment (background click)
- On background click: show `chart.currentNode` in details panel
- This provides a "reset to current folder" action when clicking empty space

Implementation in `app.js`:
```javascript
// In _bindChartInteractions() or new method
d3.select('#chart').on('click', (event) => {
  // Check if click was on a path segment
  const target = event.target;
  if (!target.classList.contains('chart-segment')) {
    // Background click - show current folder in details
    const currentNode = this.chart.getCurrentNode();
    if (currentNode) {
      this.details.render(currentNode, this.currentData?.root);
      this.details.show();
      this.chart.clearSelection();
      this._updateStatus(`Showing: ${currentNode.data.name}`);
    }
  }
});
```

**Issue**: Current `_bindChartInteractions()` at line 151-161 has:
```javascript
d3.select('#chart').select('.sunburst-chart')
  .on('click', (event) => {
    event.stopPropagation();
  });
```
This stops propagation, preventing outer click handlers. Need to restructure.

**Better approach**: Handle background click at SVG level, check if target is background:
```javascript
// Add to _bindChartInteractions()
this.chart.svg.on('click', (event) => {
  const target = event.target;
  // Check if click is on background (not path or label)
  if (target.tagName === 'svg' || target === this.chart.g.node()) {
    // Background click
    const currentNode = this.chart.getCurrentNode();
    if (currentNode) {
      this.details.render(currentNode, this.currentData?.root);
      this.details.show();
      this.chart.clearSelection();
    }
  }
});
```

### 2. Arrow Key Navigation Among Siblings

When `chart.selectedNode` exists, left/right arrows navigate siblings.

Need to add methods to `chart.js`:
```javascript
// Get siblings of a node (children of same parent)
getSiblings(node) {
  if (!node || !node.parent) return [];
  return node.parent.children || [];
}

// Navigate to next/previous sibling
selectNextSibling() {
  if (!this.selectedNode) return;
  const siblings = this.getSiblings(this.selectedNode);
  const currentIndex = siblings.indexOf(this.selectedNode);
  const nextIndex = (currentIndex + 1) % siblings.length;
  this.select(siblings[nextIndex]);
}

selectPrevSibling() {
  if (!this.selectedNode) return;
  const siblings = this.getSiblings(this.selectedNode);
  const currentIndex = siblings.indexOf(this.selectedNode);
  const prevIndex = (currentIndex - 1 + siblings.length) % siblings.length;
  this.select(siblings[prevIndex]);
}
```

Then in `app.js` `_handleKeyboard()`:
```javascript
} else if (e.key === 'ArrowRight') {
  this.chart.selectNextSibling();
} else if (e.key === 'ArrowLeft') {
  this.chart.selectPrevSibling();
}
```

**Edge cases**:
- Selected node at root (no parent): no siblings to navigate
- Only one sibling: navigation cycles to self (acceptable)
- Siblings sorted by size in details panel but by angle in chart - use chart order (partition layout order)

### 3. Update Details Panel After Arrow Navigation

When arrow navigation changes selection, need to update details panel. The `select()` method already triggers `_onNodeClick` callback which updates details via app.js line 43-47.

**Verification needed**: Check if `select()` callback properly updates details panel after arrow navigation.

## Step-by-Step Plan

### Step 1: Add sibling navigation methods to chart.js
1. Add `getSiblings(node)` method
2. Add `selectNextSibling()` method
3. Add `selectPrevSibling()` method

### Step 2: Add arrow key handlers to app.js
1. Add ArrowLeft/ArrowRight handling in `_handleKeyboard()`
2. Only navigate if `chart.selectedNode` exists

### Step 3: Add background click handler
1. Modify `_bindChartInteractions()` to add SVG-level click handler
2. Detect background click (not on path segment)
3. On background click: show currentNode in details, clear selection

### Step 4: Update help modal
1. Add ArrowLeft/ArrowRight shortcuts to help modal table

### Step 5: Test
1. Test background click with node selected
2. Test background click without selection
3. Test arrow navigation with selection
4. Test arrow navigation at root level

## Files to Change

| File | Changes |
|------|---------|
| `frontend/chart.js` | Add `getSiblings()`, `selectNextSibling()`, `selectPrevSibling()` methods |
| `frontend/app.js` | Add ArrowLeft/ArrowRight in `_handleKeyboard()`, add background click handler in `_bindChartInteractions()` |
| `frontend/index.html` | Add arrow key shortcuts to help modal table |

## Tests/Validation

1. Background click behavior:
   - Click empty chart area when a node is selected -> details shows current folder
   - Selection cleared after background click

2. Arrow navigation:
   - Select a file, press ArrowRight -> next sibling selected
   - Press ArrowLeft -> previous sibling selected
   - Navigation wraps around (last to first, first to last)
   - No navigation if nothing selected

3. Details panel updates correctly after each navigation action

## Risks/Tradeoffs

1. **Event propagation complexity**: Current click handlers use `event.stopPropagation()` which may interfere. Need to restructure carefully.

2. **Sibling ordering**: Partition layout orders by value (size), but angle position may differ. Navigation should follow visual (angular) order for intuitive UX. May need to sort siblings by `x0` angle instead of array order.

3. **Keyboard focus**: Arrow keys should only work when not in input field - already handled by existing check.

## Open Questions

1. Should arrow navigation follow angular order (clockwise) instead of array order?
   - Proposal: Yes, more intuitive. Sort siblings by `x0` angle.

2. Should background click also clear breadcrumb or just selection?
   - Proposal: Just selection and details panel. Breadcrumb stays as navigation indicator.

3. Should there be visual feedback for "no siblings" case?
   - Proposal: Silent no-op is acceptable (matches other keyboard shortcuts).