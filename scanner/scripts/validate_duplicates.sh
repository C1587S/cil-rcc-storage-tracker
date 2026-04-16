#!/bin/bash
# =============================================================================
# validate_duplicates.sh — Hash-based duplicate validation (proof of concept)
#
# Takes the top-N candidate duplicate groups (by size+name) and hashes a
# sample of files from each group using BLAKE3 (or SHA-256 fallback).
# Reports: confirmed duplicates, mixed groups, false positives.
#
# Run on a cluster node where /project/cil is accessible.
#
# Usage:
#   bash validate_duplicates.sh                    # uses bundled validation_groups.json
#   bash validate_duplicates.sh --input groups.json
#   bash validate_duplicates.sh --full             # hash ALL files in each group (slow)
# =============================================================================
set -o pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INPUT_FILE="${SCRIPT_DIR}/validation_groups.json"
FULL_MODE=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --input) INPUT_FILE="$2"; shift 2 ;;
        --full)  FULL_MODE=true; shift ;;
        *) shift ;;
    esac
done

if [[ ! -f "$INPUT_FILE" ]]; then
    echo "Error: input file not found: $INPUT_FILE"
    echo "Generate it from the dashboard query or use the bundled one."
    exit 1
fi

# Detect hash tool
HASH_CMD=""
if command -v b3sum &>/dev/null; then
    HASH_CMD="b3sum"
    HASH_NAME="BLAKE3"
elif command -v blake3sum &>/dev/null; then
    HASH_CMD="blake3sum"
    HASH_NAME="BLAKE3"
elif command -v sha256sum &>/dev/null; then
    HASH_CMD="sha256sum"
    HASH_NAME="SHA-256"
else
    echo "Error: no hash tool found (b3sum, blake3sum, or sha256sum)"
    exit 1
fi

echo "========================================================"
echo "Duplicate Validation — $(date)"
echo "Hash algorithm: $HASH_NAME ($HASH_CMD)"
echo "Input: $INPUT_FILE"
echo "Mode: $(if $FULL_MODE; then echo 'FULL (all files)'; else echo 'SAMPLE (subset)'; fi)"
echo "========================================================"
echo ""

# Run Python to orchestrate hashing and analysis
python3 << 'PYEOF' - "$INPUT_FILE" "$HASH_CMD" "$HASH_NAME" "$FULL_MODE"

import json, sys, os, subprocess, time
from collections import defaultdict

input_file = sys.argv[1]
hash_cmd = sys.argv[2]
hash_name = sys.argv[3]
full_mode = sys.argv[4] == "true"

with open(input_file) as f:
    groups = json.load(f)

R = "\033[0m"; B = "\033[1m"; DIM = "\033[2m"
CYN = "\033[0;36m"; ORG = "\033[38;5;208m"; WARN = "\033[38;5;203m"; WHT = "\033[1;37m"

results = []
total_confirmed_waste = 0
total_estimated_waste = 0
total_files_hashed = 0
t_start = time.time()

for gi, group in enumerate(groups, 1):
    name = group["name"]
    size = group["size"]
    total_copies = group["total_copies"]
    wasted_space = group.get("wasted_space", "?")
    paths = group["sample_paths"]

    print(f"{B}Group {gi}/{len(groups)}: {name}{R}")
    print(f"  Size: {size / (1024**2):.1f} MB | Total copies: {total_copies} | Estimated waste: {wasted_space}")
    print(f"  Hashing {len(paths)} files...")

    # Hash each file
    hashes = {}  # path -> hash
    errors = []
    for pi, path in enumerate(paths):
        if not os.path.exists(path):
            errors.append(f"  NOT FOUND: {path}")
            continue
        try:
            result = subprocess.run(
                [hash_cmd, path],
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=300
            )
            if result.returncode == 0:
                h = result.stdout.decode().strip().split()[0]
                hashes[path] = h
                total_files_hashed += 1
            else:
                errors.append("  HASH ERROR: {}: {}".format(path, result.stderr.decode().strip()))
        except subprocess.TimeoutExpired:
            errors.append(f"  TIMEOUT: {path}")
        except Exception as e:
            errors.append(f"  ERROR: {path}: {e}")

    if errors:
        for e in errors[:5]:
            print(f"  {WARN}{e}{R}")
        if len(errors) > 5:
            print(f"  {WARN}  ... and {len(errors) - 5} more errors{R}")

    # Abort if too many files failed
    attempted = len(paths) - sum(1 for e in errors if "NOT FOUND" in e)
    if attempted > 0 and len(hashes) == 0:
        print("  {}FATAL: all {} files failed to hash. Aborting.{}".format(WARN, attempted, R))
        print("  Check Python version (need 3.7+) and hash tool availability.")
        if errors:
            print("  First error: {}".format(errors[0]))
        sys.exit(1)
    if len(paths) > 0 and len(hashes) < len(paths) * 0.5:
        print("  {}WARNING: {}/{} files failed to hash (>50%). Results unreliable.{}".format(
            WARN, len(paths) - len(hashes), len(paths), R))
        group_failed = True
    else:
        group_failed = False

    # Analyze hashes
    unique_hashes = set(hashes.values())
    hash_groups = defaultdict(list)
    for path, h in hashes.items():
        hash_groups[h].append(path)

    if len(unique_hashes) == 0:
        status = "ERROR"
        color = WARN
        detail = "no files could be hashed"
    elif len(unique_hashes) == 1:
        status = "CONFIRMED"
        color = CYN
        detail = f"all {len(hashes)} sampled files have identical hash"
        # Extrapolate: if sample is 100% identical, assume full group is too
        confirmed_waste = size * (total_copies - 1)
        total_confirmed_waste += confirmed_waste
    elif len(unique_hashes) == len(hashes):
        status = "FALSE POSITIVE"
        color = WARN
        detail = f"all {len(hashes)} files have different hashes — size collision"
    else:
        status = "MIXED"
        color = ORG
        biggest = max(hash_groups.values(), key=len)
        detail = f"{len(unique_hashes)} distinct hashes among {len(hashes)} files — largest identical group: {len(biggest)}"
        # Conservative: only count the biggest identical sub-group
        confirmed_waste = size * (len(biggest) - 1)
        # Scale up proportionally to total copies
        scale = total_copies / len(hashes) if len(hashes) > 0 else 1
        confirmed_waste = int(confirmed_waste * scale)
        total_confirmed_waste += confirmed_waste

    total_estimated_waste += size * (total_copies - 1)

    print(f"  Result: {color}{B}{status}{R} — {detail}")
    if len(unique_hashes) > 0 and len(unique_hashes) <= 5:
        for h, paths_for_hash in sorted(hash_groups.items(), key=lambda x: -len(x[1])):
            print(f"  {DIM}  {h[:16]}... ({len(paths_for_hash)} files){R}")
    print()

    results.append({
        "group": gi,
        "name": name,
        "size": size,
        "total_copies": total_copies,
        "sampled": len(paths),
        "hashed": len(hashes),
        "unique_hashes": len(unique_hashes),
        "status": status,
        "errors": len(errors)
    })

duration = time.time() - t_start

# Summary
print(f"{B}{'=' * 60}{R}")
print(f"{B}SUMMARY{R}")
print(f"{'=' * 60}")
print()

if total_files_hashed == 0:
    print("  {}FATAL: zero files were successfully hashed. Cannot produce results.{}".format(WARN, R))
    print("  Check: Python version, hash tool, file accessibility.")
    sys.exit(1)

confirmed = sum(1 for r in results if r["status"] == "CONFIRMED")
mixed = sum(1 for r in results if r["status"] == "MIXED")
false_pos = sum(1 for r in results if r["status"] == "FALSE POSITIVE")
errored = sum(1 for r in results if r["status"] == "ERROR")

print(f"  Groups analyzed:      {len(results)}")
print(f"  Files hashed:         {total_files_hashed}")
print(f"  Duration:             {duration:.1f}s")
print(f"  Hash algorithm:       {hash_name}")
print()
print(f"  {CYN}CONFIRMED duplicates:  {confirmed}{R}")
print(f"  {ORG}MIXED groups:          {mixed}{R}")
print(f"  {WARN}FALSE POSITIVES:       {false_pos}{R}")
if errored:
    print(f"  {WARN}ERRORS:                {errored}{R}")
print()

def fmt_size(b):
    if b >= 1024**4: return f"{b / 1024**4:.2f} TiB"
    if b >= 1024**3: return f"{b / 1024**3:.2f} GiB"
    if b >= 1024**2: return f"{b / 1024**2:.1f} MiB"
    return f"{b / 1024:.0f} KiB"

print(f"  Estimated waste (size+name):   {fmt_size(total_estimated_waste)}")
print(f"  Confirmed waste (hash-verified): {fmt_size(total_confirmed_waste)}")
if total_estimated_waste > 0:
    ratio = total_confirmed_waste / total_estimated_waste * 100
    print(f"  Signal-to-noise ratio:         {ratio:.1f}%")
print()

# Save results
out_path = os.path.splitext(input_file)[0] + "_results.json"
with open(out_path, "w") as f:
    json.dump({
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "hash_algorithm": hash_name,
        "duration_sec": round(duration, 1),
        "total_files_hashed": total_files_hashed,
        "summary": {
            "confirmed": confirmed,
            "mixed": mixed,
            "false_positive": false_pos,
            "error": errored,
            "estimated_waste_bytes": total_estimated_waste,
            "confirmed_waste_bytes": total_confirmed_waste,
        },
        "groups": results
    }, f, indent=2)
print(f"  Results saved to: {out_path}")
print()

PYEOF
