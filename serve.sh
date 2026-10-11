#!/usr/bin/env bash
# Start / stop the static server for the TILT project viewer.
#   bash serve.sh            start in the background (default)
#   bash serve.sh stop
#   bash serve.sh restart
#   bash serve.sh status
#   bash serve.sh logs
#   bash serve.sh backup  snapshot data/o2tilt.db into data/backups/
#   PORT=8090 bash serve.sh  use a different port
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${PORT:-8080}"
STATE="${TMPDIR:-/data/data/com.termux/files/usr/tmp}"
LOG="$STATE/tilt-server.log"
PIDF="$STATE/tilt-server.pid"

pid_alive() { [ -n "${1:-}" ] && kill -0 "$1" 2>/dev/null; }

port_open() {
    node -e "
        const s = require('node:net').connect($PORT, '127.0.0.1');
        s.on('connect', () => { s.end(); process.exit(0); });
        s.on('error', () => process.exit(1));
        setTimeout(() => process.exit(1), 300);
    " 2>/dev/null
}

# The live process wins over the pid file; the file can go stale.
current_pid() {
    local p
    p="$(pgrep -f 'tools/serve\.mjs' 2>/dev/null | head -1)"
    if pid_alive "$p"; then echo "$p"; return 0; fi
    p="$(cat "$PIDF" 2>/dev/null)"
    if pid_alive "$p"; then echo "$p"; fi
}

url() { echo "http://localhost:$PORT/"; }

start() {
    local p
    p="$(current_pid)"
    if pid_alive "$p"; then
        if port_open; then
            echo "already running (pid $p) -> $(url)"
            return 0
        fi
        echo "pid $p is alive but port $PORT is dead - restarting"
        stop
    fi

    # Never claim success just because *something* answered the port.
    if port_open; then
        echo "port $PORT is already in use by another process."
        echo "  find it:  pgrep -af 'http.server|serve.mjs'"
        echo "  or move:  PORT=8090 bash serve.sh"
        return 1
    fi

    mkdir -p "$STATE"
    : > "$LOG"
    nohup env PORT="$PORT" node "$ROOT/tools/serve.mjs" >>"$LOG" 2>&1 < /dev/null &
    echo $! > "$PIDF"
    disown 2>/dev/null || true

    # Ready only when OUR pid is alive and answering.
    local tries=0
    while [ "$tries" -lt 40 ]; do
        tries=$((tries + 1))
        if ! pid_alive "$(cat "$PIDF" 2>/dev/null)"; then break; fi
        if port_open; then
            echo "started -> $(url)"
            return 0
        fi
        sleep 0.25
    done

    echo "FAILED to start. Log:"
    sed 's/^/  /' "$LOG" 2>/dev/null
    rm -f "$PIDF"
    return 1
}

stop() {
    local p
    p="$(current_pid)"
    if ! pid_alive "$p"; then
        echo "not running"
        rm -f "$PIDF"
        return 0
    fi
    kill "$p" 2>/dev/null
    local n=0
    while pid_alive "$p" && [ "$n" -lt 20 ]; do n=$((n + 1)); sleep 0.25; done
    pid_alive "$p" && kill -9 "$p" 2>/dev/null
    rm -f "$PIDF"
    echo "stopped"
}

status() {
    local p
    p="$(current_pid)"
    if pid_alive "$p"; then
        if port_open; then echo "running (pid $p) -> $(url)"
        else echo "process $p is alive but port $PORT is not answering"; return 1
        fi
    elif port_open; then
        echo "port $PORT is in use, but not by this script"
        return 1
    else
        echo "not running"
        return 1
    fi
}

logs() {
    if [ -f "$LOG" ]; then tail -n 50 "$LOG"; else echo "no log yet"; fi
}

backup() {
    python3 "$ROOT/tools/backup.py"
}

case "${1:-start}" in
    start)   start ;;
    stop)    stop ;;
    restart) stop; start ;;
    status)  status ;;
    logs)    logs ;;
    backup)  backup ;;
    *)       echo "usage: bash serve.sh [start|stop|restart|status|logs|backup]"; exit 2 ;;
esac
