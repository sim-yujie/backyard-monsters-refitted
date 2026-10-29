#!/bin/sh
# the four resource buildings' sample renders and sheets, one after another: every look still, and every look's
# producing loop (the owner, 29 Oct: each look animates, as in Flash). render3.sh [name ...] does just those.
cd "$(dirname "$0")"
one() {   # one <name> <typeId>
  sh renderall.sh $1 1 3 6 10 -- anim 1 3 6 10 && python compare.py $1 $2 1 3 6 10 &&
    for lv in 1 3 6 10; do python compare.py $1 $2 anim $lv; done
}
for b in ${@:-pebble putty twig goo}; do
  case $b in pebble) one pebble 2 ;; putty) one putty 3 ;; twig) one twig 1 ;; goo) one goo 4 ;; esac
done
