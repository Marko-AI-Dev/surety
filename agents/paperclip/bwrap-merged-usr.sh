#!/usr/bin/env bash
# Paperclip workspace sandbox fix for merged-/usr Ubuntu (Surety, 9 Nov 2026).
# Paperclip symlinks /bin, /sbin, /lib and /lib64 to usr/* and then also bind-mounts them, before /usr
# exists in the new root, which fails. Drop those four redundant binds: the symlinks resolve once /usr
# is mounted read-only. Every other argument passes through unchanged.
args=()
while [ $# -gt 0 ]; do
  case "$1" in
    --ro-bind)
      if [ "$2" = "$3" ] && { [ "$2" = /bin ] || [ "$2" = /sbin ] || [ "$2" = /lib ] || [ "$2" = /lib64 ]; }; then
        shift 3; continue
      fi ;;
  esac
  args+=("$1"); shift
done
exec /usr/bin/bwrap "${args[@]}"
