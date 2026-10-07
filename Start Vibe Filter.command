#!/bin/bash
# Starts Vibe Filter from this folder (wherever it lives) and opens it in the browser.
cd "$(dirname "$0")" || exit 1
echo "Starting Vibe Filter..."
node server.js &
pid=$!
for _ in 1 2 3 4 5 6 7 8 9 10; do
  curl -sf -o /dev/null "http://127.0.0.1:4747/" && break
  sleep 0.2
done
open "http://127.0.0.1:4747"
echo "Vibe Filter is open in your browser. Close this window to stop it."
wait "$pid"
