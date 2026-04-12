"""Simple tests for the backend scanner."""

import sys
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent))

from scanner import DirectoryScanner, ScanNode


def test_scan_current_directory():
    """Test scanning the current directory."""
    scanner = DirectoryScanner(max_depth=3, max_results=1000)
    
    # Scan the backend directory itself
    current_dir = str(Path(__file__).parent.resolve())
    nodes, metadata = scanner.scan(current_dir)
    
    print(f"Scanned: {current_dir}")
    print(f"  Nodes: {len(nodes)}")
    print(f"  Total size: {metadata['total_size']:,} bytes")
    print(f"  Files: {metadata['total_files']}")
    print(f"  Dirs: {metadata['total_dirs']}")
    print(f"  Time: {metadata['scan_time_ms']:.2f} ms")
    
    # Verify root node exists
    root_nodes = [n for n in nodes if n.parent_id is None]
    assert len(root_nodes) == 1, "Should have exactly one root node"
    
    # Verify all nodes have valid IDs
    ids = {n.id for n in nodes}
    assert len(ids) == len(nodes), "All node IDs should be unique"
    
    # Verify parent references are valid
    for node in nodes:
        if node.parent_id is not None:
            assert node.parent_id in ids, f"Node {node.id} has invalid parent_id {node.parent_id}"
    
    # Verify depth is consistent
    root = root_nodes[0]
    assert root.depth == 0, "Root should have depth 0"
    
    print("\nAll tests passed!")
    return True


def test_exclude_patterns():
    """Test that exclude patterns work."""
    scanner = DirectoryScanner(
        excluded_patterns=["*.pyc", "__pycache__", ".git"],
        max_depth=5,
    )
    
    current_dir = str(Path(__file__).parent.resolve())
    nodes, _ = scanner.scan(current_dir)
    
    # Check that excluded patterns are not present
    for node in nodes:
        assert not node.name.endswith(".pyc"), f"Excluded .pyc file found: {node.name}"
        assert node.name != "__pycache__", f"Excluded __pycache__ found"
        assert node.name != ".git", f"Excluded .git found"
    
    print("Exclude patterns test passed!")
    return True


def test_node_structure():
    """Test node data structure."""
    node = ScanNode(
        id=1,
        parent_id=0,
        name="test.txt",
        size=1024,
        depth=1,
        is_dir=False,
    )
    
    assert node.id == 1
    assert node.parent_id == 0
    assert node.name == "test.txt"
    assert node.size == 1024
    assert node.depth == 1
    assert node.is_dir == False
    
    print("Node structure test passed!")
    return True


if __name__ == "__main__":
    print("Running backend tests...\n")
    
    try:
        test_node_structure()
        print()
        test_exclude_patterns()
        print()
        test_scan_current_directory()
    except Exception as e:
        print(f"\nTest failed: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
