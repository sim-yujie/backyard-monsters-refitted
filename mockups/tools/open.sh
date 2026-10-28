#!/bin/bash
# Close what is open and click a HUD button by its name: open.sh "<name regex>" [wait ms]
cd "$(dirname "$0")/../.." || exit 1
playwright-cli -s=window-skin run-code "async page => {
  for (let i = 0; i < 3; i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(150); }
  await page.getByRole('button', { name: /$1/ }).first().click();
  await page.waitForTimeout(${2:-1500});
}" 2>&1 | grep -i "error" | head -2
playwright-cli -s=window-skin screenshot --filename=mockups/shots/tmp-1.png >/dev/null 2>&1
