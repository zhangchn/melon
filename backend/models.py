"""Pydantic models for the disk usage analyzer API."""

from pydantic import BaseModel, Field
from typing import Optional, List


class NodeData(BaseModel):
    """Compact node representation for frontend consumption."""
    id: int = Field(..., description="Unique node ID")
    parent_id: Optional[int] = Field(None, description="Parent node ID (null for root)")
    name: str = Field(..., description="File or directory name")
    size: int = Field(..., description="Size in bytes")
    depth: int = Field(..., description="Depth from root (0 = root)")
    is_dir: bool = Field(..., description="True if directory, false if file")
    error: Optional[str] = Field(None, description="Error message if scan failed")


class ScanResponse(BaseModel):
    """Response from scan endpoint."""
    root: str = Field(..., description="Root path that was scanned")
    nodes: List[NodeData] = Field(..., description="Flat array of all nodes")
    total_size: int = Field(..., description="Total size in bytes")
    total_files: int = Field(..., description="Total number of files")
    total_dirs: int = Field(..., description="Total number of directories")
    scan_time_ms: float = Field(..., description="Time taken to scan in milliseconds")


class ChildrenResponse(BaseModel):
    """Response for lazy-loaded children."""
    parent_id: int = Field(..., description="Parent node ID")
    children: List[NodeData] = Field(..., description="Child nodes")


class ConfigResponse(BaseModel):
    """Server configuration."""
    allowed_paths: List[str] = Field(..., description="Paths that can be scanned")
    excluded_patterns: List[str] = Field(..., description="Patterns to exclude from scans")
    max_depth: int = Field(..., description="Maximum scan depth")
    max_results: int = Field(..., description="Maximum number of nodes to return")


class ScanProgress(BaseModel):
    """Progress update during scanning."""
    current_path: str = Field(..., description="Currently scanning path")
    nodes_scanned: int = Field(..., description="Number of nodes processed")
    size_so_far: int = Field(..., description="Total size accumulated so far")
    percent_complete: Optional[float] = Field(None, description="Estimated completion percentage")


class ErrorResponse(BaseModel):
    """Error response."""
    error: str = Field(..., description="Error message")
    detail: Optional[str] = Field(None, description="Additional details")
