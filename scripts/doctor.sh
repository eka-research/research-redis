#!/usr/bin/env bash
# Preflight checks for the local toolchain and host kernel settings.
source "$(dirname "$0")/lib.sh"

fail=0
check() { # name, command, expectation-description
  if eval "$2" >/dev/null 2>&1; then printf '  \033[32mok\033[0m   %-22s %s\n' "$1" "$3";
  else printf '  \033[31mFAIL\033[0m %-22s %s\n' "$1" "$3"; fail=1; fi
}
ver_ge() { [ "$(printf '%s\n%s\n' "$2" "$1" | sort -V | head -1)" = "$2" ]; }

log "toolchain"
check docker      "docker info"                                              "daemon reachable"
kind_v="$(kind version 2>/dev/null | awk '{print $2}' | tr -d v)"
check kind        "ver_ge '${kind_v:-0}' 0.33.0"                             "v0.33.0+ (found ${kind_v:-none})"
kc_minor="$(kubectl version --client -o json 2>/dev/null | sed -n 's/.*"minor": *"\([0-9]*\).*/\1/p' | head -1)"
check kubectl     "[ '${kc_minor:-0}' -ge 35 ]"                              "1.35+ for node 1.36 skew (found 1.${kc_minor:-?})"
check gh          "gh auth status"                                           "authenticated"
check kustomize   "command -v kustomize || kubectl kustomize --help"         "standalone or embedded"

log "host"
mmc="$(sysctl -n vm.max_map_count)"
check max_map_count "[ $mmc -ge 262144 ]"                                    ">= 262144 for Elasticsearch (found $mmc)"
avail_gb="$(df --output=avail -BG / | tail -1 | tr -dc 0-9)"
check disk        "[ $avail_gb -ge 10 ]"                                     ">= 10G free on / (found ${avail_gb}G)"
mem_gb="$(awk '/MemAvailable/{printf "%d", $2/1024/1024}' /proc/meminfo)"
check memory      "[ $mem_gb -ge 6 ]"                                        ">= 6G available (found ${mem_gb}G)"
check port80      "! ss -ltnH 'sport = :80' | grep -q ."                     "127.0.0.1:80 free for the kind port mapping"
fstype="$(findmnt -T "$ROOT" -no FSTYPE)"
check workspace-fs "[ '$fstype' != ntfs3 ] && [ '$fstype' != fuseblk ]"      "native FS, not NTFS (found $fstype); see ADR-0007"

[ "$fail" -eq 0 ] && log "all checks passed" || die "fix the failures above"
