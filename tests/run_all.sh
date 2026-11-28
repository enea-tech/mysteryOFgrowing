#!/bin/bash
# uso: tests/run_all.sh <cartella-scratch>   (richiede playwright + dexie/chart.js/supabase-js/pglite in libs/node_modules)
S=${1:-$PWD}; OUT=$S/tests/RISULTATI.txt; : > $OUT
for t in pg_sql m1 m2 m3 m4 s1 s2 s3 p1; do echo "##### $t" | tee -a $OUT; timeout 280 node $S/tests/$t.js $S 2>&1 | grep -E "^(PASS|FAIL)|passati|FALLITI|errori console|^\(nessuno\)|PAGEERROR" | cut -c1-170 | tee -a $OUT; done
