"""Utility functions for the Camoufox MCP Server"""

import os
import sys
from contextlib import contextmanager


@contextmanager
def redirect_stdout_to_stderr(config=None):
    """
    Context manager to redirect stdout to stderr during browser operations.
    This is critical for STDIO mode to prevent library/subprocess output
    from corrupting the JSON-RPC stream on stdout.
    """
    import logging
    logger = logging.getLogger(__name__)
    
    # For now, disable stdout redirection to fix JSON-RPC communication
    # TODO: Implement selective redirection that preserves MCP protocol messages
    logger.debug("[REDIRECT] Stdout redirection temporarily disabled")
    yield