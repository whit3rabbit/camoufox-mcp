"""Utility functions for the Camoufox MCP Server"""

import os
import sys
from contextlib import contextmanager


@contextmanager
def redirect_stdout_to_stderr(config=None):
    """Context manager to redirect stdout to stderr during browser operations"""
    # For STDIO mode, we need to redirect at the file descriptor level
    # to catch output from subprocesses (like Camoufox downloads)
    if config and not config.server.port:
        # STDIO mode - redirect at OS level
        stdout_fd = sys.stdout.fileno()
        stderr_fd = sys.stderr.fileno()
        
        # Save the original stdout
        stdout_copy = os.dup(stdout_fd)
        try:
            # Redirect stdout to stderr
            os.dup2(stderr_fd, stdout_fd)
            yield
        finally:
            # Restore original stdout
            os.dup2(stdout_copy, stdout_fd)
            os.close(stdout_copy)
    else:
        # HTTP mode - simple redirect
        original_stdout = sys.stdout
        try:
            sys.stdout = sys.stderr
            yield
        finally:
            sys.stdout = original_stdout