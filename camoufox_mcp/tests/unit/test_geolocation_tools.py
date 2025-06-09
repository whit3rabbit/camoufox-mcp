"""
Unit tests for geolocation tools
"""

import pytest
from unittest.mock import AsyncMock
from mcp.types import CallToolResult

pytestmark = pytest.mark.unit

from camoufox_mcp.tools.geolocation import GeolocationTools


class TestGeolocationTools:
    """Test GeolocationTools class"""
    
    @pytest.fixture
    def geo_tools(self, server_with_mock_browser):
        """Create GeolocationTools instance with mocked server"""
        return GeolocationTools(server_with_mock_browser)
    
    @pytest.mark.asyncio
    async def test_set_geolocation_success(self, geo_tools, mock_page):
        """Test successful geolocation setting"""
        result = await geo_tools.set_geolocation(37.7749, -122.4194)
        
        assert isinstance(result, CallToolResult)
        assert not result.isError
        assert "🌍 Geolocation set: 37.7749, -122.4194 (±100m)" in result.content[0].text
        
        expected_location = {
            "latitude": 37.7749,
            "longitude": -122.4194,
            "accuracy": 100
        }
        mock_page.set_geolocation.assert_called_once_with(expected_location)
    
    @pytest.mark.asyncio
    async def test_set_geolocation_custom_accuracy(self, geo_tools, mock_page):
        """Test geolocation setting with custom accuracy"""
        result = await geo_tools.set_geolocation(40.7128, -74.0060, accuracy=50)
        
        assert "🌍 Geolocation set: 40.7128, -74.006 (±50m)" in result.content[0].text
        
        expected_location = {
            "latitude": 40.7128,
            "longitude": -74.0060,
            "accuracy": 50
        }
        mock_page.set_geolocation.assert_called_once_with(expected_location)
    
    @pytest.mark.asyncio
    async def test_set_geolocation_zero_coordinates(self, geo_tools, mock_page):
        """Test geolocation setting with zero coordinates"""
        result = await geo_tools.set_geolocation(0.0, 0.0)
        
        assert not result.isError
        expected_location = {
            "latitude": 0.0,
            "longitude": 0.0,
            "accuracy": 100
        }
        mock_page.set_geolocation.assert_called_once_with(expected_location)
    
    @pytest.mark.asyncio
    async def test_set_geolocation_negative_coordinates(self, geo_tools, mock_page):
        """Test geolocation setting with negative coordinates"""
        result = await geo_tools.set_geolocation(-33.8688, 151.2093)  # Sydney
        
        assert not result.isError
        expected_location = {
            "latitude": -33.8688,
            "longitude": 151.2093,
            "accuracy": 100
        }
        mock_page.set_geolocation.assert_called_once_with(expected_location)
    
    @pytest.mark.asyncio
    async def test_set_geolocation_extreme_coordinates(self, geo_tools, mock_page):
        """Test geolocation setting with extreme coordinates"""
        # Test North Pole
        result = await geo_tools.set_geolocation(90.0, 0.0)
        assert not result.isError
        
        # Test South Pole  
        result = await geo_tools.set_geolocation(-90.0, 0.0)
        assert not result.isError
        
        # Test International Date Line
        result = await geo_tools.set_geolocation(0.0, 180.0)
        assert not result.isError
    
    @pytest.mark.asyncio
    async def test_set_geolocation_high_accuracy(self, geo_tools, mock_page):
        """Test geolocation setting with high accuracy"""
        result = await geo_tools.set_geolocation(37.7749, -122.4194, accuracy=1)
        
        assert "±1m" in result.content[0].text
        expected_location = {
            "latitude": 37.7749,
            "longitude": -122.4194,
            "accuracy": 1
        }
        mock_page.set_geolocation.assert_called_once_with(expected_location)
    
    @pytest.mark.asyncio
    async def test_set_geolocation_low_accuracy(self, geo_tools, mock_page):
        """Test geolocation setting with low accuracy"""
        result = await geo_tools.set_geolocation(37.7749, -122.4194, accuracy=10000)
        
        assert "±10000m" in result.content[0].text
    
    @pytest.mark.asyncio
    async def test_set_geolocation_no_page(self, geo_tools):
        """Test geolocation setting when page is not initialized"""
        geo_tools.server.page = None
        
        result = await geo_tools.set_geolocation(37.7749, -122.4194)
        
        assert isinstance(result, CallToolResult)
        assert result.isError
        assert "❌ Browser not initialized" in result.content[0].text
    
    @pytest.mark.asyncio
    async def test_set_geolocation_playwright_error(self, geo_tools, mock_page):
        """Test geolocation setting with Playwright error"""
        from playwright.async_api import Error as PlaywrightError
        mock_page.set_geolocation.side_effect = PlaywrightError("Permission denied")
        
        result = await geo_tools.set_geolocation(37.7749, -122.4194)
        
        assert isinstance(result, CallToolResult)
        assert result.isError
        assert "❌ PW err set_geo:" in result.content[0].text
    
    @pytest.mark.asyncio
    async def test_set_geolocation_generic_error(self, geo_tools, mock_page):
        """Test geolocation setting with generic error"""
        mock_page.set_geolocation.side_effect = ValueError("Invalid coordinates")
        
        result = await geo_tools.set_geolocation(37.7749, -122.4194)
        
        assert isinstance(result, CallToolResult)
        assert result.isError
        assert "❌ Failed to set geolocation:" in result.content[0].text
    
    @pytest.mark.asyncio
    async def test_set_geolocation_float_precision(self, geo_tools, mock_page):
        """Test geolocation setting with high precision floats"""
        lat = 37.774929
        lon = -122.419416
        
        result = await geo_tools.set_geolocation(lat, lon)
        
        assert not result.isError
        expected_location = {
            "latitude": lat,
            "longitude": lon,
            "accuracy": 100
        }
        mock_page.set_geolocation.assert_called_once_with(expected_location)