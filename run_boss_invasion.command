#!/bin/bash

# Get the script directory
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd "$DIR"

LOG_FILE="boss_invasion.log"

# Check if Bun is installed
if ! command -v bun &> /dev/null
then
    echo "Bun not found. Please install it first: https://bun.sh/"
    exit 1
fi

echo "--- Starting Boss Invasion Engine at $(date) ---" | tee -a "$LOG_FILE"
echo "Logging to $LOG_FILE"

# Run the engine and append all output to the log file
bun src/bossInvasion.ts 2>&1 | tee -a "$LOG_FILE"
