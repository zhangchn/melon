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
    
    def get_video_duration(self, file_path: str) -> Optional[float]:
        """
        Get video duration using ffprobe.
        
        Returns duration in seconds, or None on failure.
        """
        if not FFMPEG_AVAILABLE:
            return None
        
        cmd = [
            'ffprobe', '-v', 'error',
            '-show_entries', 'format=duration',
            '-of', 'default=noprint_wrappers=1:nokey=1',
            file_path
        ]
        
        try:
            result = subprocess.run(cmd, capture_output=True, timeout=5)
            if result.returncode == 0:
                duration_str = result.stdout.decode('utf-8').strip()
                return float(duration_str) if duration_str else None
        except Exception as e:
            print(f"ffprobe error: {e}")
        
        return None
    
    def _make_xstack_layout(self, n, cols=4):
        layout = []

        for i in range(n):
            col = i % cols
            row = i // cols

            # build x
            if col == 0:
                x = "0"
            else:
                x = "+".join([f"w{row*cols + j}" for j in range(col)])

            # build y
            if row == 0:
                y = "0"
            else:
                y = "+".join([f"h{r*cols}" for r in range(row)])

            layout.append(f"{x}_{y}")

        return "|".join(layout)

    def calculate_timestamps(self, duration: float, max_thumbnails: int = 8) -> List[float]:
        """
        Generate timestamps at exponential intervals.
        
        Sequence: 3.75s, 15s, 60s, 240s, 960s...
        Clamped to video duration.
        """
        base_interval = 3.75  # Start at 3.75 seconds
        timestamps = []
        t = base_interval
        
        while t < duration and len(timestamps) < max_thumbnails:
            timestamps.append(round(t, 2))
            t *= 4  # Double each time
        
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
        thumb_width: int = 320,
        columns: int = 4,
        timeout: int = 30
    ) -> Optional[Path]:
        """
        Generate a contact sheet image with thumbnails at calculated timestamps.
        
        Uses fast seeking with -ss before each input for efficient extraction.
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
        
        num_thumbs = len(timestamps)
        rows = (num_thumbs + columns - 1) // columns
        
        # Build command with -ss before each input for fast seeking
        # This is much faster than fps filter as it doesn't decode the whole video
        cmd = ['ffmpeg', '-y']
        
        # Add -ss and -i for each timestamp
        for ts in timestamps:
            cmd.extend(['-ss', str(ts), '-i', file_path])
        
        # Build filter_complex: scale each input, then tile them together
        scale_filters = []
        scaled_labels = []
        for i in range(num_thumbs):
            label = f"v{i}"
            scale_filters.append(f"[{i}:v]scale={thumb_width}:-1[{label}]")
            scaled_labels.append(f"[{label}]")
        
        # Tile filter combines all scaled frames
        # tile_filter = f"{''.join(scaled_labels)}tile={columns}x{rows}:padding=4:color=0x333333"
        xstack_layout = self._make_xstack_layout(num_thumbs)
        xstack_filter = f"{''.join(scaled_labels)}xstack=inputs={num_thumbs}:layout={xstack_layout}:fill=0x333333"
        filter_complex = ";".join(scale_filters) + ";" + xstack_filter
        
        cmd.extend([
            '-filter_complex', filter_complex,
            '-frames:v', '1',
            '-q:v', '5',
            str(cache_path)
        ])
        
        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                timeout=timeout
            )
            if result.returncode == 0 and cache_path.exists():
                return cache_path
            else:
                # Log error for debugging
                if result.stderr:
                    print(f"ffmpeg command: {cmd}")
                    print(f"ffmpeg error: {result.stderr.decode('utf-8', errors='replace')}")
                # Clean up failed output
                if cache_path.exists():
                    cache_path.unlink()
                return None
        except subprocess.TimeoutExpired:
            print(f"Thumbnail generation timed out for {file_path}")
            print(f"ffmpeg command: {cmd}")
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
