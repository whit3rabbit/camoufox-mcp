# scripts/preload_browser.py
import asyncio
import sys
import os
import logging
from camoufox.async_api import AsyncCamoufox
from camoufox_mcp.server.base import CamoufoxMCPServer
from camoufox_mcp.config import Config, CamoufoxConfig

# Basic logging to stderr for build output
logging.basicConfig(level=logging.INFO, stream=sys.stderr, format='[Preload] %(message)s')

async def main():
    """
    Initializes Camoufox to pre-download the browser, profile, and addons.
    This is run during the Docker build to warm the cache.
    """
    logging.info("Starting browser pre-warming process...")

    # We use a dummy server instance to leverage its _ensure_browser logic,
    # which accurately reflects the real application's startup sequence.
    dummy_config = Config(
        browser=CamoufoxConfig(
            headless="virtual", # Use 'virtual' as we are in a headless build env
            humanize=False,     # No need for humanization during preload
            geoip=False         # Skip GeoIP for faster preload
        )
    )
    dummy_server = CamoufoxMCPServer(config=dummy_config)

    try:
        # This will trigger the download and setup of the browser and profile.
        await dummy_server._ensure_browser()
        logging.info("Browser instance ensured.")

        if dummy_server.page:
            logging.info("Navigating to a data URL to confirm page is working...")
            await dummy_server.page.goto("data:text/html,<h1>Preload Complete</h1>", timeout=15000)
            logging.info("Navigation successful.")
        else:
            logging.error("Failed to get a page object from the browser.")
            sys.exit(1)

        # Gracefully close all resources.
        await dummy_server._close_browser_resources()
        logging.info("Browser resources closed gracefully.")

        # Verify that the cache directory was created and is not empty.
        cache_dir = os.path.expanduser("~/.cache/camoufox")
        if os.path.exists(cache_dir) and os.listdir(cache_dir):
            logging.info(f"✅ Cache verification successful. Contents: {os.listdir(cache_dir)}")
        else:
            logging.error(f"❌ Cache verification failed. Directory missing or empty: {cache_dir}")
            sys.exit(1)

    except Exception as e:
        logging.error(f"❌ An error occurred during pre-warming: {e}", exc_info=True)
        # Attempt cleanup even on failure
        if dummy_server.browser_context:
            await dummy_server._close_browser_resources()
        sys.exit(1)

    logging.info("✅ Browser pre-warming complete.")


if __name__ == "__main__":
    # It's better to run this within xvfb-run for simplicity and robustness
    # The Dockerfile will handle this.
    if "DISPLAY" not in os.environ:
        logging.error("This script requires a virtual display. Please run with xvfb-run.")
        sys.exit(1)
        
    asyncio.run(main())