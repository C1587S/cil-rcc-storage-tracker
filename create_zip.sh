#!/bin/bash

rm -f cil_scans.zip
zip -r cil_scans.zip /project/cil/home_dirs/rcc/cil_scans \
    -x "/project/cil/home_dirs/rcc/cil_scans/slurm_out/*"
