#!/bin/bash
# Load the game with ?skin=$1, dismiss the "Slow internet?" pop-up, open the Town Hall (window-skin session).
cd "$(dirname "$0")/../.." || exit 1
playwright-cli -s=window-skin run-code "async page => {
  await page.goto('http://localhost:5591/?skin=$1');
  await page.waitForTimeout(7000);
  const keep = page.getByRole('button', { name: 'Keep High' });
  if (await keep.count()) await keep.click();
  await page.waitForTimeout(300);
  await page.mouse.click(800, 400);
  await page.waitForTimeout(1200);
}" 2>&1 | grep -i "error" | head -3
