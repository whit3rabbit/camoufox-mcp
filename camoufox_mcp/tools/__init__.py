"""Browser automation tools for Camoufox MCP Server"""

from .navigation import NavigationTools
from .interaction import InteractionTools
from .content import ContentTools
from .javascript import JavaScriptTools
from .geolocation import GeolocationTools
from .browser_mgmt import BrowserManagementTools
from .captcha import CaptchaTools

__all__ = [
    "NavigationTools",
    "InteractionTools", 
    "ContentTools",
    "JavaScriptTools",
    "GeolocationTools",
    "BrowserManagementTools",
    "CaptchaTools"
]