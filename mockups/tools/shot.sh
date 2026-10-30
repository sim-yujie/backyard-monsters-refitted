#!/bin/bash
# Screenshot the game cropped to one window: shot.sh <file.png> <css selector> [pad px]
# (playwright-cli session window-skin; the file lands in mockups/shots/)
out="$1"; sel="$2"; pad="${3:-40}"
cd "$(dirname "$0")/../.." || exit 1
playwright-cli -s=window-skin run-code "async page => {
  const el = page.locator('$sel').last();
  const b = await el.boundingBox();
  if (!b) return 'no element';
  const v = page.viewportSize();
  const x = Math.max(0, b.x - $pad), y = Math.max(0, b.y - $pad - 30);
  const w = Math.min(v.width - x, b.width + 2 * $pad), h = Math.min(v.height - y, b.height + 2 * $pad + 30);
  await page.screenshot({ path: 'mockups/shots/$out', clip: { x, y, width: w, height: h } });
  return 'ok ' + Math.round(w) + 'x' + Math.round(h);
}" 2>&1 | grep -E "ok|no element|Error" | head -3
