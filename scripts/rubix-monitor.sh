#!/usr/bin/env bash
# rubix-monitor.sh — Bridges comms.db ↔ tmux panes for Rubix Orchestra
# Polls for undelivered messages, routes them to the correct tmux pane,
# and displays a live dashboard.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
DATA_DIR="${RUBIX_DATA_DIR:-$PROJECT_ROOT/data}"
COMMS_DB="$DATA_DIR/comms.db"
REGISTRY_FILE="$DATA_DIR/orchestra-registry.json"
DELIVERED_FILE="$DATA_DIR/monitor-delivered.txt"
POLL_INTERVAL=3
REGISTRY_REFRESH=30
MAX_DELIVER_PER_CYCLE=5
SESSION="rubix"
START_TIME=$(date +%s)

# --- Pane mapping ---
declare -A PANE_MAP
LAST_REGISTRY_LOAD=0

load_registry() {
  PANE_MAP=()

  # Try registry file first (written by rubix-orchestra.sh)
  if [ -f "$REGISTRY_FILE" ]; then
    # Parse JSON with python3 (universally available)
    local mapping
    mapping=$(python3 -c "
import json, sys
with open('$REGISTRY_FILE') as f:
    reg = json.load(f)
for iid, info in reg.get('instances', {}).items():
    print(f'{iid}={info[\"pane\"]}')
" 2>/dev/null) || true

    if [ -n "$mapping" ]; then
      while IFS='=' read -r iid pane; do
        PANE_MAP["$iid"]="$pane"
      done <<< "$mapping"
      LAST_REGISTRY_LOAD=$(date +%s)
      return
    fi
  fi

  # Fallback: query comms.db instances table and assign panes by order
  if [ -f "$COMMS_DB" ]; then
    local idx=0
    while IFS='|' read -r instance_id _name _role; do
      PANE_MAP["$instance_id"]="$idx"
      idx=$((idx + 1))
    done < <(sqlite3 "$COMMS_DB" "
      SELECT instance_id, name, role
      FROM instances
      WHERE status != 'offline'
      ORDER BY instance_id;
    " 2>/dev/null)
    LAST_REGISTRY_LOAD=$(date +%s)
  fi
}

get_pane_for_instance() {
  local instance_id="$1"
  echo "${PANE_MAP[$instance_id]:-}"
}

# --- Delivery tracking ---
declare -A DELIVERED

load_delivered() {
  DELIVERED=()
  if [ -f "$DELIVERED_FILE" ]; then
    local cutoff
    cutoff=$(date -d '1 hour ago' +%s 2>/dev/null || date -v-1H +%s 2>/dev/null || echo 0)

    while IFS='|' read -r msg_id ts; do
      if [ "${ts:-0}" -ge "$cutoff" ]; then
        DELIVERED["$msg_id"]=1
      fi
    done < "$DELIVERED_FILE"
  fi
}

mark_delivered() {
  local msg_id="$1"
  DELIVERED["$msg_id"]=1
  echo "${msg_id}|$(date +%s)" >> "$DELIVERED_FILE"
}

cleanup_delivered() {
  if [ ! -f "$DELIVERED_FILE" ]; then return; fi
  local cutoff
  cutoff=$(date -d '1 hour ago' +%s 2>/dev/null || date -v-1H +%s 2>/dev/null || echo 0)

  local tmpfile
  tmpfile=$(mktemp)
  while IFS='|' read -r msg_id ts; do
    if [ "${ts:-0}" -ge "$cutoff" ]; then
      echo "${msg_id}|${ts}" >> "$tmpfile"
    fi
  done < "$DELIVERED_FILE"
  mv "$tmpfile" "$DELIVERED_FILE"
}

# --- Message formatting ---
format_message() {
  local from_instance="$1"
  local to_instance="$2"
  local msg_type="$3"
  local subject="$4"
  local payload="$5"

  case "$msg_type" in
    task)
      local task_text
      task_text=$(echo "$payload" | python3 -c "
import json, sys
p = json.loads(sys.stdin.read())
print(p.get('task', p.get('description', json.dumps(p))))
" 2>/dev/null || echo "$payload")

      cat <<EOF
[ORCHESTRA] Task from ${from_instance}: ${subject}

${task_text}

Execute this task and report results via god_comms_send(to: "${from_instance}", type: "response", subject: "Done: ${subject}", payload: { result: "<your summary>", filesChanged: [] }).
EOF
      ;;
    response)
      local result_text
      result_text=$(echo "$payload" | python3 -c "
import json, sys
p = json.loads(sys.stdin.read())
result = p.get('result', '')
files = p.get('filesChanged', [])
out = result
if files:
    out += '\n\nFiles changed: ' + ', '.join(files)
print(out)
" 2>/dev/null || echo "$payload")

      cat <<EOF
[ORCHESTRA] Response from ${from_instance}: ${subject}

${result_text}
EOF
      ;;
    question)
      local question_text
      question_text=$(echo "$payload" | python3 -c "
import json, sys
p = json.loads(sys.stdin.read())
print(p.get('question', p.get('message', json.dumps(p))))
" 2>/dev/null || echo "$payload")

      cat <<EOF
[ORCHESTRA] Question from ${from_instance}: ${subject}

${question_text}

Reply via god_comms_send(to: "${from_instance}", type: "response", subject: "Re: ${subject}", payload: { answer: "<your answer>" }).
EOF
      ;;
    status)
      # Status messages go to dashboard, not injected into panes
      return 1
      ;;
    *)
      cat <<EOF
[ORCHESTRA] ${msg_type} from ${from_instance}: ${subject}

${payload}
EOF
      ;;
  esac
}

deliver_to_pane() {
  local pane="$1"
  local message="$2"

  # Check pane exists
  if ! tmux list-panes -t "$SESSION:0" -F "#{pane_index}" 2>/dev/null | grep -qx "$pane"; then
    return 1
  fi

  # Atomic injection: load-buffer + paste-buffer sends entire message as one block
  local tmpfile
  tmpfile=$(mktemp)
  printf '%s' "$message" > "$tmpfile"

  local buffer_name="msg_$(date +%s%N)"
  tmux load-buffer -b "$buffer_name" "$tmpfile"
  tmux paste-buffer -b "$buffer_name" -t "$SESSION:0.$pane"
  tmux delete-buffer -b "$buffer_name" 2>/dev/null || true
  tmux send-keys -t "$SESSION:0.$pane" Enter

  rm -f "$tmpfile"
  return 0
}

# --- Dashboard ---
update_dashboard() {
  local now
  now=$(date +%s)
  local uptime=$(( now - START_TIME ))
  local uptime_min=$(( uptime / 60 ))
  local uptime_sec=$(( uptime % 60 ))

  clear

  echo "═══ RUBIX ORCHESTRA ═══════════════════════════════════"
  echo ""

  # Instance status
  local instance_count=0
  if [ -f "$COMMS_DB" ]; then
    while IFS='|' read -r iid iname irole istatus iheartbeat; do
      local hb_ago="?"
      if [ -n "$iheartbeat" ]; then
        local hb_ts
        hb_ts=$(date -d "$iheartbeat" +%s 2>/dev/null || echo 0)
        if [ "$hb_ts" -gt 0 ]; then
          hb_ago="$(( now - hb_ts ))s ago"
        fi
      fi

      local status_icon="●"
      case "$istatus" in
        active) status_icon="● active" ;;
        idle)   status_icon="○ idle" ;;
        busy)   status_icon="◉ busy" ;;
        *)      status_icon="✗ offline" ;;
      esac

      local pane="${PANE_MAP[$iid]:-?}"
      printf "  %-8s (%-12s) pane:%-2s %s  heartbeat: %s\n" \
        "${iname:-$iid}" "$irole" "$pane" "$status_icon" "$hb_ago"
      instance_count=$((instance_count + 1))
    done < <(sqlite3 "$COMMS_DB" "
      SELECT instance_id, name, role, status, last_heartbeat
      FROM instances
      ORDER BY instance_id;
    " 2>/dev/null)
  fi

  if [ "$instance_count" -eq 0 ]; then
    echo "  (no instances registered yet)"
  fi

  echo ""

  # Message stats
  local total_delivered=${#DELIVERED[@]}
  local pending=0
  local failed=0

  if [ -f "$COMMS_DB" ]; then
    pending=$(sqlite3 "$COMMS_DB" "
      SELECT COUNT(*) FROM messages WHERE status = 'unread';
    " 2>/dev/null || echo 0)
  fi

  printf "Instances: %d | Uptime: %dm%02ds | Poll: %ds\n" \
    "$instance_count" "$uptime_min" "$uptime_sec" "$POLL_INTERVAL"
  printf "Queue: %s pending | Delivered: %s | Failed: %s\n" \
    "$pending" "$total_delivered" "$failed"
  echo ""
  echo "═══════════════════════════════════════════════════════"
  echo ""
  echo "$(date '+%H:%M:%S') Monitoring $COMMS_DB ..."
}

# --- Main loop ---
main() {
  echo "Rubix Monitor starting..."

  # Wait for comms.db — MCP may not have initialized it yet
  if [ ! -f "$COMMS_DB" ]; then
    echo "Waiting for comms.db..."
    local wait=0
    while [ ! -f "$COMMS_DB" ] && [ "$wait" -lt 60 ]; do
      sleep 2
      wait=$((wait + 2))
    done
    if [ ! -f "$COMMS_DB" ]; then
      echo "ERROR: comms.db not found after 60s at $COMMS_DB"
      exit 1
    fi
    echo "comms.db found after ${wait}s."
  fi

  # Mark stale unread messages from previous sessions as expired
  local stale_count
  stale_count=$(sqlite3 "$COMMS_DB" "
    UPDATE messages SET status = 'expired'
    WHERE status = 'unread'
      AND datetime(created_at) < datetime('now', '-24 hours');
    SELECT changes();
  " 2>/dev/null || echo 0)
  if [ "$stale_count" -gt 0 ]; then
    echo "Expired $stale_count stale unread message(s) from previous sessions."
  fi

  # Verify tmux session
  if ! tmux has-session -t "$SESSION" 2>/dev/null; then
    echo "ERROR: tmux session '$SESSION' not found."
    echo "Start with: rubix-orchestra.sh start"
    exit 1
  fi

  load_registry
  load_delivered

  local cycle=0

  while true; do
    # Refresh registry periodically
    local now_ts
    now_ts=$(date +%s)
    if (( now_ts - LAST_REGISTRY_LOAD > REGISTRY_REFRESH )); then
      load_registry
    fi

    # Cleanup delivered tracking every 100 cycles
    if (( cycle % 100 == 0 && cycle > 0 )); then
      cleanup_delivered
    fi

    # Query undelivered direct messages
    local delivered_count=0
    if [ -f "$COMMS_DB" ]; then
      while IFS='|' read -r msg_id from_inst to_inst msg_type msg_subject msg_payload; do
        [ -z "$msg_id" ] && continue

        # Skip if already delivered
        [ "${DELIVERED[$msg_id]:-}" = "1" ] && continue

        # Skip self-sends
        [ "$from_inst" = "$to_inst" ] && continue

        # Find target pane
        local target_pane
        target_pane=$(get_pane_for_instance "$to_inst")

        if [ -z "$target_pane" ]; then
          echo "$(date '+%H:%M:%S') WARN: No pane for $to_inst (msg: $msg_id)"
          continue
        fi

        # Format message
        local formatted
        formatted=$(format_message "$from_inst" "$to_inst" "$msg_type" "$msg_subject" "$msg_payload") || continue

        # Deliver
        if deliver_to_pane "$target_pane" "$formatted"; then
          mark_delivered "$msg_id"
          delivered_count=$((delivered_count + 1))
          echo "$(date '+%H:%M:%S') Delivered $msg_type from $from_inst → $to_inst (pane $target_pane)"
        else
          echo "$(date '+%H:%M:%S') FAIL: Could not deliver to pane $target_pane ($to_inst)"
        fi

        # Rate limit
        if [ "$delivered_count" -ge "$MAX_DELIVER_PER_CYCLE" ]; then
          break
        fi
      done < <(sqlite3 "$COMMS_DB" "
        SELECT id, from_instance, to_instance, type,
               COALESCE(subject, ''), payload
        FROM messages
        WHERE status = 'unread'
          AND to_instance IS NOT NULL
        ORDER BY priority DESC, created_at ASC
        LIMIT $((MAX_DELIVER_PER_CYCLE * 2));
      " 2>/dev/null)

      # Also check broadcasts that haven't been delivered
      while IFS='|' read -r msg_id from_inst msg_type msg_subject msg_payload; do
        [ -z "$msg_id" ] && continue
        [ "${DELIVERED[$msg_id]:-}" = "1" ] && continue

        # Deliver broadcast to all panes except sender
        for iid in "${!PANE_MAP[@]}"; do
          [ "$iid" = "$from_inst" ] && continue

          local bc_key="${msg_id}_${iid}"
          [ "${DELIVERED[$bc_key]:-}" = "1" ] && continue

          local target_pane
          target_pane=$(get_pane_for_instance "$iid")
          [ -z "$target_pane" ] && continue

          # Only deliver task/question/response broadcasts, skip status
          case "$msg_type" in
            task|question|response|notification|handoff)
              local formatted
              formatted=$(format_message "$from_inst" "$iid" "$msg_type" "$msg_subject" "$msg_payload") || continue
              if deliver_to_pane "$target_pane" "$formatted"; then
                mark_delivered "$bc_key"
                echo "$(date '+%H:%M:%S') Broadcast $msg_type from $from_inst → $iid (pane $target_pane)"
              fi
              ;;
          esac
        done

        mark_delivered "$msg_id"
        delivered_count=$((delivered_count + 1))

        if [ "$delivered_count" -ge "$MAX_DELIVER_PER_CYCLE" ]; then
          break
        fi
      done < <(sqlite3 "$COMMS_DB" "
        SELECT id, from_instance, type, COALESCE(subject, ''), payload
        FROM messages
        WHERE status = 'unread'
          AND to_instance IS NULL
        ORDER BY priority DESC, created_at ASC
        LIMIT $((MAX_DELIVER_PER_CYCLE));
      " 2>/dev/null)
    fi

    update_dashboard
    cycle=$((cycle + 1))
    sleep "$POLL_INTERVAL"
  done
}

main "$@"
