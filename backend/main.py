"""
Web Disk Usage Analyzer - Backend API

A FastAPI-based backend for scanning directories and providing
disk usage data to a web-based visualization frontend.
"""

import os
import gzip
import json
import time
import hashlib
from pathlib import Path
from typing import Optional, List
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Query, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse

from scanner import DirectoryScanner, ScanNode, MAX_PREVIEW_SIZE, IMAGE_EXTENSIONS, VIDEO_EXTENSIONS
from models import (
    NodeData,
    ScanResponse,
    ChildrenResponse,
    ConfigResponse,
    ScanProgress,
    ErrorResponse,
    VideoMetadata,
)
from thumbnail_service import ThumbnailService, FFMPEG_AVAILABLE


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

# Global thumbnail service instance
thumbnail_service = ThumbnailService()

# Cache for recent scans (in-memory, simple implementation)
# In production, use Redis or similar
scan_cache: dict[str, tuple[list[ScanNode], dict, float]] = {}
CACHE_TTL = 300  # 5 minutes


def is_path_allowed(path: str) -> bool:
    """Check if a path is within allowed directories."""
    resolved = Path(path).resolve()
    print(f"DEBUG is_path_allowed: resolved={resolved}")
    
    for allowed in ALLOWED_PATHS.split(","):
        allowed_path = Path(allowed.strip()).resolve()
        print(f"DEBUG is_path_allowed: checking against allowed_path={allowed_path}")
        try:
            # Check if resolved path starts with allowed path
            resolved.relative_to(allowed_path)
            print(f"DEBUG is_path_allowed: MATCH! {resolved} is under {allowed_path}")
            return True
        except ValueError:
            print(f"DEBUG is_path_allowed: no match for {allowed_path}")
            continue
    
    print(f"DEBUG is_path_allowed: NO MATCH found for {resolved}")
    return False


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler."""
    # Startup
    print(f"Disk Usage Analyzer API starting...")
    print(f"Allowed paths: {ALLOWED_PATHS}")
    print(f"Excluded patterns: {EXCLUDED_PATTERNS}")
    print(f"Max depth: {MAX_DEPTH}, Max results: {MAX_RESULTS}")
    print(f"FFmpeg available: {FFMPEG_AVAILABLE}")
    yield
    # Shutdown
    scan_cache.clear()
    thumbnail_service.cleanup_on_shutdown()
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
            preview_url=n.preview_url,
            video_metadata=VideoMetadata(**n.video_metadata) if n.video_metadata else None,
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
                            preview_url=c.preview_url,
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
                preview_url=c.preview_url,
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

    # Find node to get preview_url
    node = scanner.get_node_by_id(nodes, node_id)
    
    return {
        "node_id": node_id, 
        "root": str(cache_key), 
        "path": full_path,
        "preview_url": node.preview_url if node else None
    }


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
                "preview_url": node.preview_url,
            })
            
            if len(results) >= limit:
                break
    
    return {"query": query, "root": str(cache_key), "results": results, "count": len(results)}


@app.get("/api/preview")
async def get_preview(
    node_id: int = Query(None, description="Node ID of the image file"),
    root: str = Query(None, description="Root path of the scan"),
    path: str = Query(None, description="Direct file path (fallback when cache expired)"),
):
    """
    Get preview for a small image file.

    Returns the image file directly for files smaller than 5MB.
    Supports two modes:
    1. node_id + root: Uses scan cache (fast, but cache expires)
    2. path: Direct file access (works when cache expired)
    """
    file_path = None
    
    # Mode 1: Try scan cache first
    if node_id is not None and root is not None:
        cache_key = Path(root).resolve()

        if str(cache_key) in scan_cache:
            nodes, _, cache_time = scan_cache[str(cache_key)]

            if time.time() - cache_time < CACHE_TTL:
                # Cache valid - use it
                node = None
                for n in nodes:
                    if n.id == node_id:
                        node = n
                        break

                if node:
                    if node.is_dir:
                        raise HTTPException(status_code=400, detail="Preview is only available for files")

                    # Reconstruct full path
                    full_path = scanner.get_path_for_node(nodes, node_id, str(cache_key))
                    file_path = Path(full_path)
    
    # Mode 2: Direct path access (fallback when cache misses or expires)
    if file_path is None and path is not None:
        # Validate path is allowed
        if not is_path_allowed(path):
            raise HTTPException(
                status_code=403,
                detail=f"Path not allowed. Allowed paths: {ALLOWED_PATHS}"
            )
        
        file_path = Path(path).resolve()
    
    if file_path is None:
        raise HTTPException(
            status_code=400, 
            detail="Either node_id+root or path parameter required. Cache may have expired."
        )

    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found")

    # Check file size
    if file_path.stat().st_size > MAX_PREVIEW_SIZE:
        raise HTTPException(status_code=413, detail="File too large for preview")

    # Check if it's an image
    ext = file_path.suffix.lower()
    if ext not in {'.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg'}:
        raise HTTPException(status_code=400, detail="File is not an image")

    # Serve the file
    if ext in {'.svg'}:
        media_type = "image/svg+xml"
    elif ext in {'.jpg', '.jpeg'}:
        media_type = "image/jpeg"
    elif ext == '.png':
        media_type = "image/png"
    elif ext == '.gif':
        media_type = "image/gif"
    elif ext == '.bmp':
        media_type = "image/bmp"
    elif ext == '.webp':
        media_type = "image/webp"
    else:
        media_type = "application/octet-stream"

    return FileResponse(file_path, media_type=media_type)


@app.get("/api/thumbnail")
async def get_thumbnail(
    node_id: int = Query(None, description="Node ID of the video file (requires scan cache)"),
    root: str = Query(None, description="Root path of the scan (required with node_id)"),
    path: str = Query(None, description="Direct file path (alternative to node_id)"),
):
    """
    Generate or retrieve cached thumbnail for a video file.
    
    Two modes:
    1. node_id + root: Uses scan cache to resolve path (faster, but cache expires)
    2. path: Direct file path (works without cache, but requires path validation)
    
    Returns a contact sheet image with thumbnails at exponential timestamps.
    """
    try:
        if not FFMPEG_AVAILABLE:
            raise HTTPException(
                status_code=503,
                detail="Thumbnail generation requires ffmpeg. Please install ffmpeg."
            )
        
        file_path = None
        duration = None
        
        # Mode 1: Try scan cache first (fast)
        if node_id is not None and root is not None:
            cache_key = Path(root).resolve()
            print(f"DEBUG: Looking for cache key: {cache_key}")
            print(f"DEBUG: Available keys: {list(scan_cache.keys())}")

            if str(cache_key) in scan_cache:
                nodes, _, cache_time = scan_cache[str(cache_key)]

                if time.time() - cache_time < CACHE_TTL:
                    # Cache valid - use it
                    node = None
                    for n in nodes:
                        if n.id == node_id:
                            node = n
                            break

                    if node:
                        if node.is_dir:
                            raise HTTPException(status_code=400, detail="Thumbnail is only available for video files")

                        if node.video_metadata:
                            # Reconstruct full path
                            full_path = scanner.get_path_for_node(nodes, node_id, str(cache_key))
                            print(f"DEBUG: Reconstructed path from cache: {full_path}")
                            file_path = Path(full_path)
                            duration = node.video_metadata.get('duration', 0)
                        else:
                            raise HTTPException(status_code=400, detail="Node is not a video file or has no metadata")
                    else:
                        print(f"DEBUG: Node {node_id} not found in cache")
                else:
                    print(f"DEBUG: Cache expired for {cache_key}")
            else:
                print(f"DEBUG: Cache miss for {cache_key}")
        
        # Mode 2: Direct path access (fallback when cache misses or expires)
        if file_path is None and path is not None:
            # Validate path is allowed
            print(f"DEBUG: Checking if path allowed: {path}")
            print(f"DEBUG: ALLOWED_PATHS: {ALLOWED_PATHS}")
            if not is_path_allowed(path):
                print(f"DEBUG: Path NOT allowed: {path}")
                raise HTTPException(
                    status_code=403,
                    detail=f"Path not allowed. Allowed paths: {ALLOWED_PATHS}"
                )
            
            file_path = Path(path).resolve()
            print(f"DEBUG: Using direct path: {file_path}")
            
            if not file_path.exists():
                raise HTTPException(status_code=404, detail="Video file not found")
            
            # Get video metadata using ffprobe
            from thumbnail_service import ThumbnailService
            duration = ThumbnailService().get_video_duration(str(file_path))
            if not duration:
                raise HTTPException(status_code=400, detail="Could not determine video duration")
        
        # Validate we have what we need
        if file_path is None:
            raise HTTPException(
                status_code=400, 
                detail="Either node_id+root or path parameter required. Cache may have expired."
            )

        if not file_path.exists():
            raise HTTPException(status_code=404, detail="Video file not found")

        # Generate thumbnail
        print(f"DEBUG: Duration: {duration}")
        if duration is None or duration <= 0:
            raise HTTPException(status_code=400, detail="Invalid video duration")

        file_mtime = file_path.stat().st_mtime
        
        cache_path = await thumbnail_service.generate_contact_sheet(
            str(file_path),
            duration,
            file_mtime,
        )
        
        print(f"DEBUG: Cache path result: {cache_path}")

        if not cache_path:
            raise HTTPException(status_code=500, detail="Thumbnail generation failed")

        # Use node_id if available, otherwise generate a hash for filename
        thumb_name = f"thumb_{node_id}.jpg" if node_id else f"thumb_{hashlib.md5(str(file_path).encode()).hexdigest()[:8]}.jpg"
        return FileResponse(
            cache_path,
            media_type="image/jpeg",
            filename=thumb_name
        )
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        print(f"ERROR in thumbnail endpoint: {e}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Internal error: {str(e)}")


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
    from fastapi.responses import FileResponse, Response
    from starlette.responses import PlainTextResponse
    
    # MIME type mapping
    MIME_TYPES = {
        '.js': 'application/javascript',
        '.css': 'text/css',
        '.html': 'text/html',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml',
        '.ico': 'image/x-icon',
        '.woff': 'font/woff',
        '.woff2': 'font/woff2',
        '.ttf': 'font/ttf',
        '.eot': 'application/vnd.ms-fontobject',
    }
    
    @app.get("/")
    async def serve_index():
        """Serve the frontend index.html."""
        return FileResponse(str(frontend_path / "index.html"), media_type="text/html")
    
    @app.get("/{full_path:path}")
    async def serve_static(full_path: str):
        """Serve static files (CSS, JS, etc.)."""
        # Build full file path
        file_path = frontend_path / full_path
        
        # Check if file exists first
        if not file_path.exists() or not file_path.is_file():
            # Only then check if it's a blocked API path
            if full_path.startswith("api/") or full_path in ["docs", "redoc", "openapi.json"]:
                raise HTTPException(status_code=404)
            raise HTTPException(status_code=404, detail="File not found")
        
        # Get file extension and determine MIME type
        ext = file_path.suffix.lower()
        media_type = MIME_TYPES.get(ext, "application/octet-stream")
        
        # Read file content and return with correct MIME type
        content = file_path.read_bytes()
        return Response(content=content, media_type=media_type)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
