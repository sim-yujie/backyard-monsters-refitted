#!/bin/bash
# List clipped or overflowing things inside the open windows (window-skin session).
cd "$(dirname "$0")/../.." || exit 1
playwright-cli -s=window-skin run-code "async page => page.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll('.panel, .panel *')) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const cs = getComputedStyle(el);
    const clipX = cs.overflowX !== 'visible' && el.scrollWidth > el.clientWidth + 1;
    const ell = cs.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1;
    if (clipX || ell) out.push((el.className || el.tagName) + ' ' + el.scrollWidth + '/' + el.clientWidth + (ell ? ' ellipsis' : '') + ' [' + (el.textContent || '').trim().slice(0, 30) + ']');
  }
  return out.slice(0, 25);
})" 2>&1 | sed -n 2p
