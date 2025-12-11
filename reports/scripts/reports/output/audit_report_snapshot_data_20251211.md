# Data Audit and Data Cleaning Report

**Directory:** `snapshot_data`  
**Generated:** 2025-12-11 06:54:32  
**Report Type:** Storage Audit and Data Analysis

---

## 1. Analysis of the Main Folder

### Storage Overview

- **Total Size:** 1.01 GB
- **Total Files:** 113,338
- **Subdirectories:** 17,823
- **Unique File Types:** 113

### Predominant File Types

| File Type | Count | Total Size | Percentage |
|-----------|-------|------------|------------|
| js | 34,750 | 443.36 MB | 42.88% |
| map | 7,491 | 244.13 MB | 23.61% |
| ts | 32,654 | 91.05 MB | 8.81% |
| pyc | 2,259 | 45.43 MB | 4.39% |
| py | 2,888 | 36.89 MB | 3.57% |
| json | 5,189 | 34.65 MB | 3.35% |
| so | 61 | 25.55 MB | 2.47% |
| md | 3,771 | 19.08 MB | 1.85% |
| wasm | 33 | 15.30 MB | 1.48% |
| node | 54 | 7.59 MB | 0.73% |

### Heaviest Subdirectory

**Directory:** `/Users/sebastiancadavidsanchez/Documents/Github/3cc/3ccap_dev/node_modules/typescript/lib`

- **Size:** 59.98 MB
- **Files:** 101
- **Percentage of total:** 5.80%

---

## 2. Hierarchical Weight Analysis

This section shows how storage is distributed across the directory hierarchy, 
identifying the heaviest folders at each level.

### Level 1

| Folder | File Count | Total Size | Percentage |
|--------|------------|------------|------------|
| `Users` | 113,337 | 1.01 GB | 100.00% |

### Level 2

| Folder | File Count | Total Size | Percentage |
|--------|------------|------------|------------|
| `sebastiancadavidsanchez` | 113,325 | 1.01 GB | 100.00% |

### Level 3

| Folder | File Count | Total Size | Percentage |
|--------|------------|------------|------------|
| `Documents` | 113,218 | 1.01 GB | 100.00% |

### Level 4

| Folder | File Count | Total Size | Percentage |
|--------|------------|------------|------------|
| `Github` | 111,390 | 1.00 GB | 100.00% |

### Level 5

| Folder | File Count | Total Size | Percentage |
|--------|------------|------------|------------|
| `3cc` | 99,763 | 919.18 MB | 100.00% |

### Structural Observations

- Directory structure has significant depth (>3 levels)
- Deep nested structures may impact performance and management

---

## 3. Hotspots (Critical Points)

This section identifies critical storage consumption points that require immediate attention.

### Heaviest Subdirectories (Top 20)

| Directory | File Count | Total Size | Largest File |
|-----------|------------|------------|--------------|
| `/Users/sebastiancadavidsanchez/Documents/Github/3cc/dev/node_modules/typescript/lib` | 101 | 59.98 MB | 11.14 MB |
| `/Users/sebastiancadavidsanchez/Documents/Github/3cc/3ccap/node_modules/typescript/lib` | 101 | 59.98 MB | 11.14 MB |
| `/Users/sebastiancadavidsanchez/Documents/Github/3cc/3ccap_dev/node_modules/typescript/lib` | 101 | 59.98 MB | 11.14 MB |
| `/Users/sebastiancadavidsanchez/Documents/Github/3cc/dev/node_modules/firebase` | 78 | 20.74 MB | 4.72 MB |
| `/Users/sebastiancadavidsanchez/Documents/Github/3cc/3ccap_dev/node_modules/firebase` | 78 | 20.74 MB | 4.72 MB |
| `/Users/sebastiancadavidsanchez/Documents/Github/3cc/3ccap/node_modules/firebase` | 78 | 20.74 MB | 4.72 MB |
| `/Users/sebastiancadavidsanchez/Documents/Github/3cc/3ccap_dev/node_modules/@firebase/firestore/dist` | 18 | 17.02 MB | 2.15 MB |
| `/Users/sebastiancadavidsanchez/Documents/Github/3cc/3ccap/node_modules/@firebase/firestore/dist` | 18 | 17.02 MB | 2.15 MB |
| `/Users/sebastiancadavidsanchez/Documents/Github/3cc/dev/node_modules/@firebase/firestore/dist` | 18 | 17.02 MB | 2.15 MB |
| `/Users/sebastiancadavidsanchez/Documents/Github/3cc/fin_exps/finance-exp/lib/python3.11/site-packages/pandas/_libs` | 88 | 13.23 MB | 2.02 MB |
| `/Users/sebastiancadavidsanchez/Documents/Github/3cc/3ccap/node_modules/@firebase/database/dist` | 16 | 8.00 MB | 1018.61 KB |
| `/Users/sebastiancadavidsanchez/Documents/Github/3cc/dev/node_modules/@firebase/database/dist` | 16 | 8.00 MB | 1018.61 KB |
| `/Users/sebastiancadavidsanchez/Documents/Github/3cc/3ccap_dev/node_modules/@firebase/database/dist` | 16 | 8.00 MB | 1018.61 KB |
| `/Users/sebastiancadavidsanchez/Documents/Github/3cc/dev/node_modules/bootstrap/dist/css` | 32 | 5.86 MB | 663.10 KB |
| `/Users/sebastiancadavidsanchez/Documents/Github/3cc/3ccap_dev/node_modules/bootstrap/dist/css` | 32 | 5.86 MB | 663.10 KB |
| `/Users/sebastiancadavidsanchez/Documents/Github/3cc/3ccap/node_modules/bootstrap/dist/css` | 32 | 5.86 MB | 663.10 KB |
| `/Users/sebastiancadavidsanchez/Documents/Github/3cc/3ccap_dev/node_modules/@firebase/firestore/dist/lite` | 17 | 5.75 MB | 814.70 KB |
| `/Users/sebastiancadavidsanchez/Documents/Github/3cc/dev/node_modules/@firebase/firestore/dist/lite` | 17 | 5.75 MB | 814.70 KB |
| `/Users/sebastiancadavidsanchez/Documents/Github/3cc/3ccap/node_modules/@firebase/firestore/dist/lite` | 17 | 5.75 MB | 814.70 KB |
| `/Users/sebastiancadavidsanchez/Documents/Github/3cc/fin_exps/finance-exp/lib/python3.11/site-packages/pandas/_libs/tslibs` | 63 | 5.55 MB | 904.92 KB |

### Largest Individual Files (Top 30)

| File Path | Size | Type | Last Modified |
|-----------|------|------|---------------|
| `/Users/sebastiancadavidsanchez/Documents/Github/3cc/3ccap/node_modules/typescript/lib/tsserver.js` | 11.14 MB | js | 2024-02-25 |
| `/Users/sebastiancadavidsanchez/Documents/Github/3cc/dev/node_modules/typescript/lib/tsserver.js` | 11.14 MB | js | 2023-12-27 |
| `/Users/sebastiancadavidsanchez/Documents/Github/3cc/3ccap_dev/node_modules/typescript/lib/tsserver.js` | 11.14 MB | js | 2023-10-27 |
| `/Users/sebastiancadavidsanchez/Documents/Github/3cc/dev/node_modules/typescript/lib/tsserverlibrary.js` | 11.08 MB | js | 2023-12-27 |
| `/Users/sebastiancadavidsanchez/Documents/Github/3cc/3ccap/node_modules/typescript/lib/tsserverlibrary.js` | 11.08 MB | js | 2024-02-25 |
| `/Users/sebastiancadavidsanchez/Documents/Github/3cc/3ccap_dev/node_modules/typescript/lib/tsserverlibrary.js` | 11.08 MB | js | 2023-10-27 |
| `/Users/sebastiancadavidsanchez/Documents/Github/3cc/3ccap/node_modules/typescript/lib/typescriptServices.js` | 10.44 MB | js | 2024-02-25 |
| `/Users/sebastiancadavidsanchez/Documents/Github/3cc/3ccap_dev/node_modules/typescript/lib/typescriptServices.js` | 10.44 MB | js | 2023-10-27 |
| `/Users/sebastiancadavidsanchez/Documents/Github/3cc/dev/node_modules/typescript/lib/typescriptServices.js` | 10.44 MB | js | 2023-12-27 |
| `/Users/sebastiancadavidsanchez/Documents/Github/3cc/3ccap/node_modules/typescript/lib/typescript.js` | 10.44 MB | js | 2024-02-25 |
| `/Users/sebastiancadavidsanchez/Documents/Github/3cc/3ccap_dev/node_modules/typescript/lib/typescript.js` | 10.44 MB | js | 2023-10-27 |
| `/Users/sebastiancadavidsanchez/Documents/Github/3cc/dev/node_modules/typescript/lib/typescript.js` | 10.44 MB | js | 2023-12-27 |
| `/Users/sebastiancadavidsanchez/Documents/Github/3cc/dev/node_modules/typescript/lib/typingsInstaller.js` | 7.77 MB | js | 2023-12-27 |
| `/Users/sebastiancadavidsanchez/Documents/Github/3cc/3ccap_dev/node_modules/typescript/lib/typingsInstaller.js` | 7.77 MB | js | 2023-10-27 |
| `/Users/sebastiancadavidsanchez/Documents/Github/3cc/3ccap/node_modules/typescript/lib/typingsInstaller.js` | 7.77 MB | js | 2024-02-25 |
| `/Users/sebastiancadavidsanchez/Documents/Github/3cc/3ccap/node_modules/typescript/lib/tsc.js` | 5.87 MB | js | 2024-02-25 |
| `/Users/sebastiancadavidsanchez/Documents/Github/3cc/3ccap_dev/node_modules/typescript/lib/tsc.js` | 5.87 MB | js | 2023-10-27 |
| `/Users/sebastiancadavidsanchez/Documents/Github/3cc/dev/node_modules/typescript/lib/tsc.js` | 5.87 MB | js | 2023-12-27 |
| `/Users/sebastiancadavidsanchez/Documents/Github/3cc/dev/node_modules/firebase/firebase-compat.js.map` | 4.72 MB | map | 2023-12-27 |
| `/Users/sebastiancadavidsanchez/Documents/Github/3cc/3ccap/node_modules/firebase/firebase-compat.js.map` | 4.72 MB | map | 2024-02-25 |
| `/Users/sebastiancadavidsanchez/Documents/Github/3cc/3ccap_dev/node_modules/firebase/firebase-compat.js.map` | 4.72 MB | map | 2023-10-27 |
| `/Users/sebastiancadavidsanchez/Documents/Github/3cc/fin_exps/finance-exp/lib/python3.11/site-packages/numpy/core/_multiarray_umath.cpython-311-darwin.so` | 3.53 MB | so | 2023-02-03 |
| `/Users/sebastiancadavidsanchez/Documents/Github/3cc/3ccap/node_modules/web3/dist/web3.min.js.map` | 3.15 MB | map | 2024-02-25 |
| `/Users/sebastiancadavidsanchez/Documents/Github/3cc/dev/node_modules/web3/dist/web3.min.js.map` | 3.15 MB | map | 2023-12-27 |
| `/Users/sebastiancadavidsanchez/Documents/Github/3cc/3ccap_dev/node_modules/web3/dist/web3.min.js.map` | 3.15 MB | map | 2023-10-27 |
| `/Users/sebastiancadavidsanchez/Documents/Github/3cc/3ccap_dev/node_modules/next/dist/compiled/next-server/next-server.js` | 2.64 MB | js | 2023-10-27 |
| `/Users/sebastiancadavidsanchez/Documents/Github/3cc/dev/node_modules/next/dist/compiled/next-server/next-server.js` | 2.64 MB | js | 2023-12-27 |
| `/Users/sebastiancadavidsanchez/Documents/Github/3cc/3ccap/node_modules/next/dist/compiled/next-server/next-server.js` | 2.64 MB | js | 2024-02-25 |
| `/Users/sebastiancadavidsanchez/Documents/Github/3cc/dev/node_modules/next/dist/server/lib/squoosh/avif/avif_node_enc.wasm` | 2.52 MB | wasm | 2023-12-27 |
| `/Users/sebastiancadavidsanchez/Documents/Github/3cc/3ccap/node_modules/next/dist/server/lib/squoosh/avif/avif_node_enc.wasm` | 2.52 MB | wasm | 2024-02-25 |

### Files by Size Threshold

**Over 10Gb:**

- Count: 0
- Total Size: 0.00 B

**Over 50Gb:**

- Count: 0
- Total Size: 0.00 B

**Over 100Gb:**

- Count: 0
- Total Size: 0.00 B

### File Types Consuming Most Space

| File Type | File Count | Total Size | Average Size | Max Size |
|-----------|------------|------------|--------------|----------|
| js | 34,750 | 443.36 MB | 13.06 KB | 11.14 MB |
| map | 7,491 | 244.13 MB | 33.37 KB | 4.72 MB |
| ts | 32,654 | 91.05 MB | 2.86 KB | 859.21 KB |
| pyc | 2,259 | 45.43 MB | 20.59 KB | 683.29 KB |
| py | 2,888 | 36.89 MB | 13.08 KB | 419.45 KB |
| json | 5,189 | 34.65 MB | 6.84 KB | 1.05 MB |
| so | 61 | 25.55 MB | 428.84 KB | 3.53 MB |
| md | 3,771 | 19.08 MB | 5.18 KB | 122.41 KB |
| wasm | 33 | 15.30 MB | 474.89 KB | 2.52 MB |
| node | 54 | 7.59 MB | 143.86 KB | 288.72 KB |
| csv | 57 | 7.14 MB | 128.18 KB | 1.53 MB |
| o | 18 | 6.90 MB | 392.29 KB | 666.41 KB |
| mjs | 764 | 6.49 MB | 8.70 KB | 1.17 MB |
| no_extension | 2,777 | 5.63 MB | 2.08 KB | 234.10 KB |
| css | 91 | 4.98 MB | 56.08 KB | 274.23 KB |

---

## 4. Age (Temporal) Analysis

Analysis of files based on last modification time, identifying old or unused data.

### Files by Age

| Age Range | File Count | Total Size |
|-----------|------------|------------|
| 0-30 days | 0 | 0.00 B (0%) |
| 31-90 days | 0 | 0.00 B (0%) |
| 91-180 days | 0 | 0.00 B (0%) |
| 6-12 months | 0 | 0.00 B (0%) |
| Over 1 year | 0 | 0.00 B (0%) |

### Old Files (>1 year) by Type

| File Type | File Count | Total Size |
|-----------|------------|------------|

### Directories with High Amounts of Old Content

| Directory | Old Files | Total Size | Most Recent Modification |
|-----------|-----------|------------|--------------------------|

---

## 5. Cleanup and Reduction Opportunities

This section identifies potential cleanup and reduction opportunities.

### Potential Duplicate Files

**Total potential space wasted by duplicates:** 316.81 MB

| Filename | Size | Occurrences | Wasted Space |
|----------|------|-------------|--------------|
| tsserver.js | 11.14 MB | 3 | 33.41 MB |
| tsserverlibrary.js | 11.08 MB | 3 | 33.23 MB |
| typescriptServices.js | 10.44 MB | 3 | 31.31 MB |
| typescript.js | 10.44 MB | 3 | 31.31 MB |
| typingsInstaller.js | 7.77 MB | 3 | 23.31 MB |
| tsc.js | 5.87 MB | 3 | 17.62 MB |
| firebase-compat.js.map | 4.72 MB | 3 | 14.16 MB |
| web3.min.js.map | 3.15 MB | 3 | 9.45 MB |
| next-server.js | 2.64 MB | 3 | 7.93 MB |
| avif_node_enc.wasm | 2.52 MB | 3 | 7.56 MB |
| bundle5.js | 2.30 MB | 3 | 6.89 MB |
| firebase-firestore-compat.js.map | 2.24 MB | 3 | 6.71 MB |
| firebase-firestore.js.map | 2.19 MB | 3 | 6.57 MB |
| index.node.cjs.js.map | 2.15 MB | 3 | 6.45 MB |
| index.node.mjs.map | 2.03 MB | 3 | 6.08 MB |
| index.esm5.js.map | 1.93 MB | 3 | 5.78 MB |
| index.rn.js.map | 1.89 MB | 3 | 5.67 MB |
| index.cjs.js.map | 1.44 MB | 3 | 4.32 MB |
| index.esm2017.js.map | 1.44 MB | 3 | 4.32 MB |
| index.js | 1.39 MB | 3 | 4.17 MB |

### Checkpoint Files

**Total checkpoint files:** 2  
**Total size:** 169.00 B

### Temporary and Intermediate Files

No temporary files detected.

### Compression Opportunities

**Estimated space savings through compression:** 4.35 MB

| File Type | File Count | Current Size | Estimated Savings |
|-----------|------------|--------------|-------------------|
| json | 3 | 3.16 MB | 2.21 MB |
| csv | 2 | 3.06 MB | 2.14 MB |

### Priority Cleanup Actions

**High Priority:**


**Medium Priority:**

1. Compress eligible files: 4.35 MB estimated savings
2. Investigate and remove duplicate files: 316.81 MB potential savings

**Low Priority:**

1. Archive old data (>1 year) to cheaper storage tiers
2. Review rarely accessed files for archival or deletion

---

## 7. Analysis of Critically Large Files

Files larger than 10GB require special attention due to their significant storage impact.

---

## 8. Trash, Hidden, and Residual Files Analysis

### Hidden Files (starting with .)

- **Count:** 0
- **Total Size:** 0.00 B

### Cache and Application Directories

- **Count:** 108,127
- **Total Size:** 951.25 MB

Includes: `.cache/`, `__pycache__/`, `.ipynb_checkpoints/`, `node_modules/`


### Empty Files (0 bytes)

- **Count:** 382


### Trash Folders

No files in trash folders detected.

---

## 11. File Type Classification

Breakdown of storage usage by data category.

| Category | File Count | Total Size | Avg Size | Max Size | Percentage |
|----------|------------|------------|----------|----------|------------|
| Datasets | 6 | 1.57 KB | 267.67 B | 449.00 B | 0.00% |
| Checkpoints | 6 | 3.64 KB | 620.67 B | 1.36 KB | 0.00% |
| Logs | 1 | 711.00 B | 711.00 B | 711.00 B | 0.00% |
| Temporary | 3 | 20.91 KB | 6.97 KB | 6.97 KB | 0.00% |
| Environments | 2,259 | 45.43 MB | 20.59 KB | 683.29 KB | 4.39% |
| Outputs | 77 | 3.71 MB | 49.34 KB | 476.17 KB | 0.36% |
| Other | 110,986 | 984.72 MB | 9.09 KB | 11.14 MB | 95.24% |

### Category Analysis

**Other:** 984.72 MB (95.24% of classified data)

**Environments:** 45.43 MB (4.39% of classified data)

**Outputs:** 3.71 MB (0.36% of classified data)

---

## Report Information

- **Generated by:** Storage Analytics Scanner
- **Report Date:** 2025-12-11 06:54:32
- **Directory Analyzed:** `snapshot_data`

---

*This report was automatically generated from snapshot data.*