# Duplicate Detection Investigation

**Date:** April 2026
**Status:** Closed -- not applicable to this filesystem

## Summary

Duplicate detection was investigated and found inapplicable to this filesystem. Monte Carlo simulation outputs produce same-name-same-size files with different content by design. A 200-file hash sample (SHA-256) across the top 10 candidate groups by estimated wasted space showed 0% true duplicates.

## Method

1. **Size+name candidate filter** identified 531K duplicate groups (7.3M excess files, ~319 TB estimated waste) among files >10 MB.
2. **Directory-level overlap** between `gcp/outputs/` and `battuta-shares-S3-archive/gcp/outputs/` showed 15 overlapping directory names, but with vastly different sizes (936 GB vs 7-17 GB per batch) -- different versions at different stages, not copies.
3. **Hash validation** of 20 randomly sampled files from each of the top 10 groups (200 files, ~26 GB): all 200 files had unique SHA-256 hashes. Zero confirmed duplicates.

## Why

The CIL filesystem is dominated by climate projection outputs (agriculture, energy, mortality, labor). These are parameterized Monte Carlo simulations where each run produces files with identical names, identical NetCDF schemas, identical grid dimensions (and therefore identical byte sizes), but different numerical content per scenario combination (batch x RCP x GCM x SSP x adaptation variant).

Same-name-same-size is the expected structural pattern for this workload, not a duplication signal.

## Conclusion

Content hashing is the only reliable duplicate detection method for this filesystem, but full-filesystem hashing (~460 TB) would require 10+ days of sustained I/O on GPFS -- not viable as a routine operation. Since the hash validation showed 0% signal even among the highest-confidence candidates, the expected return does not justify the cost.
