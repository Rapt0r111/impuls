const {chromium} = require('playwright');
const path = require('path');
const assert = require('assert');

(async () => {
  console.log('--- STARTING COMPREHENSIVE DEMO VERIFICATION ---');
  const browser = await chromium.launch({headless: true});
  const page = await browser.newPage({viewport: {width: 1440, height: 1000}});
  const fileUrl = 'file:///' + path.resolve(__dirname, '../outputs/impuls-presentation.html').replaceAll('\\', '/');
  
  const pageErrors = [];
  page.on('pageerror', err => pageErrors.push(err.message));
  page.on('console', msg => {
    if (msg.type() === 'error') pageErrors.push(msg.text());
  });

  await page.goto(fileUrl);
  await page.evaluate(() => document.fonts.ready);
  const snapshot = () => page.evaluate(() => window.demoSnapshot());

  console.log('1. Testing Topbar, Presentation Mode, and Guide...');
  // Present toggle
  const presentBtn = page.locator('#present-toggle');
  await presentBtn.click();
  let isPres = await page.locator('body').evaluate(el => el.classList.contains('presentation'));
  assert.equal(isPres, true, 'Body should have presentation class');
  assert.equal(await presentBtn.innerText(), 'Вернуться к проекту');
  await presentBtn.click();
  isPres = await page.locator('body').evaluate(el => el.classList.contains('presentation'));
  assert.equal(isPres, false, 'Body should not have presentation class');
  assert.equal(await presentBtn.innerText(), 'Режим показа');

  // Motion checkbox
  const motionCheckbox = page.locator('#motion');
  await motionCheckbox.uncheck();
  let hasNoMotion = await page.locator('body').evaluate(el => el.classList.contains('no-motion'));
  assert.equal(hasNoMotion, true, 'Reduced motion class should be added');
  await motionCheckbox.check();
  hasNoMotion = await page.locator('body').evaluate(el => el.classList.contains('no-motion'));
  assert.equal(hasNoMotion, false, 'Reduced motion class should be removed');

  // Guide start button
  await page.locator('#guide-start').click();
  let s = await snapshot();
  assert.equal(s.role, 'soldier');
  assert.equal(s.page, 'task');
  assert((await page.locator('.detail-title').innerText()).includes('Обновить страницу проекта'));

  // Reset demo button
  await page.locator('#reset-demo').click();
  s = await snapshot();
  assert.equal(s.page, 'home');
  assert.equal(s.xp, 1840);
  assert.equal(s.points, 260);

  console.log('2. Testing Role Switcher & Bottom Navigation...');
  // Switch to commander
  await page.locator('[data-role="commander"]').click();
  s = await snapshot();
  assert.equal(s.role, 'commander');
  assert.equal(s.page, 'reviews');
  assert.equal(await page.locator('#bottomnav button.active').innerText(), 'Проверка');

  // Switch to soldier
  await page.locator('[data-role="soldier"]').click();
  s = await snapshot();
  assert.equal(s.role, 'soldier');
  assert.equal(s.page, 'home');
  assert.equal(await page.locator('#bottomnav button.active').innerText(), 'Главная');

  // Navigate across soldier tabs
  const navTabs = ['tasks', 'leaderboard', 'shop', 'profile', 'home'];
  for (const tab of navTabs) {
    await page.locator(`[data-page="${tab}"]`).click();
    s = await snapshot();
    assert.equal(s.page, tab, `Active page should be ${tab}`);
  }

  console.log('3. Testing Task Filters and Taking Open Tasks...');
  await page.locator('[data-page="tasks"]').click();
  // Filter buttons: active, submitted, accepted, all
  await page.locator('[data-action="filter"][data-value="active"]').click();
  assert.equal((await snapshot()).filter, 'active');
  await page.locator('[data-action="filter"][data-value="submitted"]').click();
  assert.equal((await snapshot()).filter, 'submitted');
  await page.locator('[data-action="filter"][data-value="accepted"]').click();
  assert.equal((await snapshot()).filter, 'accepted');
  await page.locator('[data-action="filter"][data-value="all"]').click();
  assert.equal((await snapshot()).filter, 'all');

  // Open task 4 (available in pool)
  await page.locator('[data-action="task"][data-id="4"]').click();
  assert.equal((await snapshot()).page, 'task');
  assert(await page.locator('[data-action="take-task"]').isVisible());
  await page.locator('[data-action="take-task"]').click();
  s = await snapshot();
  assert.equal(s.tasks.find(t => t.id === 4).status, 'doing');
  // Back to tasks button
  await page.locator('[data-action="back-tasks"]').click();
  assert.equal((await snapshot()).page, 'tasks');

  // Open task 2 (assigned)
  await page.locator('[data-action="task"][data-id="2"]').click();
  assert(await page.locator('[data-action="start-task"]').isVisible());
  await page.locator('[data-action="start-task"]').click();
  s = await snapshot();
  assert.equal(s.tasks.find(t => t.id === 2).status, 'doing');
  await page.locator('[data-action="back-tasks"]').click();

  console.log('4. Testing Milestones Cycle (Submit -> Accept -> Chain Completion)...');
  // Open task 1 with milestones
  await page.locator('[data-action="task"][data-id="1"]').click();
  // The first milestone is active in the initial demo state.
  await page.locator('#milestone-report-1').fill('Структура страницы и критерии готовности описаны.');
  await page.locator('[data-action="submit-milestone"][data-mid="1"]').click();
  await page.locator('[data-role="commander"]').click();
  await page.locator('[data-action="task"][data-id="1"]').click();
  await page.locator('[data-action="accept-milestone"][data-mid="1"]').click();
  await page.locator('[data-action="close-celebration"]').click();
  await page.locator('[data-role="soldier"]').click();
  await page.locator('[data-action="task"][data-id="1"]').click();
  await page.locator('#milestone-report-2').fill('Страница свёрстана и проверена на мобильной ширине.');
  await page.locator('[data-action="submit-milestone"][data-mid="2"]').click();
  s = await snapshot();
  assert.equal(s.tasks[0].milestones[1].status, 'submitted');

  // Switch to commander to accept milestone 2
  await page.locator('[data-role="commander"]').click();
  // Commander opens task 1
  await page.locator('[data-action="task"][data-id="1"]').click();
  await page.locator('[data-action="accept-milestone"][data-mid="2"]').click();
  assert(await page.locator('.celebration').isVisible(), 'Celebration dialog must appear');
  await page.locator('[data-action="close-celebration"]').click();
  
  s = await snapshot();
  assert.equal(s.tasks[0].milestones[1].status, 'accepted');
  assert.equal(s.tasks[0].milestones[2].status, 'doing', 'Milestone 3 should automatically unlock to doing');

  // Soldier submits milestone 3
  await page.locator('[data-role="soldier"]').click();
  await page.locator('[data-action="task"][data-id="1"]').click();
  await page.locator('#milestone-report-3').fill('Ссылки открываются, замечания внесены в отчёт.');
  await page.locator('[data-action="submit-milestone"][data-mid="3"]').click();
  s = await snapshot();
  assert.equal(s.tasks[0].milestones[2].status, 'submitted');

  // Commander accepts milestone 3 -> entire task completes!
  await page.locator('[data-role="commander"]').click();
  await page.locator('[data-action="task"][data-id="1"]').click();
  await page.locator('[data-action="accept-milestone"][data-mid="3"]').click();
  assert(await page.locator('.celebration').isVisible());
  await page.locator('[data-action="close-celebration"]').click();
  s = await snapshot();
  assert.equal(s.tasks[0].milestones[2].status, 'accepted');
  assert.equal(s.tasks[0].status, 'accepted', 'Whole task should now be accepted');

  console.log('5. Testing Task Rework Flow (Return with Comment -> Resubmit -> Commander Accept)...');
  await page.locator('[data-role="soldier"]').click();
  await page.locator('[data-page="tasks"]').click();
  await page.locator('[data-action="task"][data-id="2"]').click();
  // Validate empty report error
  await page.locator('#report').fill('кратко');
  await page.locator('[data-action="submit-task"]').click();
  assert(await page.locator('#form-error').innerText().then(t => t.includes('не менее 10 символов')));
  
  // Submit valid report
  await page.locator('#report').fill('Материалы к совещанию полностью подготовлены и оформлены.');
  await page.locator('[data-action="submit-task"]').click();
  s = await snapshot();
  assert.equal(s.tasks.find(t => t.id === 2).status, 'submitted');

  // Commander reviews and returns for rework
  await page.locator('[data-role="commander"]').click();
  await page.locator('[data-action="task"][data-id="2"]').click();
  await page.locator('#review-comment').fill('');
  await page.locator('[data-action="return-task"]').click();
  assert(await page.locator('#form-error').innerText().then(t => t.includes('не менее 5 символов')));

  await page.locator('#review-comment').fill('Добавьте второй слайд с регламентом.');
  await page.locator('[data-action="return-task"]').click();
  s = await snapshot();
  assert.equal(s.tasks.find(t => t.id === 2).status, 'rework');

  // Soldier sees comment and resubmits
  await page.locator('[data-role="soldier"]').click();
  await page.locator('[data-page="tasks"]').click();
  await page.locator('[data-action="task"][data-id="2"]').click();
  assert(await page.locator('.statusbox').innerText().then(t => t.includes('Добавьте второй слайд')));
  await page.locator('#report').fill('Второй слайд добавлен и согласован с руководителем.');
  await page.locator('[data-action="submit-task"]').click();

  // Commander accepts with custom reward
  await page.locator('[data-role="commander"]').click();
  await page.locator('[data-action="task"][data-id="2"]').click();
  await page.locator('#review-xp').fill('150');
  await page.locator('#review-coins').fill('50');
  await page.locator('#bonus').selectOption('speed'); // +30 XP / +15 coins
  await page.locator('#review-comment').fill('Отличная доработка и опережение срока.');
  await page.locator('[data-action="accept-task"]').click();
  assert(await page.locator('.celebration').isVisible());
  await page.locator('[data-action="close-celebration"]').click();
  s = await snapshot();
  assert.equal(s.tasks.find(t => t.id === 2).status, 'accepted');

  console.log('6. Testing Soldier Initiative Proposal & Commander Approval/Rejection...');
  await page.locator('[data-role="soldier"]').click();
  await page.locator('[data-page="tasks"]').click();
  await page.locator('[data-action="open-proposal"]').click();
  assert(await page.locator('#proposal-dialog').isVisible());
  // Test cancel
  await page.locator('#proposal-cancel').click();
  assert(!await page.locator('#proposal-dialog').isVisible());

  // Test validation
  await page.locator('[data-action="open-proposal"]').click();
  await page.locator('#prop-title').fill('Тест');
  await page.locator('#proposal-confirm').click();
  assert(await page.locator('#prop-error').innerText().then(t => t.includes('не менее 5 символов')));

  // Create Proposal 1 (to approve)
  await page.locator('#prop-title').fill('Внедрение автоматического линтера');
  await page.locator('#prop-desc').fill('Позволит сократить ошибки стиля в кодовой базе роты.');
  await page.locator('#proposal-confirm').click();
  s = await snapshot();
  assert.equal(s.proposals.length, 1);

  // Create Proposal 2 (to reject)
  await page.locator('[data-action="open-proposal"]').click();
  await page.locator('#prop-title').fill('Неактуальное предложение роты');
  await page.locator('#prop-desc').fill('Попытка изменить установленный базовый регламент.');
  await page.locator('#proposal-confirm').click();
  s = await snapshot();
  assert.equal(s.proposals.length, 2);

  // Commander reviews proposals
  await page.locator('[data-role="commander"]').click();
  await page.locator('[data-page="reviews"]').click();
  assert.equal(await page.locator('.prop-card').count(), 2);

  // Reject proposal 2
  await page.locator('.prop-card').nth(1).locator('[data-action="reject-proposal"]').click();
  s = await snapshot();
  assert.equal(s.proposals.find(p => p.id === 2).status, 'rejected');

  // Approve proposal 1
  await page.locator('.prop-card').first().locator('[data-action="approve-proposal"]').click();
  s = await snapshot();
  assert.equal(s.proposals.find(p => p.id === 1).status, 'approved');
  assert(s.tasks.some(t => t.title === 'Внедрение автоматического линтера'));

  console.log('7. Testing Kudos (Взаимное признание)...');
  await page.locator('[data-role="soldier"]').click();
  await page.locator('[data-page="profile"]').click();
  await page.locator('[data-action="open-kudos"]').click();
  assert(await page.locator('#kudos-dialog').isVisible());
  await page.locator('#kudos-cancel').click();
  assert(!await page.locator('#kudos-dialog').isVisible());

  await page.locator('[data-action="open-kudos"]').click();
  await page.locator('#kudos-text').fill('спс');
  await page.locator('#kudos-confirm').click();
  assert(await page.locator('#kudos-error').innerText().then(t => t.includes('не менее 5 символов')));

  await page.locator('#kudos-text').fill('Спасибо за отличную консультацию по архитектуре.');
  await page.locator('#kudos-confirm').click();
  s = await snapshot();
  assert.equal(s.kudosSent, 2);
  assert.equal(s.kudosReceived, 3);

  console.log('8. Testing Shop Purchases, Quotas & Full Order Lifecycle...');
  await page.locator('[data-page="shop"]').click();
  
  // Instant Purchase: Profile Frame
  await page.locator('[data-action="buy"][data-id="frame"]').click();
  assert(await page.locator('#purchase-dialog').isVisible());
  await page.locator('#purchase-cancel').click();
  assert(!await page.locator('#purchase-dialog').isVisible());

  await page.locator('[data-action="buy"][data-id="frame"]').click();
  await page.locator('#purchase-confirm').click();
  s = await snapshot();
  assert.equal(s.frame, true);
  assert(await page.locator('[data-action="buy"][data-id="frame"]').isDisabled());

  // Service Order with Quota: Leave (Увольнение)
  const quotaInitial = s.quota.leave;
  await page.locator('[data-action="buy"][data-id="leave"]').click();
  await page.locator('#purchase-confirm').click();
  s = await snapshot();
  assert.equal(s.quota.leave, quotaInitial - 1);
  assert.equal(s.orders[0].status, 'pending');

  // Cancel order as soldier -> refund & restore quota
  await page.locator('[data-action="cancel-order"]').click();
  s = await snapshot();
  assert.equal(s.quota.leave, quotaInitial);
  assert.equal(s.orders[0].status, 'cancelled');

  // Buy again -> commander rejects -> refund & restore quota
  await page.locator('[data-action="buy"][data-id="leave"]').click();
  await page.locator('#purchase-confirm').click();
  await page.locator('[data-role="commander"]').click();
  await page.locator('[data-page="reviews"]').click();
  await page.locator('[data-action="reject-order"]').click();
  s = await snapshot();
  assert.equal(s.quota.leave, quotaInitial);
  assert.equal(s.orders[1].status, 'rejected');

  // Buy again -> commander approves -> fulfills
  await page.locator('[data-role="soldier"]').click();
  await page.locator('[data-page="shop"]').click();
  await page.locator('[data-action="buy"][data-id="leave"]').click();
  await page.locator('#purchase-confirm').click();
  await page.locator('[data-role="commander"]').click();
  await page.locator('[data-page="reviews"]').click();
  await page.locator('[data-action="approve-order"]').click();
  s = await snapshot();
  assert.equal(s.orders[2].status, 'approved');
  assert.equal(s.quota.leave, quotaInitial - 1);

  await page.locator('[data-action="fulfill-order"]').click();
  s = await snapshot();
  assert.equal(s.orders[2].status, 'fulfilled');

  console.log('9. Testing Commander Task Creation Dialog...');
  await page.locator('[data-page="tasks"]').click();
  await page.locator('[data-action="open-create-task"]').click();
  assert(await page.locator('#create-task-dialog').isVisible());
  await page.locator('#task-create-cancel').click();
  assert(!await page.locator('#create-task-dialog').isVisible());

  await page.locator('[data-action="open-create-task"]').click();
  await page.locator('#task-create-title').fill('Нов');
  await page.locator('#task-create-confirm').click();
  assert(await page.locator('#task-create-error').innerText().then(t => t.includes('не менее 5 символов')));

  await page.locator('#task-create-title').fill('Разработка модуля шифрования');
  await page.locator('#task-create-type').selectOption('Разработка');
  await page.locator('#task-create-prio').selectOption('critical');
  await page.locator('#task-create-xp').fill('250');
  await page.locator('#task-create-coins').fill('70');
  await page.locator('#task-create-due').fill('29 сентября');
  await page.locator('#task-create-criteria').fill('Провести аудит протокола; реализовать модуль.');
  await page.locator('#task-create-confirm').click();

  s = await snapshot();
  const created = s.tasks.find(t => t.title === 'Разработка модуля шифрования');
  assert(created, 'Task must be created in state');
  assert.equal(created.priority, 'critical');
  assert.equal(created.xp, 250);
  assert.equal(created.coins, 70);

  console.log('10. Testing Leaderboard Archive & Expansion...');
  await page.locator('[data-page="leaderboard"]').click();
  // Toggle all 40 participants
  await page.locator('[data-action="rank-toggle"]').click();
  assert.equal(await page.locator('.rankrow').count(), 40);
  await page.locator('[data-action="rank-toggle"]').click();
  assert.equal(await page.locator('.rankrow').count(), 6);

  // Switch to August archive
  await page.locator('[data-action="set-season"][data-value="august"]').click();
  assert(await page.locator('.statusbox').innerText().then(t => t.includes('Август 2026')));
  // Switch back to September
  await page.locator('[data-action="set-season"][data-value="current"]').click();
  assert(await page.locator('.podium').innerText().then(t => t.includes('XP за сезон')));

  console.log('11. Testing Documentation: TOC, Expand All, Print...');
  const expandBtn = page.locator('#expand-doc');
  await expandBtn.click();
  assert.equal(await page.locator('.doc details[open]').count(), 23);
  await expandBtn.click();
  assert.equal(await page.locator('.doc details[open]').count(), 0);

  // Click a TOC link
  await page.locator('.toc a[href="#chapter-3"]').click();
  assert(await page.locator('#chapter-3').evaluate(el => el.open));

  console.log('12. Checking for any unhandled JS/console errors...');
  console.log('Captured page errors:', pageErrors);
  assert.equal(pageErrors.length, 0, 'No console or page errors allowed!');

  console.log('=== ALL BUTTONS, DIALOGS, ROLES, AND USER FLOWS VERIFIED SUCCESSFULLY! ===');
  await browser.close();
})().catch(e => {
  console.error('VERIFICATION FAILED:', e);
  process.exit(1);
});
