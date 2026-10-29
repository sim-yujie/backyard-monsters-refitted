#!/bin/sh
# the four resource buildings' sample renders and sheets, one after another
cd "$(dirname "$0")"
sh renderall.sh pebble 1 3 6 10 -- anim 10 && python compare.py pebble 2 1 3 6 10 && python compare.py pebble 2 anim 10
sh renderall.sh putty 1 3 6 10 -- anim 10 && python compare.py putty 3 1 3 6 10 && python compare.py putty 3 anim 10
sh renderall.sh twig 1 3 6 10 -- anim 10 && python compare.py twig 1 1 3 6 10 && python compare.py twig 1 anim 10
sh renderall.sh goo 1 3 6 10 -- anim 10 && python compare.py goo 4 1 3 6 10 && python compare.py goo 4 anim 10
