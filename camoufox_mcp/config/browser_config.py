"""Browser configuration for Camoufox MCP Server"""

from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Union


@dataclass
class CamoufoxConfig:
    """Configuration for the Camoufox browser instance.

    This dataclass holds all settings related to how the Camoufox browser
    will be launched and behave, including headless mode, humanization,
    fingerprinting options, security settings, and proxy configuration.
    """
    # Basic options
    headless: Union[bool, str] = True  # True, False, or 'virtual'
    humanize: Union[bool, float] = True  # Enable human cursor movement
    
    # Fingerprinting options
    os: Optional[Union[str, List[str]]] = None  # 'windows', 'macos', 'linux' or list
    geoip: Union[bool, str, None] = True  # True, False, or IP address
    locale: Optional[Union[str, List[str]]] = None  # Language/region
    fonts: Optional[List[str]] = None  # Custom fonts to load
    
    # Security & Privacy
    block_webrtc: bool = True
    block_images: bool = False
    block_webgl: bool = False
    disable_coop: bool = False  # For CAPTCHA solving
    
    # Browser options
    proxy: Optional[Dict[str, str]] = None  # Playwright proxy format
    user_agent: Optional[str] = None
    window: Optional[tuple[int, int]] = None  # (width, height)
    addons: Optional[List[str]] = None  # Paths to Firefox addons
    
    # Advanced options
    enable_cache: bool = False
    persistent_context: bool = False
    user_data_dir: Optional[str] = None
    main_world_eval: bool = True  # Enable DOM manipulation
    
    # MCP-specific options
    captcha_solver: bool = False
    output_dir: str = "/tmp/camoufox-mcp"