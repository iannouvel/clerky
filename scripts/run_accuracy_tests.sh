#!/bin/bash

# Clinical Guidelines Accuracy Testing Runner
# This script runs the automated accuracy testing agent with various configurations

set -e

# Configuration
DEFAULT_SERVER_URL="http://localhost:3000"
DEFAULT_NUM_TESTS=10
DEFAULT_LOG_LEVEL="INFO"
DEFAULT_RESULTS_DIR="test_results"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to show usage
show_usage() {
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  -s, --server-url URL     Server URL (default: $DEFAULT_SERVER_URL)"
    echo "  -t, --auth-token TOKEN   Authentication token"
    echo "  -n, --num-tests NUM      Number of tests to run (default: $DEFAULT_NUM_TESTS)"
    echo "  -l, --log-level LEVEL    Log level: DEBUG, INFO, WARNING, ERROR (default: $DEFAULT_LOG_LEVEL)"
    echo "  -r, --results-dir DIR    Results directory (default: $DEFAULT_RESULTS_DIR)"
    echo "  -q, --quick              Run quick test (5 tests)"
    echo "  -f, --full               Run full test (50 tests)"
    echo "  -c, --continuous         Run continuous testing (10 tests every hour)"
    echo "  -h, --help               Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0 --quick                                    # Quick 5-test run"
    echo "  $0 --full --log-level DEBUG                  # Full 50-test run with debug logging"
    echo "  $0 --continuous --num-tests 20               # Continuous testing with 20 tests per hour"
    echo "  $0 --server-url https://api.example.com      # Test against remote server"
}

# Parse command line arguments
SERVER_URL="$DEFAULT_SERVER_URL"
AUTH_TOKEN=""
NUM_TESTS="$DEFAULT_NUM_TESTS"
LOG_LEVEL="$DEFAULT_LOG_LEVEL"
RESULTS_DIR="$DEFAULT_RESULTS_DIR"
QUICK_MODE=false
FULL_MODE=false
CONTINUOUS_MODE=false

while [[ $# -gt 0 ]]; do
    case $1 in
        -s|--server-url)
            SERVER_URL="$2"
            shift 2
            ;;
        -t|--auth-token)
            AUTH_TOKEN="$2"
            shift 2
            ;;
        -n|--num-tests)
            NUM_TESTS="$2"
            shift 2
            ;;
        -l|--log-level)
            LOG_LEVEL="$2"
            shift 2
            ;;
        -r|--results-dir)
            RESULTS_DIR="$2"
            shift 2
            ;;
        -q|--quick)
            QUICK_MODE=true
            NUM_TESTS=5
            shift
            ;;
        -f|--full)
            FULL_MODE=true
            NUM_TESTS=50
            shift
            ;;
        -c|--continuous)
            CONTINUOUS_MODE=true
            shift
            ;;
        -h|--help)
            show_usage
            exit 0
            ;;
        *)
            print_error "Unknown option: $1"
            show_usage
            exit 1
            ;;
    esac
done

# Validation
if ! [[ "$NUM_TESTS" =~ ^[0-9]+$ ]] || [ "$NUM_TESTS" -lt 1 ]; then
    print_error "Number of tests must be a positive integer"
    exit 1
fi

if [[ ! "$LOG_LEVEL" =~ ^(DEBUG|INFO|WARNING|ERROR)$ ]]; then
    print_error "Log level must be one of: DEBUG, INFO, WARNING, ERROR"
    exit 1
fi

# Check if Python script exists
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PYTHON_SCRIPT="$SCRIPT_DIR/accuracy_testing_agent.py"

if [ ! -f "$PYTHON_SCRIPT" ]; then
    print_error "Python script not found: $PYTHON_SCRIPT"
    exit 1
fi

# Check if required files exist
REQUIRED_FILES=("../clinical_issues.json" "../fake_transcripts.json")
for file in "${REQUIRED_FILES[@]}"; do
    if [ ! -f "$SCRIPT_DIR/$file" ]; then
        print_error "Required file not found: $file"
        exit 1
    fi
done

# Create results directory
mkdir -p "$RESULTS_DIR"

# Function to run a single test batch
run_test_batch() {
    local timestamp=$(date '+%Y-%m-%d_%H-%M-%S')
    local log_file="$RESULTS_DIR/test_run_$timestamp.log"
    
    print_status "Starting accuracy testing..."
    print_status "Server URL: $SERVER_URL"
    print_status "Number of tests: $NUM_TESTS"
    print_status "Log level: $LOG_LEVEL"
    print_status "Results directory: $RESULTS_DIR"
    print_status "Log file: $log_file"
    
    # Build command
    local cmd="python3 $PYTHON_SCRIPT"
    cmd="$cmd --server-url $SERVER_URL"
    cmd="$cmd --num-tests $NUM_TESTS"
    cmd="$cmd --log-level $LOG_LEVEL"
    cmd="$cmd --results-dir $RESULTS_DIR"
    
    if [ -n "$AUTH_TOKEN" ]; then
        cmd="$cmd --auth-token $AUTH_TOKEN"
    fi
    
    # Run the test
    if $cmd 2>&1 | tee "$log_file"; then
        print_success "Accuracy testing completed successfully!"
        print_status "Results saved to: $RESULTS_DIR"
        print_status "Log file: $log_file"
        
        # Show latest report summary if available
        local latest_report=$(ls -t "$RESULTS_DIR"/accuracy_report_*.json 2>/dev/null | head -n1)
        if [ -n "$latest_report" ]; then
            print_status "Latest report: $latest_report"
            
            # Extract and display key metrics
            if command -v jq > /dev/null 2>&1; then
                local overall_accuracy=$(jq -r '.overall_accuracy' "$latest_report" 2>/dev/null || echo "N/A")
                local total_tests=$(jq -r '.total_tests' "$latest_report" 2>/dev/null || echo "N/A")
                
                if [ "$overall_accuracy" != "N/A" ] && [ "$total_tests" != "N/A" ]; then
                    overall_accuracy_percent=$(echo "$overall_accuracy * 100" | bc -l 2>/dev/null | cut -d. -f1)
                    print_success "Overall Accuracy: ${overall_accuracy_percent}% (${total_tests} tests)"
                fi
            fi
        fi
        
        return 0
    else
        print_error "Accuracy testing failed! Check log file: $log_file"
        return 1
    fi
}

# Function to run continuous testing
run_continuous_testing() {
    print_status "Starting continuous accuracy testing..."
    print_status "Running $NUM_TESTS tests every hour"
    print_status "Press Ctrl+C to stop"
    
    local test_count=1
    
    while true; do
        print_status "=== Continuous Test Run #$test_count $(date) ==="
        
        if run_test_batch; then
            print_success "Test run #$test_count completed successfully"
        else
            print_error "Test run #$test_count failed"
        fi
        
        test_count=$((test_count + 1))
        
        print_status "Waiting 1 hour before next test run..."
        sleep 3600  # Wait 1 hour
    done
}

# Main execution
print_status "Clinical Guidelines Accuracy Testing Agent"
print_status "==========================================="

# Check Python dependencies
if ! python3 -c "import aiohttp, asyncio" 2>/dev/null; then
    print_error "Required Python packages not found. Please install:"
    print_error "pip install aiohttp asyncio"
    exit 1
fi

# Check if server is accessible
if command -v curl > /dev/null 2>&1; then
    if ! curl -s --connect-timeout 5 "$SERVER_URL" > /dev/null; then
        print_warning "Server at $SERVER_URL may not be accessible"
        print_warning "Continuing anyway..."
    fi
fi

# Run tests based on mode
if $CONTINUOUS_MODE; then
    run_continuous_testing
else
    run_test_batch
fi 