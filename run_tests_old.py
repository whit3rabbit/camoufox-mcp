#!/usr/bin/env python3
"""
Consolidated test runner for Camoufox MCP Server

This script provides a unified interface to run different types of tests:
- Connectivity tests: Basic server communication
- Unit tests: Individual component testing  
- Integration tests: Full MCP workflow testing

Usage:
    python run_tests.py                    # Run connectivity tests
    python run_tests.py --unit            # Run unit tests
    python run_tests.py --integration     # Run integration tests
    python run_tests.py --all             # Run all test suites
    
    # Docker mode (for any test type)
    python run_tests.py --docker          # Test Docker container
    python run_tests.py --integration --docker --debug
"""

import sys
import subprocess
import argparse
import time
from pathlib import Path
from typing import List, Tuple


class TestRunner:
    """Consolidated test runner for the MCP server"""
    
    def __init__(self, debug: bool = False):
        self.debug = debug
        self.results = {
            "connectivity": None,
            "unit": None, 
            "integration": None
        }
    
    def run_connectivity_tests(self, use_docker: bool = False) -> bool:
        """Run connectivity tests"""
        print("🔌 Running Connectivity Tests...")
        print("=" * 50)
        
        cmd = ["python3", "tests/test_connectivity.py"]
        if use_docker:
            cmd.append("--docker")
        if self.debug:
            cmd.append("--debug")
        
        result = subprocess.run(cmd)
        success = result.returncode == 0
        self.results["connectivity"] = success
        
        print(f"Connectivity tests: {'✅ PASSED' if success else '❌ FAILED'}")
        return success
    
    def run_unit_tests(self) -> bool:
        """Run unit tests"""
        print("\\n🧪 Running Unit Tests...")
        print("=" * 50)
        
        cmd = ["python3", "tests/test_unit.py"]
        if self.debug:
            cmd.append("--debug")
        
        result = subprocess.run(cmd)
        success = result.returncode == 0
        self.results["unit"] = success
        
        print(f"Unit tests: {'✅ PASSED' if success else '❌ FAILED'}")
        return success
    
    def run_integration_tests(self, use_docker: bool = False) -> bool:
        """Run integration tests"""
        print("\\n🔄 Running Integration Tests...")
        print("=" * 50)
        
        cmd = ["python3", "tests/test_integration.py"]
        if use_docker:
            cmd.append("--docker")
        if self.debug:
            cmd.append("--debug")
        
        result = subprocess.run(cmd)
        success = result.returncode == 0
        self.results["integration"] = success
        
        print(f"Integration tests: {'✅ PASSED' if success else '❌ FAILED'}")
        return success
    
    def print_summary(self):
        """Print comprehensive test summary"""
        print("\\n" + "=" * 60)
        print("📊 Test Suite Summary")
        print("=" * 60)
        
        total_run = sum(1 for result in self.results.values() if result is not None)
        total_passed = sum(1 for result in self.results.values() if result is True)
        
        for test_type, result in self.results.items():
            if result is not None:
                status = "✅ PASSED" if result else "❌ FAILED"
                print(f"  {test_type.capitalize():<12}: {status}")
            else:
                print(f"  {test_type.capitalize():<12}: ⏭️ SKIPPED")
        
        print(f"\\n  Total: {total_passed}/{total_run} test suites passed")
        
        if total_passed == total_run and total_run > 0:
            print("\\n🎉 All test suites passed successfully!")
            print("   Your Camoufox MCP server is fully functional.")
        elif total_run > 0:
            print("\\n⚠️ Some test suites failed.")
            self._print_troubleshooting_tips()
        else:
            print("\\n❓ No tests were run.")
    
    def _print_troubleshooting_tips(self):
        """Print troubleshooting guidance"""
        print("\\n💡 Troubleshooting Tips:")
        print("   • Check failed test output above for specific errors")
        print("   • Run individual test suites with --debug for more details")
        print("   • For Docker issues: docker pull followthewhit3rabbit/camoufox-mcp:latest")
        print("   • For local issues: pip install -r requirements.txt")
        print("   • Ensure sufficient system resources (RAM/CPU)")


def main():
    """Main test runner function"""
    parser = argparse.ArgumentParser(
        description="Consolidated test runner for Camoufox MCP Server",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python run_tests.py                     # Quick connectivity check
  python run_tests.py --unit             # Test individual components
  python run_tests.py --integration      # Full workflow testing
  python run_tests.py --all              # Run complete test suite
  python run_tests.py --docker           # Test Docker container
  python run_tests.py --all --docker     # Complete testing with Docker
        """
    )
    
    # Test type selection
    test_group = parser.add_mutually_exclusive_group()
    test_group.add_argument(
        "--connectivity", 
        action="store_true", 
        help="Run connectivity tests (default)"
    )
    test_group.add_argument(
        "--unit", 
        action="store_true", 
        help="Run unit tests"
    )
    test_group.add_argument(
        "--integration", 
        action="store_true", 
        help="Run integration tests"
    )
    test_group.add_argument(
        "--all", 
        action="store_true", 
        help="Run all test suites"
    )
    
    # Test mode options
    parser.add_argument(
        "--docker", 
        action="store_true", 
        help="Test Docker container instead of local server"
    )
    parser.add_argument(
        "--debug", 
        action="store_true", 
        help="Enable debug output"
    )
    
    args = parser.parse_args()
    
    # Create test runner
    runner = TestRunner(debug=args.debug)
    
    # Determine what tests to run
    if args.all:
        tests_to_run = ["connectivity", "unit", "integration"]
    elif args.unit:
        tests_to_run = ["unit"]
    elif args.integration:
        tests_to_run = ["integration"]
    else:
        # Default to connectivity tests
        tests_to_run = ["connectivity"]
    
    print("🧪 Camoufox MCP Server Test Runner")
    print(f"📍 Mode: {'Docker' if args.docker else 'Local'}")
    print(f"🎯 Tests: {', '.join(tests_to_run)}")
    print("=" * 60)
    
    # Run selected tests
    overall_success = True
    
    try:
        if "connectivity" in tests_to_run:
            if not runner.run_connectivity_tests(use_docker=args.docker):
                overall_success = False
        
        if "unit" in tests_to_run:
            if not runner.run_unit_tests():
                overall_success = False
        
        if "integration" in tests_to_run:
            if not runner.run_integration_tests(use_docker=args.docker):
                overall_success = False
        
        # Print summary
        runner.print_summary()
        
        # Exit with appropriate code
        sys.exit(0 if overall_success else 1)
        
    except KeyboardInterrupt:
        print("\\n\\n⚠️ Testing interrupted by user")
        sys.exit(1)
    except Exception as e:
        print(f"\\n\\n💥 Unexpected error in test runner: {e}")
        if args.debug:
            import traceback
            traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
