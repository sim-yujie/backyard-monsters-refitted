# try.sh "x,y,z,tilt,roll" keel levels : gap + tray contacts for a tray placement
B="C:/Program Files/Blender Foundation/Blender 5.2/blender.exe"
for lv in $3; do
  echo "== L$lv $1 keel $2"
  TW_TRAY="$1" TW_KEEL="$2" "$B" -b --factory-startup -P twig2.py -- $lv gap 2>&1 | grep -E "GAP|Error|line [0-9]"
  TW_TRAY="$1" TW_KEEL="$2" "$B" -b --factory-startup -P twig2.py -- $lv check 2>&1 | grep -E "CHECK" | grep "tray" | grep -v "'roller', 'tray'" | cut -c1-200
done
