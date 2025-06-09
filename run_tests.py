#!/usr/bin/env python3
"""
Comprehensive test runner for Camoufox MCP Server
Provides unified interface for running unit and integration tests
"""

import sys
import subprocess
import argparse
from pathlib import Path


def run_pytest(test_type, use_docker=False, verbose=False, debug=False):
    """Run pytest with specific configuration"""
    
    # Base pytest command
    cmd = ["python", "-m", "pytest"]
    
    # Add verbosity
    if verbose:
        cmd.append("-v")
    if debug:
        cmd.extend(["--log-cli-level", "DEBUG"])
    
    # Configure test selection based on type
    if test_type == "unit":
        cmd.extend(["-m", "unit", "camoufox_mcp/tests/unit/"])
    elif test_type == "integration":
        cmd.extend(["-m", "integration", "camoufox_mcp/tests/integration/"])
        if use_docker:
            cmd.extend(["-m", "docker"])
    elif test_type == "all":
        cmd.append("camoufox_mcp/tests/")
        if use_docker:
            cmd.extend(["-m", "not docker or docker"])
    elif test_type == "docker":
        cmd.extend(["-m", "docker", "camoufox_mcp/tests/integration/"])
    else:
        print(f"❌ Unknown test type: {test_type}")
        return 1
    
    # Add Docker flag if needed
    if use_docker and test_type != "unit":
        cmd.append("--docker")
    
    print(f"🧪 Running {test_type} tests...")
    if use_docker:
        print("🐳 Using Docker mode")
    print(f"📋 Command: {' '.join(cmd)}")
    print()
    
    # Run the tests
    try:
        result = subprocess.run(cmd, check=False)
        return result.returncode
    except KeyboardInterrupt:
        print("\n❌ Tests interrupted by user")
        return 130
    except Exception as e:
        print(f"❌ Error running tests: {e}")
        return 1


def check_prerequisites():
    """Check if prerequisites are available"""
    issues = []
    
    # Check Python version
    if sys.version_info < (3, 8):
        issues.append(f"Python 3.8+ required (found {sys.version_info.major}.{sys.version_info.minor})")
    
    # Check pytest
    try:
        import pytest
    except ImportError:
        issues.append("pytest not installed (pip install pytest)")
    
    # Check MCP dependencies
    try:
        import mcp
    except ImportError:
        issues.append("MCP not installed (pip install mcp)")
    
    # Check Camoufox
    try:
        import camoufox
    except ImportError:
        issues.append("Camoufox not installed (pip install camoufox)")
    
    if issues:
        print("❌ Prerequisites missing:")
        for issue in issues:
            print(f"   - {issue}")
        return False
    
    return True


def check_docker():
    """Check if Docker is available"""
    try:
        result = subprocess.run(
            ["docker", "--version"],
            capture_output=True,
            timeout=5
        )
        return result.returncode == 0
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return False


def main():
    """Main entry point"""
    parser = argparse.ArgumentParser(
        description="Camoufox MCP Server Test Runner",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python run_tests_new.py unit              # Run unit tests only
  python run_tests_new.py integration       # Run integration tests
  python run_tests_new.py all               # Run all tests
  python run_tests_new.py docker            # Run Docker tests only
  python run_tests_new.py all --docker      # Run all tests including Docker
  python run_tests_new.py integration -v    # Verbose integration tests
        """
    )
    
    parser.add_argument(
        "test_type",
        choices=["unit", "integration", "all", "docker"],
        help="Type of tests to run"
    )
    
    parser.add_argument(
        "--docker",
        action="store_true",
        help="Use Docker for applicable tests"
    )
    
    parser.add_argument(
        "-v", "--verbose",
        action="store_true",
        help="Verbose output"
    )
    
    parser.add_argument(
        "--debug",
        action="store_true",
        help="Debug level logging"
    )
    
    args = parser.parse_args()
    
    # Print header
    print("🚀 Camoufox MCP Server Test Suite")
    print("=" * 50)
    
    # Check prerequisites
    if not check_prerequisites():
        return 1
    
    # Check Docker if needed
    if args.docker or args.test_type == "docker":
        if not check_docker():
            print("❌ Docker not available but required for this test type")
            return 1
        print("✅ Docker available")
    
    print()
    
    # Run tests
    return run_pytest(
        args.test_type,
        use_docker=args.docker,
        verbose=args.verbose,
        debug=args.debug
    )


if __name__ == "__main__":
    sys.exit(main())