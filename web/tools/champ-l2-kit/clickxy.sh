#!/bin/bash
# usage: clickxy.sh <x> <y> : left click at a page position in the champ-sheets-l2b browser.
P="$(dirname "$0")/pw.sh"
bash "$P" mousemove "$1" "$2" >/dev/null && bash "$P" mousedown >/dev/null && bash "$P" mouseup >/dev/null
