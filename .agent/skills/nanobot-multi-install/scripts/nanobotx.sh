#!/usr/bin/env bash
# nanobotx - multi-instance manager for nanobot on Linux
# Depends on: NANOBOT_APP env var pointing to the venv install root.

set -euo pipefail

NANOBOT_BIN="${NANOBOT_APP:-$HOME/nanobot-app}/app/bin/nanobot"
INSTANCES_ROOT="${NANOBOT_INSTANCES:-${NANOBOT_APP:-$HOME/nanobot-app}/instances}"
REGISTRY="${NANOBOT_APP:-$HOME/nanobot-app}/instances.json"
LOG_DIR="${NANOBOT_APP:-$HOME/nanobot-app}/logs"
GATEWAY_PORT_BASE=18790            # 18791 起作为 WebUI 端口 (websocket)
API_PORT_BASE=8900                 # 8901 起作为 API 端口
HEALTH_PORT_OFFSET=10000           # gateway health server 端口 = webui_port + 10000, 避免与 websocket 端口冲突

mkdir -p "$INSTANCES_ROOT" "$LOG_DIR"

# ---------- helpers ----------
reg_init() {
  if ! jq empty "$REGISTRY" 2>/dev/null; then
    echo '{"instances": []}' > "$REGISTRY"
  fi
}
reg_read() { jq '.instances // []' "$REGISTRY" 2>/dev/null || echo "[]"; }
reg_write() {
  local val="${1:-[]}"
  echo "{\"instances\": $val}" > "$REGISTRY"
}
reg_init

port_taken() {
  local p=$1
  ss -tuln 2>/dev/null | awk '{print $5}' | grep -Eq ":${p}\$"
}

find_free_port() {
  # $1 = base, $2 = used_ports csv
  local base=$1 used=$2 p
  p=$((base + 1))
  while port_taken "$p" || echo ",$used," | grep -Eq ",${p},"; do
    p=$((p + 1))
  done
  echo "$p"
}

instance_exists() {
  reg_read | jq -e --arg n "$1" 'map(.name) | index($n)' >/dev/null
}

next_gateway_port() {
  local used; used=$(reg_read | jq -r '.[].gateway_port' | paste -sd, -)
  find_free_port "$GATEWAY_PORT_BASE" "$used"
}

next_api_port() {
  local used; used=$(reg_read | jq -r '.[].api_port' | paste -sd, -)
  find_free_port "$API_PORT_BASE" "$used"
}

gen_token() {
  python3 -c "import uuid; print(uuid.uuid4())" 2>/dev/null || uuidgen 2>/dev/null || echo "nanobot-$(date +%s)-$RANDOM"
}

# ---------- commands ----------
cmd_create() {
  local name="${1:-}"
  if [[ -z "$name" ]]; then
    read -rp "Instance name (e.g. <your_name> / work): " name
  fi
  [[ -n "$name" ]] || { echo "ERROR: name required"; exit 1; }
  if instance_exists "$name"; then
    echo "ERROR: instance '$name' already exists"; exit 1
  fi

  local gw_port api_port health_port token
  gw_port=$(next_gateway_port)
  api_port=$(next_api_port)
  health_port=$((gw_port + HEALTH_PORT_OFFSET))
  token=$(gen_token)

  local base="$INSTANCES_ROOT/$name"
  mkdir -p "$base/workspace"

  echo "[create] onboarding '$name' (webui=$gw_port, api=$api_port, health=$health_port)..."
  "$NANOBOT_BIN" onboard \
    -c "$base/config.json" \
    -w "$base/workspace" \
    >/dev/null

  # Patch ports, bind 0.0.0.0 for external access, placeholder API key,
  # and configure websocket channel with a random token to pass security validation.
  # gateway.port is moved to a separate port (health-only) to avoid conflicting
  # with the websocket channel which serves the actual Web UI on the same port.
  tmp=$(mktemp)
  jq \
    --arg name "$name" \
    --arg gw "$gw_port" \
    --arg api "$api_port" \
    --arg health "$health_port" \
    --arg token "$token" \
    '.agents.defaults.botName = $name
     | .gateway.port = ($health|tonumber)
     | .gateway.host = "0.0.0.0"
     | .api.port = ($api|tonumber)
     | .api.host = "0.0.0.0"
     | .providers.anthropic.apiKey = "sk-placeholder-change-in-webui"
     | .channels.websocket.enabled = true
     | .channels.websocket.host = "0.0.0.0"
     | .channels.websocket.port = ($gw|tonumber)
     | .channels.websocket.token = $token' \
    "$base/config.json" > "$tmp" && mv "$tmp" "$base/config.json"

  # Register
  local entry; entry=$(jq -n \
    --arg name "$name" \
    --arg cfg "$base/config.json" \
    --argjson gw "$gw_port" \
    --argjson api "$api_port" \
    --arg token "$token" \
    '{name:$name, config:$cfg, gateway_port:$gw, api_port:$api, token:$token, pid:null}')
  reg_write "$(reg_read | jq --argjson e "$entry" '. + [$e]')"

  echo "[create] starting '$name'..."
  cmd_start_one "$name" || true
  cmd_status "$name"
}

all_names() {
  reg_read | jq -r '.[].name'
}

cmd_start() {
  local name="${1:-}"
  if [[ -z "$name" ]]; then
    local count=0
    while IFS= read -r n; do
      [[ -z "$n" ]] && continue
      cmd_start_one "$n" || true
      count=$((count + 1))
    done < <(all_names)
    if [[ $count -eq 0 ]]; then echo "(no instances)"; fi
    return
  fi
  cmd_start_one "$name"

  # Show status after starting a specific instance
  cmd_status "$name"
}

cmd_start_one() {
  local name="$1"
  instance_exists "$name" || { echo "ERROR: instance '$name' not found"; return 1; }

  local cfg pid
  cfg=$(reg_read | jq -r --arg n "$name" '.[]|select(.name==$n).config')
  pid=$(reg_read | jq -r --arg n "$name" '.[]|select(.name==$n).pid')
  if [[ -n "$pid" && "$pid" != "null" ]] && kill -0 "$pid" 2>/dev/null; then
    echo "[start] '$name' already running (pid=$pid)"; return 0
  fi

  local logfile="$LOG_DIR/$name.log"
  echo "[start] launching '$name'..."
  nohup "$NANOBOT_BIN" gateway -c "$cfg" > "$logfile" 2>&1 &
  pid=$!

  # Persist pid
  reg_write "$(reg_read | jq --arg n "$name" --argjson p "$pid" '(.[]|select(.name==$n)).pid=$p')"
  sleep 2
  if kill -0 "$pid" 2>/dev/null; then
    echo "[start] OK. pid=$pid, log=$logfile"
  else
    echo "[start] FAILED. Check $logfile"; return 1
  fi
}

cmd_stop() {
  local name="${1:-}"
  if [[ -z "$name" ]]; then
    local count=0
    while IFS= read -r n; do
      [[ -z "$n" ]] && continue
      cmd_stop_one "$n" || true
      count=$((count + 1))
    done < <(all_names)
    if [[ $count -eq 0 ]]; then echo "(no instances)"; fi
    return
  fi
  cmd_stop_one "$name"
}

cmd_stop_one() {
  local name="$1"
  instance_exists "$name" || { echo "ERROR: instance '$name' not found"; return 1; }
  local pid; pid=$(reg_read | jq -r --arg n "$name" '.[]|select(.name==$n).pid')
  if [[ -z "$pid" || "$pid" == "null" ]]; then
    echo "[stop] '$name' not running"; return 0
  fi
  if kill -0 "$pid" 2>/dev/null; then
    kill "$pid" && echo "[stop] killed pid=$pid ($name)"
  else
    echo "[stop] stale pid=$pid ($name), cleaning registry"
  fi
  reg_write "$(reg_read | jq --arg n "$name" '(.[]|select(.name==$n)).pid=null')"
}

cmd_destory() {
  local name="${1:-}"
  [[ -n "$name" ]] || { echo "Usage: nanobotx destory <name>"; exit 1; }
  instance_exists "$name" || { echo "ERROR: instance '$name' not found"; exit 1; }
  read -rp "destory instance '$name'? All data will be lost. [y/N] " confirm
  [[ "$confirm" =~ ^[Yy]$ ]] || { echo "aborted"; exit 0; }

  cmd_stop "$name" 2>/dev/null || true

  local base="$INSTANCES_ROOT/$name"
  rm -rf "$base"
  rm -f "$LOG_DIR/$name.log"
  reg_write "$(reg_read | jq --arg n "$name" 'del(.[]|select(.name==$n))')"
  echo "[destory] '$name' removed."
}

cmd_list() {
  local host; host=$(hostname -I 2>/dev/null | awk '{print $1}')
  [[ -z "$host" ]] && host="127.0.0.1"
  if [[ $(reg_read | jq 'length') -eq 0 ]]; then
    echo "(no instances)"; return
  fi
  printf "%-12s %-30s %-38s %-8s %s\n" NAME WEBUI TOKEN PID STATUS
  reg_read | jq -r '.[] | [.name, (.gateway_port|tostring), (.token // "-" | tostring), (.pid|tostring)] | @tsv' | \
  while IFS=$'\t' read -r name gw token pid; do
    if [[ "$pid" != "null" ]] && kill -0 "$pid" 2>/dev/null; then
      status=$(ps -o etime= -p "$pid" 2>/dev/null | tr -d ' ')
      [[ -z "$status" ]] && status="running"
    else
      status="stopped"; pid="-"
    fi
    printf "%-12s %-30s %-38s %-8s %s\n" "$name" "http://$host:$gw" "${token:0:36}" "$pid" "$status"
  done
}

cmd_status() {
  local name="${1:-}"
  if [[ -z "$name" ]]; then
    cmd_list; return
  fi
  instance_exists "$name" || { echo "ERROR: instance '$name' not found"; exit 1; }
  local cfg pid gw api token host
  host=$(hostname -I 2>/dev/null | awk '{print $1}')
  [[ -z "$host" ]] && host="127.0.0.1"
  cfg=$(reg_read | jq -r --arg n "$name" '.[]|select(.name==$n).config')
  gw=$(reg_read  | jq -r --arg n "$name" '.[]|select(.name==$n).gateway_port')
  api=$(reg_read | jq -r --arg n "$name" '.[]|select(.name==$n).api_port')
  pid=$(reg_read | jq -r --arg n "$name" '.[]|select(.name==$n).pid')
  token=$(reg_read | jq -r --arg n "$name" '.[]|select(.name==$n).token // "-"')
  echo "Instance : $name"
  echo "Config   : $cfg"
  echo "WebUI    : http://$host:$gw"
  echo "API      : $host:$api"
  echo "Token    : $token"
  if [[ "$pid" != "null" ]] && kill -0 "$pid" 2>/dev/null; then
    echo "Process  : running (pid=$pid)"
    curl -sf "http://127.0.0.1:$gw/health" -o /dev/null 2>/dev/null && echo "Health   : OK" || echo "Health   : no response"
  else
    echo "Process  : stopped"
  fi
  echo
  echo "Recent log:"
  tail -n 5 "$LOG_DIR/$name.log" 2>/dev/null || echo "  (no log)"
}

cmd_restart() {
  local name="${1:-}"
  if [[ -z "$name" ]]; then
    local count=0
    while IFS= read -r n; do
      [[ -z "$n" ]] && continue
      echo "[restart] stopping '$n'..."
      cmd_stop_one "$n" || true
      sleep 1
      cmd_start_one "$n" || true
      count=$((count + 1))
    done < <(all_names)
    if [[ $count -eq 0 ]]; then echo "(no instances)"; fi
    return
  fi
  instance_exists "$name" || { echo "ERROR: instance '$name' not found"; exit 1; }

  echo "[restart] stopping '$name'..."
  cmd_stop_one "$name"
  sleep 1
  cmd_start_one "$name"

  # Show status after restarting a specific instance
  cmd_status "$name"
}

cmd_help() {
  cat <<'EOF'
nanobotx - multi-instance manager for nanobot (Linux)

Commands:
  nanobotx create [name]          Create and auto-start a new instance (shows status on success).
  nanobotx start   [name]         Start an instance, or all if omitted.
  nanobotx stop    [name]         Stop an instance, or all if omitted.
  nanobotx restart [name]         Restart an instance, or all if omitted.
  nanobotx destory <name>         Stop and remove an instance (data loss).
  nanobotx list                   List all instances (with WebUI tokens).
  nanobotx status [name]          Show status of one (or all) instances.
  nanobotx help                   Show this help.

Env:
  NANOBOT_APP        Install root (default: $HOME/nanobot-app)
  NANOBOT_INSTANCES  Instance data root (default: $NANOBOT_APP/instances)

Ports auto-assigned starting from 18791 (webui) / 8901 (api).
Each instance gets a random UUID token for WebSocket authentication.
EOF
}

# ---------- dispatch ----------
cmd="${1:-help}"; shift || true
case "$cmd" in
  create)  cmd_create  "$@";;
  start)   cmd_start   "$@";;
  stop)    cmd_stop    "$@";;
  restart) cmd_restart "$@";;
  destory) cmd_destory "$@";;
  list|ls) cmd_list    "$@";;
  status)  cmd_status  "$@";;
  help|-h|--help) cmd_help;;
  *) echo "Unknown command: $cmd"; cmd_help; exit 1;;
esac
