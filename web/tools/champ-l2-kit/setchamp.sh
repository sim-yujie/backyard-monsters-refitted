#!/bin/bash
# usage: setchamp.sh <type 1 Gorgo|2 Drull|3 Fomor|5 Krallen> <level> <power level> [hp] : agenttester's champion in the bym_champl2 copy only.
hp=${4:-20000}
timeout 30 docker exec bymr-database psql -U postgres -d bym_champl2 -c \
  "UPDATE bym.save SET champion='[{\"l\": $2, \"t\": $1, \"fb\": 0, \"fd\": 0, \"ft\": 1792818284, \"hp\": $hp, \"pl\": $3, \"status\": 0}]' WHERE basesaveid=2526"
