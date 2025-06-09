"""Command line argument parsing for Camoufox MCP Server"""

import argparse
from ..config import Config, CamoufoxConfig, ServerConfig


def parse_args():
    """Parse command line arguments"""
    parser = argparse.ArgumentParser(description="Camoufox MCP Server - Stealth Browser Automation")
    
    # Browser options
    browser_group = parser.add_argument_group("Browser Options")
    browser_group.add_argument("--headless", choices=["true", "false", "virtual"], default="true",
                               help="Headless mode: true, false, or virtual (uses Xvfb on Linux)")
    browser_group.add_argument("--humanize", type=float, metavar="SECONDS",
                               help="Enable human-like cursor movement (max duration in seconds)")
    browser_group.add_argument("--no-humanize", action="store_true",
                               help="Disable human-like cursor movement")
    
    # Fingerprinting options
    fingerprint_group = parser.add_argument_group("Fingerprinting & Stealth")
    fingerprint_group.add_argument("--os", choices=["windows", "macos", "linux"], 
                                   help="Target operating system for fingerprinting")
    fingerprint_group.add_argument(
        "--geoip", help="IP address for geolocation (or 'auto' for auto-detection)"
    )
    fingerprint_group.add_argument("--no-geoip", action="store_true", help="Disable GeoIP features")
    fingerprint_group.add_argument("--locale", help="Locale/language (e.g., 'en-US' or 'US')")
    fingerprint_group.add_argument("--fonts", nargs="+", help="Custom fonts to load")
    
    # Security & Privacy
    security_group = parser.add_argument_group("Security & Privacy")
    security_group.add_argument("--block-webrtc", action="store_true", default=True,
                                help="Block WebRTC to prevent IP leaks")
    security_group.add_argument("--no-block-webrtc", action="store_false", dest="block_webrtc")
    security_group.add_argument("--block-images", action="store_true",
                                help="Block image loading to save bandwidth")
    security_group.add_argument("--block-webgl", action="store_true",
                                help="Block WebGL (use with caution)")
    security_group.add_argument("--disable-coop", action="store_true",
                                help="Disable Cross-Origin-Opener-Policy (for CAPTCHA solving)")
    
    # Network options
    network_group = parser.add_argument_group("Network Options")
    network_group.add_argument("--proxy", help="Proxy server (format: http://user:pass@host:port)")
    network_group.add_argument("--user-agent", help="Custom user agent string")
    
    # Browser behavior
    behavior_group = parser.add_argument_group("Browser Behavior")
    behavior_group.add_argument("--window", help="Window size in pixels (format: WIDTHxHEIGHT)")
    behavior_group.add_argument("--enable-cache", action="store_true",
                                help="Enable page caching (allows back/forward navigation)")
    behavior_group.add_argument("--persistent", action="store_true",
                                help="Use persistent context (requires --user-data-dir)")
    behavior_group.add_argument("--user-data-dir", help="Path to user data directory")
    behavior_group.add_argument("--addons", nargs="+", help="Paths to Firefox addon directories")
    
    # CAPTCHA solving
    captcha_group = parser.add_argument_group("CAPTCHA Solving")
    captcha_group.add_argument("--captcha-solver", action="store_true",
                               help="Enable CAPTCHA solving capabilities")
    
    # Output options
    output_group = parser.add_argument_group("Output Options") 
    output_group.add_argument("--output-dir", default="/tmp/camoufox-mcp",
                              help="Directory for screenshots and files")
    
    # Server options  
    server_group = parser.add_argument_group("Server Options")
    server_group.add_argument("--port", type=int, help="Port for SSE transport (enables HTTP mode)")
    server_group.add_argument("--host", default="localhost", help="Host to bind server to")
    server_group.add_argument("--debug", action="store_true", help="Enable debug logging")
    
    return parser.parse_args()


def build_config_from_args(args) -> Config:
    """Build configuration from parsed command line arguments"""
    # Build browser config
    browser_config = CamoufoxConfig()
    
    # Handle headless option
    if args.headless == "true":
        browser_config.headless = True
    elif args.headless == "false":
        browser_config.headless = False
    elif args.headless == "virtual":
        browser_config.headless = "virtual"
    
    # Handle humanize option
    if args.no_humanize:
        browser_config.humanize = False
    elif args.humanize:
        browser_config.humanize = args.humanize
    
    # Fingerprinting options
    if args.os:
        browser_config.os = args.os
    if args.geoip:
        if args.geoip.lower() == "auto":
            browser_config.geoip = True
        else:
            browser_config.geoip = args.geoip
    elif args.no_geoip:
        browser_config.geoip = False
    if args.locale:
        browser_config.locale = args.locale
    if args.fonts:
        browser_config.fonts = args.fonts
    
    # Security options
    browser_config.block_webrtc = args.block_webrtc
    browser_config.block_images = args.block_images
    browser_config.block_webgl = args.block_webgl
    browser_config.disable_coop = args.disable_coop
    
    # Network options
    if args.proxy:
        # Parse proxy string into Playwright format
        if "@" in args.proxy:
            # Format: http://user:pass@host:port
            protocol, rest = args.proxy.split("://", 1)
            auth, server = rest.split("@", 1)
            if ":" in auth:
                username, password = auth.split(":", 1)
                browser_config.proxy = {
                    "server": f"{protocol}://{server}",
                    "username": username,
                    "password": password
                }
            else:
                browser_config.proxy = {"server": args.proxy}
        else:
            # Format: http://host:port
            browser_config.proxy = {"server": args.proxy}
    
    if args.user_agent:
        browser_config.user_agent = args.user_agent
    
    # Browser behavior
    if args.window:
        try:
            width, height = map(int, args.window.split('x'))
            browser_config.window = (width, height)
        except ValueError as ve:
            raise ValueError(
                "Invalid window size format. Use WIDTHxHEIGHT (e.g., 1920x1080)"
            ) from ve
    
    browser_config.enable_cache = args.enable_cache
    browser_config.persistent_context = args.persistent
    if args.user_data_dir:
        browser_config.user_data_dir = args.user_data_dir
    if args.addons:
        browser_config.addons = args.addons
    
    # CAPTCHA and output
    browser_config.captcha_solver = args.captcha_solver
    browser_config.output_dir = args.output_dir
    
    # Build main config
    config = Config(
        browser=browser_config,
        server=ServerConfig(port=args.port, host=args.host),
        debug=args.debug
    )
    
    # Validate configuration
    if config.browser.persistent_context and not config.browser.user_data_dir:
        raise ValueError("--persistent requires --user-data-dir")
    
    return config