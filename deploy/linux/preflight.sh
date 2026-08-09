#!/usr/bin/env bash

# Real VPS preflight for deploy/linux.
# This script is intentionally read-only:
# - no package installation
# - no system configuration changes
# - no service start/stop
# - no database migration
# - no Cloudflare/D1/R2/remote deploy calls
# - no secret value printing

set -u
umask 077

FAIL_COUNT=0
WARN_COUNT=0

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

pass() {
  printf 'PASS %s\n' "$1"
}

warn() {
  WARN_COUNT=$((WARN_COUNT + 1))
  printf 'WARN %s\n' "$1"
}

fail() {
  FAIL_COUNT=$((FAIL_COUNT + 1))
  printf 'FAIL %s\n' "$1"
}

has_command() {
  command -v "$1" >/dev/null 2>&1
}

env_key_present() {
  local key="$1"
  awk -F= -v key="$key" '
    /^[[:space:]]*#/ { next }
    /^[[:space:]]*$/ { next }
    {
      name=$1
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", name)
      if (name == key) { found=1; exit }
    }
    END { exit found ? 0 : 1 }
  ' .env
}

env_key_nonempty() {
  local key="$1"
  awk -F= -v key="$key" '
    /^[[:space:]]*#/ { next }
    /^[[:space:]]*$/ { next }
    {
      name=$1
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", name)
      if (name == key) {
        value=substr($0, index($0, "=") + 1)
        gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
        if (value != "") { found=1 }
        exit
      }
    }
    END { exit found ? 0 : 1 }
  ' .env
}

env_value() {
  local key="$1"
  awk -F= -v key="$key" '
    /^[[:space:]]*#/ { next }
    /^[[:space:]]*$/ { next }
    {
      name=$1
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", name)
      if (name == key) {
        value=substr($0, index($0, "=") + 1)
        gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
        print value
        exit
      }
    }
  ' .env
}

env_value_matches() {
  local key="$1"
  local pattern="$2"
  local value
  value="$(env_value "$key")"
  printf '%s' "$value" | grep -Eiq "$pattern"
}

check_private_path() {
  local path="$1"
  local expected_mode="$2"
  if [ ! -e "$path" ]; then
    pass "${path} will be created with mode ${expected_mode}"
    return
  fi
  local owner mode
  owner="$(stat -c '%u' "$path" 2>/dev/null || true)"
  mode="$(stat -c '%a' "$path" 2>/dev/null || true)"
  if [ "$owner" != "$(id -u)" ]; then
    fail "${path} must be owned by the current deployment account"
  elif [ "$mode" != "$expected_mode" ]; then
    fail "${path} must have mode ${expected_mode}; refusing to continue"
  else
    pass "${path} owner and mode are secure"
  fi
}

check_required_env() {
  local key="$1"
  if ! env_key_present "$key"; then
    fail ".env missing required key: ${key}"
    return
  fi
  if ! env_key_nonempty "$key"; then
    fail ".env key is empty: ${key}"
    return
  fi
  pass ".env key present: ${key}"
}

check_file_exists() {
  local path="$1"
  if [ -f "$path" ]; then
    pass "found ${path}"
  else
    fail "missing ${path}"
  fi
}

check_port() {
  local port="$1"
  if has_command ss; then
    if ss -ltn 2>/dev/null | awk '{print $4}' | grep -Eq "(:|\\])${port}$"; then
      fail "TCP port ${port} is already listening; free it before first VPS deploy"
    else
      pass "TCP port ${port} is not listening"
    fi
    return
  fi

  if has_command lsof; then
    if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
      fail "TCP port ${port} is already listening; free it before first VPS deploy"
    else
      pass "TCP port ${port} is not listening"
    fi
    return
  fi

  if has_command netstat; then
    if netstat -ltn 2>/dev/null | awk '{print $4}' | grep -Eq "(:|\\])${port}$"; then
      fail "TCP port ${port} is already listening; free it before first VPS deploy"
    else
      pass "TCP port ${port} is not listening"
    fi
    return
  fi

  warn "cannot check TCP port ${port}; install ss, lsof, or netstat manually if needed"
}

check_disk() {
  local available_kb
  available_kb="$(df -Pk "$SCRIPT_DIR" 2>/dev/null | awk 'NR==2 { print $4 }')"
  if [ -z "$available_kb" ]; then
    warn "cannot determine available disk space"
    return
  fi

  if [ "$available_kb" -lt 2097152 ]; then
    fail "available disk space is below 2 GiB"
  elif [ "$available_kb" -lt 5242880 ]; then
    warn "available disk space is below 5 GiB; acceptable for smoke, weak for production"
  else
    pass "available disk space is at least 5 GiB"
  fi
}

check_memory() {
  if [ ! -r /proc/meminfo ]; then
    warn "cannot determine memory from /proc/meminfo"
    return
  fi

  local mem_kb
  mem_kb="$(awk '/^MemTotal:/ { print $2 }' /proc/meminfo)"
  if [ -z "$mem_kb" ]; then
    warn "cannot determine total memory"
    return
  fi

  if [ "$mem_kb" -lt 1048576 ]; then
    fail "total memory is below 1 GiB"
  elif [ "$mem_kb" -lt 2097152 ]; then
    warn "total memory is below 2 GiB; app may run, but production headroom is limited"
  else
    pass "total memory is at least 2 GiB"
  fi
}

printf 'Real VPS self-host preflight: read-only checks only.\n'

check_file_exists "docker-compose.yml"
check_file_exists "Caddyfile"

if has_command docker; then
  if docker --version >/dev/null 2>&1; then
    pass "docker command is available"
  else
    fail "docker command exists but is not usable"
  fi

  if docker compose version >/dev/null 2>&1; then
    pass "docker compose plugin is available"
  else
    fail "docker compose plugin is not available"
  fi
else
  fail "docker command is not available"
fi

check_port "80"
check_port "443"

if [ -f ".env" ]; then
  pass ".env exists"
  check_private_path ".env" "600"
else
  fail ".env is missing; copy .env.example to .env and fill it only on the VPS"
fi

if [ -f ".env" ]; then
  required_keys=(
    "APP_DOMAIN"
    "VISITOR_ROOT_DOMAIN"
    "POSTGRES_DB"
    "POSTGRES_USER"
    "POSTGRES_PASSWORD"
    "DATABASE_URL"
    "APP_PORT"
    "SESSION_SECRET"
    "SETUP_TOKEN"
    "STORAGE_DRIVER"
    "STORAGE_PATH"
    "MAX_UPLOAD_SIZE"
    "BACKUP_DIR"
    "BACKUP_SIGNING_KEY"
    "LOG_LEVEL"
  )

  for key in "${required_keys[@]}"; do
    check_required_env "$key"
  done

  for key in APP_DOMAIN VISITOR_ROOT_DOMAIN POSTGRES_PASSWORD DATABASE_URL SESSION_SECRET SETUP_TOKEN BACKUP_SIGNING_KEY; do
    if env_key_nonempty "$key" && env_value_matches "$key" 'change-me|example\.com|localhost|127\.0\.0\.1'; then
      fail ".env key appears to contain a placeholder or localhost value: ${key}"
    fi
  done

  check_private_path "storage" "700"
  check_private_path "logs" "700"
  check_private_path "$(env_value BACKUP_DIR)" "700"

  fail "server-generic public deployment is disabled until it implements the same separate admin bundle, visitor bundle, token-subdomain host capability, and visitor API boundary as the Cloudflare production entry; use the Cloudflare production deployment for public traffic"

  if env_key_present "ENCRYPTION_ENABLED"; then
    pass ".env key present: ENCRYPTION_ENABLED"
    if [ "$(env_value ENCRYPTION_ENABLED)" = "1" ]; then
      if env_key_nonempty "ENCRYPTION_KEY"; then
        pass ".env key present for enabled encryption: ENCRYPTION_KEY"
      else
        fail "ENCRYPTION_ENABLED is 1 but ENCRYPTION_KEY is missing or empty"
      fi
    else
      warn "ENCRYPTION_ENABLED is not 1; new encrypted-message storage is disabled"
    fi
  else
    warn ".env missing ENCRYPTION_ENABLED; encryption defaults should be reviewed"
  fi
fi

if [ -f "docker-compose.yml" ]; then
  for service in app postgres caddy; do
    if grep -Eq "^[[:space:]]{2}${service}:" docker-compose.yml; then
      pass "docker-compose.yml defines service: ${service}"
    else
      fail "docker-compose.yml missing service: ${service}"
    fi
  done
fi

if [ -f "Caddyfile" ]; then
  if grep -q '{$APP_DOMAIN}' Caddyfile && grep -q '{$VISITOR_ROOT_DOMAIN}' Caddyfile; then
    pass "Caddyfile references APP_DOMAIN and VISITOR_ROOT_DOMAIN"
  else
    fail "Caddyfile must reference APP_DOMAIN and VISITOR_ROOT_DOMAIN"
  fi
fi

check_disk
check_memory

printf 'Preflight completed: %s FAIL, %s WARN.\n' "$FAIL_COUNT" "$WARN_COUNT"

if [ "$FAIL_COUNT" -gt 0 ]; then
  exit 1
fi
