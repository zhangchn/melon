# Backend Test Coverage

## Test Files

| File | Tests | Description |
|------|-------|-------------|
| `test_api.py` | 29 | API endpoint integration tests |
| `test_backend.py` | 3 | Scanner unit tests |

## API Endpoint Tests (`test_api.py`)

### `/health`
- ✅ `test_health_check` - Returns healthy status with timestamp

### `/api/config`
- ✅ `test_config_returns_settings` - Returns all configuration values

### `/api/scan`
- ✅ `test_scan_valid_directory` - Scans directory, returns correct structure
- ✅ `test_scan_nonexistent_path` - Returns 403/404 for invalid paths
- ✅ `test_scan_file_not_directory` - Returns 400 for files
- ✅ `test_scan_disallowed_path` - Returns 403 for paths outside allowed list
- ✅ `test_scan_excludes_patterns` - Respects exclude patterns (.git, etc.)
- ✅ `test_scan_node_structure` - All nodes have required fields
- ✅ `test_scan_parent_references_valid` - All parent_ids reference existing nodes
- ✅ `test_scan_depth_respected` - Depth values are correct
- ✅ `test_scan_caching` - Results are cached
- ✅ `test_scan_force_rescan` - Force parameter bypasses cache
- ✅ `test_scan_compressed_response` - Gzip compression works

### `/api/children`
- ✅ `test_children_by_path` - Returns immediate children only
- ✅ `test_children_nonexistent_path` - Returns 403/404 for invalid paths
- ✅ `test_children_file_not_directory` - Returns 400 for files

### `/api/path`
- ✅ `test_path_reconstruction` - Reconstructs full path from node ID
- ✅ `test_path_no_scan_in_cache` - Returns 404 if scan not cached

### `/api/search`
- ✅ `test_search_finds_matches` - Finds matching nodes
- ✅ `test_search_no_matches` - Returns empty results for no matches
- ✅ `test_search_limit` - Respects limit parameter
- ✅ `test_search_no_scan_in_cache` - Returns 404 if scan not cached

### `/api/cache`
- ✅ `test_cache_clear_all` - Clears all cached scans
- ✅ `test_cache_clear_specific_path` - Clears specific path from cache

### Path Validation
- ✅ `test_allowed_home_directory` - Home directory is allowed
- ✅ `test_allowed_subdirectory` - Subdirectories of allowed paths work
- ✅ `test_disallowed_system_directory` - System dirs (/etc, /usr) blocked

### Performance
- ✅ `test_scan_performance_small` - Small directories scan quickly (<1s)
- ✅ `test_scan_response_size` - Response structure is reasonable

## Scanner Tests (`test_backend.py`)

- ✅ `test_node_structure` - ScanNode dataclass works correctly
- ✅ `test_exclude_patterns` - Exclude patterns filter correctly
- ✅ `test_scan_current_directory` - Full scan produces valid tree

## Running Tests

```bash
# All tests
pytest -v

# Specific test file
pytest test_api.py -v
pytest test_backend.py -v

# Specific test
pytest test_api.py::TestScanEndpoint::test_scan_caching -v

# With coverage
pytest --cov=. --cov-report=html
```

## Test Coverage Summary

| Category | Tests | Status |
|----------|-------|--------|
| Health | 1 | ✅ 100% |
| Config | 1 | ✅ 100% |
| Scan | 11 | ✅ 100% |
| Children | 3 | ✅ 100% |
| Path | 2 | ✅ 100% |
| Search | 4 | ✅ 100% |
| Cache | 2 | ✅ 100% |
| Path Validation | 3 | ✅ 100% |
| Performance | 2 | ✅ 100% |
| Scanner Unit | 3 | ✅ 100% |
| **Total** | **32** | **✅ 100%** |

## Edge Cases Covered

- Empty directories
- Deep nesting (depth limits)
- Permission denied errors
- Symlink loops (prevented)
- Exclude patterns (.git, node_modules, etc.)
- Cache hit/miss scenarios
- Invalid paths (nonexistent, disallowed, files vs directories)
- Compressed responses
- Large result sets (max_results limit)

## Security Tests

- Path traversal prevention (403 for disallowed paths)
- Information leakage prevention (403 before 404)
- Symlink loop detection
- Permission error handling (graceful, no crashes)
