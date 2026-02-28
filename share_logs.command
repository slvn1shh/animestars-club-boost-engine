#!/bin/bash

# Get the script directory
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd "$DIR"

LOG_FILE="boost.log"

if [ ! -f "$LOG_FILE" ]; then
    echo "Log file $LOG_FILE not found. Nothing to share."
    exit 1
fi

echo "Uploading logs..."
# Using transfer.sh which is reliable and doesn't require registration
URL=$(curl -s --upload-file "$LOG_FILE" "https://transfer.sh/boost_log.txt")

if [ $? -eq 0 ] && [ ! -z "$URL" ]; then
    echo "Logs uploaded successfully!"
    echo "Please share this link with me:"
    echo "$URL"
else
    echo "Failed to upload logs automatically."
    echo "You can manually send me the file: $DIR/$LOG_FILE"
fi
