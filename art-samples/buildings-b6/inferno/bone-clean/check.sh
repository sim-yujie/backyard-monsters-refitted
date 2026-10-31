#!/bin/sh
# check.sh <tier> : the contact check, without the pairs that are Tier 1's own approved joints.
cd "$(dirname "$0")"
PB_LINES=400 ../run.sh "$PWD/clean3d.py" "$1" check 2>&1 | grep -v HIPEW | grep -vE "'(bowl|bowlin|bowlpale|bowltop|bowllip|bowllipriv|bowlfoot|bowlseam|drum|drumband|drumcap|drumchock|drumrim|drumsplit|horn|horngroove|hornlip|plate|platetop|shield|shieldbolt|shieldbracket|shieldframe|stay|stayeye|stayfoot)', '(bowl|bowlin|bowlpale|bowltop|bowllip|bowllipriv|bowlfoot|bowlseam|drum|drumband|drumcap|drumchock|drumrim|drumsplit|horn|horngroove|hornlip|plate|platetop|shield|shieldbolt|shieldbracket|shieldframe|stay|stayeye|stayfoot)'\)" | cut -c1-240
