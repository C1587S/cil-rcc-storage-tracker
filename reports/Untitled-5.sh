./scanner/target/release/storage-scanner scan \
    --path /Volumes/cil/home_dirs/jonahmgilbert \
    --output /Users/sebastiancadavidsanchez/Documents/Github/cil/cil-rcc-storage-tracker/scan_examples/snapshot_$(date +%Y-%m-%d).parquet \
    --threads 10 \
    --batch-size 100000 \
    --verbose


