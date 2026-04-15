"""Video thumbnail generation service using ffmpeg."""

import subprocess
import tempfile
import hashlib
import shutil
from pathlib import Path
from typing import Optional, List

# Check if ffmpeg is available
FFMPEG_AVAILABLE = shutil.which('ffmpeg') is not None


class ThumbnailService:
    """
    Generates contact-sheet thumbnails for video files.
    
    Uses ffmpeg to extract frames at exponential timestamps and
    arrange them in a grid. Thumbnails are cached in a temp directory.
    """
    
    def __init__(self, cache_dir: Optional[Path] = None):
        self.cache_dir = cache_dir or Path(tempfile.gettempdir()) / 'disk_analyzer_thumbs'
        self.cache_dir.mkdir(parents=True, exist_ok=True)
    
    def get_cache_path(self, file_path: str, file_mtime: float) -> Path:
        """Generate unique cache filename based on path and mtime."""
        key = hashlib.md5(f"{file_path}:{file_mtime}".encode()).hexdigest()
        return self.cache_dir / f"{key}.jpg"
    
    def calculate_timestamps(self, duration: float, max_thumbnails: int = 8) -> List[float]:
        """
        Generate timestamps at exponential intervals.
        
        Sequence: 3.75s, 7.5s, 15s, 30s, 60s, 120s, 240s, 480s...
        Clamped to video duration.
        """
        base_interval = 3.75  # Start at 3.75 seconds
        timestamps = []
        t = base_interval
        
        while t < duration and len(timestamps) < max_thumbnails:
            timestamps.append(round(t, 2))
            t *= 2  # Double each time
        
        # Add one more near the end (90% of duration) if space allows
        if duration > 0 and len(timestamps) < max_thumbnails:
            end_ts = round(duration * 0.9, 2)
            if end_ts not in timestamps and end_ts > 0:
                timestamps.append(end_ts)
        
        return timestamps
    
    async def generate_contact_sheet(
        self,
        file_path: str,
        duration: float,
        file_mtime: float,
        max_thumbnails: int = 8,
        thumb_width: int = 160,
        columns: int = 4,
        timeout: int = 30
    ) -> Optional[Path]:
        """
        Generate a contact sheet image with thumbnails at calculated timestamps.
        
        Returns path to generated image, or None on failure.
        """
        if not FFMPEG_AVAILABLE:
            return None
        
        cache_path = self.get_cache_path(file_path, file_mtime)
        
        # Return cached if exists
        if cache_path.exists():
            return cache_path
        
        timestamps = self.calculate_timestamps(duration, max_thumbnails)
        if not timestamps:
            return None
        
        rows = (len(timestamps) + columns - 1) // columns
        
        # Build ffmpeg inputs and filter complex
        inputs = []
        filter_parts = []
        
        for i, ts in enumerate(timestamps):
            # Each thumbnail: seek to timestamp, take 1 frame
            inputs.extend(['-ss', str(ts), '-i', file_path, '-frames:v', '1'])
            filter_parts.append(f'[{i}:v]scale={thumb_width}:-1[thumb{i}]')
        
        # Tile all thumbnails into grid
        thumb_labels = ''.join(f'[thumb{i}]' for i in range(len(timestamps)))
        tile_filter = f"{thumb_labels}tile={columns}x{rows}:padding=4:color=0x333333[out]"
        filter_complex = ';'.join(filter_parts) + ';' + tile_filter
        
        cmd = [
            'ffmpeg', '-y',  # Overwrite output
            *inputs,
            '-filter_complex', filter_complex,
            '-map', '[out]',
            '-frames:v', '1',
            '-q:v', '5',  # JPEG quality
            str(cache_path)
        ]
        
        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                timeout=timeout
            )
            if result.returncode == 0 and cache_path.exists():
                return cache_path
            else:
                # Clean up failed output
                if cache_path.exists():
                    cache_path.unlink()
                return None
        except subprocess.TimeoutExpired:
            if cache_path.exists():
                cache_path.unlink()
            return None
        except Exception as e:
            print(f"Thumbnail generation failed: {e}")
            return None
    
    def clear_cache(self) -> int:
        """
        Clear all cached thumbnails.
        
        Returns number of files removed.
        """
        count = 0
        if self.cache_dir.exists():
            for f in self.cache_dir.iterdir():
                if f.is_file():
                    f.unlink()
                    count += 1
        return count
    
    def cleanup_on_shutdown(self):
        """Remove entire cache directory on shutdown."""
        if self.cache_dir.exists():
            try:
                shutil.rmtree(self.cache_dir)
            except Exception as e:
                print(f"Failed to cleanup thumbnail cache: {e}")