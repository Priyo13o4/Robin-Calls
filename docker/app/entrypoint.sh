#!/bin/sh
#
# Keeps the PREVIOUS build's client chunks servable after this one replaces it.
#
# The failure it fixes: `.next/static` shipped inside the image, so replacing the
# container deleted every chunk the old build had emitted. A tab opened before
# the deploy then asked for a hash that no longer existed, got a 404, and the
# page died — "failed to load", fixed by a reload, which is exactly what a
# vanished asset looks like from the browser.
#
# So `.next/static` is a persistent volume in production and this script merges
# each build into it. Chunk filenames are content-hashed, which is what makes
# accumulating safe: two builds either agree on a name because the bytes are
# identical, or they use different names.
#
# The archive is swept by age so it cannot grow forever. A tab still open past
# the retention window falls back to the reload handler in app/layout.tsx —
# that is now a genuine last resort rather than the whole mechanism.
set -eu

ARCHIVE=/app/.next/static
BUILD=/app/.next/static-build
DAYS="${NEXT_STATIC_RETENTION_DAYS:-14}"

if [ -d "$BUILD" ]; then
  # PRUNE FIRST, COPY SECOND — the order is load-bearing. An unchanged chunk
  # keeps the date it was first archived, so a sweep run AFTER the copy would
  # delete assets this build is still serving. Pruning first means everything
  # the running build needs is written back immediately afterwards.
  #
  # Non-fatal: a sweep that cannot run leaves the archive larger than intended,
  # which is survivable. The copy below is not — a missing chunk is a blank page.
  find "$ARCHIVE" -mindepth 1 -type f -mtime "+$DAYS" -delete 2>/dev/null || true
  find "$ARCHIVE" -mindepth 1 -type d -empty -delete 2>/dev/null || true

  mkdir -p "$ARCHIVE"
  # Overwrite rather than skip-existing (`cp -n`): rewriting refreshes the mtime
  # of every asset this build still uses, which is what keeps a long-lived chunk
  # out of the sweep above for as long as it stays deployed.
  cp -r "$BUILD/." "$ARCHIVE/"
fi

exec "$@"
