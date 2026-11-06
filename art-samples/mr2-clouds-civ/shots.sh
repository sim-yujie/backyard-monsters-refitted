#!/bin/bash
# usage: bash shots.sh <prefix> <view...>   views: midfar far edge flat low wide
# Takes real in-game shots as yardtester (already logged in) into raw/<prefix>-<view>.png.
cd "$(dirname "$0")"
P="playwright-cli -s=mr2-clouds-civ"
HOME_X=26887; HOME_Y=15637
prefix=$1; shift

clickText() { # clicks the first visible button whose text contains $1
  $P eval "() => { const b = [...document.querySelectorAll('button')].find(b => b.offsetParent && b.textContent.includes('$1')); if (b) b.click(); return !!b }" 2>&1 | sed -n 2p
}

load() { # url query, quality
  $P localstorage-set bymr.quality "$2" >/dev/null
  $P goto "http://localhost:5381/?mr2look=on&$1" >/dev/null
  sleep 14
  clickText "Keep High" >/dev/null
  sleep 1
  # Open the map unless it is open already.
  $P eval "() => { const b = [...document.querySelectorAll('button')].find(b => b.offsetParent && b.textContent.trim() === 'Map'); if (b && !document.body.textContent.includes('Find bookmarks')) b.click(); return 1 }" >/dev/null
  sleep 10
  clickText "Engage" >/dev/null
}

view() { # zoom, dx, dy (world points from home)
  $P eval "() => { const c = globalThis.__bymrCamera; c.zoomAt($1, {x: 800, y: 450}); c.centreOn({x: $HOME_X + $2, y: $HOME_Y + $3}); document.querySelectorAll('.close, [aria-label=Close]').forEach(e => e.click && e.click()); return c.zoom }" 2>&1 | sed -n 2p
  sleep 6
}

shot() { $P screenshot --filename="raw/$prefix-$1.png" >/dev/null; echo "raw/$prefix-$1.png"; }

current=""
for v in "$@"; do
  case $v in
    midfar|far|edge|wide) want="mr2tilt=medium high" ;;
    flat) want="mr2tilt=off high" ;;
    low) want="mr2tilt=medium low" ;;
  esac
  if [ "$want" != "$current" ]; then load $want; current=$want; fi
  case $v in
    midfar|flat|low) view 0.22 0 0 ;;
    far) view 0.0001 0 0 ;;
    edge) view 1.3 -1050 -250 ;;
    wide) view 0.45 0 0 ;;
  esac
  shot $v
done
