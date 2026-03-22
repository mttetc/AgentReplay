#!/usr/bin/env bash
# Agent Replay — Post-session summary hook for Claude Code
#
# Prints a quick cost/stats summary after each Claude Code session ends.
#
# Installation:
#   Add to your ~/.claude/settings.json:
#   {
#     "hooks": {
#       "Stop": [{
#         "matcher": "",
#         "hooks": [{
#           "type": "command",
#           "command": "/path/to/agent-replay/hooks/post-session-summary.sh"
#         }]
#       }]
#     }
#   }
#
# Or install via agent-replay CLI:
#   agent-replay install-hook

set -euo pipefail

CLAUDE_DIR="${HOME}/.claude/projects"

# Find the most recently modified .jsonl file
LATEST_FILE=$(find "$CLAUDE_DIR" -name "*.jsonl" -type f -print0 2>/dev/null | xargs -0 ls -t 2>/dev/null | head -1)

if [ -z "$LATEST_FILE" ]; then
  exit 0
fi

# Quick parse: count lines, extract basic stats
LINES=$(wc -l < "$LATEST_FILE" | tr -d ' ')
if [ "$LINES" -lt 2 ]; then
  exit 0
fi

# Extract stats using lightweight parsing
TOOL_CALLS=$(grep -c '"type":"tool_use"' "$LATEST_FILE" 2>/dev/null || echo "0")
ERRORS=$(grep -c '"is_error":true' "$LATEST_FILE" 2>/dev/null || echo "0")
INPUT_TOKENS=$(grep -oP '"input_tokens":\s*\K\d+' "$LATEST_FILE" 2>/dev/null | awk '{s+=$1}END{print s+0}')
OUTPUT_TOKENS=$(grep -oP '"output_tokens":\s*\K\d+' "$LATEST_FILE" 2>/dev/null | awk '{s+=$1}END{print s+0}')

# Estimate cost (using Sonnet pricing as default: $3/$15 per M tokens)
COST=$(echo "scale=2; ($INPUT_TOKENS * 3 + $OUTPUT_TOKENS * 15) / 1000000" | bc 2>/dev/null || echo "?")

# Print summary
echo ""
echo "  --- Agent Replay Summary ---"
echo "  Tools: ${TOOL_CALLS} calls | Errors: ${ERRORS}"
echo "  Tokens: ${INPUT_TOKENS} in / ${OUTPUT_TOKENS} out"
echo "  Est. cost: \$${COST}"
if [ "$ERRORS" -gt 0 ]; then
  echo "  Run 'npx agent-replay last' to inspect errors"
fi
echo ""
