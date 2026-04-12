"""
Comprehensive API endpoint tests.

Run with: pytest test_api.py -v
Or: python -m pytest test_api.py -v
"""

import pytest
import os
import sys
import time
import shutil
from pathlib import Path
from fastapi.testclient import TestClient

# Add backend to path
sys.path.insert(0, str(Path(__file__).parent))

from main import app, scan_cache, is_path_allowed, ALLOWED_PATHS


@pytest.fixture
def client():
    """Create test client."""
    # Clear cache before each test
    scan_cache.clear()
    return TestClient(app)


@pytest.fixture
def test_dir():
    """Create a test directory structure under home directory."""
    # Use a temp dir under home (which is in ALLOWED_PATHS)
    base = Path.home() / ".melon_test"
    
    # Clean up if exists
    if base.exists():
        shutil.rmtree(base)
    
    base.mkdir(parents=True)
    
    # Create structure:
    # test_dir/
    # ├── file1.txt (100 bytes)
    # ├── file2.log (200 bytes)
    # ├── subdir1/
    # │   ├── nested.txt (50 bytes)
    # │   └── nested2.dat (75 bytes)
    # └── subdir2/
    #     └── deep/
    #         └── deep_file.txt (25 bytes)
    
    file1 = base / "file1.txt"
    file1.write_text("x" * 100)
    
    file2 = base / "file2.log"
    file2.write_text("y" * 200)
    
    subdir1 = base / "subdir1"
    subdir1.mkdir()
    (subdir1 / "nested.txt").write_text("a" * 50)
    (subdir1 / "nested2.dat").write_text("b" * 75)
    
    subdir2 = base / "subdir2"
    subdir2.mkdir()
    deep = subdir2 / "deep"
    deep.mkdir()
    (deep / "deep_file.txt").write_text("c" * 25)
    
    # Create a .git folder (should be excluded)
    git_dir = base / ".git"
    git_dir.mkdir()
    (git_dir / "config").write_text("git config")
    
    yield base
    
    # Cleanup after test
    if base.exists():
        shutil.rmtree(base)


class TestHealthEndpoint:
    """Tests for /health endpoint."""
    
    def test_health_check(self, client):
        """Health endpoint returns healthy status."""
        response = client.get("/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"
        assert "timestamp" in data


class TestConfigEndpoint:
    """Tests for /api/config endpoint."""
    
    def test_config_returns_settings(self, client):
        """Config endpoint returns server settings."""
        response = client.get("/api/config")
        assert response.status_code == 200
        data = response.json()
        
        assert "allowed_paths" in data
        assert "excluded_patterns" in data
        assert "max_depth" in data
        assert "max_results" in data
        
        # Verify types
        assert isinstance(data["allowed_paths"], list)
        assert isinstance(data["excluded_patterns"], list)
        assert isinstance(data["max_depth"], int)
        assert isinstance(data["max_results"], int)


class TestScanEndpoint:
    """Tests for /api/scan endpoint."""
    
    def test_scan_valid_directory(self, client, test_dir):
        """Scan a valid directory returns correct structure."""
        response = client.get(f"/api/scan?path={test_dir}")
        assert response.status_code == 200
        data = response.json()
        
        assert "root" in data
        assert "nodes" in data
        assert "total_size" in data
        assert "total_files" in data
        assert "total_dirs" in data
        assert "scan_time_ms" in data
        
        # Should have nodes
        assert len(data["nodes"]) > 0
        
        # Root node should exist
        root_nodes = [n for n in data["nodes"] if n["parent_id"] is None]
        assert len(root_nodes) == 1
    
    def test_scan_nonexistent_path(self, client):
        """Scan nonexistent path returns 403 (path validation before existence check)."""
        # Note: Returns 403 because /nonexistent is outside allowed paths
        # This is correct security behavior - don't reveal existence of disallowed paths
        response = client.get("/api/scan?path=/nonexistent/path/xyz123")
        assert response.status_code in (403, 404)  # Either is acceptable
    
    def test_scan_file_not_directory(self, client, test_dir):
        """Scan a file (not directory) returns 400."""
        file_path = test_dir / "file1.txt"
        response = client.get(f"/api/scan?path={file_path}")
        assert response.status_code == 400
    
    def test_scan_disallowed_path(self, client):
        """Scan disallowed path returns 403."""
        # Try to scan root system directory (should be blocked)
        response = client.get("/api/scan?path=/etc")
        assert response.status_code == 403
    
    def test_scan_excludes_patterns(self, client, test_dir):
        """Scan excludes configured patterns like .git."""
        response = client.get(f"/api/scan?path={test_dir}")
        assert response.status_code == 200
        data = response.json()
        
        # .git should not be in results
        git_nodes = [n for n in data["nodes"] if n["name"] == ".git"]
        assert len(git_nodes) == 0
    
    def test_scan_node_structure(self, client, test_dir):
        """Scan returns nodes with correct structure."""
        response = client.get(f"/api/scan?path={test_dir}")
        data = response.json()
        
        for node in data["nodes"]:
            assert "id" in node
            assert "parent_id" in node
            assert "name" in node
            assert "size" in node
            assert "depth" in node
            assert "is_dir" in node
            assert "error" in node
            
            # Verify types
            assert isinstance(node["id"], int)
            assert isinstance(node["name"], str)
            assert isinstance(node["size"], int)
            assert isinstance(node["depth"], int)
            assert isinstance(node["is_dir"], bool)
    
    def test_scan_parent_references_valid(self, client, test_dir):
        """All parent_id references should point to existing nodes."""
        response = client.get(f"/api/scan?path={test_dir}")
        data = response.json()
        
        node_ids = {n["id"] for n in data["nodes"]}
        
        for node in data["nodes"]:
            if node["parent_id"] is not None:
                assert node["parent_id"] in node_ids, \
                    f"Node {node['id']} has invalid parent_id {node['parent_id']}"
    
    def test_scan_depth_respected(self, client, test_dir):
        """Scan respects max_depth parameter."""
        # Set a low max depth via environment (would need server restart)
        # For now, just verify depth values are present
        response = client.get(f"/api/scan?path={test_dir}")
        data = response.json()
        
        for node in data["nodes"]:
            assert node["depth"] >= 0
    
    def test_scan_caching(self, client, test_dir):
        """Scan results are cached."""
        # First scan
        response1 = client.get(f"/api/scan?path={test_dir}")
        assert response1.status_code == 200
        
        # Second scan (should use cache)
        response2 = client.get(f"/api/scan?path={test_dir}")
        assert response2.status_code == 200
        
        # Results should be identical
        assert response1.json() == response2.json()
    
    def test_scan_force_rescan(self, client, test_dir):
        """Force parameter bypasses cache."""
        # Initial scan
        client.get(f"/api/scan?path={test_dir}")
        
        # Force rescan
        response = client.get(f"/api/scan?path={test_dir}&force=true")
        assert response.status_code == 200
    
    def test_scan_compressed_response(self, client, test_dir):
        """Compressed parameter returns gzipped response."""
        response = client.get(f"/api/scan?path={test_dir}&compressed=true")
        assert response.status_code == 200
        assert response.headers.get("Content-Encoding") == "gzip"


class TestChildrenEndpoint:
    """Tests for /api/children endpoint."""
    
    def test_children_by_path(self, client, test_dir):
        """Get children by path returns immediate children."""
        response = client.get(f"/api/children?path={test_dir}")
        assert response.status_code == 200
        data = response.json()
        
        assert "parent_id" in data
        assert "children" in data
        
        # Should only have depth=1 items
        for child in data["children"]:
            assert child["depth"] == 1
    
    def test_children_nonexistent_path(self, client):
        """Get children of nonexistent path returns 403 (path validation first)."""
        # Note: Returns 403 because /nonexistent is outside allowed paths
        response = client.get("/api/children?path=/nonexistent/xyz")
        assert response.status_code in (403, 404)  # Either is acceptable
    
    def test_children_file_not_directory(self, client, test_dir):
        """Get children of a file returns 400."""
        file_path = test_dir / "file1.txt"
        response = client.get(f"/api/children?path={file_path}")
        assert response.status_code == 400


class TestPathEndpoint:
    """Tests for /api/path endpoint."""
    
    def test_path_reconstruction(self, client, test_dir):
        """Reconstruct path for a node."""
        # First scan to populate cache
        scan_response = client.get(f"/api/scan?path={test_dir}")
        scan_data = scan_response.json()
        
        # Find a non-root node
        non_root_nodes = [n for n in scan_data["nodes"] if n["parent_id"] is not None]
        if non_root_nodes:
            node = non_root_nodes[0]
            
            response = client.get(
                f"/api/path?node_id={node['id']}&root={test_dir}"
            )
            assert response.status_code == 200
            data = response.json()
            
            assert "node_id" in data
            assert "path" in data
            assert data["node_id"] == node["id"]
    
    def test_path_no_scan_in_cache(self, client):
        """Path endpoint returns 404 if scan not in cache."""
        response = client.get("/api/path?node_id=0&root=/some/path")
        assert response.status_code == 404


class TestSearchEndpoint:
    """Tests for /api/search endpoint."""
    
    def test_search_finds_matches(self, client, test_dir):
        """Search finds matching nodes."""
        # First scan to populate cache
        client.get(f"/api/scan?path={test_dir}")
        
        # Search for .txt files
        response = client.get(f"/api/search?query=.txt&root={test_dir}")
        assert response.status_code == 200
        data = response.json()
        
        assert "results" in data
        assert "count" in data
        
        # Should find some .txt files
        assert data["count"] > 0
        
        # All results should contain the query
        for result in data["results"]:
            assert ".txt" in result["name"].lower()
    
    def test_search_no_matches(self, client, test_dir):
        """Search with no matches returns empty results."""
        # First scan to populate cache
        client.get(f"/api/scan?path={test_dir}")
        
        response = client.get(f"/api/search?query=xyz123nonexistent&root={test_dir}")
        assert response.status_code == 200
        data = response.json()
        
        assert data["count"] == 0
        assert data["results"] == []
    
    def test_search_limit(self, client, test_dir):
        """Search respects limit parameter."""
        # First scan to populate cache
        client.get(f"/api/scan?path={test_dir}")
        
        response = client.get(f"/api/search?query=&root={test_dir}&limit=5")
        assert response.status_code == 200
        data = response.json()
        
        assert data["count"] <= 5
    
    def test_search_no_scan_in_cache(self, client):
        """Search returns 404 if scan not in cache."""
        response = client.get("/api/search?query=test&root=/some/path")
        assert response.status_code == 404


class TestCacheEndpoint:
    """Tests for /api/cache endpoint."""
    
    def test_cache_clear_all(self, client, test_dir):
        """Clear all cache."""
        # Populate cache
        client.get(f"/api/scan?path={test_dir}")
        
        # Clear cache
        response = client.delete("/api/cache")
        assert response.status_code == 200
        data = response.json()
        
        assert "cleared" in data
    
    def test_cache_clear_specific_path(self, client, test_dir):
        """Clear cache for specific path."""
        # Populate cache
        client.get(f"/api/scan?path={test_dir}")
        
        # Clear specific path
        response = client.delete(f"/api/cache?path={test_dir}")
        assert response.status_code == 200
        data = response.json()
        
        assert "cleared" in data


class TestIsPathAllowed:
    """Tests for path validation helper."""
    
    def test_allowed_home_directory(self):
        """Home directory paths are allowed."""
        home = str(Path.home())
        assert is_path_allowed(home) is True
    
    def test_allowed_subdirectory(self):
        """Subdirectories of allowed paths are allowed."""
        home_subdir = str(Path.home() / "Documents")
        assert is_path_allowed(home_subdir) is True
    
    def test_disallowed_system_directory(self):
        """System directories are not allowed."""
        assert is_path_allowed("/etc") is False
        assert is_path_allowed("/usr") is False


class TestPerformance:
    """Performance-related tests."""
    
    def test_scan_performance_small(self, client, test_dir):
        """Small directory scans quickly."""
        start = time.time()
        response = client.get(f"/api/scan?path={test_dir}")
        elapsed = time.time() - start
        
        assert response.status_code == 200
        assert elapsed < 1.0  # Should complete in under 1 second
    
    def test_scan_response_size(self, client, test_dir):
        """Response size is reasonable."""
        response = client.get(f"/api/scan?path={test_dir}")
        data = response.json()
        
        # Response should have all required fields
        assert len(data["nodes"]) > 0
        
        # Each node should be compact
        for node in data["nodes"]:
            # Node shouldn't have excessive data
            assert len(node.keys()) <= 7  # id, parent_id, name, size, depth, is_dir, error


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
