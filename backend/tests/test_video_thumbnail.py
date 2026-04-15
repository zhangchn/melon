"""Tests for video metadata extraction and thumbnail generation."""

import pytest
import tempfile
import json
from pathlib import Path
from unittest.mock import patch, MagicMock, AsyncMock

# Import modules under test
import sys
sys.path.insert(0, str(Path(__file__).parent.parent))

from scanner import (
    get_video_metadata,
    VIDEO_EXTENSIONS,
    FFPROBE_AVAILABLE,
    ScanNode,
)
from thumbnail_service import ThumbnailService, FFMPEG_AVAILABLE


class TestVideoExtensions:
    """Test video file extension detection."""
    
    def test_video_extensions_include_common_formats(self):
        """Verify common video formats are included."""
        assert '.mp4' in VIDEO_EXTENSIONS
        assert '.mov' in VIDEO_EXTENSIONS
        assert '.mkv' in VIDEO_EXTENSIONS
        assert '.avi' in VIDEO_EXTENSIONS
        assert '.webm' in VIDEO_EXTENSIONS
    
    def test_video_extensions_exclude_images(self):
        """Verify image formats are not included."""
        assert '.png' not in VIDEO_EXTENSIONS
        assert '.jpg' not in VIDEO_EXTENSIONS
        assert '.gif' not in VIDEO_EXTENSIONS


class TestGetVideoMetadata:
    """Test ffprobe video metadata extraction."""
    
    @pytest.mark.skipif(not FFPROBE_AVAILABLE, reason="ffprobe not installed")
    def test_get_video_metadata_real_file(self, tmp_path):
        """Test metadata extraction from a real video file (if available)."""
        # This test requires a real video file and ffprobe
        # In CI, we mock the subprocess
        pass
    
    @patch('scanner.subprocess.run')
    def test_get_video_metadata_mock_success(self, mock_run, tmp_path):
        """Test successful metadata extraction with mocked ffprobe."""
        # Create a dummy video file path
        video_file = tmp_path / "test.mp4"
        video_file.write_bytes(b"fake video")
        
        # Mock ffprobe output
        mock_result = MagicMock()
        mock_result.returncode = 0
        mock_result.stdout = json.dumps({
            "format": {"duration": "120.5"},
            "streams": [
                {
                    "codec_type": "video",
                    "codec_name": "h264",
                    "width": 1920,
                    "height": 1080,
                    "r_frame_rate": "30/1"
                }
            ]
        })
        mock_run.return_value = mock_result
        
        metadata = get_video_metadata(video_file)
        
        assert metadata is not None
        assert metadata['duration'] == 120.5
        assert metadata['width'] == 1920
        assert metadata['height'] == 1080
        assert metadata['codec'] == 'h264'
        assert metadata['fps'] == 30.0
    
    @patch('scanner.subprocess.run')
    def test_get_video_metadata_parse_fps_fraction(self, mock_run, tmp_path):
        """Test parsing fps from fraction format like '30000/1001'."""
        video_file = tmp_path / "test.mp4"
        video_file.write_bytes(b"fake video")
        
        mock_result = MagicMock()
        mock_result.returncode = 0
        mock_result.stdout = json.dumps({
            "format": {"duration": "60.0"},
            "streams": [{
                "codec_type": "video",
                "codec_name": "h264",
                "width": 1920,
                "height": 1080,
                "r_frame_rate": "30000/1001"  # ~29.97 fps
            }]
        })
        mock_run.return_value = mock_result
        
        metadata = get_video_metadata(video_file)
        
        assert metadata is not None
        assert abs(metadata['fps'] - 29.97) < 0.1
    
    @patch('scanner.subprocess.run')
    def test_get_video_metadata_no_video_stream(self, mock_run, tmp_path):
        """Test handling of files without video stream."""
        video_file = tmp_path / "test.mp4"
        video_file.write_bytes(b"fake video")
        
        mock_result = MagicMock()
        mock_result.returncode = 0
        mock_result.stdout = json.dumps({
            "format": {"duration": "10.0"},
            "streams": [{"codec_type": "audio"}]
        })
        mock_run.return_value = mock_result
        
        metadata = get_video_metadata(video_file)
        
        assert metadata is None
    
    @patch('scanner.subprocess.run')
    def test_get_video_metadata_ffprobe_failure(self, mock_run, tmp_path):
        """Test handling of ffprobe failure."""
        video_file = tmp_path / "test.mp4"
        video_file.write_bytes(b"fake video")
        
        mock_result = MagicMock()
        mock_result.returncode = 1
        mock_result.stderr = "Invalid data found when processing input"
        mock_run.return_value = mock_result
        
        metadata = get_video_metadata(video_file)
        
        assert metadata is None
    
    @patch('scanner.subprocess.run')
    def test_get_video_metadata_timeout(self, mock_run, tmp_path):
        """Test handling of ffprobe timeout."""
        import subprocess
        video_file = tmp_path / "test.mp4"
        video_file.write_bytes(b"fake video")
        
        mock_run.side_effect = subprocess.TimeoutExpired(cmd='ffprobe', timeout=10)
        
        metadata = get_video_metadata(video_file)
        
        assert metadata is None


class TestThumbnailServiceTimestamps:
    """Test timestamp calculation for thumbnail generation."""
    
    def test_calculate_timestamps_short_video(self):
        """Test timestamps for a short video (30 seconds)."""
        service = ThumbnailService()
        timestamps = service.calculate_timestamps(duration=30.0)
        
        # Should get 3.75, 7.5, 15, and 27 (90% of 30)
        assert 3.75 in timestamps
        assert 7.5 in timestamps
        assert 15 in timestamps
        # 30s is at end, so 90% = 27s should be added
        assert len(timestamps) <= 8
    
    def test_calculate_timestamps_medium_video(self):
        """Test timestamps for a medium video (5 minutes = 300 seconds)."""
        service = ThumbnailService()
        timestamps = service.calculate_timestamps(duration=300.0)
        
        # Should get: 3.75, 7.5, 15, 30, 60, 120, 270 (90%)
        assert 3.75 in timestamps
        assert 60 in timestamps
        assert 120 in timestamps
        # 240 would be in range, but 480 exceeds 300
        assert 480 not in timestamps
        # 90% of 300 = 270
        assert 270 in timestamps
    
    def test_calculate_timestamps_long_video(self):
        """Test timestamps for a long video (10 minutes = 600 seconds)."""
        service = ThumbnailService()
        timestamps = service.calculate_timestamps(duration=600.0)
        
        # Should get: 3.75, 7.5, 15, 30, 60, 120, 240, 480
        # 540 (90% of 600) should be added
        assert 3.75 in timestamps
        assert 60 in timestamps
        assert 120 in timestamps
        assert 240 in timestamps
        assert 480 in timestamps
        # Check max 8 thumbnails
        assert len(timestamps) <= 8
    
    def test_calculate_timestamps_very_short_video(self):
        """Test timestamps for very short video (5 seconds)."""
        service = ThumbnailService()
        timestamps = service.calculate_timestamps(duration=5.0)
        
        # 3.75 is within range, 7.5 is not
        # Should get 3.75 and 4.5 (90% of 5)
        assert len(timestamps) >= 1
        for ts in timestamps:
            assert ts <= 5.0
    
    def test_calculate_timestamps_zero_duration(self):
        """Test handling of zero duration video."""
        service = ThumbnailService()
        timestamps = service.calculate_timestamps(duration=0.0)
        
        assert timestamps == []
    
    def test_calculate_timestamps_custom_max(self):
        """Test custom max thumbnail count."""
        service = ThumbnailService()
        timestamps = service.calculate_timestamps(duration=300.0, max_thumbnails=4)
        
        assert len(timestamps) <= 4


class TestThumbnailServiceCaching:
    """Test thumbnail caching logic."""
    
    def test_cache_path_generation(self):
        """Test that cache paths are generated consistently."""
        with tempfile.TemporaryDirectory() as tmpdir:
            service = ThumbnailService(cache_dir=Path(tmpdir))
            
            path1 = service.get_cache_path("/videos/test.mp4", 12345.0)
            path2 = service.get_cache_path("/videos/test.mp4", 12345.0)
            
            assert path1 == path2
            assert path1.suffix == ".jpg"
    
    def test_cache_path_changes_with_mtime(self):
        """Test that different mtimes produce different cache paths."""
        with tempfile.TemporaryDirectory() as tmpdir:
            service = ThumbnailService(cache_dir=Path(tmpdir))
            
            path1 = service.get_cache_path("/videos/test.mp4", 12345.0)
            path2 = service.get_cache_path("/videos/test.mp4", 12346.0)
            
            assert path1 != path2
    
    def test_clear_cache(self):
        """Test cache clearing."""
        with tempfile.TemporaryDirectory() as tmpdir:
            service = ThumbnailService(cache_dir=Path(tmpdir))
            
            # Create some dummy cache files
            cache_file = service.cache_dir / "test.jpg"
            cache_file.write_bytes(b"fake image")
            
            count = service.clear_cache()
            
            assert count == 1
            assert not cache_file.exists()


@pytest.mark.asyncio
class TestThumbnailAPI:
    """Test the thumbnail API endpoint."""
    
    @pytest.fixture
    def mock_scan_cache(self):
        """Create mock scan cache with a video node."""
        from datetime import datetime
        
        video_node = ScanNode(
            id=1,
            parent_id=0,
            name="test.mp4",
            size=1024 * 1024,
            depth=1,
            is_dir=False,
            video_metadata={
                'duration': 120.0,
                'width': 1920,
                'height': 1080,
                'codec': 'h264',
                'fps': 30.0
            }
        )
        
        return {
            "/test": ([video_node], {}, datetime.now().timestamp())
        }
    
    @patch('main.FFMPEG_AVAILABLE', True)
    async def test_thumbnail_requires_cache(self, mock_scan_cache):
        """Test that thumbnail endpoint requires scan in cache."""
        from fastapi.testclient import TestClient
        from main import app
        
        client = TestClient(app)
        
        response = client.get("/api/thumbnail?node_id=1&root=/nonexistent")
        
        assert response.status_code == 404
    
    @patch('main.FFMPEG_AVAILABLE', False)
    async def test_thumbnail_ffmpeg_not_available(self):
        """Test that thumbnail returns 503 if ffmpeg not installed."""
        from fastapi.testclient import TestClient
        from main import app
        
        client = TestClient(app)
        
        response = client.get("/api/thumbnail?node_id=1&root=/test")
        
        assert response.status_code == 503


class TestVideoMetadataModel:
    """Test the VideoMetadata Pydantic model."""
    
    def test_video_metadata_creation(self):
        """Test creating VideoMetadata instance."""
        from models import VideoMetadata
        
        metadata = VideoMetadata(
            duration=120.5,
            width=1920,
            height=1080,
            codec='h264',
            fps=30.0
        )
        
        assert metadata.duration == 120.5
        assert metadata.width == 1920
        assert metadata.height == 1080
        assert metadata.codec == 'h264'
        assert metadata.fps == 30.0
    
    def test_video_metadata_optional_fields(self):
        """Test VideoMetadata with optional fields omitted."""
        from models import VideoMetadata
        
        metadata = VideoMetadata(
            duration=60.0,
            width=1280,
            height=720
        )
        
        assert metadata.codec is None
        assert metadata.fps is None
    
    def test_node_data_with_video_metadata(self):
        """Test NodeData can include video_metadata."""
        from models import NodeData, VideoMetadata
        
        node = NodeData(
            id=1,
            parent_id=0,
            name="video.mp4",
            size=1024,
            depth=1,
            is_dir=False,
            video_metadata=VideoMetadata(
                duration=120.0,
                width=1920,
                height=1080
            )
        )
        
        assert node.video_metadata is not None
        assert node.video_metadata.duration == 120.0


class TestScanNodeVideoMetadata:
    """Test ScanNode dataclass with video metadata."""
    
    def test_scan_node_with_video_metadata(self):
        """Test creating ScanNode with video metadata."""
        node = ScanNode(
            id=1,
            parent_id=0,
            name="video.mp4",
            size=1024,
            depth=1,
            is_dir=False,
            video_metadata={
                'duration': 120.0,
                'width': 1920,
                'height': 1080
            }
        )
        
        assert node.video_metadata is not None
        assert node.video_metadata['duration'] == 120.0
    
    def test_scan_node_without_video_metadata(self):
        """Test ScanNode without video metadata."""
        node = ScanNode(
            id=1,
            parent_id=0,
            name="file.txt",
            size=1024,
            depth=1,
            is_dir=False
        )
        
        assert node.video_metadata is None


if __name__ == "__main__":
    pytest.main([__file__, "-v"])