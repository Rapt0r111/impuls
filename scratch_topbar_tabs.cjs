const {chromium} = require('playwright');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({viewport: {width: 1000, height: 200}});
  const fontCss = fs.readFileSync('work/fonts-embedded.css', 'utf8');

  const html = `<!DOCTYPE html><html><head><style>
    ${fontCss}
    :root {
      --bg: #08151c;
      --mint: #70e1c2;
      --line: #29404a;
      --muted: #acc0c6;
      --ink: #edf5f2;
    }
    body {
      background: #08151c;
      margin: 0;
      padding: 30px;
      font-family: Manrope, sans-serif;
      display: flex;
      flex-direction: column;
      gap: 20px;
      align-items: center;
    }
    .topbar-modes {
      display: inline-flex;
      align-items: center;
      background: rgba(11, 26, 34, 0.9);
      border: 1px solid rgba(75, 105, 115, 0.4);
      border-radius: 9999px;
      padding: 3px;
      gap: 2px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.25);
    }
    .mode-tab {
      position: relative;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 7px;
      height: 32px;
      padding: 0 15px;
      font-size: 12px;
      font-weight: 600;
      border-radius: 9999px;
      border: 0;
      background: transparent;
      color: #92a9b1;
      cursor: pointer;
      white-space: nowrap;
      transition: all 0.18s ease;
      line-height: 1;
    }
    .mode-tab .ico {
      width: 15px;
      height: 15px;
      stroke: currentColor;
      stroke-width: 2;
      fill: none;
      display: block;
      flex-shrink: 0;
    }
    .mode-tab:hover:not(.active) {
      color: #f0f7f5;
      background: rgba(255, 255, 255, 0.06);
    }
    .mode-tab.active {
      background: var(--mint);
      color: #061518;
      font-weight: 750;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.35), 0 0 12px rgba(112, 225, 194, 0.3);
    }
    .mode-tab.active .ico {
      color: #061518;
      stroke: #061518;
    }
  </style></head><body>
    <div class="topbar-modes" role="tablist">
      <button class="mode-tab active" data-view="demo" role="tab" aria-selected="true">
        <svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="2" width="14" height="20" rx="3"/><path d="M12 18h.01"/></svg>
        <span>Демонстрация</span>
      </button>
      <button class="mode-tab" data-view="economy" role="tab" aria-selected="false">
        <svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>
        <span>Экономика и роли</span>
      </button>
      <button class="mode-tab" data-view="docs" role="tab" aria-selected="false">
        <svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z"/><path d="M6 6h10M6 10h10"/></svg>
        <span>Документация</span>
      </button>
    </div>

    <!-- Active on Economy to see how second tab looks -->
    <div class="topbar-modes" role="tablist">
      <button class="mode-tab" data-view="demo" role="tab" aria-selected="false">
        <svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="2" width="14" height="20" rx="3"/><path d="M12 18h.01"/></svg>
        <span>Демонстрация</span>
      </button>
      <button class="mode-tab active" data-view="economy" role="tab" aria-selected="true">
        <svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>
        <span>Экономика и роли</span>
      </button>
      <button class="mode-tab" data-view="docs" role="tab" aria-selected="false">
        <svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z"/><path d="M6 6h10M6 10h10"/></svg>
        <span>Документация</span>
      </button>
    </div>
  </body></html>`;

  await page.setContent(html);
  await page.screenshot({path: 'scratch_topbar_tabs.png'});
  await browser.close();
  console.log('Saved scratch_topbar_tabs.png');
})();
