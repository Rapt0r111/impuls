/* Narrative interactions are local examples; only the team view reads the R0 state. */
(() => {
  const effects = document.querySelector('#motion');
  const preference = matchMedia('(prefers-reduced-motion: reduce)');
  const ambient = document.querySelector('#ambient-effects');
  const launch = document.querySelector('.launch');
  let accepted = false, numberFrame = 0, selectedModule = 'dev';
  const allowed = () => effects.checked && !preference.matches && !document.hidden;
  const format = value => new Intl.NumberFormat('ru-RU').format(value);
  const updateEffects = () => {
    ambient.setAttribute('aria-pressed', String(effects.checked && !preference.matches));
    ambient.textContent = effects.checked && !preference.matches ? 'Эффекты: вкл.' : 'Эффекты: выкл.';
    if (!allowed()) {
      cancelAnimationFrame(numberFrame);
      if (accepted) showScore();
    }
  };
  ambient.addEventListener('click', () => {
    effects.checked = !effects.checked;
    effects.dispatchEvent(new Event('change'));
  });
  effects.addEventListener('change', updateEffects);
  preference.addEventListener('change', updateEffects);
  document.addEventListener('visibilitychange', () => {
    launch.classList.toggle('is-in-view', !document.hidden && launch.getBoundingClientRect().bottom > 0);
    updateEffects();
  });
  updateEffects();
  if ('IntersectionObserver' in window) {
    const visibility = new IntersectionObserver(entries => {
      launch.classList.toggle('is-in-view', entries[0].isIntersecting && !document.hidden);
    }, {threshold:.05});
    visibility.observe(launch);
    window.addEventListener('pagehide', () => visibility.disconnect(), {once:true});
  }
  const selectedBonus = () => bonuses[document.querySelector('input[name="lab-bonus"]:checked').value];
  const award = () => ({xp:150 + selectedBonus().xp, points:50 + selectedBonus().coins});
  const showScore = (xp = accepted ? 1840 + award().xp : 1840, points = accepted ? 260 + award().points : 260) => {
    document.querySelector('#lab-xp').textContent = format(xp);
    document.querySelector('#lab-points').textContent = format(points);
    const nextLevel = 1 + Math.floor(xp / 500);
    document.querySelector('#lab-level').textContent = nextLevel;
    document.querySelector('#lab-next').textContent = `${nextLevel * 500 - xp} XP до уровня ${nextLevel + 1}`;
  };
  document.querySelectorAll('input[name="lab-bonus"]').forEach(input => input.addEventListener('change', () => {
    document.querySelector('#lab-award').textContent = `+${award().xp} XP / +${award().points} баллов`;
  }));
  document.querySelector('#lab-accept').addEventListener('click', () => {
    if (accepted) return;
    accepted = true;
    const {xp, points} = award();
    document.querySelector('#lab-status').textContent = 'Учебный пример · результат принят';
    document.querySelector('#lab-result').textContent = `В примере подтверждено: +${xp} XP и +${points} баллов.${1840 + xp >= 2000 ? ' Открыт уровень 5!' : ''}`;
    document.querySelector('#lab-result').classList.add('accepted');
    document.querySelector('#lab-accept').disabled = true;
    document.querySelector('#lab-accept').textContent = 'Результат принят в примере';
    document.querySelectorAll('input[name="lab-bonus"]').forEach(input => input.disabled = true);
    document.querySelector('#lab-reset').hidden = false;
    if (!allowed()) {showScore(); return;}
    const started = performance.now();
    const tick = now => {
      const progress = Math.min(1, (now - started) / 500);
      const eased = 1 - Math.pow(1 - progress, 3);
      showScore(1840 + Math.round(xp * eased), 260 + Math.round(points * eased));
      if (progress < 1 && allowed()) numberFrame = requestAnimationFrame(tick);
      else showScore();
    };
    numberFrame = requestAnimationFrame(tick);
  });
  document.querySelector('#lab-reset').addEventListener('click', () => {
    cancelAnimationFrame(numberFrame);
    accepted = false;
    document.querySelector('#lab-status').textContent = 'Учебный пример · на проверке';
    document.querySelector('#lab-result').textContent = 'Отправка отчёта сама по себе не начисляет награду.';
    document.querySelector('#lab-result').classList.remove('accepted');
    document.querySelector('#lab-accept').disabled = false;
    document.querySelector('#lab-accept').textContent = 'Показать принятие результата';
    document.querySelectorAll('input[name="lab-bonus"]').forEach(input => input.disabled = false);
    document.querySelector('#lab-reset').hidden = true;
    showScore();
  });
  const modules = {
    dev:{title:'Цифровизация',text:'Сайты, интерфейсы и сервисы. Каждая принятая работа приближает общий модуль к завершению.'},
    science:{title:'Научный потенциал',text:'Исследования, анализ и проверяемые этапы проектов. Большая работа становится заметной по мере принятия результатов.'},
    duty:{title:'Внутренний регламент',text:'Материалы, отчёты и организационная работа. Повседневный вклад тоже входит в общую цель.'}
  };
  let teamSignature = '';
  const updateTeam = () => {
    const signature = `${selectedModule}:${state.goal}:${JSON.stringify(state.labModules)}`;
    if (signature === teamSignature) return;
    teamSignature = signature;
    const data = state.labModules[selectedModule], content = modules[selectedModule];
    document.querySelector('#team-total').innerHTML = `${state.goal}<span> / 30</span>`;
    document.querySelector('#module-detail').innerHTML = `<h3>${content.title}</h3><p>${content.text}</p><div class="module-count"><strong>${data.count} / ${data.total}</strong><span>результатов в демо</span></div><div class="module-segments" aria-hidden="true">${Array.from({length:data.total},(_,index)=>`<i class="${index<data.count?'complete':''}"></i>`).join('')}</div>`;
  };
  document.querySelectorAll('[data-module]').forEach(button => button.addEventListener('click', () => {
    selectedModule = button.dataset.module;
    document.querySelectorAll('[data-module]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
    updateTeam();
  }));
  const linked = new MutationObserver(updateTeam);
  linked.observe(document.querySelector('#screen'), {childList:true});
  updateTeam();
  const achievements = {
    first:['Первый результат','Первая принятая задача — начало видимого прогресса.'],
    skill:['Новый навык','Рост компетенции отмечается отдельным достижением. Направление зависит от принятой работы.'],
    mentor:['Наставник','В прототипе знак связан с благодарностями за помощь сослуживцам. Пример порога: три полученных «спасибо».'],
    team:['Командный вклад','Личная работа продвигает общую цель. В прототипе достижение открывается при 23 подтверждённых результатах.']
  };
  document.querySelectorAll('[data-achievement]').forEach(button => button.addEventListener('click', () => {
    document.querySelectorAll('[data-achievement]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
    const [title, text] = achievements[button.dataset.achievement];
    document.querySelector('#achievement-explainer').innerHTML = `<strong>${title}</strong><span>${text}</span>`;
  }));

  /* Sound stub (audio removed per user requirement) */
  const playSound = () => {};


  /* ========================================================
     FLOATING NUMBERS & TOASTS
     ======================================================== */
  const floatHost = document.querySelector('#floating-numbers-host');
  const spawnFloatingNumber = (x, y, text, type = 'xp') => {
    if (!floatHost || preference.matches || !allowed()) return;
    const el = document.createElement('div');
    el.className = `floating-number ${type}`;
    el.textContent = text;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    floatHost.appendChild(el);
    setTimeout(() => { el.remove(); }, 950);
  };

  /* ========================================================
     RPG OPERATIVE DOSSIER & RADAR CANVAS
     ======================================================== */
  const rpgStats = { code: 75, arch: 60, anal: 60, sec: 45, mentor: 30 };
  const baseStats = { code: 75, arch: 60, anal: 60, sec: 45, mentor: 30 };
  let freeSP = 3;

  const spCounter = document.querySelector('#sp-counter');
  const roleTitle = document.querySelector('#rpg-role-title');
  const rpgRadarCanvas = document.querySelector('#rpg-radar-canvas');
  const rpgRadarCtx = rpgRadarCanvas ? rpgRadarCanvas.getContext('2d') : null;

  const updateArchetype = () => {
    if (!roleTitle) return;
    if (rpgStats.code >= 85) roleTitle.textContent = 'Главный системный архитектор платформы';
    else if (rpgStats.arch >= 80) roleTitle.textContent = 'Ведущий архитектор распределенных систем';
    else if (rpgStats.anal >= 75) roleTitle.textContent = 'Ведущий исследователь ИИ и алгоритмов';
    else if (rpgStats.sec >= 65) roleTitle.textContent = 'Офицер кибербезопасности контура R1';
    else if (rpgStats.mentor >= 50) roleTitle.textContent = 'Мастер-наставник эскадры разработчиков';
    else roleTitle.textContent = 'Старший специалист R&D лаборатории';
  };

  const updatePerks = () => {
    const pClean = document.querySelector('#perk-clean');
    const pAi = document.querySelector('#perk-ai');
    const pMentor = document.querySelector('#perk-mentor');
    const pGuard = document.querySelector('#perk-guard');

    if (pClean) {
      const ok = rpgStats.code >= 70;
      pClean.classList.toggle('active', ok);
      const b = pClean.querySelector('.perk-badge');
      if (b) b.textContent = ok ? 'АКТИВЕН' : 'Код 70+';
    }
    if (pAi) {
      const ok = rpgStats.anal >= 65;
      pAi.classList.toggle('active', ok);
      const b = pAi.querySelector('.perk-badge');
      if (b) b.textContent = ok ? 'АКТИВЕН' : 'Анализ 65+';
    }
    if (pMentor) {
      const ok = rpgStats.mentor >= 40;
      pMentor.classList.toggle('active', ok);
      const b = pMentor.querySelector('.perk-badge');
      if (b) b.textContent = ok ? 'АКТИВЕН' : 'Шефство 40+';
    }
    if (pGuard) {
      const ok = rpgStats.sec >= 60;
      pGuard.classList.toggle('active', ok);
      const b = pGuard.querySelector('.perk-badge');
      if (b) b.textContent = ok ? 'АКТИВЕН' : 'Безопасность 60+';
    }
  };

  const drawRpgRadar = () => {
    if (!rpgRadarCanvas || !rpgRadarCtx) return;
    const w = rpgRadarCanvas.width, h = rpgRadarCanvas.height;
    rpgRadarCtx.clearRect(0, 0, w, h);
    const cx = w / 2, cy = h / 2;
    const radius = Math.min(cx, cy) - 22;
    const keys = ['code', 'arch', 'anal', 'sec', 'mentor'];
    const labels = ['Код', 'Архитектура', 'Анализ', 'Безопасность', 'Шефство'];
    const count = keys.length;

    for (let level = 1; level <= 4; level++) {
      const r = (radius / 4) * level;
      rpgRadarCtx.strokeStyle = 'rgba(112, 225, 194, 0.18)';
      rpgRadarCtx.lineWidth = 1;
      rpgRadarCtx.beginPath();
      for (let i = 0; i < count; i++) {
        const angle = (i * Math.PI * 2) / count - Math.PI / 2;
        const x = cx + Math.cos(angle) * r;
        const y = cy + Math.sin(angle) * r;
        if (i === 0) rpgRadarCtx.moveTo(x, y);
        else rpgRadarCtx.lineTo(x, y);
      }
      rpgRadarCtx.closePath();
      rpgRadarCtx.stroke();
    }

    rpgRadarCtx.fillStyle = 'rgba(112, 225, 194, 0.7)';
    rpgRadarCtx.font = '9px Manrope, sans-serif';
    rpgRadarCtx.textAlign = 'center';
    rpgRadarCtx.textBaseline = 'middle';

    for (let i = 0; i < count; i++) {
      const angle = (i * Math.PI * 2) / count - Math.PI / 2;
      const x = cx + Math.cos(angle) * radius;
      const y = cy + Math.sin(angle) * radius;
      rpgRadarCtx.strokeStyle = 'rgba(112, 225, 194, 0.2)';
      rpgRadarCtx.beginPath();
      rpgRadarCtx.moveTo(cx, cy);
      rpgRadarCtx.lineTo(x, y);
      rpgRadarCtx.stroke();

      const labelDist = radius + 12;
      const lx = cx + Math.cos(angle) * labelDist;
      const ly = cy + Math.sin(angle) * labelDist;
      rpgRadarCtx.fillText(labels[i], lx, ly);
    }

    rpgRadarCtx.beginPath();
    for (let i = 0; i < count; i++) {
      const angle = (i * Math.PI * 2) / count - Math.PI / 2;
      const val = (rpgStats[keys[i]] || 50) / 100;
      const r = radius * Math.min(1, Math.max(0.1, val));
      const x = cx + Math.cos(angle) * r;
      const y = cy + Math.sin(angle) * r;
      if (i === 0) rpgRadarCtx.moveTo(x, y);
      else rpgRadarCtx.lineTo(x, y);
    }
    rpgRadarCtx.closePath();
    rpgRadarCtx.fillStyle = 'rgba(112, 225, 194, 0.35)';
    rpgRadarCtx.fill();
    rpgRadarCtx.strokeStyle = '#70e1c2';
    rpgRadarCtx.lineWidth = 2;
    rpgRadarCtx.stroke();

    for (let i = 0; i < count; i++) {
      const angle = (i * Math.PI * 2) / count - Math.PI / 2;
      const val = (rpgStats[keys[i]] || 50) / 100;
      const r = radius * Math.min(1, Math.max(0.1, val));
      const x = cx + Math.cos(angle) * r;
      const y = cy + Math.sin(angle) * r;
      rpgRadarCtx.fillStyle = '#ebba5c';
      rpgRadarCtx.beginPath();
      rpgRadarCtx.arc(x, y, 3.5, 0, Math.PI * 2);
      rpgRadarCtx.fill();
    }
  };

  document.querySelectorAll('[data-attr-inc]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const attr = btn.dataset.attrInc;
      if (freeSP > 0 && rpgStats[attr] < 99) {
        rpgStats[attr] = Math.min(99, rpgStats[attr] + 5);
        freeSP--;
        if (spCounter) spCounter.textContent = freeSP;
        const valEl = document.querySelector(`[data-attr-val="${attr}"]`);
        if (valEl) valEl.textContent = rpgStats[attr];
        updateArchetype();
        updatePerks();
        drawRpgRadar();
        playSound('blip');
        const rect = btn.getBoundingClientRect();
        spawnFloatingNumber(rect.left + 10, rect.top - 15, '+5', 'xp');
      }
    });
  });

  document.querySelectorAll('[data-attr-dec]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const attr = btn.dataset.attrDec;
      if (rpgStats[attr] > baseStats[attr]) {
        rpgStats[attr] = Math.max(baseStats[attr], rpgStats[attr] - 5);
        freeSP++;
        if (spCounter) spCounter.textContent = freeSP;
        const valEl = document.querySelector(`[data-attr-val="${attr}"]`);
        if (valEl) valEl.textContent = rpgStats[attr];
        updateArchetype();
        updatePerks();
        drawRpgRadar();
        playSound('blip');
      }
    });
  });

  drawRpgRadar();
  updatePerks();

  /* ========================================================
     RPG DAILY QUEST ROULETTE TERMINAL
     ======================================================== */
  const dailyQuests = [
    {
      id: 1,
      title: 'Оптимизация криптографического модуля верификации',
      category: 'КИБЕРБЕЗОПАСНОСТЬ',
      rarity: 'legendary',
      rarityLabel: 'ЛЕГЕНДАРНАЯ МИССИЯ',
      desc: 'Разработать оптимизированный модуль верификации контрольных сумм для распределённого защищённого хранилища данных роты.',
      xp: 350,
      points: 120,
      tag: 'ВАК-публикация',
      tagClass: 'badge amber'
    },
    {
      id: 2,
      title: 'Разработка драйвера защищённой телеметрии',
      category: 'РАЗРАБОТКА ПО',
      rarity: 'epic',
      rarityLabel: 'ЭПИЧЕСКАЯ ЗАДАЧА',
      desc: 'Реализовать асинхронный протокол сбора метрик с бортовых вычислителей на базе Rust и WebAssembly.',
      xp: 280,
      points: 80,
      tag: 'Высокий приоритет',
      tagClass: 'badge'
    },
    {
      id: 3,
      title: 'Патентная заявка на метод анализа спектрограмм',
      category: 'НИР И НАУКА',
      rarity: 'epic',
      rarityLabel: 'ЭПИЧЕСКАЯ ЗАДАЧА',
      desc: 'Оформить формулу изобретения и сравнительный анализ с существующими прототипами для подачи в Роспатент.',
      xp: 300,
      points: 100,
      tag: 'Патентный фонд',
      tagClass: 'badge amber'
    },
    {
      id: 4,
      title: 'Автоматизация стенда нагрузочного тестирования API',
      category: 'ИНФРАСТРУКТУРА',
      rarity: 'rare',
      rarityLabel: 'РЕДКАЯ ЗАДАЧА',
      desc: 'Создать сценарии профилирования для проверки устойчивости шлюза при пиковой нагрузке 1 000 RPS.',
      xp: 210,
      points: 50,
      tag: 'Внутренний стенд',
      tagClass: 'badge muted'
    },
    {
      id: 5,
      title: 'Технический аудит защищённых микросервисов',
      category: 'КИБЕРБЕЗОПАСНОСТЬ',
      rarity: 'rare',
      rarityLabel: 'РЕДКАЯ ЗАДАЧА',
      desc: 'Проверить валидацию входящих контрактов и изоляцию транзакций базы данных согласно регламенту роты.',
      xp: 240,
      points: 60,
      tag: 'Стандарт ГОСТ',
      tagClass: 'badge'
    },
    {
      id: 6,
      title: 'Регламентная аттестация программного комплекса',
      category: 'РЕГЛАМЕНТ',
      rarity: 'common',
      rarityLabel: 'ПЛАНОВАЯ СЛУЖБА',
      desc: 'Подготовить формуляры и протоколы контрольных проверок для сдачи комиссии испытательного стенда.',
      xp: 140,
      points: 30,
      tag: 'Плановый срез',
      tagClass: 'badge muted'
    }
  ];

  let currentQuestIdx = 0;
  const questDisplay = document.querySelector('#quest-display');
  const questRarity = document.querySelector('#quest-rarity');
  const questTitle = document.querySelector('#quest-title');
  const questDesc = document.querySelector('#quest-desc');
  const questXp = document.querySelector('#quest-xp');
  const questTag = document.querySelector('#quest-tag');
  const questRollBtn = document.querySelector('#quest-roll-btn');
  const questAcceptBtn = document.querySelector('#quest-accept-btn');
  const questStatusNote = document.querySelector('#quest-status-note');

  const renderQuest = (q) => {
    if (questRarity) {
      questRarity.textContent = q.rarityLabel;
      questRarity.className = `quest-rarity-badge ${q.rarity}`;
    }
    if (questTitle) questTitle.textContent = q.title;
    if (questDesc) questDesc.textContent = q.desc;
    if (questXp) questXp.textContent = `+${q.xp} XP / +${q.points} баллов`;
    if (questTag) {
      questTag.textContent = q.tag;
      questTag.className = q.tagClass || 'badge';
    }
    if (questStatusNote) questStatusNote.hidden = true;
    if (questAcceptBtn) {
      questAcceptBtn.disabled = false;
      questAcceptBtn.textContent = 'Принять в боевой журнал';
      questAcceptBtn.classList.remove('btn-success');
    }
  };

  if (questRollBtn) {
    questRollBtn.addEventListener('click', () => {
      questRollBtn.disabled = true;
      if (questAcceptBtn) questAcceptBtn.disabled = true;
      if (questDisplay) questDisplay.classList.add('quest-rolling');
      if (questStatusNote) questStatusNote.hidden = true;

      let rolls = 0;
      const maxRolls = 8;
      const rollInterval = setInterval(() => {
        currentQuestIdx = (currentQuestIdx + 1) % dailyQuests.length;
        renderQuest(dailyQuests[currentQuestIdx]);
        rolls++;
        if (rolls >= maxRolls) {
          clearInterval(rollInterval);
          if (questDisplay) questDisplay.classList.remove('quest-rolling');
          questRollBtn.disabled = false;
          if (questAcceptBtn) questAcceptBtn.disabled = false;
        }
      }, 75);
    });
  }

  if (questAcceptBtn) {
    questAcceptBtn.addEventListener('click', () => {
      const q = dailyQuests[currentQuestIdx];
      questAcceptBtn.disabled = true;
      questAcceptBtn.textContent = '✓ Принято в боевой журнал';
      if (questStatusNote) {
        questStatusNote.innerHTML = `<strong>Задание добавлено:</strong> «${q.title}» зафиксировано за оператором (+${q.xp} XP и +${q.points} баллов фонда).`;
        questStatusNote.hidden = false;
      }
      const rect = questAcceptBtn.getBoundingClientRect();
      spawnFloatingNumber(rect.left + 20, rect.top - 20, `+${q.xp} XP`, 'xp');
      spawnFloatingNumber(rect.left + 120, rect.top - 20, `+${q.points} Б`, 'points');

      const toastEl = document.querySelector('#toast');
      if (toastEl) {
        toastEl.textContent = `Задача «${q.title}» принята в боевой журнал оператора!`;
        toastEl.hidden = false;
        setTimeout(() => { toastEl.hidden = true; }, 3500);
      }
    });
  }

  /* ========================================================
     RPG LOOT VAULT CAPSULE
     ======================================================== */
  const lootArtifacts = [
    {
      title: 'Золотой шеврон «Альфа-Исследователь»',
      type: 'РЕЛИКВИЯ РОТЫ',
      rarity: 'legendary',
      desc: 'Особый статус в профиле роты и приоритетное рассмотрение заявок на согласование поощрений.',
      icon: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" style="width:26px;height:26px;color:var(--gold)"><circle cx="12" cy="8" r="6"/><path d="m15.48 13.93 2.02 7.07-5.5-3-5.5 3 2.02-7.07"/></svg>',
      perk: '+15% ко всем начислениям XP до завершения сезона'
    },
    {
      title: 'Знак отличия за оптимизацию архитектуры R1',
      type: 'НАГРАДА КОМАНДОВАНИЯ',
      rarity: 'epic',
      desc: 'Почётный знак за внедрение высокотехнологичных решений в инфраструктуру роты.',
      icon: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" style="width:26px;height:26px;color:var(--gold)"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3z"/></svg>',
      perk: 'Мгновенное разблокирование 1 слота внеочередного поощрения'
    },
    {
      title: 'Памятный знак «Импульс: Высокая готовность»',
      type: 'НАГРАДА КОМАНДОВАНИЯ',
      rarity: 'epic',
      desc: 'Знак отличия за ускорение и автоматизацию регламентных процедур роты.',
      icon: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" style="width:26px;height:26px;color:var(--mint)"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
      perk: '+25 баллов единовременно в баланс поощрений'
    },
    {
      title: 'Нагрудный знак «Мастер алгоритмов»',
      type: 'ОТЛИЧИЕ СПЕЦИАЛИСТА',
      rarity: 'rare',
      desc: 'Присваивается за серию успешных исследовательских отчётов без возвратов на доработку.',
      icon: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" style="width:26px;height:26px;color:var(--mint)"><path d="M6 18h8M3 22h18M14 22a7 7 0 1 0 0-14h-1"/><path d="M9 14h2"/><rect x="8" y="2" width="6" height="8" rx="1"/></svg>',
      perk: '+10% XP за все задачи направления «НИР и наука»'
    },
    {
      title: 'Свидетельство наставника смены',
      type: 'ОТЛИЧИЕ СПЕЦИАЛИСТА',
      rarity: 'rare',
      desc: 'Отмечает активную передачу опыта новым операторам и регулярные качественные код-ревью.',
      icon: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" style="width:26px;height:26px;color:var(--mint)"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
      perk: '+20 баллов в фонд наставничества'
    }
  ];

  const capsuleContainer = document.querySelector('#capsule-container');
  const capsuleModel = document.querySelector('#capsule-model');
  const capsuleOpenBtn = document.querySelector('#capsule-open-btn');
  const capsuleResetBtn = document.querySelector('#capsule-reset-btn');
  const capsuleLootCard = document.querySelector('#capsule-loot-card');
  const lootRarity = document.querySelector('#loot-rarity');
  const lootIcon = document.querySelector('#loot-icon');
  const lootTitle = document.querySelector('#loot-title');
  const lootDesc = document.querySelector('#loot-desc');
  const lootPerk = document.querySelector('#loot-perk');
  const capsuleCode = document.querySelector('#capsule-code');

  const openCapsule = () => {
    if (!capsuleContainer || capsuleContainer.classList.contains('capsule-shaking') || capsuleContainer.classList.contains('capsule-opened')) return;

    if (capsuleOpenBtn) capsuleOpenBtn.disabled = true;
    capsuleContainer.classList.add('capsule-shaking');

    setTimeout(() => {
      capsuleContainer.classList.remove('capsule-shaking');
      capsuleContainer.classList.add('capsule-opened');

      const art = lootArtifacts[Math.floor(Math.random() * lootArtifacts.length)];
      if (lootRarity) {
        lootRarity.textContent = art.type;
        lootRarity.className = `artifact-badge ${art.rarity}`;
      }
      if (lootIcon) lootIcon.innerHTML = art.icon;
      if (lootTitle) lootTitle.textContent = art.title;
      if (lootDesc) lootDesc.textContent = art.desc;
      if (lootPerk) lootPerk.textContent = art.perk;
      if (capsuleCode) capsuleCode.textContent = `SYS://LOOT_BOX_VAULT · ${art.rarity.toUpperCase()}`;

      if (capsuleLootCard) capsuleLootCard.hidden = false;
      if (capsuleOpenBtn) capsuleOpenBtn.hidden = true;
      if (capsuleResetBtn) capsuleResetBtn.hidden = false;

      const rect = capsuleContainer.getBoundingClientRect();
      spawnFloatingNumber(rect.left + rect.width / 2 - 40, rect.top + 20, 'РАСПАКОВАНО!', 'xp');

      const toastEl = document.querySelector('#toast');
      if (toastEl) {
        toastEl.textContent = `Вскрыта капсула: получен артефакт «${art.title}»!`;
        toastEl.hidden = false;
        setTimeout(() => { toastEl.hidden = true; }, 3500);
      }
    }, 550);
  };

  const resetCapsule = () => {
    if (!capsuleContainer) return;
    capsuleContainer.classList.remove('capsule-opened');
    if (capsuleLootCard) capsuleLootCard.hidden = true;
    if (capsuleCode) capsuleCode.textContent = 'SYS://LOOT_BOX_VAULT · READY';
    if (capsuleOpenBtn) {
      capsuleOpenBtn.hidden = false;
      capsuleOpenBtn.disabled = false;
    }
    if (capsuleResetBtn) capsuleResetBtn.hidden = true;
  };

  if (capsuleOpenBtn) capsuleOpenBtn.addEventListener('click', openCapsule);
  if (capsuleModel) capsuleModel.addEventListener('click', openCapsule);
  if (capsuleResetBtn) capsuleResetBtn.addEventListener('click', resetCapsule);

  /* ========================================================
     CAREER MATRIX TAB SWITCHING
     ======================================================== */
  const careerData = {
    junior: {
      tier: 'Уровень 1–2 // Квалификация: Младший исследователь',
      title: 'Ассистент R&D лаборатории',
      desc: 'Базовый допуск к учебным задачам, освоение внутреннего регламента, участие в парном код-ревью и сбор первичных метрик.',
      xp: '0 — 1 500 XP',
      privilege: 'Допуск к базовой витрине мерча, участие в командных брейнштормах'
    },
    middle: {
      tier: 'Уровень 3–4 // Квалификация: Исследователь',
      title: 'Инженер-разработчик контура',
      desc: 'Самостоятельное ведение сервисных фич, участие в архитектурных консилиумах, право первичного ревью задач стажёров.',
      xp: '1 500 — 3 500 XP',
      privilege: 'Коэффициент начисления баллов 1.2x, допуск к закрытым техническим митапам'
    },
    senior: {
      tier: 'Уровень 5–6 // Квалификация: Старший специалист',
      title: 'Ведущий исследователь модулей',
      desc: 'Проектирование подсистем R1, ответственность за надежность Vercel Handlers и Supabase DB, защита технических решений в ADR.',
      xp: '3 500 — 7 000 XP',
      privilege: 'Статус официального наставника, право выдвижения инициативных проектов'
    },
    lead: {
      tier: 'Уровень 7+ // Квалификация: Главный архитектор',
      title: 'Руководитель R&D направления',
      desc: 'Стратегическое планирование дорожной карты сервиса, утверждение P-решений и стандартов безопасности, координация межмодульного взаимодействия.',
      xp: '7 000+ XP',
      privilege: 'Участие в распределении премиального фонда лаборатории, именной знак почета'
    }
  };

  const careerSteps = document.querySelectorAll('[data-career-step]');
  const cdTier = document.querySelector('#cd-tier');
  const cdTitle = document.querySelector('#cd-title');
  const cdDesc = document.querySelector('#cd-desc');
  const cdXp = document.querySelector('#cd-xp');
  const cdPrivilege = document.querySelector('#cd-privilege');

  careerSteps.forEach(btn => {
    btn.addEventListener('click', () => {
      careerSteps.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const step = btn.dataset.careerStep;
      const data = careerData[step];
      if (data) {
        if (cdTier) cdTier.textContent = data.tier;
        if (cdTitle) cdTitle.textContent = data.title;
        if (cdDesc) cdDesc.textContent = data.desc;
        if (cdXp) cdXp.textContent = data.xp;
        if (cdPrivilege) cdPrivilege.textContent = data.privilege;
      }
      playSound('blip');
    });
  });

  /* ========================================================
     TOPBAR MODE NAVIGATION
     ======================================================== */
  const modeTabs = document.querySelectorAll('.mode-tab');
  const viewMap = {
    demo: '#demo',
    economy: '#mechanics',
    docs: '#specification'
  };
  let userNavigating = false;
  let userNavTimer = null;
  let currentActiveView = 'demo';

  const setActiveTab = (view) => {
    if (currentActiveView === view && modeTabs[0]?.classList.contains('active')) return;
    currentActiveView = view;
    modeTabs.forEach(t => {
      const active = t.dataset.view === view;
      t.classList.toggle('active', active);
      t.setAttribute('aria-selected', String(active));
    });
  };

  modeTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const view = tab.dataset.view;
      userNavigating = true;
      clearTimeout(userNavTimer);
      userNavTimer = setTimeout(() => { userNavigating = false; }, 850);

      // If user was in presentation mode, exit it when switching to economy or docs
      if (view !== 'demo' && document.body.classList.contains('presentation')) {
        document.body.classList.remove('presentation');
        const presentToggle = document.getElementById('present-toggle');
        if (presentToggle) presentToggle.textContent = 'Режим презентации';
      }

      setActiveTab(view);

      if (view === 'demo') {
        const target = document.querySelector('#demo') || document.querySelector('.hero');
        if (target && window.scrollY > target.offsetTop + 180) {
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } else {
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
      } else {
        const target = document.querySelector(viewMap[view]);
        if (target) {
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }
    });
  });

  const updateScrollSpy = () => {
    if (userNavigating) return;
    if (document.body.classList.contains('presentation')) {
      setActiveTab('demo');
      return;
    }

    const scrollY = window.scrollY || window.pageYOffset || 0;
    const windowHeight = window.innerHeight;
    const docHeight = document.documentElement.scrollHeight;

    // If reached bottom of document, activate docs
    if (scrollY + windowHeight >= docHeight - 90) {
      setActiveTab('docs');
      return;
    }

    const mechanicsEl = document.getElementById('mechanics');
    const docsEl = document.getElementById('specification');

    if (!mechanicsEl || !docsEl) return;

    // Threshold offset from viewport top (accounting for topbar 54px + reading headroom)
    const threshold = 150;
    const mechanicsTop = mechanicsEl.getBoundingClientRect().top;
    const docsTop = docsEl.getBoundingClientRect().top;

    let targetView = 'demo';
    if (docsTop <= threshold) {
      targetView = 'docs';
    } else if (mechanicsTop <= threshold) {
      targetView = 'economy';
    } else {
      targetView = 'demo';
    }

    setActiveTab(targetView);
  };

  let scrollTicking = false;
  window.addEventListener('scroll', () => {
    if (!scrollTicking) {
      requestAnimationFrame(() => {
        updateScrollSpy();
        scrollTicking = false;
      });
      scrollTicking = true;
    }
  }, { passive: true });

  window.addEventListener('resize', () => {
    updateScrollSpy();
  }, { passive: true });

  // Initial sync
  updateScrollSpy();

  /* ========================================================
     FLOATING REWARD BADGES & PHONE AURA FX
     ======================================================== */
  window.spawnRewardBadge = (text, type = 'mint', iconChar = '', tx = 0, ty = 0) => {
    const container = document.querySelector('#phone-floating-badges');
    const effects = document.querySelector('#motion');
    const preference = matchMedia('(prefers-reduced-motion: reduce)');
    if (!container || (effects && !effects.checked) || preference.matches) return;

    const badge = document.createElement('div');
    badge.className = `floating-reward-badge ${type}`;
    badge.style.setProperty('--tx', `${tx}px`);
    badge.style.setProperty('--ty', `${ty}px`);
    badge.style.left = '50%';
    badge.style.top = '36%';
    badge.innerHTML = `${iconChar ? `<span>${iconChar}</span>` : ''}<strong>${text}</strong>`;
    container.appendChild(badge);
    setTimeout(() => { badge.remove(); }, 1450);
  };

  window.triggerDemoCelebrationFx = (xp, coins, isLevelUp, newLevel) => {
    const halo = document.querySelector('#phone-impulse-halo');
    if (halo) {
      halo.classList.remove('pulse-active');
      void halo.offsetWidth; // retrigger reflow
      halo.classList.add('pulse-active');
      setTimeout(() => halo.classList.remove('pulse-active'), 1400);
    }
    window.spawnRewardBadge(`+${xp} XP`, 'mint', '', -75, -20);
    window.spawnRewardBadge(`+${coins} Баллов`, 'gold', '', 75, -10);
    window.spawnRewardBadge('✓ Принято командиром', 'success', '✓', 0, 45);
    if (isLevelUp) {
      setTimeout(() => {
        window.spawnRewardBadge(`Новый уровень ${newLevel}!`, 'gold', '★', 0, -65);
      }, 350);
    }
  };

  /* ========================================================
     INTERACTIVE AUTOTOUR ENGINE
     ======================================================== */
  const tour = {
    running: false,
    step: 0,
    timer: null,
    inSecondLoop: false
  };

  const tourCard = document.querySelector('#tour-story-card');
  const tourTitle = document.querySelector('#tour-story-title');
  const tourDesc = document.querySelector('#tour-story-desc');
  const tourStageTag = document.querySelector('#tour-stage-tag');
  const tourBtn = document.querySelector('#autotour-btn');
  const tourIcon = document.querySelector('#tour-icon');
  const tourBtnLabel = document.querySelector('#tour-btn-label');
  const spotlight = document.querySelector('#tour-spotlight');

  const updateSpotlight = (selector) => {
    if (!spotlight) return;
    if (!selector) {
      spotlight.style.display = 'none';
      return;
    }
    const target = document.querySelector(selector);
    const wrapper = document.querySelector('.phone-stage-wrapper');
    if (!target || !wrapper) {
      spotlight.style.display = 'none';
      return;
    }
    const tRect = target.getBoundingClientRect();
    const wRect = wrapper.getBoundingClientRect();
    spotlight.style.display = 'block';
    spotlight.style.left = `${tRect.left - wRect.left - 4}px`;
    spotlight.style.top = `${tRect.top - wRect.top - 4}px`;
    spotlight.style.width = `${tRect.width + 8}px`;
    spotlight.style.height = `${tRect.height + 8}px`;
  };

  const updateTourStepUi = (stepNum, tag, title, desc) => {
    if (tourStageTag) tourStageTag.textContent = tag;
    if (tourTitle) tourTitle.textContent = title;
    if (tourDesc) tourDesc.textContent = desc;
    document.querySelectorAll('.step-pill').forEach(pill => {
      pill.classList.toggle('active', Number(pill.dataset.step) === stepNum);
    });
  };

  const stopTour = (msg = 'Свободный режим') => {
    tour.running = false;
    if (tour.timer) clearTimeout(tour.timer);
    tour.timer = null;
    if (tourBtnLabel) tourBtnLabel.textContent = 'Запустить автопоказ';
    if (tourIcon) tourIcon.textContent = '▶';
    updateSpotlight(null);
    if (msg && tourStageTag) tourStageTag.textContent = msg;
  };

  const runStep1 = () => {
    tour.step = 1;
    tour.inSecondLoop = false;
    updateTourStepUi(
      1,
      'ШАГ 1 ИЗ 3 · ВОЕННОСЛУЖАЩИЙ',
      'Сдача готового отчёта',
      'Боец научной роты открывает задачу «Обновить страницу проекта» и отправляет отчёт на проверку командиру.'
    );
    const soldierBtn = document.querySelector('[data-role="soldier"]');
    if (soldierBtn) soldierBtn.click();
    const guideStart = document.querySelector('#guide-start');
    if (guideStart) guideStart.click();

    setTimeout(() => {
      if (!tour.running) return;
      updateSpotlight('[data-action="submit-task"]');
      tour.timer = setTimeout(() => {
        if (!tour.running) return;
        const submitBtn = document.querySelector('[data-action="submit-task"]');
        if (submitBtn) {
          submitBtn.click();
          window.spawnRewardBadge('Отчёт на проверке', 'mint', '', 0, -20);
        }
        updateSpotlight(null);
        tour.timer = setTimeout(runStep2, 800);
      }, 1500);
    }, 300);
  };

  const runStep2 = () => {
    tour.step = 2;
    updateTourStepUi(
      2,
      'ШАГ 2 ИЗ 3 · КОМАНДИР',
      'Оценка качества и начисление бонуса',
      'Командир проверяет отчёт, отмечает высокое качество и начисляет бонус +30 XP и +15 баллов за скорость.'
    );
    const commBtn = document.querySelector('[data-role="commander"]');
    if (commBtn) commBtn.click();
    setTimeout(() => {
      if (!tour.running) return;
      const task1 = document.querySelector('[data-action="task"][data-id="1"]');
      if (task1) task1.click();
      setTimeout(() => {
        if (!tour.running) return;
        const bonusSel = document.querySelector('#bonus');
        if (bonusSel) {
          bonusSel.value = 'speed';
          bonusSel.dispatchEvent(new Event('change'));
        }
        const comment = document.querySelector('#review-comment');
        if (comment) {
          comment.value = 'Критерии проверены, отчёт принят с премиальным бонусом.';
        }
        updateSpotlight('[data-action="accept-task"]');
        tour.timer = setTimeout(() => {
          if (!tour.running) return;
          const acceptBtn = document.querySelector('[data-action="accept-task"]');
          if (acceptBtn) acceptBtn.click();
          updateSpotlight(null);
          tour.timer = setTimeout(runStep3, 700);
        }, 1400);
      }, 300);
    }, 300);
  };

  const runStep3 = () => {
    tour.step = 3;
    updateTourStepUi(
      3,
      'ШАГ 3 ИЗ 3 · НАГРАДА И БАЛАНС',
      'Утверждение результата и рост баланса',
      'Результат подтверждён! Боец получает +220 XP и +50 баллов, опыт переведён в уровень, баланс пополнен.'
    );
    updateSpotlight('[data-action="close-celebration"]');
    tour.timer = setTimeout(() => {
      if (!tour.running) return;
      const closeBtn = document.querySelector('[data-action="close-celebration"]');
      if (closeBtn) closeBtn.click();
      const soldierBtn = document.querySelector('[data-role="soldier"]');
      if (soldierBtn) soldierBtn.click();
      updateSpotlight(null);
      stopTour('Тур завершён · Попробуйте магазин поощрений');
      if (tourBtnLabel) tourBtnLabel.textContent = 'Повторить автопоказ';
    }, 3200);
  };

  const runSecondLoop = () => {
    tour.running = true;
    tour.inSecondLoop = true;
    if (tourBtnLabel) tourBtnLabel.textContent = 'Приостановить';
    if (tourIcon) tourIcon.textContent = '⏸';
    updateTourStepUi(
      1,
      'ЦИКЛ ПООЩРЕНИЙ · ШАГ 1 ИЗ 2',
      'Заказ поощрения в каталоге',
      'Боец переходит в «Поощрения», выбирает «Увольнение на выходные» и отправляет заявку на согласование.'
    );
    const soldierBtn = document.querySelector('[data-role="soldier"]');
    if (soldierBtn) soldierBtn.click();
    const shopTab = document.querySelector('[data-page="shop"]');
    if (shopTab) shopTab.click();

    setTimeout(() => {
      if (!tour.running) return;
      updateSpotlight('[data-action="buy"][data-id="leave"]');
      tour.timer = setTimeout(() => {
        if (!tour.running) return;
        const buyBtn = document.querySelector('[data-action="buy"][data-id="leave"]');
        if (buyBtn) buyBtn.click();
        updateSpotlight('#purchase-confirm');
        tour.timer = setTimeout(() => {
          if (!tour.running) return;
          const confirmBtn = document.querySelector('#purchase-confirm');
          if (confirmBtn) {
            confirmBtn.click();
            window.spawnRewardBadge('−180 в резерве', 'gold', '', 0, -20);
          }
          updateSpotlight(null);
          // Step 2 of loop
          tour.timer = setTimeout(() => {
            if (!tour.running) return;
            updateTourStepUi(
              2,
              'ЦИКЛ ПООЩРЕНИЙ · ШАГ 2 ИЗ 2',
              'Согласование заявки командиром',
              'Командир открывает входящие заявки, одобряет поощрение и отмечает выдачу. Резерв списан.'
            );
            const commBtn = document.querySelector('[data-role="commander"]');
            if (commBtn) commBtn.click();
            setTimeout(() => {
              if (!tour.running) return;
              updateSpotlight('[data-action="approve-order"]');
              tour.timer = setTimeout(() => {
                if (!tour.running) return;
                const approveBtn = document.querySelector('[data-action="approve-order"]');
                if (approveBtn) {
                  approveBtn.click();
                  window.spawnRewardBadge('✓ Согласовано!', 'success', '✓', 0, -20);
                }
                setTimeout(() => {
                  if (!tour.running) return;
                  const fulfillBtn = document.querySelector('[data-action="fulfill-order"]');
                  if (fulfillBtn) fulfillBtn.click();
                  const sBtn = document.querySelector('[data-role="soldier"]');
                  if (sBtn) sBtn.click();
                  updateSpotlight(null);
                  stopTour('Поощрение предоставлено');
                }, 1000);
              }, 2000);
            }, 500);
          }, 1200);
        }, 1500);
      }, 1800);
    }, 500);
  };

  if (tourBtn) {
    tourBtn.addEventListener('click', () => {
      if (tour.running) {
        stopTour('Автопоказ приостановлен');
      } else {
        tour.running = true;
        if (tourBtnLabel) tourBtnLabel.textContent = 'Приостановить';
        if (tourIcon) tourIcon.textContent = '⏸';
        runStep1();
      }
    });
  }

  const loopBtn = document.querySelector('#autotour-second-loop');
  if (loopBtn) {
    loopBtn.addEventListener('click', () => {
      if (tour.running) stopTour();
      runSecondLoop();
    });
  }

  const nextBtn = document.querySelector('#tour-next-btn');
  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      tour.running = true;
      if (tour.timer) clearTimeout(tour.timer);
      if (tour.step === 1) runStep2();
      else if (tour.step === 2) runStep3();
      else runStep1();
    });
  }

  const freeBtn = document.querySelector('#tour-free-btn');
  if (freeBtn) {
    freeBtn.addEventListener('click', () => {
      stopTour('Свободный ручной режим');
      const resetBtn = document.querySelector('#reset-demo');
      if (resetBtn) resetBtn.click();
    });
  }

  document.querySelectorAll('.step-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      const step = Number(pill.dataset.step);
      tour.running = true;
      if (tour.timer) clearTimeout(tour.timer);
      if (step === 1) runStep1();
      else if (step === 2) runStep2();
      else if (step === 3) runStep3();
    });
  });

  const phoneEl = document.querySelector('#phone');
  if (phoneEl) {
    phoneEl.addEventListener('click', (e) => {
      if (tour.running && e.isTrusted) {
        stopTour('Ручное управление');
      }
    });
  }

  // Stable no-script reading remains available; interactive examples explain their requirement.
  window.addEventListener('pagehide', () => {linked.disconnect(); cancelAnimationFrame(numberFrame);}, {once:true});
})();
