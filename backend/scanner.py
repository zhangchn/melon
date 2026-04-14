"""File system scanner for disk usage analysis."""

import os
import time
from pathlib import Path
from typing import List, Optional, Set, Callable
from dataclasses import dataclass, field

import fnmatch


# Image extensions that can be previewed
IMAGE_EXTENSIONS = {'.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg'}
MAX_PREVIEW_SIZE = 5 * 1024 * 1024  # 5MB


@dataclass
class ScanNode:
    """Compact node representation for efficient memory usage."""
    id: int
    parent_id: Optional[int]
    name: str
    size: int
    depth: int
    is_dir: bool
    error: Optional[str] = None
    preview_url: Optional[str] = None


class DirectoryScanner:
    """
    Scans directories and builds a hierarchical size map.
    
    Uses iterative traversal to avoid recursion limits.
    Supports exclude patterns, depth limits, and progress callbacks.
    """
    
    DEFAULT_EXCLUDES = [
        '.git', '.svn', '.hg',
        'node_modules', '__pycache__', '.pytest_cache',
        '.venv', 'venv', 'env',
        '.idea', '.vscode',
        'dist', 'build', '.eggs',
        '*.pyc', '*.pyo',
        '.DS_Store', 'Thumbs.db',
    ]
    
    def __init__(
        self,
        excluded_patterns: Optional[List[str]] = None,
        max_depth: int = 50,
        max_results: int = 100000,
        follow_symlinks: bool = False,
    ):
        self.excluded_patterns = excluded_patterns or self.DEFAULT_EXCLUDES.copy()
        self.max_depth = max_depth
        self.max_results = max_results
        self.follow_symlinks = follow_symlinks
        self._inode_cache: Set[tuple] = set()  # Track visited inodes to avoid loops
    
    def _should_exclude(self, name: str, is_dir: bool) -> bool:
        """Check if a file/directory should be excluded."""
        for pattern in self.excluded_patterns:
            if fnmatch.fnmatch(name, pattern):
                return True
            # Also check if it matches as a directory pattern
            if is_dir and pattern == name:
                return True
        return False
    
    def _get_size(self, path: Path, is_dir: bool) -> tuple[int, Optional[str]]:
        """
        Get size of a file or directory.
        
        Returns (size_bytes, error_message).
        For directories, recursively sums all contained files.
        """
        try:
            if not is_dir:
                return path.stat().st_size, None
            
            # For directories, we'll calculate size during traversal
            # This method is used for files only during the scan
            return 0, None
            
        except PermissionError:
            return 0, "Permission denied"
        except OSError as e:
            return 0, str(e)
    
    def scan(
        self,
        root_path: str,
        progress_callback: Optional[Callable[[str, int, int], None]] = None,
    ) -> tuple[List[ScanNode], dict]:
        """
        Scan a directory and return all nodes.
        
        Args:
            root_path: Root directory to scan
            progress_callback: Optional callback(current_path, nodes_count, size_so_far)
        
        Returns:
            Tuple of (nodes_list, metadata_dict)
        """
        start_time = time.time()
        root = Path(root_path).resolve()
        
        if not root.exists():
            raise FileNotFoundError(f"Path does not exist: {root_path}")
        
        if not root.is_dir():
            raise NotADirectoryError(f"Path is not a directory: {root_path}")
        
        nodes: List[ScanNode] = []
        node_id = 0
        total_files = 0
        total_dirs = 0
        
        # Track directory sizes using a dict: path -> (size, node_id)
        dir_sizes: dict[Path, int] = {}
        dir_node_ids: dict[Path, int] = {}
        
        # Stack for iterative DFS: (path, parent_id, depth)
        stack: List[tuple[Path, Optional[int], int]] = [(root, None, 0)]
        
        # Track visited inodes to prevent symlink loops
        visited_inodes: Set[tuple] = set()
        
        while stack and len(nodes) < self.max_results:
            current_path, parent_id, depth = stack.pop()
            
            try:
                # Check inode to prevent loops
                try:
                    stat_info = current_path.stat()
                    inode_key = (stat_info.st_dev, stat_info.st_ino)
                    
                    if inode_key in visited_inodes and not current_path == root:
                        continue
                    
                    if not self.follow_symlinks and current_path.is_symlink():
                        # Skip symlinks but don't error
                        continue
                    
                    visited_inodes.add(inode_key)
                except (OSError, PermissionError) as e:
                    # Can't stat, skip
                    continue
                
                name = current_path.name or current_path.root  # Handle root "/"
                is_dir = current_path.is_dir()
                
                # Check exclusions
                if self._should_exclude(name, is_dir):
                    continue
                
                # Check depth
                if depth > self.max_depth:
                    continue
                
                # Get size for files
                size = 0
                error = None
                preview_url = None

                if not is_dir:
                    try:
                        size = stat_info.st_size
                        total_files += 1
                        
                        # Check if file is a small image for preview
                        ext = current_path.suffix.lower()
                        if ext in IMAGE_EXTENSIONS and size <= MAX_PREVIEW_SIZE:
                            # Generate preview URL (will be handled by backend endpoint)
                            preview_url = f"/api/preview?node_id={node_id}"
                    except (OSError, PermissionError) as e:
                        error = str(e)
                else:
                    total_dirs += 1
                    dir_node_ids[current_path] = node_id

                # Create node
                node = ScanNode(
                    id=node_id,
                    parent_id=parent_id,
                    name=name,
                    size=size,
                    depth=depth,
                    is_dir=is_dir,
                    error=error,
                    preview_url=preview_url,
                )
                nodes.append(node)
                current_node_id = node_id  # Capture current node's ID for children
                node_id += 1
                
                # Progress callback
                if progress_callback:
                    current_size = sum(n.size for n in nodes)
                    progress_callback(str(current_path), len(nodes), current_size)
                
                # Add children to stack (for directories)
                if is_dir:
                    try:
                        entries = list(current_path.iterdir())
                        # Add to stack in reverse order for consistent ordering
                        for entry in reversed(entries):
                            stack.append((entry, current_node_id, depth + 1))
                    except PermissionError:
                        # Mark directory as having permission error
                        nodes[-1].error = "Permission denied"
                    except OSError:
                        nodes[-1].error = "Cannot read directory"
                
            except Exception as e:
                # Log but continue scanning
                continue
        
        # Second pass: calculate directory sizes bottom-up
        # Build parent -> children mapping
        children_map: dict[int, List[int]] = {}
        for node in nodes:
            if node.parent_id is not None:
                if node.parent_id not in children_map:
                    children_map[node.parent_id] = []
                children_map[node.parent_id].append(node.id)
        
        # Calculate sizes bottom-up (deepest first)
        nodes_by_id: dict[int, ScanNode] = {n.id: n for n in nodes}
        
        # Sort by depth descending
        sorted_nodes = sorted(nodes, key=lambda n: -n.depth)
        
        for node in sorted_nodes:
            if node.is_dir and node.id in children_map:
                # Sum children sizes
                total_child_size = sum(
                    nodes_by_id[child_id].size 
                    for child_id in children_map[node.id]
                )
                node.size = total_child_size
        
        # Calculate metadata
        scan_time = time.time() - start_time
        total_size = sum(n.size for n in nodes if n.parent_id is None)  # Root size
        if not total_size and nodes:
            total_size = nodes[0].size if nodes else 0
        
        metadata = {
            "root_path": str(root),
            "total_size": total_size,
            "total_files": total_files,
            "total_dirs": total_dirs,
            "scan_time_ms": scan_time * 1000,
            "nodes_count": len(nodes),
            "truncated": len(nodes) >= self.max_results,
        }
        
        return nodes, metadata
    
    def get_children(self, nodes: List[ScanNode], parent_id: int) -> List[ScanNode]:
        """Get immediate children of a node."""
        return [n for n in nodes if n.parent_id == parent_id]
    
    def get_node_by_id(self, nodes: List[ScanNode], node_id: int) -> Optional[ScanNode]:
        """Get a specific node by ID."""
        for node in nodes:
            if node.id == node_id:
                return node
        return None
    
    def get_path_for_node(self, nodes: List[ScanNode], node_id: int, root_path: str) -> str:
        """Reconstruct full path for a node by traversing up to root."""
        nodes_by_id = {n.id: n for n in nodes}
        path_parts = []
        
        current_id = node_id
        while current_id is not None:
            node = nodes_by_id.get(current_id)
            if not node:
                break
            path_parts.append(node.name)
            current_id = node.parent_id
        
        path_parts.reverse()
        
        # Handle root path properly
        if root_path.endswith('/'):
            root_path = root_path[:-1]
        
        return root_path + '/' + '/'.join(path_parts[1:]) if len(path_parts) > 1 else root_path
