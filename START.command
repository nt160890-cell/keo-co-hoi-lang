#!/usr/bin/env bash
# macOS: double-click in Finder to start the game (runs start.sh in Terminal).
# First time: right-click > Open, or run once: chmod +x START.command start.sh
exec bash "$(dirname "$0")/start.sh"
