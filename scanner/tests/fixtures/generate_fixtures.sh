#!/bin/bash

# Mock filesystem generation script for testing storage scanner
# Creates a realistic test directory structure with various file types and sizes

set -e

TEST_DIR="test_project"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_DIR="$SCRIPT_DIR/$TEST_DIR"

echo "Generating mock filesystem at: $TARGET_DIR"

# Clean up existing test directory
if [ -d "$TARGET_DIR" ]; then
    echo "Removing existing test directory..."
    rm -rf "$TARGET_DIR"
fi

mkdir -p "$TARGET_DIR"

# Generate small files (100 files, 1KB each)
echo "Creating small files..."
mkdir -p "$TARGET_DIR/small_files"
for i in $(seq -w 1 100); do
    dd if=/dev/urandom of="$TARGET_DIR/small_files/file$i.txt" bs=1K count=1 2>/dev/null
done

# Generate large files (10 files, 10MB each to keep it manageable for tests)
echo "Creating large files..."
mkdir -p "$TARGET_DIR/large_files"
for i in $(seq -w 1 10); do
    dd if=/dev/urandom of="$TARGET_DIR/large_files/data$i.bin" bs=1M count=10 2>/dev/null
done

# Generate nested structure
echo "Creating nested directory structure..."
mkdir -p "$TARGET_DIR/nested/level1/level2/level3"
echo "Level 0 file" > "$TARGET_DIR/nested/file.txt"
echo "Level 1 file" > "$TARGET_DIR/nested/level1/file.txt"
echo "Level 2 file" > "$TARGET_DIR/nested/level1/level2/file.txt"
echo "Deep file" > "$TARGET_DIR/nested/level1/level2/level3/deep_file.txt"

# Generate mixed file types
echo "Creating mixed file types..."
mkdir -p "$TARGET_DIR/mixed_types"
dd if=/dev/urandom of="$TARGET_DIR/mixed_types/document.pdf" bs=1M count=5 2>/dev/null
dd if=/dev/urandom of="$TARGET_DIR/mixed_types/image.png" bs=1M count=2 2>/dev/null
echo "print('hello world')" > "$TARGET_DIR/mixed_types/script.py"
echo "col1,col2,col3" > "$TARGET_DIR/mixed_types/data.csv"
echo '{"key": "value"}' > "$TARGET_DIR/mixed_types/config.json"
dd if=/dev/urandom of="$TARGET_DIR/mixed_types/archive.tar.gz" bs=1M count=3 2>/dev/null

# Generate special cases
echo "Creating special case files..."
mkdir -p "$TARGET_DIR/special_cases"
touch "$TARGET_DIR/special_cases/.hidden_file"
echo "File with spaces" > "$TARGET_DIR/special_cases/file with spaces.txt"
echo "Unicode test" > "$TARGET_DIR/special_cases/file_with_unicode_한국어.txt"
touch "$TARGET_DIR/special_cases/empty_file.txt"
echo "Long filename test" > "$TARGET_DIR/special_cases/this_is_a_very_long_filename_that_tests_the_scanner_ability_to_handle_long_names.txt"

# Generate symlinks
echo "Creating symbolic links..."
mkdir -p "$TARGET_DIR/symlinks"
ln -s ../small_files/file001.txt "$TARGET_DIR/symlinks/link_to_file"
ln -s ../nested "$TARGET_DIR/symlinks/link_to_dir"

# Generate directories with many files
echo "Creating directory with many files..."
mkdir -p "$TARGET_DIR/many_files"
for i in $(seq 1 500); do
    echo "Content $i" > "$TARGET_DIR/many_files/file_$i.log"
done

# Generate mixed depth structure
echo "Creating mixed depth structure..."
mkdir -p "$TARGET_DIR/mixed_depth/a/b/c/d/e"
mkdir -p "$TARGET_DIR/mixed_depth/x"
mkdir -p "$TARGET_DIR/mixed_depth/y/z"

for depth_dir in "$TARGET_DIR/mixed_depth" \
                 "$TARGET_DIR/mixed_depth/a" \
                 "$TARGET_DIR/mixed_depth/a/b" \
                 "$TARGET_DIR/mixed_depth/a/b/c" \
                 "$TARGET_DIR/mixed_depth/a/b/c/d" \
                 "$TARGET_DIR/mixed_depth/a/b/c/d/e" \
                 "$TARGET_DIR/mixed_depth/x" \
                 "$TARGET_DIR/mixed_depth/y" \
                 "$TARGET_DIR/mixed_depth/y/z"; do
    echo "Content" > "$depth_dir/file.txt"
done

# Print summary
echo ""
echo "Mock filesystem generation complete!"
echo "---"
echo "Location: $TARGET_DIR"
echo ""
echo "Structure summary:"
find "$TARGET_DIR" -type f | wc -l | xargs echo "Total files:"
find "$TARGET_DIR" -type d | wc -l | xargs echo "Total directories:"
du -sh "$TARGET_DIR" | awk '{print "Total size: " $1}'
echo ""
echo "Directory contents:"
tree -L 2 "$TARGET_DIR" 2>/dev/null || find "$TARGET_DIR" -maxdepth 2 -type d | sort

echo ""
echo "To run scanner on test data:"
echo "  cd $SCRIPT_DIR/../.."
echo "  cargo run -- scan --path $TARGET_DIR --output /tmp/test_scan.parquet"
