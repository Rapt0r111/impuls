const {chromium} = require('playwright');
const {pathToFileURL} = require('url');
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');

(async () => {
  const root = path.resolve(__dirname, '..');
  const artifacts = path.join(root, 'docs/verification/assets/presentation-motion');
  fs.mkdirSync(artifacts, {recursive:true});
  const browser = await chromium.launch({headless:true});
  const page = await browser.newPage({viewport:{width:1440,height:1000}});
  const errors = [], requests = [], layout = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {if (/^https?:/.test(request.url())) requests.push(request.url());});
  const url = pathToFileURL(path.join(root, 'outputs/impuls-presentation.html')).href;
  await page.goto(url);
  await page.evaluate(() => document.fonts.ready);
  const artLoaded = await page.evaluate(async () => {
    const background = getComputedStyle(document.querySelector('.launch-art')).backgroundImage;
    if (background === 'none') return false;
    const image = new Image();
    image.src = background.slice(5,-2);
    await image.decode();
    return image.naturalWidth >= 1000;
  });
  assert(artLoaded, 'Embedded hero illustration must decode and render');
  await page.waitForFunction(() => window.presentationGraphics?.().scenes === 2);
  const initialFrames = await page.evaluate(() => window.presentationGraphics().frames);
  await page.waitForFunction(before => window.presentationGraphics().frames > before + 2, initialFrames);
  await page.evaluate(async () => {
    await Promise.all(document.getAnimations().filter(animation => animation.effect.getComputedTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {})));
  });
  await page.screenshot({path:path.join(artifacts,'desktop.png')});
  for (const width of [320,360,390,768,920,1050,1150,1280,1440]) {
    await page.setViewportSize({width,height:1000});
    const current = await page.evaluate(() => ({
      width:innerWidth, scroll:document.documentElement.scrollWidth,
      screen:document.querySelector('#screen').scrollWidth,
      screenClient:document.querySelector('#screen').clientWidth,
      headlineLines:document.querySelector('.launch h1').getBoundingClientRect().height /
        parseFloat(getComputedStyle(document.querySelector('.launch h1')).lineHeight),
      navLabelsFit:[...document.querySelectorAll('.bottomnav button')].every(button => button.querySelector('span').scrollWidth <= button.clientWidth)
    }));
    layout.push(current);
    assert(current.scroll <= width, `Page overflow at ${width}`);
    assert(current.screen <= current.screenClient + 1, `Demo overflow at ${width}`);
    assert(current.headlineLines <= 4.1, `Headline exceeds four lines at ${width}`);
    assert(current.navLabelsFit, `Demo navigation label overlap at ${width}`);
    if ([320,390].includes(width)) {
      await page.screenshot({path:path.join(artifacts,`mobile-${width}.png`)});
      await page.locator('.democol').scrollIntoViewIfNeeded();
      await page.screenshot({path:path.join(artifacts,`demo-${width}.png`)});
      await page.locator('.overview').scrollIntoViewIfNeeded();
      await page.screenshot({path:path.join(artifacts,`flow-${width}.png`)});
      await page.evaluate(() => window.scrollTo(0,0));
    }
  }
  await page.setViewportSize({width:1440,height:1000});
  await page.locator('.overview').scrollIntoViewIfNeeded();
  await page.evaluate(async () => {
    await Promise.all(document.getAnimations().filter(animation => animation.effect.getComputedTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {})));
  });
  await page.screenshot({path:path.join(artifacts,'flow-desktop.png')});
  await page.locator('#research-core').scrollIntoViewIfNeeded();
  assert(await page.locator('#research-core').evaluate(canvas => canvas.classList.contains('graphics-ready')));
  await page.locator('[data-core-turn="1"]').click();
  await page.locator('#research-core').focus();
  await page.keyboard.press('ArrowLeft');
  assert.equal(await page.locator('#research-core').evaluate(canvas => canvas.getContext('webgl').getError()), 0);
  await page.locator('.team-layout').screenshot({path:path.join(artifacts,'core-desktop.png')});
  const teamFrames = await page.evaluate(() => window.presentationGraphics().frames);
  await page.waitForFunction(before => window.presentationGraphics().frames > before + 2, teamFrames);
  await page.locator('#chapter-1').scrollIntoViewIfNeeded();
  await page.waitForFunction(() => window.presentationGraphics().active === 0 && !window.presentationGraphics().animating);
  await page.locator('#motion').uncheck();
  assert.equal(await page.evaluate(() => window.presentationGraphics().animating), false);
  assert.equal(await page.locator('#ambient-effects').getAttribute('aria-pressed'), 'false');
  // Independent expected values: 1840 + 150 + 20 = 2010; 260 + 50 + 10 = 320.
  const demoBefore = await page.evaluate(() => window.demoSnapshot());
  await page.locator('input[name="lab-bonus"][value="quality"]').check();
  await page.locator('#lab-accept').click();
  assert.equal((await page.locator('#lab-xp').innerText()).replace(/\s/g,''), '2010');
  assert.equal(await page.locator('#lab-points').innerText(), '320');
  assert.equal(await page.locator('#lab-level').innerText(), '5');
  assert(await page.locator('#lab-accept').isDisabled());
  assert.deepEqual(await page.evaluate(() => window.demoSnapshot()), demoBefore, 'Example is isolated from prototype');
  await page.locator('#lab-reset').click();
  // The team narrative follows the actual local demo, including a reset.
  await page.locator('#guide-start').click();
  await page.locator('[data-action="submit-task"]').click();
  await page.locator('[data-role="commander"]').click();
  await page.locator('[data-action="task"][data-id="1"]').click();
  await page.locator('#review-comment').fill('Учебный результат соответствует критериям.');
  await page.locator('[data-action="accept-task"]').click();
  assert((await page.locator('#team-total').innerText()).startsWith('23'));
  await page.locator('[data-action="close-celebration"]').click();
  await page.locator('#reset-demo').click();
  assert((await page.locator('#team-total').innerText()).startsWith('22'));
  await page.locator('input[name="lab-bonus"][value="none"]').check();
  await page.locator('#lab-accept').click();
  assert.equal((await page.locator('#lab-xp').innerText()).replace(/\s/g,''), '1990');
  assert.equal(await page.locator('#lab-points').innerText(), '310');
  assert.equal(await page.locator('#lab-level').innerText(), '4');
  await page.locator('#lab-reset').click();
  await page.locator('input[name="lab-bonus"][value="team"]').check();
  await page.locator('#lab-accept').click();
  assert.equal((await page.locator('#lab-xp').innerText()).replace(/\s/g,''), '2015');
  assert.equal(await page.locator('#lab-points').innerText(), '325');
  await page.locator('#lab-reset').click();
  await page.locator('.mechanics').scrollIntoViewIfNeeded();
  await page.screenshot({path:path.join(artifacts,'mechanics-desktop.png')});
  await page.locator('[data-module="science"]').click();
  assert((await page.locator('#module-detail').innerText()).includes('7 / 10'));
  await page.locator('[data-module="duty"]').click();
  assert((await page.locator('#module-detail').innerText()).includes('6 / 10'));
  await page.locator('[data-module="dev"]').click();
  assert((await page.locator('#module-detail').innerText()).includes('9 / 10'));
  await page.locator('[data-achievement="mentor"]').click();
  assert((await page.locator('#achievement-explainer').innerText()).includes('три'));
  await page.locator('.team-world').scrollIntoViewIfNeeded();
  await page.screenshot({path:path.join(artifacts,'team-desktop.png')});
  await page.locator('[data-page="shop"]').click();
  assert.equal(await page.evaluate(() => document.getAnimations().length), 0, 'Effects off cancels all motion');
  await page.locator('#motion').check();
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.locator('[data-page="tasks"]').click();
  assert.equal(await page.evaluate(() => document.getAnimations().length), 0, 'Live system preference cancels motion');
  assert(await page.locator('body').evaluate(body => body.classList.contains('no-motion')));
  // Enabling the local switch cannot override the operating-system preference.
  await page.locator('#motion').check();
  await page.locator('[data-page="profile"]').click();
  assert.equal(await page.evaluate(() => document.getAnimations().length), 0);
  const canLoseContext = await page.locator('#research-core').evaluate(canvas => {
    const extension = canvas.getContext('webgl').getExtension('WEBGL_lose_context');
    if (!extension) return false;
    window.testContextRecovery = extension;
    extension.loseContext();
    return true;
  });
  if (canLoseContext) {
    await page.waitForFunction(() => !document.querySelector('.team-scene').classList.contains('has-webgl'));
    assert(await page.locator('[data-core-turn="1"]').isHidden());
    await page.evaluate(() => window.testContextRecovery.restoreContext());
    await page.waitForFunction(() => document.querySelector('#research-core').classList.contains('graphics-ready'));
  }
  await page.locator('#present-toggle').focus();
  await page.keyboard.press('Enter');
  assert(await page.locator('body').evaluate(body => body.classList.contains('presentation')));
  assert(await page.locator('#phone').isVisible());
  await page.keyboard.press('Enter');
  await page.locator('.toc a').first().focus();
  assert.equal(await page.locator('.toc a').first().evaluate(link => getComputedStyle(link).outlineStyle), 'solid');
  await page.keyboard.press('Enter');
  assert(await page.locator('#chapter-1').evaluate(chapter => chapter.open));
  await page.locator('#expand-doc').click();
  await page.emulateMedia({media:'print'});
  assert.equal(await page.locator('.doc details[open]').count(), 23);
  assert(await page.locator('.doc').isVisible());
  assert.equal(await page.evaluate(() => document.getAnimations().length), 0);
  await page.emulateMedia({media:'screen'});
  const noJs = await browser.newPage({javaScriptEnabled:false,viewport:{width:390,height:1000}});
  await noJs.goto(url);
  assert(await noJs.locator('.launch h1').isVisible());
  assert(await noJs.locator('.noscript').isVisible());
  await noJs.locator('#chapter-1 summary').click();
  await noJs.locator('#chapter-1 summary').click();
  assert(await noJs.locator('#chapter-1 .chapter').isVisible());
  const fallbackBrowser = await chromium.launch({headless:true,args:['--disable-webgl']});
  const fallback = await fallbackBrowser.newPage({viewport:{width:390,height:1000}});
  await fallback.goto(url);
  assert(await fallback.locator('#research-core').isHidden());
  assert((await fallback.locator('#core-caption').innerText()).includes('Иллюстрация'));
  await fallback.locator('#lab-accept').click();
  assert(await fallback.locator('#lab-accept').isDisabled());
  await fallbackBrowser.close();
  assert.equal(errors.length, 0);
  assert.equal(requests.length, 0);
  const report = {status:'pass',layout,errors,requests,checks:[
    'finite entrance', 'nine responsive widths', 'effects off cancels animations',
    'live reduced motion', 'system preference wins', 'keyboard presentation mode',
    'keyboard chapter navigation and focus', 'print document', 'no-JavaScript reading',
    'three independent reward calculations', 'example isolation and repeat prevention',
    'team module selection and actual demo sync', 'achievement meanings', 'top effects control',
    'embedded illustration decodes', 'two WebGL scenes render after load and scroll',
    '3D keyboard and button rotation', 'offscreen GPU scheduling stops', 'effects stop GPU animation',
    'WebGL-unavailable fallback', ...(canLoseContext ? ['WebGL context loss and recovery'] : [])
  ]};
  fs.writeFileSync(path.join(artifacts,'verification.json'), JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
  await browser.close();
})().catch(error => {console.error(error);process.exit(1);});
