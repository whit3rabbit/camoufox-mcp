"""Server configuration for Camoufox MCP Server"""

from dataclasses import dataclass, field
from typing import Optional
from .browser_config import CamoufoxConfig


@dataclass 
class ServerConfig:
    """Configuration for the MCP server itself.

    Specifies network parameters like port and host for the server.
    """
    port: Optional[int] = None
    host: str = "localhost"


@dataclass
class Config:
    """Main configuration container for the Camoufox MCP Server.

    Aggregates browser-specific and server-specific configurations,
    as well as global settings like debug mode.
    """
    browser: CamoufoxConfig = field(default_factory=CamoufoxConfig)
    server: ServerConfig = field(default_factory=ServerConfig)
    debug: bool = False