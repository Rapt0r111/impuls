const {chromium} = require('playwright');
const path = require('path');
const assert = require('assert');

(async () => {
  const root = path.resolve(__dirname, '..');
  const browser = await chromium.launch({
    headless: true,
    
  });
  const page = await browser.newPage({viewport: {width: 1440, height: 950}});
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.goto('file:///' + path.join(root, 'outputs', 'impuls-presentation.html').replaceAll('\\', '/'));
  await page.evaluate(() => document.fonts.ready);

  console.log('--- 1. Testing Telegram Header Controls ---');
  // Click dots menu
  await page.locator('#tg-dots').click();
  assert.equal(await page.locator('#tg-menu-dropdown').isVisible(), true, 'Dropdown should be visible');
  // Click info action
  await page.locator('[data-tg-action="info"]').click();
  assert.equal(await page.locator('#tg-menu-dropdown').isVisible(), false, 'Dropdown should close');
  assert.equal(await page.locator('#toast').isVisible(), true, 'Toast should show info message');

  console.log('--- 2. Testing Task Creation with Milestones ---');
  // Switch to commander
  await page.locator('[data-role="commander"]').click();
  await page.locator('[data-page="tasks"]').click();
  // Open create task dialog
  await page.locator('[data-action="open-create-task"]').click();
  assert.equal(await page.locator('#create-task-dialog').isVisible(), true);

  await page.locator('#task-create-title').fill('Разработка модуля шифрования данных');
  await page.locator('#task-create-type').selectOption('Разработка');
  await page.locator('#task-create-prio').selectOption('high');
  await page.locator('#task-create-xp').fill('200');
  await page.locator('#task-create-coins').fill('60');
  await page.locator('#task-create-due').fill('29 сентября');
  await page.locator('#task-create-criteria').fill('Критерий 1: Спецификация; Критерий 2: Код модуля');

  // Add 2 milestones
  await page.locator('#task-add-milestone').click();
  const mRows = page.locator('#task-milestones-container .milestone-form-row');
  assert.equal(await mRows.count(), 1);
  await mRows.nth(0).locator('.m-title').fill('Этап 1: Архитектура шифра');
  await mRows.nth(0).locator('.m-criteria').fill('Архитектура и угрозы описаны в отчёте.');
  await mRows.nth(0).locator('.m-xp').fill('80');
  await mRows.nth(0).locator('.m-coins').fill('25');

  await page.locator('#task-add-milestone').click();
  assert.equal(await mRows.count(), 2);
  await mRows.nth(1).locator('.m-title').fill('Этап 2: Реализация и бенчмарк');
  await mRows.nth(1).locator('.m-criteria').fill('Модуль собран и скорость измерена.');
  await mRows.nth(1).locator('.m-xp').fill('120');
  await mRows.nth(1).locator('.m-coins').fill('35');

  // Confirm task creation
  await page.locator('#task-create-confirm').click();
  assert.equal(await page.locator('#create-task-dialog').isVisible(), false);

  // Check state
  let snap = await page.evaluate(() => window.demoSnapshot());
  const createdTask = snap.tasks.find(t => t.title === 'Разработка модуля шифрования данных');
  assert(createdTask, 'Created task should exist in state');
  assert.equal(createdTask.milestones.length, 2, 'Task should have 2 milestones');
  assert.equal(createdTask.milestones[0].status, 'doing');
  assert.equal(createdTask.milestones[1].status, 'pending');

  console.log('--- 3. Testing Milestone Execution & Acceptance ---');
  // Switch to soldier
  await page.locator('[data-role="soldier"]').click();
  await page.locator('[data-page="tasks"]').click();
  // Open created task
  await page.locator(`[data-action="task"][data-id="${createdTask.id}"]`).click();
  assert(await page.locator('.milestones').isVisible(), 'Milestones section should be visible');

  // Start task
  await page.locator('[data-action="start-task"]').click();

  // Submit milestone 1
  await page.locator('#milestone-report-1').fill('Архитектура шифрования и модель угроз подготовлены.');
  await page.locator('[data-action="submit-milestone"][data-mid="1"]').click();
  snap = await page.evaluate(() => window.demoSnapshot());
  let taskInSnap = snap.tasks.find(t => t.id === createdTask.id);
  assert.equal(taskInSnap.milestones[0].status, 'submitted');

  // Switch to commander to accept milestone
  await page.locator('[data-role="commander"]').click();
  await page.locator('[data-page="tasks"]').click();
  await page.locator(`[data-action="task"][data-id="${createdTask.id}"]`).click();
  const prevXp = snap.xp;
  const prevPoints = snap.points;
  const prevWebSkill = snap.skills.web;

  await page.locator('[data-action="accept-milestone"][data-mid="1"]').click();
  assert(await page.locator('.celebration').isVisible(), 'Celebration dialog should show up');
  await page.locator('[data-action="close-celebration"]').click();

  snap = await page.evaluate(() => window.demoSnapshot());
  assert.equal(snap.xp, prevXp + 80, 'XP should increase by milestone 1 XP');
  assert.equal(snap.points, prevPoints + 25, 'Points should increase by milestone 1 coins');
  assert.equal(snap.skills.web, Math.min(100, prevWebSkill + 5), 'Dev skill should increase by 5');
  taskInSnap = snap.tasks.find(t => t.id === createdTask.id);
  assert.equal(taskInSnap.milestones[0].status, 'accepted');
  assert.equal(taskInSnap.milestones[1].status, 'doing', 'Milestone 2 should now be doing');

  console.log('--- 4. Testing Task Search & Category Filter ---');
  await page.locator('[data-page="tasks"]').click();
  // Search
  await page.locator('#task-search-input').fill('шифрования');
  assert.equal(await page.locator('.taskrow').count(), 1, 'Only encryption task should show up');

  await page.locator('#task-search-input').fill('');
  // Filter by category
  await page.locator('#task-cat-select').selectOption('duty');
  const dutyCount = await page.locator('.taskrow').count();
  assert(dutyCount >= 2, 'Should show duty tasks');

  await page.locator('#task-cat-select').selectOption('all');

  console.log('--- 5. Testing Admin Role & Quota Controls ---');
  await page.locator('[data-role="admin"]').click();
  snap = await page.evaluate(() => window.demoSnapshot());
  assert.equal(snap.role, 'admin');
  assert(await page.locator('.screen').innerText().then(t => t.includes('Панель администрирования')));

  // Adjust leave quota
  const prevLeaveQuota = snap.quota.leave;
  await page.locator('[data-action="admin-quota"][data-item="leave"][data-delta="-1"]').click();
  snap = await page.evaluate(() => window.demoSnapshot());
  assert.equal(snap.quota.leave, prevLeaveQuota - 1, 'Leave quota should decrease by 1');

  // Archive season
  await page.locator('[data-action="admin-archive-season"]').click();
  snap = await page.evaluate(() => window.demoSnapshot());
  assert.equal(snap.seasonView, 'archive', 'Season view should show the saved September archive');
  assert.equal(snap.season, 0, 'New season should start at zero XP');
  assert.equal(snap.seasonName, 'Октябрь 2026');
  assert(await page.locator('.screen').innerText().then(t => t.includes('Закрытый сезон · Сентябрь 2026')));

  console.log('--- 6. Testing Profile Competency Matrix & Reactive Achievements ---');
  await page.locator('[data-role="soldier"]').click();
  await page.locator('[data-page="profile"]').click();

  const profileText = await page.locator('.screen').innerText();
  assert(profileText.includes('Матрица компетенций исследователя'), 'Competency matrix should be present');
  assert(profileText.includes('Web-разработка и сервисы'), 'Web skill should be listed');
  assert(profileText.includes('НИР и технический анализ'), 'Science skill should be listed');
  assert(profileText.includes('Регламент и документация'), 'Duty skill should be listed');

  // Check achievements count
  const achievements = page.locator('.achievement');
  assert.equal(await achievements.count(), 6, 'Should display all 6 achievements');
  const achUnlocked = await page.locator('.achievement:not(.locked)').count();
  console.log('Currently unlocked achievements:', achUnlocked);
  assert(achUnlocked >= 2, 'At least 2 achievements should be unlocked given accepted tasks and skills');

  console.log('--- 7. Testing Telegram Back Button ---');
  await page.locator('[data-page="tasks"]').click();
  await page.locator('[data-action="task"][data-id="1"]').click();
  assert.equal((await page.evaluate(() => window.demoSnapshot())).page, 'task');
  await page.locator('#tg-back').click();
  assert.equal((await page.evaluate(() => window.demoSnapshot())).page, 'tasks', 'tg-back should return to tasks list');

  console.log('--- 8. Testing Milestone Distribution and Live Sync Banner ---');
  await page.locator('[data-role="commander"]').click();
  await page.locator('[data-page="tasks"]').click();
  await page.locator('[data-action="open-create-task"]').click();
  await page.locator('#task-create-xp').fill('150');
  await page.locator('#task-create-coins').fill('50');
  await page.locator('#task-add-milestone').click();
  await page.locator('#task-add-milestone').click();
  await page.locator('#task-add-milestone').click();
  await page.locator('#task-distribute-milestones').click();
  const syncBanner = await page.locator('#task-milestones-sync').innerText();
  assert(syncBanner.includes('полностью синхронизирована'), 'Banner should show synced');
  await page.locator('#task-create-cancel').click();

  assert.equal(errors.length, 0, 'No errors in console');
  console.log('ALL NEW FEATURES TESTS PASSED SUCCESSFULLY!');

  await browser.close();
})().catch(e => {
  console.error('Test failed:', e);
  process.exit(1);
});
