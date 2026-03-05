#!/usr/bin/env bash
# rubix-orchestra.sh — Autonomous multi-instance orchestration via tmux
# Usage: rubix-orchestra.sh start [N] | stop | status | attach | list

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
SESSION="rubix"
DATA_DIR="${RUBIX_DATA_DIR:-$PROJECT_ROOT/data}"
COMMS_DB="$DATA_DIR/comms.db"
REGISTRY_FILE="$DATA_DIR/orchestra-registry.json"
STARTUP_DELAY=8

# Instance names — cycle every 5
NAMES=(Forge Axis Trace Loom Spark)

get_instance_name() {
  local idx=$1
  local cycle=$(( (idx - 1) / 5 ))
  local pos=$(( (idx - 1) % 5 ))
  local name="${NAMES[$pos]}"
  if [ "$cycle" -gt 0 ]; then
    echo "${name}$((cycle + 1))"
  else
    echo "$name"
  fi
}

get_instance_role() {
  local idx=$1
  if [ "$idx" -eq 1 ]; then
    echo "orchestrator"
  else
    echo "worker"
  fi
}

build_identity_prompt() {
  local idx=$1
  local name=$2
  local role=$3

  if [ "$role" = "orchestrator" ]; then
    cat <<PROMPT
instance_${idx} ${name} orchestrator
god_comms_heartbeat instanceId:"instance_${idx}" name:"${name}" role:"orchestrator"
/recall
Split tasks→god_comms_send workers. Synthesize responses. Escalate only if blocked.
PROMPT
  else
    cat <<PROMPT
instance_${idx} ${name} worker
god_comms_heartbeat instanceId:"instance_${idx}" name:"${name}" role:"worker"
/recall
Execute tasks from monitor. god_comms_send(to:"instance_1" type:"response") when done.
PROMPT
  fi
}

wait_for_ready() {
  local count=$1
  local timeout=120  # 2 minutes max
  local elapsed=0

  echo "Waiting for instances to register heartbeats..."
  while [ "$elapsed" -lt "$timeout" ]; do
    local ready
    ready=$(sqlite3 "$COMMS_DB" "
      SELECT COUNT(*) FROM instances
      WHERE julianday('now') - julianday(last_heartbeat) < 0.007;
    " 2>/dev/null || echo 0)

    if [ "$ready" -ge "$count" ]; then
      echo "All $count instances ready!"
      return 0
    fi

    echo "  $ready/$count ready... (${elapsed}s)"
    sleep 5
    elapsed=$((elapsed + 5))
  done

  echo "WARNING: Only $ready/$count instances registered after ${timeout}s"
  return 1
}

write_registry() {
  local count=$1
  local json='{'
  json+='"session":"'"$SESSION"'",'
  json+='"created":"'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'",'
  json+='"instances":{'

  for i in $(seq 1 "$count"); do
    local name
    name=$(get_instance_name "$i")
    local role
    role=$(get_instance_role "$i")
    local pane=$((i - 1))
    [ "$i" -gt 1 ] && json+=','
    json+='"instance_'"$i"'":{"name":"'"$name"'","role":"'"$role"'","pane":'"$pane"'}'
  done

  json+='},'
  json+='"monitorPane":'"$count"
  json+='}'

  echo "$json" > "$REGISTRY_FILE"
}

cmd_start() {
  local count="${1:-3}"

  if [ "$count" -lt 1 ]; then
    echo "Need at least 1 instance."
    exit 1
  fi

  # Kill existing session if present
  if tmux has-session -t "$SESSION" 2>/dev/null; then
    echo "Session '$SESSION' already exists. Stop it first: $0 stop"
    exit 1
  fi

  echo "Starting Rubix Orchestra with $count instance(s) + monitor..."
  mkdir -p "$DATA_DIR"

  # Create session with first pane (instance 1)
  tmux new-session -d -s "$SESSION" -x 220 -y 50

  # Create additional instance panes
  for i in $(seq 2 "$count"); do
    tmux split-window -t "$SESSION" -h
    tmux select-layout -t "$SESSION" tiled
  done

  # Create monitor pane
  tmux split-window -t "$SESSION" -h
  tmux select-layout -t "$SESSION" tiled

  # Write registry before launching anything
  write_registry "$count"

  # Launch Claude in each instance pane (staggered)
  for i in $(seq 1 "$count"); do
    local pane=$((i - 1))
    local name
    name=$(get_instance_name "$i")
    local role
    role=$(get_instance_role "$i")

    echo "  Starting instance_$i ($name, $role) in pane $pane..."

    # Set pane title
    tmux select-pane -t "$SESSION:0.$pane" -T "instance_$i ($name)"

    # Launch claude (unset CLAUDECODE to allow nested sessions from within Claude Code)
    tmux send-keys -t "$SESSION:0.$pane" "unset CLAUDECODE && claude" Enter

    # Staggered startup to avoid API rate limits
    if [ "$i" -lt "$count" ]; then
      sleep "$STARTUP_DELAY"
    fi
  done

  # Wait for last Claude to initialize
  sleep "$STARTUP_DELAY"

  # Inject identity prompts — atomic via load-buffer + paste-buffer
  for i in $(seq 1 "$count"); do
    local pane=$((i - 1))
    local name
    name=$(get_instance_name "$i")
    local role
    role=$(get_instance_role "$i")

    echo "  Injecting identity for instance_$i ($name)..."

    local prompt
    prompt=$(build_identity_prompt "$i" "$name" "$role")

    # Atomic injection: entire prompt pasted as one block, then submitted with single Enter
    local tmpfile
    tmpfile=$(mktemp)
    printf '%s' "$prompt" > "$tmpfile"

    local buffer_name="identity_${i}"
    tmux load-buffer -b "$buffer_name" "$tmpfile"
    tmux paste-buffer -b "$buffer_name" -t "$SESSION:0.$pane"
    tmux delete-buffer -b "$buffer_name" 2>/dev/null || true
    tmux send-keys -t "$SESSION:0.$pane" Enter

    rm -f "$tmpfile"

    # Small delay between identity injections
    sleep 2
  done

  # Launch monitor in last pane
  local monitor_pane=$count
  echo "  Starting monitor in pane $monitor_pane..."
  tmux send-keys -t "$SESSION:0.$monitor_pane" \
    "bash $SCRIPT_DIR/rubix-monitor.sh" Enter

  # Wait for instances to register heartbeats
  wait_for_ready "$count" || true

  echo ""
  echo "Rubix Orchestra started!"
  echo "  Instances: $count"
  echo "  Session: $SESSION"
  echo "  Registry: $REGISTRY_FILE"
  echo ""
  echo "Attach with: $0 attach"
  echo "Status with: $0 status"
}

cmd_stop() {
  if ! tmux has-session -t "$SESSION" 2>/dev/null; then
    echo "No '$SESSION' session running."
    exit 0
  fi

  echo "Stopping Rubix Orchestra..."
  tmux kill-session -t "$SESSION"
  rm -f "$REGISTRY_FILE"
  echo "Stopped."
}

cmd_status() {
  if ! tmux has-session -t "$SESSION" 2>/dev/null; then
    echo "No '$SESSION' session running."
    exit 1
  fi

  echo "═══ RUBIX ORCHESTRA STATUS ═══════════════════════"
  echo ""

  # Show pane info
  tmux list-panes -t "$SESSION" -F "  Pane #{pane_index}: #{pane_title} (#{pane_width}x#{pane_height}) #{?pane_active,*,}" 2>/dev/null || true

  echo ""

  # Query comms.db for instance heartbeats
  if [ -f "$COMMS_DB" ]; then
    echo "Instances (from comms.db):"
    sqlite3 -header -column "$COMMS_DB" "
      SELECT
        instance_id,
        COALESCE(name, '?') AS name,
        COALESCE(role, '?') AS role,
        status,
        CAST((julianday('now') - julianday(last_heartbeat)) * 86400 AS INTEGER) || 's ago' AS heartbeat
      FROM instances
      ORDER BY instance_id;
    " 2>/dev/null || echo "  (no instances registered yet)"

    echo ""
    echo "Message queue:"
    sqlite3 -header -column "$COMMS_DB" "
      SELECT status, COUNT(*) AS count
      FROM messages
      GROUP BY status;
    " 2>/dev/null || echo "  (no messages)"
  else
    echo "  comms.db not found at $COMMS_DB"
  fi

  echo ""
  echo "═══════════════════════════════════════════════════"
}

cmd_attach() {
  if ! tmux has-session -t "$SESSION" 2>/dev/null; then
    echo "No '$SESSION' session running. Start first: $0 start [N]"
    exit 1
  fi
  tmux attach-session -t "$SESSION"
}

cmd_list() {
  if ! tmux has-session -t "$SESSION" 2>/dev/null; then
    echo "No '$SESSION' session running."
    exit 1
  fi
  tmux list-panes -t "$SESSION" -F \
    "Pane #{pane_index}: #{pane_title} | #{pane_current_command} | #{pane_width}x#{pane_height}"
}

# --- Main ---
case "${1:-help}" in
  start)
    cmd_start "${2:-3}"
    ;;
  stop)
    cmd_stop
    ;;
  status)
    cmd_status
    ;;
  attach)
    cmd_attach
    ;;
  list)
    cmd_list
    ;;
  help|--help|-h)
    echo "Usage: $0 {start [N]|stop|status|attach|list}"
    echo ""
    echo "Commands:"
    echo "  start [N]  Launch N instances + monitor (default: 3)"
    echo "  stop       Kill tmux session"
    echo "  status     Show heartbeats + message queue"
    echo "  attach     Reattach to tmux session"
    echo "  list       List panes"
    ;;
  *)
    echo "Unknown command: $1"
    echo "Usage: $0 {start [N]|stop|status|attach|list}"
    exit 1
    ;;
esac
