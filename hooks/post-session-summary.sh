#!/usr/bin/env bash
# Agent Replay — Smart post-session hook
# Only alerts when something noteworthy happens.
#
# Installation:
#   agent-replay install-hook
#
# Or manually add to ~/.claude/settings.json:
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

set -uo pipefail

CLAUDE_DIR="${HOME}/.claude/projects"
CONFIG_FILE="${HOME}/.agent-replay/hook-config.json"

# Thresholds (can be overridden in config)
COST_THRESHOLD="1.00"
ERROR_RATE_THRESHOLD="20"
LOOP_THRESHOLD="3"

# Load custom thresholds if config exists
if [ -f "$CONFIG_FILE" ]; then
  COST_THRESHOLD=$(python3 -c "import json;print(json.load(open('$CONFIG_FILE')).get('costThreshold', '$COST_THRESHOLD'))" 2>/dev/null || echo "$COST_THRESHOLD")
  ERROR_RATE_THRESHOLD=$(python3 -c "import json;print(json.load(open('$CONFIG_FILE')).get('errorRateThreshold', '$ERROR_RATE_THRESHOLD'))" 2>/dev/null || echo "$ERROR_RATE_THRESHOLD")
  LOOP_THRESHOLD=$(python3 -c "import json;print(json.load(open('$CONFIG_FILE')).get('loopThreshold', '$LOOP_THRESHOLD'))" 2>/dev/null || echo "$LOOP_THRESHOLD")
fi

# Find latest session
LATEST_FILE=$(find "$CLAUDE_DIR" -name "*.jsonl" -type f -print0 2>/dev/null | xargs -0 ls -t 2>/dev/null | head -1)
[ -z "${LATEST_FILE:-}" ] && exit 0

LINES=$(wc -l < "$LATEST_FILE" | tr -d ' ')
[ "$LINES" -lt 2 ] && exit 0

# Parse stats
TOOL_CALLS=$(grep -c '"type":"tool_use"' "$LATEST_FILE" 2>/dev/null || echo "0")
ERRORS=$(grep -c '"is_error":true' "$LATEST_FILE" 2>/dev/null || echo "0")

# macOS uses -oE instead of -oP (no PCRE in BSD grep)
HAS_PCRE=false
echo "" | grep -oP '.' >/dev/null 2>&1 && HAS_PCRE=true
if [ "$HAS_PCRE" = "true" ]; then
  # GNU grep available
  INPUT_TOKENS=$(grep -oP '"input_tokens":\s*\K\d+' "$LATEST_FILE" 2>/dev/null | awk '{s+=$1}END{print s+0}')
  OUTPUT_TOKENS=$(grep -oP '"output_tokens":\s*\K\d+' "$LATEST_FILE" 2>/dev/null | awk '{s+=$1}END{print s+0}')
  CACHE_TOKENS=$(grep -oP '"cache_read_input_tokens":\s*\K\d+' "$LATEST_FILE" 2>/dev/null | awk '{s+=$1}END{print s+0}')
  MODEL=$(grep -oP '"model":\s*"\K[^"]+' "$LATEST_FILE" 2>/dev/null | head -1 || echo "")
  LOOP_FILES=$(grep -oP '"file_path":\s*"\K[^"]+' "$LATEST_FILE" 2>/dev/null | sort | uniq -c | sort -rn | awk -v t="$LOOP_THRESHOLD" '$1 >= t {print $2}' | head -3)
else
  # macOS / BSD grep fallback using sed
  INPUT_TOKENS=$(grep -o '"input_tokens":[[:space:]]*[0-9]*' "$LATEST_FILE" 2>/dev/null | sed 's/.*: *//' | awk '{s+=$1}END{print s+0}')
  OUTPUT_TOKENS=$(grep -o '"output_tokens":[[:space:]]*[0-9]*' "$LATEST_FILE" 2>/dev/null | sed 's/.*: *//' | awk '{s+=$1}END{print s+0}')
  CACHE_TOKENS=$(grep -o '"cache_read_input_tokens":[[:space:]]*[0-9]*' "$LATEST_FILE" 2>/dev/null | sed 's/.*: *//' | awk '{s+=$1}END{print s+0}')
  MODEL=$(grep -o '"model":"[^"]*"' "$LATEST_FILE" 2>/dev/null | head -1 | sed 's/"model":"//;s/"//' || echo "")
  LOOP_FILES=$(grep -o '"file_path":"[^"]*"' "$LATEST_FILE" 2>/dev/null | sed 's/"file_path":"//;s/"//' | sort | uniq -c | sort -rn | awk -v t="$LOOP_THRESHOLD" '$1 >= t {print $2}' | head -3)
fi

# Detect model for pricing
if echo "$MODEL" | grep -q "opus"; then
  INPUT_PRICE=15; OUTPUT_PRICE=75; CACHE_PRICE="1.5"
elif echo "$MODEL" | grep -q "haiku"; then
  INPUT_PRICE="0.8"; OUTPUT_PRICE=4; CACHE_PRICE="0.08"
else
  INPUT_PRICE=3; OUTPUT_PRICE=15; CACHE_PRICE="0.3"
fi

COST=$(echo "scale=2; ($INPUT_TOKENS * $INPUT_PRICE + $OUTPUT_TOKENS * $OUTPUT_PRICE + $CACHE_TOKENS * $CACHE_PRICE) / 1000000" | bc 2>/dev/null || echo "0")

# Calculate error rate
ERROR_RATE=0
if [ "$TOOL_CALLS" -gt 0 ]; then
  ERROR_RATE=$(echo "scale=0; $ERRORS * 100 / $TOOL_CALLS" | bc 2>/dev/null || echo "0")
fi

# Determine if noteworthy
ALERTS=""
ALERT_LEVEL="info"

COST_EXCEEDED=$(echo "$COST > $COST_THRESHOLD" | bc -l 2>/dev/null || echo "0")
if [ "${COST_EXCEEDED:-0}" = "1" ]; then
  ALERTS="${ALERTS}Cost: \$${COST} (threshold: \$${COST_THRESHOLD})\n"
  ALERT_LEVEL="warning"
fi

if [ "$ERROR_RATE" -gt "$ERROR_RATE_THRESHOLD" ]; then
  ALERTS="${ALERTS}Error rate: ${ERROR_RATE}% (${ERRORS}/${TOOL_CALLS} tools)\n"
  ALERT_LEVEL="warning"
fi

if [ -n "${LOOP_FILES:-}" ]; then
  LOOP_COUNT=$(echo "$LOOP_FILES" | wc -l | tr -d ' ')
  ALERTS="${ALERTS}Edit loops on ${LOOP_COUNT} file(s)\n"
  ALERT_LEVEL="warning"
fi

# One-line summary always
SESSION_ID=$(basename "$LATEST_FILE" .jsonl)
SHORT_ID="${SESSION_ID:0:8}"
echo "  ar: ${TOOL_CALLS} tools, ${ERRORS} err, \$${COST} ${SHORT_ID}"

# Only notify if something noteworthy
if [ -n "$ALERTS" ]; then
  TITLE="Agent Replay"
  BODY=$(printf '%b' "$ALERTS" | head -3)

  # macOS notification
  if command -v osascript &>/dev/null; then
    # Escape double quotes for AppleScript
    SAFE_BODY=$(echo "$BODY" | tr '\n' ' ' | sed 's/"/\\"/g')
    osascript -e "display notification \"${SAFE_BODY}\" with title \"${TITLE}\" subtitle \"Session ${SHORT_ID}\""
  # Linux notification
  elif command -v notify-send &>/dev/null; then
    notify-send "${TITLE}" "Session ${SHORT_ID}\n${BODY}"
  fi

  echo ""
  printf '  %b\n' "$ALERTS"
  echo "  -> npx agent-replay last"
  echo ""
fi
