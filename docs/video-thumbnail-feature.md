# Video Thumbnail Preview Feature

## Overview
Generate a contact-sheet style preview image for MP4 files with thumbnails at exponentially increasing timestamps (3.75s, 7.5s, 15s, 30s, 1min, 2min, 4min, 8min...). Cache thumbnails in a temp directory and serve to the details panel.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Backend (FastAPI)                         │
├─────────────────────────────────────────────────────────────────┤
│  Scanner                                                         │
│    └── Detect video files (.mp4, .mov, .mkv, .avi, .webm)      │
│    └── Store video metadata (duration, width, height)          │
│                                                                  │
│  ThumbnailService (NEW)                                          │
│    └── POST /api/thumbnail/{node_id}                            │
│    └── Generate contact sheet on-demand                         │
│    └── Cache in temp directory                                  │
│    └── Serve cached image                                       │
│                                                                  │
│  Lifecycle                                                       │
│    └── On shutdown: clear thumbnail cache                        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                        Frontend                                  │
├─────────────────────────────────────────────────────────────────┤
│  DetailsPanel                                                    │
│    └── For video files: fetch and display thumbnail grid        │
│    └── Show video metadata (duration, resolution)               │
└─────────────────────────────────────────────────────────────────┘
```

## Implementation Plan

### Phase 1: Backend - Video Metadata Extraction

**File: `backend/scanner.py`**

1. Add video file extensions detection
2. Use ffprobe to extract video metadata during scan:
   - Duration (seconds)
   - Width, Height (resolution)
   - Codec (optional)
   - Frame rate (optional)

```python
VIDEO_EXTENSIONS = {'.mp4', '.mov', '.mkv', '.avi', '.webm', '.m4v'}

async def get_video_metadata(file_path: str) -> dict:
    """Extract video metadata using ffprobe."""
    cmd = [
        'ffprobe', '-v', 'quiet',
        '-print_format', 'json',
        '-show_format', '-show_streams',
        file_path
    ]
    # Parse duration, width, height from first video stream
```

3. Store metadata in scan results:
```python
# In FileNode model or as separate field
video_metadata: Optional[dict] = None  # {duration, width, height}
```

**File: `backend/models.py`**

```python
class VideoMetadata(BaseModel):
    duration: float  # seconds
    width: int
    height: int
    codec: Optional[str] = None
    fps: Optional[float] = None

class FileNode(BaseModel):
    # ... existing fields ...
    video_metadata: Optional[VideoMetadata] = None
```

---

### Phase 2: Backend - Thumbnail Generation Service

**File: `backend/thumbnail_service.py` (NEW)**

```python
import subprocess
import tempfile
import hashlib
from pathlib import Path
from typing import Optional
import shutil

class ThumbnailService:
    def __init__(self, cache_dir: Optional[Path] = None):
        self.cache_dir = cache_dir or Path(tempfile.gettempdir()) / 'disk_analyzer_thumbs'
        self.cache_dir.mkdir(parents=True, exist_ok=True)
    
    def get_cache_path(self, file_path: str, file_mtime: float) -> Path:
        """Generate unique cache filename based on path and mtime."""
        key = hashlib.md5(f"{file_path}:{file_mtime}".encode()).hexdigest()
        return self.cache_dir / f"{key}.jpg"
    
    def calculate_timestamps(self, duration: float, max_thumbnails: int = 8) -> list[float]:
        """
        Generate timestamps at exponential intervals.
        Sequence: 3.75s, 7.5s, 15s, 30s, 60s, 120s, 240s, 480s...
        But clamp to video duration.
        """
        base_interval = 3.75  # Start at 3.75 seconds
        timestamps = []
        t = base_interval
        
        while t < duration and len(timestamps) < max_thumbnails:
            timestamps.append(t)
            t *= 2  # Double each time
        
        # Add one more at 90% of duration if space allows
        if duration > 0 and len(timestamps) < max_thumbnails:
            timestamps.append(duration * 0.9)
        
        return timestamps
    
    async def generate_contact_sheet(
        self, 
        file_path: str, 
        duration: float,
        file_mtime: float,
        max_thumbnails: int = 8,
        thumb_width: int = 160,
        columns: int = 4
    ) -> Optional[Path]:
        """
        Generate a contact sheet image with thumbnails at calculated timestamps.
        Returns path to generated image, or None on failure.
        """
        cache_path = self.get_cache_path(file_path, file_mtime)
        
        # Return cached if exists
        if cache_path.exists():
            return cache_path
        
        timestamps = self.calculate_timestamps(duration, max_thumbnails)
        if not timestamps:
            return None
        
        # Build ffmpeg filter for contact sheet
        # Using tile filter to arrange thumbnails in a grid
        inputs = []
        filter_parts = []
        
        for i, ts in enumerate(timestamps):
            inputs.extend(['-ss', str(ts), '-i', file_path, '-frames:v', '1'])
            filter_parts.append(f'[{i}:v]scale={thumb_width}:-1[thumb{i}]')
        
        # Tile all thumbnails
        tile_filter = f"{''.join(f'[thumb{i}]' for i in range(len(timestamps)))}tile={columns}x{len(timestamps)//columns + (1 if len(timestamps)%columns else 0)}:padding=2:color=black[out]"
        filter_complex = ';'.join(filter_parts) + ';' + tile_filter
        
        cmd = [
            'ffmpeg', '-y',
            *inputs,
            '-filter_complex', filter_complex,
            '-map', '[out]',
            '-q:v', '5',
            str(cache_path)
        ]
        
        try:
            result = subprocess.run(cmd, capture_output=True, timeout=30)
            if result.returncode == 0 and cache_path.exists():
                return cache_path
        except Exception as e:
            print(f"Thumbnail generation failed: {e}")
        
        return None
    
    def clear_cache(self):
        """Clear all cached thumbnails."""
        if self.cache_dir.exists():
            shutil.rmtree(self.cache_dir)
            self.cache_dir.mkdir(parents=True, exist_ok=True)
```

**Alternative simpler approach (single ffmpeg command with select filter):**

```python
async def generate_contact_sheet_v2(
    self,
    file_path: str,
    duration: float,
    file_mtime: float,
    thumb_width: int = 160,
    columns: int = 4
) -> Optional[Path]:
    """Generate contact sheet using ffmpeg's tile filter with select."""
    cache_path = self.get_cache_path(file_path, file_mtime)
    
    if cache_path.exists():
        return cache_path
    
    timestamps = self.calculate_timestamps(duration)
    
    # Build select expression
    select_exprs = []
    for i, ts in enumerate(timestamps):
        select_exprs.append(f'eq(t\\,{ts})')
    
    # Use fps + tile for simpler approach
    cmd = [
        'ffmpeg', '-y',
        '-i', file_path,
        '-vf', f"fps=1/{duration/8},scale={thumb_width}:-1,tile=4x2:padding=2:color=black",
        '-frames:v', '1',
        '-q:v', '5',
        str(cache_path)
    ]
    
    # ... run command
```

---

### Phase 3: Backend - API Endpoint

**File: `backend/main.py`**

```python
from thumbnail_service import ThumbnailService

# Initialize service
thumbnail_service = ThumbnailService()

@app.get("/api/thumbnail/{node_id}")
async def get_thumbnail(node_id: int):
    """Generate or retrieve cached thumbnail for a video file."""
    # Find file node
    node = find_node_by_id(node_id)
    if not node:
        raise HTTPException(404, "Node not found")
    
    if not node.video_metadata:
        raise HTTPException(400, "Not a video file")
    
    # Check if file still exists
    file_path = get_full_path(node)
    if not file_path.exists():
        raise HTTPException(404, "File not found")
    
    # Generate thumbnail
    cache_path = await thumbnail_service.generate_contact_sheet(
        str(file_path),
        node.video_metadata.duration,
        file_path.stat().st_mtime
    )
    
    if not cache_path:
        raise HTTPException(500, "Thumbnail generation failed")
    
    return FileResponse(
        cache_path,
        media_type="image/jpeg",
        filename=f"thumb_{node_id}.jpg"
    )

@app.on_event("shutdown")
async def cleanup_thumbnails():
    """Clear thumbnail cache on server shutdown."""
    thumbnail_service.clear_cache()
```

---

### Phase 4: Frontend Integration

**File: `frontend/ui/details-panel.js`**

```javascript
// Add to render() method after file info section

async _renderVideoPreview(node) {
  if (!node.video_metadata) return;
  
  const previewSection = this.container.select('.details-preview-section');
  previewSection.classed('hidden', false);
  
  // Show loading state
  previewSection.html(`
    <div class="video-preview">
      <div class="video-meta">
        Duration: ${this._formatDuration(node.video_metadata.duration)} | 
        ${node.video_metadata.width}x${node.video_metadata.height}
      </div>
      <div class="thumbnail-container loading">
        <span>Loading preview...</span>
      </div>
    </div>
  `);
  
  try {
    // Fetch thumbnail from backend
    const response = await fetch(`/api/thumbnail/${node.id}?root=${this.rootParam}`);
    if (response.ok) {
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      
      previewSection.html(`
        <div class="video-preview">
          <div class="video-meta">
            Duration: ${this._formatDuration(node.video_metadata.duration)} | 
            ${node.video_metadata.width}x${node.video_metadata.height}
          </div>
          <img src="${url}" class="video-thumbnail" alt="Video preview" />
        </div>
      `);
    }
  } catch (err) {
    console.error('Failed to load video thumbnail:', err);
    previewSection.select('.thumbnail-container')
      .classed('loading', false)
      .text('Preview unavailable');
  }
}

_formatDuration(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}
```

---

### Phase 5: Styling

**File: `frontend/styles/main.css`**

```css
/* Video preview styles */
.video-preview {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--border-color);
}

.video-meta {
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 8px;
}

.video-thumbnail {
  width: 100%;
  max-width: 640px;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
}

.thumbnail-container.loading {
  padding: 40px;
  text-align: center;
  background: var(--bg-secondary);
  border-radius: 8px;
  color: var(--text-secondary);
}
```

---

## Timestamp Calculation Logic

```
Video Duration: 10 minutes (600s)

Timestamps: 3.75, 7.5, 15, 30, 60, 120, 240, 480 (capped at 540 = 90%)
Grid: 4 columns x 2 rows = 8 thumbnails

Result:
┌────────┬────────┬────────┬────────┐
│  3.75s │  7.5s  │  15s   │  30s   │
├────────┼────────┼────────┼────────┤
│  60s   │  120s  │  240s  │  480s  │
└────────┴────────┴────────┴────────┘
```

---

## Error Handling

1. **ffprobe/ffmpeg not installed**: Gracefully skip video metadata, log warning
2. **Video too short**: Only generate available thumbnails
3. **Corrupted video**: Catch subprocess errors, return null
4. **Permission denied**: Handle file access errors
5. **Timeout**: Limit thumbnail generation to 30 seconds

---

## Performance Considerations

1. **On-demand generation**: Only generate when details panel requests it
2. **Caching**: Use file mtime in cache key to invalidate on file change
3. **Size limit**: Max 8 thumbnails, each 160px wide = ~640px contact sheet
4. **Quality**: JPEG quality 5 (good enough for preview)
5. **Timeout**: 30 second limit on ffmpeg process

---

## File Structure

```
backend/
├── main.py              # Add /api/thumbnail/{node_id} endpoint
├── models.py            # Add VideoMetadata model
├── scanner.py           # Add video metadata extraction
└── thumbnail_service.py # NEW - thumbnail generation service

frontend/
├── ui/details-panel.js  # Add video preview rendering
└── styles/main.css      # Add video preview styles

temp/
└── disk_analyzer_thumbs/  # Cache directory (cleared on shutdown)
    ├── abc123.jpg
    └── def456.jpg
```

---

## Dependencies

- **ffmpeg**: Required for thumbnail generation
- **ffprobe**: Required for video metadata extraction

Check availability at startup:
```python
import shutil

FFMPEG_AVAILABLE = shutil.which('ffmpeg') is not None
FFPROBE_AVAILABLE = shutil.which('ffprobe') is not None
```

---

## Future Enhancements

1. **Configurable thumbnail count/size** in settings
2. **Progressive loading** - show thumbnails as generated
3. **Hover preview** - play short clip on hover
4. **Generate GIF preview** for short videos
5. **Support more formats** - animated images, audio waveforms