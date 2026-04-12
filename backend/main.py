"""
Web Disk Usage Analyzer - Backend API

A FastAPI-based backend for scanning directories and providing
disk usage data to a web-based visualization frontend.
"""

import os
import gzip
import json
import time
from pathlib import Path
from typing import Optional, List
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Query, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse

from scanner import DirectoryScanner, ScanNode
from models import (
    NodeData,
    ScanResponse,
    ChildrenResponse,
    ConfigResponse,
    ScanProgress,
    ErrorResponse,
)


# Configuration
ALLOWED_PATHS = os.environ.get(
    "ALLOWED_PATHS",
    os.path.expanduser("~") + "," + "/Volumes"  # Home directory and mounted volumes
)
EXCLUDED_PATTERNS = os.environ.get(
    "EXCLUDED_PATTERNS",
    ".git,.svn,node_modules,__pycache__,.pytest_cache,.venv,venv,.DS_Store,Thumbs.db"
)
MAX_DEPTH = int(os.environ.get("MAX_DEPTH", "50"))
MAX_RESULTS = int(os.environ.get("MAX_RESULTS", "100000"))
FOLLOW_SYMLINKS = os.environ.get("FOLLOW_SYMLINKS", "false").lower() == "true"

# Global scanner instance
scanner = DirectoryScanner(
    excluded_patterns=[p.strip() for p in EXCLUDED_PATTERNS.split(",")],
    max_depth=MAX_DEPTH,
    max_results=MAX_RESULTS,
    follow_symlinks=FOLLOW_SYMLINKS,
)

# Cache for recent scans (in-memory, simple implementation)
# In production, use Redis or similar
scan_cache: dict[str, tuple[list[ScanNode], dict, float]] = {}
CACHE_TTL = 300  # 5 minutes


def is_path_allowed(path: str) -> bool:
    """Check if a path is within allowed directories."""
    resolved = Path(path).resolve()
    
    for allowed in ALLOWED_PATHS.split(","):
        allowed_path = Path(allowed.strip()).resolve()
        try:
            # Check if resolved path starts with allowed path
            resolved.relative_to(allowed_path)
            return True
        except ValueError:
            continue
    
    return False


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler."""
    # Startup
    print(f"Disk Usage Analyzer API starting...")
    print(f"Allowed paths: {ALLOWED_PATHS}")
    print(f"Excluded patterns: {EXCLUDED_PATTERNS}")
    print(f"Max depth: {MAX_DEPTH}, Max results: {MAX_RESULTS}")
    yield
    # Shutdown
    scan_cache.clear()
    print("Disk Usage Analyzer API stopped.")


app = FastAPI(
    title="Web Disk Usage Analyzer",
    description="API for scanning directories and analyzing disk usage",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS middleware for frontend access
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Configure appropriately for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "healthy", "timestamp": time.time()}


@app.get("/api/config", response_model=ConfigResponse)
async def get_config():
    """Get server configuration."""
    return ConfigResponse(
        allowed_paths=[p.strip() for p in ALLOWED_PATHS.split(",")],
        excluded_patterns=[p.strip() for p in EXCLUDED_PATTERNS.split(",")],
        max_depth=MAX_DEPTH,
        max_results=MAX_RESULTS,
    )


@app.get("/api/scan", response_model=ScanResponse)
async def scan_directory(
    path: str = Query(..., description="Directory path to scan"),
    force: bool = Query(False, description="Force rescan even if cached"),
    compressed: bool = Query(False, description="Return gzipped response"),
):
    """
    Scan a directory and return disk usage data.
    
    Returns a flat array of nodes representing the directory tree.
    Each node contains: id, parent_id, name, size, depth, is_dir, error
    """
    # Validate path
    if not is_path_allowed(path):
        raise HTTPException(
            status_code=403,
            detail=f"Path not allowed. Allowed paths: {ALLOWED_PATHS}"
        )
    
    path_obj = Path(path)
    if not path_obj.exists():
        raise HTTPException(status_code=404, detail="Path does not exist")
    
    if not path_obj.is_dir():
        raise HTTPException(status_code=400, detail="Path is not a directory")
    
    # Check cache
    cache_key = str(path_obj.resolve())
    current_time = time.time()
    
    if not force and cache_key in scan_cache:
        cached_nodes, cached_meta, cached_time = scan_cache[cache_key]
        if current_time - cached_time < CACHE_TTL:
            # Return cached result
            return _build_scan_response(
                cached_nodes, cached_meta, str(path_obj.resolve())
            )
    
    # Perform scan
    try:
        nodes, metadata = scanner.scan(str(path_obj.resolve()))
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except NotADirectoryError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Scan failed: {str(e)}")
    
    # Cache result
    scan_cache[cache_key] = (nodes, metadata, current_time)
    
    # Build response
    response = _build_scan_response(nodes, metadata, str(path_obj.resolve()))
    
    if compressed:
        # Return gzipped JSON
        json_data = json.dumps(
            {
                "root": response.root,
                "nodes": [n.model_dump() for n in response.nodes],
                "total_size": response.total_size,
                "total_files": response.total_files,
                "total_dirs": response.total_dirs,
                "scan_time_ms": response.scan_time_ms,
            },
            separators=(',', ':'),
        ).encode('utf-8')
        
        return Response(
            content=gzip.compress(json_data),
            media_type="application/x-gzip",
            headers={"Content-Encoding": "gzip", "X-Original-Size": str(len(json_data))},
        )
    
    return response


def _build_scan_response(
    nodes: list[ScanNode], 
    metadata: dict, 
    root_path: str
) -> ScanResponse:
    """Convert scanner nodes to API response model."""
    node_data = [
        NodeData(
            id=n.id,
            parent_id=n.parent_id,
            name=n.name,
            size=n.size,
            depth=n.depth,
            is_dir=n.is_dir,
            error=n.error,
        )
        for n in nodes
    ]
    
    return ScanResponse(
        root=root_path,
        nodes=node_data,
        total_size=metadata["total_size"],
        total_files=metadata["total_files"],
        total_dirs=metadata["total_dirs"],
        scan_time_ms=metadata["scan_time_ms"],
    )


@app.get("/api/children", response_model=ChildrenResponse)
async def get_children(
    path: str = Query(..., description="Directory path"),
    parent_id: Optional[int] = Query(None, description="Parent node ID (if using cached scan)"),
):
    """
    Get immediate children of a directory.
    
    Useful for lazy-loading large directory trees.
    Either provide a path (new scan of that directory) or parent_id (from cached scan).
    """
    if parent_id is not None:
        # Look up in cache
        cache_key = None
        for key, (nodes, meta, cache_time) in scan_cache.items():
            if time.time() - cache_time < CACHE_TTL:
                # Find the parent node
                parent_node = None
                for n in nodes:
                    if n.id == parent_id:
                        parent_node = n
                        break
                
                if parent_node:
                    children = scanner.get_children(nodes, parent_id)
                    child_data = [
                        NodeData(
                            id=c.id,
                            parent_id=c.parent_id,
                            name=c.name,
                            size=c.size,
                            depth=c.depth,
                            is_dir=c.is_dir,
                            error=c.error,
                        )
                        for c in children
                    ]
                    return ChildrenResponse(parent_id=parent_id, children=child_data)
        
        raise HTTPException(status_code=404, detail="Parent node not found in cache")
    
    # Scan the path directly
    if not is_path_allowed(path):
        raise HTTPException(status_code=403, detail="Path not allowed")
    
    path_obj = Path(path)
    if not path_obj.exists():
        raise HTTPException(status_code=404, detail="Path does not exist")
    
    if not path_obj.is_dir():
        raise HTTPException(status_code=400, detail="Path is not a directory")
    
    try:
        # Shallow scan (depth=1)
        shallow_scanner = DirectoryScanner(
            excluded_patterns=scanner.excluded_patterns,
            max_depth=1,
            max_results=10000,
            follow_symlinks=scanner.follow_symlinks,
        )
        nodes, _ = shallow_scanner.scan(str(path_obj.resolve()))
        
        # Filter to immediate children only (depth=1)
        children = [n for n in nodes if n.depth == 1]
        
        child_data = [
            NodeData(
                id=c.id,
                parent_id=c.parent_id,
                name=c.name,
                size=c.size,
                depth=c.depth,
                is_dir=c.is_dir,
                error=c.error,
            )
            for c in children
        ]
        
        return ChildrenResponse(parent_id=0, children=child_data)
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/path")
async def get_path_for_node(
    node_id: int = Query(..., description="Node ID"),
    root: str = Query(..., description="Root path of the scan"),
):
    """
    Reconstruct the full path for a node ID.
    
    Requires the scan to be in cache.
    """
    # Find in cache
    cache_key = Path(root).resolve()
    
    if str(cache_key) not in scan_cache:
        raise HTTPException(status_code=404, detail="Scan not found in cache")
    
    nodes, _, cache_time = scan_cache[str(cache_key)]
    
    if time.time() - cache_time >= CACHE_TTL:
        raise HTTPException(status_code=410, detail="Scan cache expired")
    
    full_path = scanner.get_path_for_node(nodes, node_id, str(cache_key))
    
    return {"node_id": node_id, "root": str(cache_key), "path": full_path}


@app.get("/api/search")
async def search_nodes(
    query: str = Query(..., description="Search query (substring match)"),
    root: str = Query(..., description="Root path of the scan"),
    limit: int = Query(50, description="Maximum results to return"),
):
    """
    Search for files/directories by name within a cached scan.
    """
    cache_key = Path(root).resolve()
    
    if str(cache_key) not in scan_cache:
        raise HTTPException(status_code=404, detail="Scan not found in cache")
    
    nodes, _, cache_time = scan_cache[str(cache_key)]
    
    if time.time() - cache_time >= CACHE_TTL:
        raise HTTPException(status_code=410, detail="Scan cache expired")
    
    query_lower = query.lower()
    results = []
    
    for node in nodes:
        if query_lower in node.name.lower():
            results.append({
                "id": node.id,
                "parent_id": node.parent_id,
                "name": node.name,
                "size": node.size,
                "depth": node.depth,
                "is_dir": node.is_dir,
                "path": scanner.get_path_for_node(nodes, node.id, str(cache_key)),
            })
            
            if len(results) >= limit:
                break
    
    return {"query": query, "root": str(cache_key), "results": results, "count": len(results)}


@app.delete("/api/cache")
async def clear_cache(
    path: Optional[str] = Query(None, description="Specific path to clear, or all if not provided"),
):
    """Clear scan cache."""
    if path:
        cache_key = str(Path(path).resolve())
        if cache_key in scan_cache:
            del scan_cache[cache_key]
            return {"cleared": [cache_key]}
        return {"cleared": []}
    else:
        count = len(scan_cache)
        scan_cache.clear()
        return {"cleared": count}


# Serve static frontend files (if they exist)
frontend_path = Path(__file__).parent.parent / "frontend"

if frontend_path.exists():
    app.mount("/app", StaticFiles(directory=str(frontend_path), html=True), name="app")
    
    @app.get("/")
    async def root():
        """Serve the frontend application."""
        index_path = frontend_path / "index.html"
        if index_path.exists():
            return FileResponse(str(index_path))
        return {"message": "Backend API is running. Frontend not found."}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
