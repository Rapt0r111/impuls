const {chromium} = require('playwright');
const path = require('path');
const assert = require('assert');

(async () => {
  const browser = await chromium.launch({headless: true});
  const page = await browser.newPage({viewport: {width: 1440, height: 900}});
  const fileUrl = 'file:///' + path.resolve(__dirname, '../outputs/impuls-presentation.html').replaceAll('\\', '/');
  await page.goto(fileUrl);
  await page.evaluate(() => document.fonts.ready);
  
  // 1. Check initial milestones in task 1
  await page.locator('[data-action="task"][data-id="1"]').click();
  const milestonesCount = await page.locator('.milestone-item').count();
  console.log('Milestones count:', milestonesCount);
  assert.equal(milestonesCount, 3, 'Should have 3 milestones');
  const progressText = await page.locator('.milestones-header .badge').innerText();
  console.log('Milestones progress:', progressText);
  assert.equal(progressText, '0 из 3 выполнено');
  
  // 2. Test individual milestone submission & acceptance
  console.log('Testing milestone 1 submission...');
  await page.locator('#milestone-report-1').fill('Структура страницы и критерии готовности описаны.');
  await page.locator('[data-action="submit-milestone"][data-mid="1"]').click();
  const m1Badge = await page.locator('.milestone-item').first().locator('.badge').innerText();
  console.log('Milestone 1 badge:', m1Badge);
  assert.equal(m1Badge, 'На проверке');

  await page.locator('[data-role="commander"]').click();
  await page.locator('[data-action="task"][data-id="1"]').click();
  await page.locator('[data-action="accept-milestone"][data-mid="1"]').click();
  await page.locator('[data-action="close-celebration"]').click();

  const snapshot = () => page.evaluate(() => window.demoSnapshot());
  let s = await snapshot();
  console.log('XP after milestone accept:', s.xp, 'Points:', s.points);
  assert.equal(s.xp, 1880, 'XP should increase by 40');
  assert.equal(s.points, 275, 'Points should increase by 15');

  // 3. Test proposals (Initiative pool)
  console.log('Testing initiative proposal creation...');
  await page.locator('[data-role="soldier"]').click();
  await page.locator('[data-page="tasks"]').click();
  await page.locator('[data-action="open-proposal"]').click();
  await page.locator('#prop-title').fill('Интеграция CI/CD пайплайна');
  await page.locator('#prop-desc').fill('Автоматизация сборки и запуска автотестов проектов роты.');
  await page.locator('#proposal-confirm').click();

  s = await snapshot();
  assert.equal(s.proposals.length, 1);
  assert.equal(s.proposals[0].title, 'Интеграция CI/CD пайплайна');

  console.log('Testing commander approval of proposal...');
  await page.locator('[data-role="commander"]').click();
  await page.locator('[data-page="reviews"]').click();
  const propText = await page.locator('.prop-card').innerText();
  assert(propText.includes('Интеграция CI/CD пайплайна'));
  await page.locator('[data-action="approve-proposal"]').click();

  s = await snapshot();
  assert(s.tasks.some(t => t.title === 'Интеграция CI/CD пайплайна'), 'New task should be created from proposal');

  // 4. Test Competency Matrix and Kudos
  console.log('Testing Skill Matrix & Peer Kudos...');
  await page.locator('[data-role="soldier"]').click();
  await page.locator('[data-page="profile"]').click();
  const skillsCount = await page.locator('.skills-box .skill-row').count();
  console.log('Skill rows count:', skillsCount);
  assert.equal(skillsCount, 3, 'Should display 3 competency categories');

  // Initially kudosReceived is 2, achievement is locked
  assert(await page.locator('.achievement-grid .achievement').nth(3).evaluate(el => el.classList.contains('locked')));

  // Send kudos
  await page.locator('[data-action="open-kudos"]').click();
  await page.locator('#kudos-text').fill('Спасибо за помощь в решении сложной проблемы с сетью.');
  await page.locator('#kudos-confirm').click();

  s = await snapshot();
  assert.equal(s.kudosReceived, 3, 'Kudos received should be 3');
  // Now achievement is unlocked
  assert(!await page.locator('.achievement-grid .achievement').nth(3).evaluate(el => el.classList.contains('locked')));

  // 5. Test Leaderboard Seasons Archive
  console.log('Testing Leaderboard Seasons Archive...');
  await page.locator('[data-page="leaderboard"]').click();
  await page.locator('[data-action="set-season"][data-value="august"]').click();
  const archiveText = await page.locator('.statusbox').innerText();
  console.log('Archive text:', archiveText);
  assert(archiveText.includes('Август 2026'), 'Should show August archive');

  await page.locator('[data-action="set-season"][data-value="current"]').click();
  const podiumText = await page.locator('.podium').innerText();
  assert(podiumText.includes('XP за сезон'), 'Should restore active September season');

  // 6. Check shop quota tag and purchase flow
  console.log('Testing shop quota & order...');
  await page.locator('[data-page="shop"]').click();
  const quotaText = await page.locator('.quota-tag').first().innerText();
  assert(quotaText.includes('Осталось мест: 3 из 5'), 'Should show quota 3 из 5');

  await page.locator('[data-action="buy"][data-id="leave"]').click();
  await page.locator('#purchase-confirm').click();
  const quotaAfterBuy = await page.locator('.quota-tag').first().innerText();
  assert(quotaAfterBuy.includes('Осталось мест: 2 из 5'), 'Should decrease quota to 2');

  await page.locator('[data-action="cancel-order"]').click();
  const quotaAfterCancel = await page.locator('.quota-tag').first().innerText();
  assert(quotaAfterCancel.includes('Осталось мест: 3 из 5'), 'Should restore quota to 3');

  // 7. Check multi-module laboratory on home
  await page.locator('[data-page="home"]').click();
  const moduleCards = await page.locator('.modules-grid .module-card').count();
  assert.equal(moduleCards, 3, 'Should show 3 laboratory module cards on home');

  // 8. Test voluntary open task taking
  console.log('Testing voluntary open task pool...');
  await page.locator('[data-page="tasks"]').click();
  await page.locator('[data-action="task"][data-id="4"]').click();
  assert(await page.locator('.badge.available').isVisible(), 'Should show available badge');
  await page.locator('[data-action="take-task"]').click();
  s = await snapshot();
  assert.equal(s.tasks.find(t => t.id === 4).status, 'doing', 'Open task should become doing');

  // 9. Verify company events banner is completely removed
  console.log('Verifying company events banner removal...');
  assert.equal(await page.locator('.event-banner').count(), 0, 'Event banner should not be present on home');
  await page.locator('[data-role="commander"]').click();
  await page.locator('[data-page="tasks"]').click();
  assert.equal(await page.locator('.event-banner').count(), 0, 'Event banner should not be present on commander tasks');

  // 10. Test commander custom points adjustment during review
  console.log('Testing commander custom XP and Coins adjustment on review...');
  await page.locator('#reset-demo').click();
  await page.locator('[data-action="task"][data-id="1"]').click();
  await page.locator('[data-action="submit-task"]').click();
  await page.locator('[data-role="commander"]').click();
  await page.locator('[data-action="task"][data-id="1"]').click();
  assert(await page.locator('#review-xp').isVisible(), 'Review XP input must be visible');
  assert(await page.locator('#review-coins').isVisible(), 'Review coins input must be visible');
  await page.locator('#review-xp').fill('200');
  await page.locator('#review-coins').fill('80');
  await page.locator('#bonus').selectOption('innovation'); // +40 XP / +20 coins
  await page.locator('#review-comment').fill('Объём и качество результата проверены.');
  await page.locator('[data-action="accept-task"]').click();
  s = await snapshot();
  // 1840 + (200 + 40) = 2080 XP; 260 + (80 + 20) = 360 points
  console.log('Adjusted XP:', s.xp, 'Adjusted Points:', s.points);
  assert.equal(s.xp, 2080, 'XP should reflect custom base 200 + bonus 40');
  assert.equal(s.points, 360, 'Points should reflect custom base 80 + bonus 20');
  await page.locator('[data-action="close-celebration"]').click();

  // 11. Test commander task creation dialog
  console.log('Testing commander task creation dialog...');
  await page.locator('[data-page="tasks"]').click();
  await page.locator('[data-action="open-create-task"]').click();
  await page.locator('#task-create-title').fill('Разработка сетевого анализатора');
  await page.locator('#task-create-xp').fill('120');
  await page.locator('#task-create-coins').fill('45');
  await page.locator('#task-create-criteria').fill('Реализовать перехват пакетов; сформировать отчёт.');
  await page.locator('#task-create-confirm').click();
  s = await snapshot();
  const createdTask = s.tasks.find(t => t.title === 'Разработка сетевого анализатора');
  assert(createdTask, 'Created task should exist in state.tasks');
  assert.equal(createdTask.xp, 120, 'Task should have 120 XP');
  assert.equal(createdTask.coins, 45, 'Task should have 45 coins');
  assert.equal(createdTask.status, 'assigned', 'Task should be assigned');

  console.log('ALL NEW FEATURES (POINTS ADJUSTMENT, EVENTS, OPEN TASKS, CREATION) TESTED AND PASSED PERFECTLY!');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
