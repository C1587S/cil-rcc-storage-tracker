#!/bin/bash
# =============================================================================
# warm-cache.sh — pre-pay the cold ClickHouse scans behind the visualizations
#
# The API caches subtree responses in-process (LRU); the first request after
# an import or API restart pays a 5-20s ClickHouse scan. This hits exactly
# the URLs the Tree/Voronoi/Treemap views request on load, so no user is
# ever the one warming the cache. Called at the end of update-snapshot.sh;
# safe to run manually after `docker compose restart api`.
# =============================================================================
API="${API:-http://localhost:8000}"
SNAP=$(curl -s "$API/api/snapshots" | python3 -c 'import json,sys;print(json.load(sys.stdin)[0]["snapshot_date"])' 2>/dev/null)
[ -z "$SNAP" ] && { echo "warm-cache: no snapshot available"; exit 0; }

echo "Warming caches for $SNAP..."
for ROOT in %2Fproject%2Fcil %2Fcds3%2Fcil; do
  # Voronoi view: depth-3 unpruned subtree (hook fetches target+1 of default 2)
  curl -so /dev/null "$API/api/voronoi/node/$SNAP/subtree?path=$ROOT&max_depth=3" &
  # Treemap default (depth 5 -> fetch 6) and sunburst (+1 -> 7), pruned
  curl -so /dev/null "$API/api/voronoi/node/$SNAP/subtree?path=$ROOT&max_depth=6&min_share=0.0005&files_limit=100" &
  curl -so /dev/null "$API/api/voronoi/node/$SNAP/subtree?path=$ROOT&max_depth=7&min_share=0.0005&files_limit=100" &
  # Tree explorer root listing + availability/root-stats probe
  curl -so /dev/null "$API/api/contents?snapshot_date=$SNAP&parent_path=$ROOT&limit=1" &
  curl -so /dev/null "$API/api/contents?snapshot_date=$SNAP&parent_path=$ROOT&limit=500" &
done
wait
echo "Cache warm complete."
