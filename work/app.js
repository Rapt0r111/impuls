'use strict';
const $=s=>document.querySelector(s);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const shapes={home:'<path d="m3 10 9-7 9 7v10H3z"/><path d="M9 20v-7h6v7"/>',clipboard:'<rect x="5" y="5" width="14" height="16" rx="2"/><rect x="8" y="2" width="8" height="5" rx="1"/><path d="M9 12h6M9 16h4"/>',trophy:'<path d="M8 3h8v7a4 4 0 0 1-8 0zM8 5H4v3c0 3 4 4 4 4m8-7h4v3c0 3-4 4-4 4M12 14v6m-4 1h8"/>',gift:'<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M5 12v9h14v-9M12 8v13"/><path d="M12 8S5 8 5 4c0-4 7 0 7 4Zm0 0s7 0 7-4c0-4-7 0-7 4Z"/>',user:'<circle cx="12" cy="7" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',check:'<path d="m5 12 4 4L19 6"/><path d="M20 12v8H4V4h10"/>',spark:'<path d="m12 2 2.7 7.3L22 12l-7.3 2.7L12 22l-2.7-7.3L2 12l7.3-2.7z"/>',arrow:'<path d="M19 12H5m6-6-6 6 6 6"/>',frame:'<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M7 9V7h2m6 0h2v2m0 6v2h-2m-6 0H7v-2"/>',ticket:'<path d="M3 6h18v4a2 2 0 0 0 0 4v4H3v-4a2 2 0 0 0 0-4zM15 6v3m0 3v1m0 3v2"/>',shield:'<path d="m12 2 8 4v6c0 5-8 10-8 10S4 17 4 12V6z"/><path d="m8 12 3 3 5-6"/>',book:'<path d="M12 5v16M3 3l9 2 9-2v16l-9 2-9-2z"/>',clock:'<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',code:'<path d="m8 6-6 6 6 6m8-12 6 6-6 6M14 3l-4 18"/>'};
const icon=n=>`<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${shapes[n]||shapes.spark}</svg>`;
document.querySelectorAll('[data-icon]').forEach(el=>el.innerHTML=icon(el.dataset.icon));

const skillLevel=v=>v>=85?'Эксперт':v>=65?'Исследователь':v>=45?'Специалист':'Базовый';

const initial=()=>({
  role:'soldier',
  page:'home',
  filter:'all',
  taskSearch:'',
  catFilter:'all',
  rankAll:false,
  seasonView:'current',
  seasonName:'Сентябрь 2026',
  archivedSeason:null,
  otherSeasonScores:null,
  xp:1840,
  season:310,
  points:260,
  reserved:0,
  goal:22,
  teamAchievement:false,
  frame:false,
  kudosReceived:2,
  kudosSent:1,
  quota:{leave:3,duty:1},
  maxQuota:{leave:5,duty:2},
  skills:{web:80,science:55,duty:40},
  labModules:{
    dev:{name:'Цифровизация',count:9,total:10},
    science:{name:'Научный потенциал',count:7,total:10},
    duty:{name:'Внутренний регламент',count:6,total:10}
  },
  proposals:[],
  nextProposalId:1,
  nextTaskId:5,
  tasks:[
    {
      id:1,
      title:'Обновить страницу проекта',
      type:'Разработка',
      priority:'high',
      sla:'До 24 сент (2 дня)',
      status:'doing',
      xp:150,
      coins:50,
      due:'24 сентября',
      report:'Обновлена структура страницы, проверены ссылки и мобильное отображение.',
      reason:'',
      category:'dev',
      milestones:[
        {id:1,title:'Проектирование структуры и ТЗ',criteria:'Описаны разделы страницы и критерии готовности.',status:'doing',reward:'40 XP / 15 баллов',xp:40,coins:15,report:''},
        {id:2,title:'Вёрстка и мобильная адаптация',criteria:'Страница читается без горизонтальной прокрутки на мобильном экране.',status:'pending',reward:'70 XP / 25 баллов',xp:70,coins:25,report:''},
        {id:3,title:'Тестирование и проверка ссылок',criteria:'Ссылки открываются, замечания зафиксированы в отчёте.',status:'pending',reward:'40 XP / 10 баллов',xp:40,coins:10,report:''}
      ]
    },
    {
      id:2,
      title:'Подготовить материалы встречи',
      type:'Организация',
      priority:'critical',
      sla:'До 25 сент (горит)',
      status:'assigned',
      xp:80,
      coins:25,
      due:'25 сентября',
      report:'Список материалов подготовлен, структура выступления согласована.',
      reason:'',
      category:'duty'
    },
    {
      id:3,
      title:'Проверить каталог материалов',
      type:'Повседневная задача',
      priority:'normal',
      sla:'Принято',
      status:'accepted',
      xp:30,
      coins:10,
      due:'21 сентября',
      report:'Каталог проверен, дубли отмечены.',
      reason:'',
      category:'duty'
    },
    {
      id:4,
      title:'Оптимизация репозитория и сборки',
      type:'Разработка',
      priority:'normal',
      sla:'В пуле (свободная)',
      status:'available',
      xp:60,
      coins:20,
      due:'28 сентября',
      report:'',
      reason:'',
      category:'dev',
      criteriaText:'Оптимизировать структуру репозитория; ускорить сборку презентации; протестировать отсутствие ошибок.'
    }
  ],
  orders:[],
  ledger:[
    {title:'Проверка каталога материалов',detail:'Задача принята · 21 сентября',delta:'+30 XP / +10 баллов'},
    {title:'Накопления до демонстрации',detail:'Демонстрационная начальная история',delta:'250 баллов'}
  ],
  nextOrder:1
});

let state=initial(),activeTask=1,pendingReward=null,toastTimer;
const bonuses={
  none:{name:'Без бонуса',xp:0,coins:0},
  quality:{name:'Качество исполнения',xp:20,coins:10},
  speed:{name:'Опережение графика',xp:30,coins:15},
  independent:{name:'Самостоятельность',xp:15,coins:5},
  team:{name:'Помощь сослуживцам',xp:25,coins:15},
  innovation:{name:'Рацпредложение / Инновация',xp:40,coins:20},
  docs:{name:'Отличная документация',xp:20,coins:10},
  complex:{name:'Повышенная сложность',xp:50,coins:25}
};
const rewards=[
  {id:'leave',name:'Заявка на увольнение',price:180,icon:'ticket',type:'review',text:'Рассмотрение командиром. Дата и условия определяются отдельно.'},
  {id:'frame',name:'Рамка профиля «Контур»',price:80,icon:'frame',type:'instant',text:'Бирюзовое оформление карточки. Появится в профиле сразу после покупки.'},
  {id:'duty',name:'Заявка на освобождение от наряда',price:300,icon:'shield',type:'review',text:'Только при утверждении такой позиции командованием. Демонстрационный пример.'}
];
const statusLabel={assigned:'Назначена',doing:'В работе',submitted:'На проверке',rework:'На доработке',accepted:'Принята',available:'Свободная'};
const orderLabel={pending:'На рассмотрении',approved:'Согласована',rejected:'Отклонена',fulfilled:'Предоставлено',cancelled:'Отменена'};
const surnames=['Д. Соколов','М. Орлов','А. Волков','И. Смирнов','П. Кузнецов','Е. Лебедев','Н. Попов','О. Васильев','Р. Петров','В. Иванов','К. Новиков','С. Морозов','А. Фёдоров','Д. Павлов','М. Семёнов','И. Голубев','П. Виноградов','Е. Богданов','Н. Воробьёв','О. Никитин','Р. Михайлов','В. Егоров','К. Макаров','С. Андреев','А. Алексеев','Д. Романов','М. Захаров','И. Борисов','П. Яковлев','Е. Григорьев','Н. Сергеев','О. Титов','Р. Козлов','В. Громов','К. Белов','С. Савельев','А. Тихонов','Д. Крылов','М. Зайцев'];

function ranking(){
  const scores=[780,660,440,390,350];
  const arr=surnames.map((name,i)=>({name,score:state.otherSeasonScores?state.otherSeasonScores[i]:i<5?scores[i]:Math.max(5,295-(i-5)*8),id:i+1,me:false}));
  arr.push({name:'А. Лазарев',score:state.season,id:40,me:true});
  arr.sort((a,b)=>b.score-a.score||a.id-b.id);
  let last=-1,rank=0;
  return arr.map((u,i)=>{if(u.score!==last)rank=i+1;last=u.score;return {...u,rank}});
}

const meRank=()=>ranking().find(x=>x.me).rank;
const level=()=>1+Math.floor(state.xp/500);
function toast(msg){clearTimeout(toastTimer);$('#toast').textContent=msg;$('#toast').hidden=false;toastTimer=setTimeout(()=>$('#toast').hidden=true,4200)}
function go(page){state.page=page;render();$('#screen').scrollTop=0;}

function taskRow(t){
  const prioTag=t.priority?`<span class="priority-tag ${t.priority}">${t.priority==='critical'?'Срочно':t.priority==='high'?'Высокий':'Штатный'}</span>`:'';
  const slaTag=t.sla?`<span class="sla-badge ${t.priority==='critical'?'urgent':''}">${esc(t.sla)}</span>`:'';
  const badgeClass=t.status==='submitted'||t.status==='rework'?'amber':t.status==='accepted'?'':t.status==='available'?'available':'muted';
  return `<div class="taskrow"><button class="open-task" data-action="task" data-id="${t.id}"><div class="row"><div style="display:flex;align-items:center;gap:4px"><span class="minor">${esc(t.type)}</span>${prioTag}</div><span class="badge ${badgeClass}">${statusLabel[t.status]}</span></div><h4>${esc(t.title)}</h4><div class="meta"><span>${slaTag||'До '+esc(t.due)}</span><span class="rewardline">${t.xp} XP · ${t.coins} баллов</span></div></button></div>`;
}

function wallet(){
  return `<div class="balance"><div><strong>${state.points}</strong><small>доступно баллов</small></div><div><strong style="color:var(--ink)">${state.reserved}</strong><small>в резерве по заявкам</small></div></div>`;
}

function home(){
  const t=state.tasks.find(t=>t.status!=='accepted')||state.tasks[0];
  return `<div class="userline"><div class="avatar" ${state.frame?'style="outline:2px solid var(--mint);outline-offset:2px"':''}>АЛ</div><div><strong>Алексей Лазарев</strong><small>Исследователь · демопрофиль</small></div><span class="badge" style="margin-left:auto">${meRank()} место</span></div><div class="levelbox"><div class="row"><div class="number">${level()} <span>уровень</span></div><div style="text-align:right"><span class="rewardline">${state.xp.toLocaleString('ru-RU')} XP</span><p>общий опыт</p></div></div><div class="progress" role="progressbar" aria-label="Опыт до следующего уровня" aria-valuenow="${state.xp%500}" aria-valuemin="0" aria-valuemax="500"><span style="width:${state.xp%500/5}%"></span></div><p style="font-size:11px">${state.xp%500} / 500 XP · до уровня ${level()+1} ещё ${500-state.xp%500}</p></div>${wallet()}<h3>Ваш следующий результат</h3>${taskRow(t)}<div class="mission"><div class="row"><div><h4>Исследовательский модуль</h4><p>Общая цель роты · ${state.seasonName}</p></div><span class="mission-count">${state.goal}<small style="font-size:11px;color:#b4d1c8"> / 30</small></span></div><div class="progress" role="progressbar" aria-label="Общая цель: принятые результаты" aria-valuenow="${state.goal}" aria-valuemin="0" aria-valuemax="30"><span style="width:${state.goal/30*100}%"></span></div><div class="modules-grid"><div class="module-card"><h5>Цифровизация</h5><strong>${state.labModules.dev.count}/${state.labModules.dev.total}</strong></div><div class="module-card"><h5>Науч. потенциал</h5><strong>${state.labModules.science.count}/${state.labModules.science.total}</strong></div><div class="module-card"><h5>Регламент</h5><strong>${state.labModules.duty.count}/${state.labModules.duty.total}</strong></div></div><svg class="mission-svg" viewBox="0 0 310 58" role="img" aria-label="Схема модулей общей цели"><path d="M7 44h294M25 44V12h54v32m21 0V6h82v38m22 0V18h76v26"/><rect class="built" x="32" y="20" width="15" height="16"/><rect class="built" x="55" y="20" width="15" height="16"/><rect class="built" x="109" y="14" width="26" height="22"/><rect class="built" x="145" y="14" width="26" height="22"/><rect x="213" y="26" width="25" height="10"/><rect x="247" y="26" width="25" height="10"/><path d="M20 50h12m66 0h15m88 0h15m56 0h15"/></svg><p>Принятые результаты развивают тематические направления лаборатории.</p></div>`;
}

function tasks(){
  const search=(state.taskSearch||'').toLowerCase().trim();
  const cat=state.catFilter||'all';

  let list=state.tasks.filter(t=>{
    const statusMatch=state.filter==='all'||(state.filter==='active'?['doing','assigned','rework','available'].includes(t.status):t.status===state.filter);
    const catMatch=cat==='all'||t.category===cat;
    const searchMatch=!search||t.title.toLowerCase().includes(search)||(t.criteriaText&&t.criteriaText.toLowerCase().includes(search))||(t.report&&t.report.toLowerCase().includes(search));
    return statusMatch&&catMatch&&searchMatch;
  });

  const propBtn=state.role==='soldier'?`<button class="btn quiet wide" style="margin:10px 0 4px" data-action="open-proposal">+ Предложить инициативу роты</button>`:'';
  const cmdBtn=state.role==='commander'?`<button class="btn quiet wide" style="margin:10px 0 4px" data-action="open-create-task">+ Назначить новую задачу</button>`:'';

  return `<h2>Задачи</h2><p>Результат начинается с понятных критериев.</p>
  <div style="display:flex;gap:6px;margin:12px 0 6px">
    <input type="search" id="task-search-input" aria-label="Поиск по задачам" placeholder="Поиск по задачам..." value="${esc(state.taskSearch||'')}" style="background:#0a1921;border:1px solid #45616b;border-radius:8px;color:var(--ink);padding:7px 10px;font-size:12px;flex:1;caret-color:var(--mint);min-height:36px">
    <select id="task-cat-select" aria-label="Категория задач" style="background:#0a1921;border:1px solid #45616b;border-radius:8px;color:var(--ink);padding:6px;font-size:11px;min-height:36px;width:125px">
      <option value="all" ${cat==='all'?'selected':''}>Все сферы</option>
      <option value="dev" ${cat==='dev'?'selected':''}>Разработка</option>
      <option value="science" ${cat==='science'?'selected':''}>НИР</option>
      <option value="duty" ${cat==='duty'?'selected':''}>Регламент</option>
    </select>
  </div>
  <div class="filters" aria-label="Фильтр задач">${[['all','Все'],['active','В работе'],['submitted','Проверка'],['accepted','Приняты']].map(([key,label])=>`<button data-action="filter" data-value="${key}" class="${state.filter===key?'active':''}" aria-pressed="${state.filter===key}">${label}</button>`).join('')}</div>
  ${cmdBtn}${propBtn}
  <p class="subnote" role="status">Найдено задач: ${list.length}</p>${list.length?list.map(taskRow).join(''):`<div class="listempty">${icon('clipboard')}<h3>Ничего не найдено</h3><p>Измените поисковый запрос или фильтр.</p></div>`}
  <p class="subnote">В прототипе интерактивные задачи, поиск и биржа предложений.</p>`;
}

function taskDetail(){
  const t=state.tasks.find(t=>t.id===activeTask);
  let action='';
  const hasSubmittedMilestone=t.milestones&&t.milestones.some(m=>m.status==='submitted');

  const mDone=t.milestones?t.milestones.filter(m=>m.status==='accepted').length:0;
  const mTotal=t.milestones?t.milestones.length:0;
  const mEarnedXp=t.milestones?t.milestones.filter(m=>m.status==='accepted').reduce((s,m)=>s+m.xp,0):0;
  const mEarnedCoins=t.milestones?t.milestones.filter(m=>m.status==='accepted').reduce((s,m)=>s+m.coins,0):0;
  const remXp=Math.max(0, t.xp - mEarnedXp);
  const remCoins=Math.max(0, t.coins - mEarnedCoins);

  if(state.role==='soldier'){
    if(t.status==='available') action='<button class="btn primary wide" data-action="take-task">Взять задачу в работу</button>';
    else if(t.status==='assigned') action='<button class="btn primary wide" data-action="start-task">Начать работу</button>';
    else if(['doing','rework'].includes(t.status)){
      action=`${t.reason?`<div class="statusbox"><strong>Комментарий проверяющего</strong>${esc(t.reason)}</div>`:''}<label class="field">Краткий отчёт о результате<textarea id="report" maxlength="1200">${esc(t.report)}</textarea></label><p id="form-error" class="error" role="alert"></p><button class="btn primary wide" data-action="submit-task">Отправить всю задачу на проверку</button>`;
    } else {
      action=`<div class="statusbox"><strong>${t.status==='accepted'?'Результат принят':'Результат ожидает проверки'}</strong>${t.status==='accepted'?'Начисление отражено в истории.':'Баллы появятся после подтверждения командиром.'}</div>`;
    }
  } else if(state.role==='commander'&&t.status==='submitted'){
    const prevPaidNotice=t.milestones&&mEarnedXp>0?`<div style="font-size:11px;color:var(--mint);margin:6px 0;padding:6px 9px;background:#0d2325;border-radius:6px;border:1px solid #1a423e">По ранее принятым вехам уже начислено: <strong>+${mEarnedXp} XP / +${mEarnedCoins} баллов</strong>. К финальному закрытию: остаток <strong>${remXp} XP / ${remCoins} баллов</strong>.</div>`:'';
     action=`<div class="statusbox"><strong>Отчёт участника</strong>${esc(t.report)}</div>${prevPaidNotice}<div class="reward-inputs"><label class="field">Опыт XP к начислению<input type="number" id="review-xp" value="${remXp}" min="0" max="1000" step="1"></label><label class="field">Баллы к начислению<input type="number" id="review-coins" value="${remCoins}" min="0" max="500" step="1"></label></div><label class="field">Бонус к базовой награде<select id="bonus">${Object.entries(bonuses).map(([key,b])=>`<option value="${key}">${b.name}${b.xp?' · +'+b.xp+' XP / +'+b.coins+' баллов':''}</option>`).join('')}</select></label><label class="field">Обоснование решения<textarea id="review-comment" maxlength="800" placeholder="Что проверено и почему принято решение"></textarea></label><p id="form-error" class="error" role="alert"></p><button class="btn primary wide" data-action="accept-task">Принять и начислить</button><button class="btn quiet wide" style="margin-top:8px" data-action="return-task">Вернуть на доработку</button>`;
  } else if(t.status==='available'){
    action=`<div class="statusbox"><strong>Открытая задача роты</strong>Задача находится в общем пуле и доступна для выполнения любому участнику.</div>`;
  } else if(state.role==='commander'&&hasSubmittedMilestone){
    action=`<div class="statusbox"><strong>Ожидает проверки этап задачи</strong>Нажмите «Принять этап» в списке вех выше для частичного начисления.</div>`;
  } else {
    action=`<div class="statusbox"><strong>${statusLabel[t.status]}</strong>Принять работу можно после отправки результата исполнителем.</div>`;
  }

  let milestonesHtml='';
  if(t.milestones){
    milestonesHtml=`<div class="milestones"><div class="milestones-header"><h4>Этапы выполнения (вехи)</h4><span class="badge ${mDone===mTotal?'':'muted'}">${mDone} из ${mTotal} выполнено</span></div><div style="display:flex;justify-content:space-between;font-size:11px;color:var(--muted);margin:3px 0 6px"><span>Выплачено: <strong style="color:var(--mint)">${mEarnedXp} XP / ${mEarnedCoins} б.</strong></span><span>Остаток фонда: <strong style="color:var(--gold)">${remXp} XP / ${remCoins} б.</strong></span></div><div class="progress" role="progressbar" aria-label="Прогресс этапов" aria-valuenow="${mDone}" aria-valuemin="0" aria-valuemax="${mTotal}"><span style="width:${(mDone/mTotal)*100}%"></span></div>${t.milestones.map(m=>{
      let mAction='';
      if(state.role==='soldier'&&m.status==='doing'&&t.status==='doing'){
        mAction=`<button class="btn primary small" data-action="submit-milestone" data-mid="${m.id}">Сдать этап</button>`;
       } else if(state.role==='commander'&&m.status==='submitted'){
        mAction=`<button class="btn primary small" data-action="accept-milestone" data-mid="${m.id}">Принять этап</button>`;
      }
      const reportField=state.role==='soldier'&&m.status==='doing'&&t.status==='doing'?`<label class="field">Результат этапа «${esc(m.title)}»<textarea id="milestone-report-${m.id}" maxlength="1200" placeholder="Опишите проверяемый результат этапа">${esc(m.report||'')}</textarea></label><p id="milestone-error-${m.id}" class="error" role="alert"></p>`:m.report?`<p class="milestone-report"><strong>Отчёт этапа:</strong> ${esc(m.report)}</p>`:'';
      return `<div class="milestone-item"><div class="milestone-title">${icon(m.status==='accepted'?'check':m.status==='doing'?'clock':m.status==='submitted'?'spark':'spark')}<span>${esc(m.title)}</span></div><div class="milestone-actions">${mAction}<span class="minor" style="font-weight:600">${m.xp} XP / ${m.coins} б.</span><span class="badge ${m.status==='accepted'?'':m.status==='doing'?'amber':m.status==='submitted'?'amber':'muted'}">${m.status==='accepted'?'Принят':m.status==='doing'?'Текущий':m.status==='submitted'?'На проверке':'В плане'}</span></div></div><p class="milestone-criteria"><strong>Критерий:</strong> ${esc(m.criteria||m.title)}</p>${reportField}`;
    }).join('')}</div>`;
  }

  const criteriaHtml=t.criteriaText?t.criteriaText.split(';').map(c=>`<li>${esc(c.trim())}</li>`).join(''):(t.id===1?'<li>Структура страницы обновлена.</li><li>Ссылки открываются, текст проверен.</li><li>Мобильное отображение без обрезания.</li>':t.id===2?'<li>Список материалов подготовлен.</li><li>Структура выступления согласована.</li>':'<li>Каталог проверен.</li><li>Дубли отмечены в отчёте.</li>');

  return `<button class="back" data-action="back-tasks">${icon('arrow')} ${state.role==='commander'?'К проверке':state.role==='admin'?'К управлению':'К задачам'}</button><span class="badge ${t.status==='submitted'?'amber':t.status==='available'?'available':'muted'}">${statusLabel[t.status]}</span><h2 class="detail-title">${esc(t.title)}</h2><div class="info"><span>${esc(t.type)}<br>До ${esc(t.due)}</span><span class="rewardline">${t.xp} XP<br>${t.coins} баллов</span></div><p>Исполнитель: ${t.status==='available'?'Открытый пул роты':'А. Лазарев'}<br>Проверяющий: руководитель направления</p><h3>Критерии приёмки</h3><ul class="criteria">${criteriaHtml}</ul>${milestonesHtml}${action}`;
}

function leaderboard(){
  const seasonTabs=`<div class="season-tabs"><button class="${state.seasonView==='current'?'active':''}" aria-pressed="${state.seasonView==='current'}" data-action="set-season" data-value="current">${state.seasonName} (текущий)</button><button class="${state.seasonView==='august'?'active':''}" aria-pressed="${state.seasonView==='august'}" data-action="set-season" data-value="august">Август 2026 (архив)</button>${state.archivedSeason?`<button class="${state.seasonView==='archive'?'active':''}" aria-pressed="${state.seasonView==='archive'}" data-action="set-season" data-value="archive">${state.archivedSeason.name} (архив)</button>`:''}</div>`;
  if(state.seasonView==='archive'&&state.archivedSeason){
    const archived=state.archivedSeason;
    return `<h2>Рейтинг</h2><p>Закрытый сезон · ${esc(archived.name)}</p>${seasonTabs}${archived.rows.map(u=>`<div class="rankrow ${u.me?'me':''}"><span class="rank">${u.rank}</span><div><strong>${esc(u.name)}${u.me?' · вы':''}</strong><small>Снимок на момент закрытия</small></div><span class="score">${u.score} XP</span></div>`).join('')}<p class="subnote">Архивный результат не меняется после закрытия сезона.</p>`;
  }
  if(state.seasonView==='august'){
    const augustTop=[
      {name:'Д. Соколов',score:820,rank:1,title:'Золотой знак сезона'},
      {name:'М. Орлов',score:790,rank:2,title:'Серебряный знак'},
      {name:'А. Лазарев',score:680,rank:3,title:'Бронзовый знак (вы)',me:true}
    ];
    return `<h2>Рейтинг</h2><p>Архив закрытых сезонов роты</p>${seasonTabs}<div class="podium">${[augustTop[1],augustTop[0],augustTop[2]].map(u=>`<div><div class="avatar">${u.name.split(' ').map(x=>x[0]).join('')}</div><small>${u.rank} место</small><b>${esc(u.name)}</b><strong>${u.score}</strong><small>${esc(u.title)}</small></div>`).join('')}</div><div class="statusbox" style="margin-top:16px"><strong>Архив сезона: Август 2026</strong>Сезон успешно завершён 31 августа. Все 40 участников выполнили нормативы. Данные сохранены в Зале Славы.</div>`;
  }

  const list=ranking(),top=list.slice(0,3),rows=state.rankAll?list:list.slice(0,6);
  return `<h2>Рейтинг</h2><p>${state.seasonName} · 40 демоучастников</p>${seasonTabs}<div class="podium">${[top[1],top[0],top[2]].map(u=>`<div><div class="avatar">${u.name.split(' ').map(x=>x[0]).join('')}</div><small>${u.rank} место</small><b>${esc(u.name)}</b><strong>${u.score}</strong><small>XP за сезон</small></div>`).join('')}</div><p class="subnote">Расход баллов не уменьшает опыт.</p>${rows.map(u=>`<div class="rankrow ${u.me?'me':''}"><span class="rank">${u.rank}</span><div><strong>${esc(u.name)}${u.me?' · вы':''}</strong><small>${u.me?'Исследователь':'Участник'}</small></div><span class="score">${u.score} XP</span></div>`).join('')}<button class="btn quiet wide" style="margin-top:13px" data-action="rank-toggle">${state.rankAll?'Показать первую шестёрку':'Показать всех 40'}</button><p class="subnote">Учитывается подтверждённый опыт сезона. Все имена и значения вымышлены.</p>`;
}

function orderCard(o,commander=false){
  const r=rewards.find(x=>x.id===o.reward);
  let actions='';
  if(commander&&o.status==='pending') actions=`<div class="actions"><button class="btn primary small" data-action="approve-order" data-id="${o.id}">Согласовать</button><button class="btn quiet small" data-action="reject-order" data-id="${o.id}">Отклонить</button></div>`;
  if(commander&&o.status==='approved') actions=`<div class="actions"><button class="btn primary small" data-action="fulfill-order" data-id="${o.id}">Отметить предоставление</button></div>`;
  if(!commander&&o.status==='pending') actions=`<div class="actions"><button class="btn quiet small" data-action="cancel-order" data-id="${o.id}">Отменить заявку</button></div>`;
  return `<div class="request"><div class="row start"><h4>${esc(r.name)}</h4><span class="badge ${o.status==='pending'?'amber':'muted'}">№${o.id}</span></div><p>${orderLabel[o.status]} · ${r.price} баллов</p><p style="font-size:11px;margin-top:5px">${o.status==='pending'?'Баллы в резерве. Заявка не является разрешением.':o.status==='approved'?'Баллы списаны. Ожидается фактическое предоставление.':o.status==='rejected'?'Демонстрационная причина: нет доступной возможности. Резерв возвращён.':o.status==='cancelled'?'Отменено участником. Резерв возвращён.':'Предоставление отмечено в демонстрации.'}</p>${actions}</div>`;
}

function shop(){
  return `<h2>Поощрения</h2><p>Выберите цель для заработанных баллов.</p>${wallet()}${rewards.map(r=>{
    const pending=state.orders.some(o=>o.reward===r.id&&['pending','approved'].includes(o.status));
    const owned=r.id==='frame'&&state.frame;
    const isLimited=state.quota&&state.quota[r.id]!==undefined;
    const rem=isLimited?state.quota[r.id]:null;
    const maxQ=isLimited?state.maxQuota[r.id]:null;
    const outOfStock=isLimited&&rem<=0;
    let label=state.role!=='soldier'?'Только для участника':owned?'Уже в профиле':pending?'Заявка открыта':outOfStock?'Лимит исчерпан':state.points<r.price?`Не хватает ${r.price-state.points}`:r.type==='instant'?'Купить за '+r.price:'Запросить за '+r.price;
    const quotaTag=isLimited?`<span class="quota-tag ${rem===0?'none':rem<=1?'low':''}">${rem>0?'Осталось мест: '+rem+' из '+maxQ:'Лимит исчерпан'}</span>`:'';
    return `<div class="rewardcard"><div class="rewardicon">${icon(r.icon)}</div><div><div class="row start"><h4>${r.name}</h4>${quotaTag}</div><p>${r.text}</p><button class="btn ${state.role==='soldier'&&!owned&&!pending&&!outOfStock&&state.points>=r.price?'primary':'quiet'}" data-action="buy" data-id="${r.id}" ${state.role!=='soldier'||owned||pending||outOfStock||state.points<r.price?'disabled':''}>${label}</button></div></div>`;
  }).join('')}<p class="subnote">Цены и позиции — предложения для обсуждения. Служебные поощрения доступны только после утверждения правил.</p><h3>Мои заявки</h3>${state.orders.length?state.orders.slice().reverse().map(o=>orderCard(o)).join(''):'<p>Пока нет заявок. Выберите доступное поощрение.</p>'}`;
}

function profile(){
  const ach1 = state.tasks.some(t => t.status === 'accepted');
  const ach2 = state.skills.web >= 85 || state.skills.science >= 60 || state.skills.duty >= 45;
  const ach3 = state.goal >= 23 || state.teamAchievement;
  const ach4 = state.kudosReceived >= 3;
  const ach5 = state.season >= 350 || state.xp >= 1900;
  const ach6 = state.tasks.some(t => t.category === 'dev' && t.status === 'accepted');

  return `<div class="userline"><div class="avatar large" ${state.frame?'style="outline:2px solid var(--mint);outline-offset:4px"':''}>АЛ</div><div><h2 style="font-size:21px">Алексей Лазарев</h2><p>Исследователь · уровень ${level()}</p><span class="rewardline">${state.xp} XP · ${meRank()} место в сезоне</span></div></div>${wallet()}
  <h3>Матрица компетенций исследователя</h3>
  <div class="skills-box">
    <div class="skill-row"><div class="skill-head"><span>Web-разработка и сервисы</span><strong>${state.skills.web}% · ${skillLevel(state.skills.web)}</strong></div><div class="progress" role="progressbar" aria-label="Web компетенция" aria-valuenow="${state.skills.web}" aria-valuemin="0" aria-valuemax="100"><span style="width:${state.skills.web}%"></span></div></div>
    <div class="skill-row"><div class="skill-head"><span>НИР и технический анализ</span><strong>${state.skills.science}% · ${skillLevel(state.skills.science)}</strong></div><div class="progress" role="progressbar" aria-label="НИР компетенция" aria-valuenow="${state.skills.science}" aria-valuemin="0" aria-valuemax="100"><span style="width:${state.skills.science}%"></span></div></div>
    <div class="skill-row"><div class="skill-head"><span>Регламент и документация</span><strong>${state.skills.duty}% · ${skillLevel(state.skills.duty)}</strong></div><div class="progress" role="progressbar" aria-label="Регламент компетенция" aria-valuenow="${state.skills.duty}" aria-valuemin="0" aria-valuemax="100"><span style="width:${state.skills.duty}%"></span></div></div>
  </div>
  <div class="kudos-box">
    <div class="kudos-head">
      <div>
        <h4 style="margin:0 0 2px;font-size:12px;color:var(--ink)">Взаимное признание («Импульс-Спасибо»)</h4>
        <p style="font-size:11px;margin:0;color:var(--muted)">Получено: <strong>${state.kudosReceived}</strong> · Отправлено: <strong>${state.kudosSent}</strong></p>
      </div>
      <button class="btn primary small" data-action="open-kudos">Сказать спасибо</button>
    </div>
    <p style="font-size:11px;color:var(--muted);margin:0">Горизонтальная благодарность за помощь в решении задач роты.</p>
  </div>
  <h3>Достижения</h3>
  <div class="achievement-grid">
    <div class="achievement ${ach1?'':'locked'}">${icon('spark')}Первый результат<br><small style="font-size:9px;color:var(--muted)">${ach1?'Принят':'1 задача'}</small></div>
    <div class="achievement ${ach2?'':'locked'}">${icon('book')}Новый навык<br><small style="font-size:9px;color:var(--muted)">${ach2?'Прокачан':'Рост навыка'}</small></div>
    <div class="achievement ${ach3?'':'locked'}">${icon('trophy')}Командный вклад<br><small style="font-size:9px;color:var(--muted)">${state.goal}/23 модулей</small></div>
    <div class="achievement ${ach4?'':'locked'}">${icon('user')}Наставник<br><small style="font-size:9px;color:var(--muted)">${state.kudosReceived}/3 спасибо</small></div>
    <div class="achievement ${ach5?'':'locked'}">${icon('shield')}Служба в роте<br><small style="font-size:9px;color:var(--muted)">${state.season}/350 XP</small></div>
    <div class="achievement ${ach6?'':'locked'}">${icon('code')}Чистый код<br><small style="font-size:9px;color:var(--muted)">${ach6?'Принят Dev':'Dev задача'}</small></div>
  </div>
  <p class="subnote">${state.frame?'Рамка «Контур» добавлена в профиль.':'Оформление профиля можно приобрести за баллы.'}</p>
  <h3>История операций</h3>${state.ledger.map(l=>`<div class="ledger"><div>${esc(l.title)}<small>${esc(l.detail)}</small></div><span class="delta">${esc(l.delta)}</span></div>`).join('')}<p class="subnote">XP и баллы учитываются отдельно. Все записи этой страницы — демонстрационные.</p>`;
}

function admin(){
  return `<div class="row"><h2>Управление</h2><span class="badge" style="background:#3d2f1b;color:var(--gold)">Администратор</span></div>
  <p>Панель администрирования каталога, лимитов и сезона роты.</p>
  
  <h3>Квоты поощрений на сезон</h3>
  <div style="background:#11262f;border:1px solid var(--line);border-radius:10px;padding:12px;margin:10px 0">
    <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--line)">
      <div>
        <strong style="font-size:12px;display:block">Заявка на увольнение</strong>
        <span class="minor" style="font-size:11px">Осталось квот: <strong style="color:var(--mint)">${state.quota.leave}</strong> из ${state.maxQuota.leave}</span>
      </div>
      <div style="display:flex;gap:6px">
        <button class="btn quiet small" data-action="admin-quota" data-item="leave" data-delta="-1" style="padding:4px 9px;min-height:28px" ${state.quota.leave<=0?'disabled':''}>−</button>
        <button class="btn primary small" data-action="admin-quota" data-item="leave" data-delta="1" style="padding:4px 9px;min-height:28px" ${state.quota.leave>=state.maxQuota.leave?'disabled':''}>+</button>
      </div>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0">
      <div>
        <strong style="font-size:12px;display:block">Освобождение от наряда</strong>
        <span class="minor" style="font-size:11px">Осталось квот: <strong style="color:var(--mint)">${state.quota.duty}</strong> из ${state.maxQuota.duty}</span>
      </div>
      <div style="display:flex;gap:6px">
        <button class="btn quiet small" data-action="admin-quota" data-item="duty" data-delta="-1" style="padding:4px 9px;min-height:28px" ${state.quota.duty<=0?'disabled':''}>−</button>
        <button class="btn primary small" data-action="admin-quota" data-item="duty" data-delta="1" style="padding:4px 9px;min-height:28px" ${state.quota.duty>=state.maxQuota.duty?'disabled':''}>+</button>
      </div>
    </div>
  </div>

  <h3>Управление сезоном роты</h3>
  <div style="background:#11262f;border:1px solid var(--line);border-radius:10px;padding:12px;margin:10px 0">
     <div style="font-size:12px;margin-bottom:6px">Текущий сезон: <strong>${state.seasonName}</strong> · Участников: <strong>40</strong></div>
     <p style="font-size:11px;color:var(--muted);margin-bottom:10px">Архивация сохраняет снимок рейтинга и открывает следующий демонстрационный сезон.</p>
     <button class="btn quiet wide small" data-action="admin-archive-season" ${state.archivedSeason?'disabled':''}>${state.archivedSeason?'Снимок сезона сохранён':'Закрыть сезон и сохранить рейтинг'}</button>
  </div>

  <h3>Журнал системного аудита (${state.ledger.length})</h3>
  <div style="max-height:180px;overflow-y:auto;padding-right:4px;margin-bottom:10px">
    ${state.ledger.map(l=>`<div class="ledger"><div>${esc(l.title)}<small>${esc(l.detail)}</small></div><span class="delta">${esc(l.delta)}</span></div>`).join('')}
  </div>
  <button class="btn quiet wide small" data-action="admin-reset-data" style="font-size:11px">Сбросить данные к начальным</button>`;
}

function reviews(){
  const list=state.tasks.filter(t=>t.status==='submitted'||(t.milestones&&t.milestones.some(m=>m.status==='submitted'))),
        orders=state.orders.filter(o=>['pending','approved'].includes(o.status)),
        pendingProps=state.proposals.filter(p=>p.status==='pending');

  let propsHtml='';
  if(pendingProps.length){
    propsHtml=`<h3>Входящие инициативы роты · ${pendingProps.length}</h3>${pendingProps.map(p=>`<div class="prop-card"><div class="row start"><h4>${esc(p.title)}</h4><span class="badge">${esc(p.type)}</span></div><p style="font-size:12px;margin:4px 0 8px">${esc(p.desc)}</p><div class="minor" style="margin-bottom:8px">Автор: ${esc(p.author)}</div><div class="actions"><button class="btn primary small" data-action="approve-proposal" data-id="${p.id}">Одобрить и создать задачу</button><button class="btn quiet small" data-action="reject-proposal" data-id="${p.id}">Отклонить</button></div></div>`).join('')}`;
  }

  return `<div class="row"><h2>Проверка</h2><span class="badge">Командир</span></div><p>Результат, решение, понятная награда.</p>${propsHtml}<h3>Результаты на проверке · ${list.length}</h3>${list.length?list.map(taskRow).join(''):`<div class="listempty">${icon('check')}<h3>Нет ожидающих результатов</h3><p>Отправьте задачу от лица военнослужащего, чтобы показать приёмку.</p></div>`}<h3>Заявки на поощрения · ${orders.length}</h3>${orders.length?orders.map(o=>orderCard(o,true)).join(''):'<p>Новые заявки появятся после оформления в каталоге.</p>'}<h3>Последние решения</h3>${state.ledger.filter(l=>!l.detail.includes('начальная')).slice(0,4).map(l=>`<div class="ledger"><div>${esc(l.title)}<small>${esc(l.detail)}</small></div><span class="delta">${esc(l.delta)}</span></div>`).join('')}`;
}

function render(){
  document.querySelectorAll('[data-role]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.role===state.role)));
  const pages={home,tasks,task:taskDetail,leaderboard,shop,profile,reviews,admin};
  $('#screen').innerHTML=(pages[state.page]||home)();
  const nav=[
    [state.role==='commander'?'reviews':state.role==='admin'?'admin':'home',state.role==='commander'?'check':state.role==='admin'?'shield':'home',state.role==='commander'?'Проверка':state.role==='admin'?'Управление':'Главная'],
    ['tasks','clipboard','Задачи'],
    ['leaderboard','trophy','Рейтинг'],
    ['shop','gift','Поощрения'],
    ['profile','user','Профиль']
  ];
  $('#bottomnav').innerHTML=nav.map(([p,i,n])=>`<button data-page="${p}" class="${state.page===p||(state.page==='task'&&p===(state.role==='commander'?'reviews':state.role==='admin'?'admin':'tasks'))?'active':''}" ${state.page===p?'aria-current="page"':''}>${icon(i)}<span>${n}</span></button>`).join('');
}

function celebrate(xp,coins,previousLevel){
  const up=level()>previousLevel;
  $('#celebration-host').innerHTML=`<div class="celebration" role="dialog" aria-modal="true" aria-labelledby="reward-heading"><div class="celebrate-inner"><div class="celebrate-icon">${icon(up?'trophy':'spark')}</div><h3 id="reward-heading">${up?'Новый уровень — '+level():'Результат принят'}</h3><p>Работа подтверждена командиром.<br>Вклад стал частью общего результата.</p><div class="gains"><div><strong>+${xp}</strong><small>опыта XP</small></div><div><strong>+${coins}</strong><small>баллов</small></div></div><button class="btn primary wide" data-action="close-celebration">Продолжить</button></div></div>`;
  $('#screen').inert=true;
  $('#bottomnav').inert=true;
  document.querySelectorAll('[data-role]').forEach(x=>x.disabled=true);
  $('#celebration-host button').focus();
}

function closeCelebration(){
  const was=!!$('#celebration-host').innerHTML;
  $('#celebration-host').innerHTML='';
  $('#screen').inert=false;
  $('#bottomnav').inert=false;
  document.querySelectorAll('[data-role]').forEach(x=>x.disabled=false);
  if(was)$('#screen').focus();
}

function log(title,detail,delta){state.ledger.unshift({title,detail,delta})}

function openPurchase(id){
  const r=rewards.find(x=>x.id===id);
  if(!r||state.role!=='soldier')return;
  pendingReward=id;
  const isLimited=state.quota&&state.quota[r.id]!==undefined;
  const quotaInfo=isLimited?`<p style="font-size:11px;color:var(--mint);margin:6px 0">Доступно квот на сезон: <strong>${state.quota[r.id]} из ${state.maxQuota[r.id]} мест</strong>.</p>`:'';
  $('#purchase-title').textContent=r.type==='instant'?'Покупка оформления':'Заявка на поощрение';
  $('#purchase-body').innerHTML=`<p>${esc(r.name)}</p><div class="dialogprice">${r.price} баллов · останется ${state.points-r.price}</div>${quotaInfo}<p>${r.type==='instant'?'Баллы спишутся, а оформление сразу появится в профиле. Опыт и рейтинг сохранятся.':'Баллы будут зарезервированы до решения командира. Заявка не является разрешением. Доступность, дата и условия согласуются отдельно.'}</p><p style="font-size:11px">Это локальная демонстрация. Реального обращения не будет.</p>`;
  $('#purchase-confirm').textContent=r.type==='instant'?'Купить':'Создать заявку';
  $('#purchase-dialog').showModal();
}

$('#purchase-confirm').addEventListener('click',()=>{
  const r=rewards.find(x=>x.id===pendingReward);
  if(!r||state.role!=='soldier')return;
  if(state.points<r.price){toast('Недостаточно баллов.');return}
  if(state.quota&&state.quota[r.id]!==undefined&&state.quota[r.id]<=0){toast('Лимит заявок на этот период исчерпан.');$('#purchase-dialog').close();return}
  if((r.id==='frame'&&state.frame)||state.orders.some(o=>o.reward===r.id&&['pending','approved'].includes(o.status))){$('#purchase-dialog').close();return}
  state.points-=r.price;
  if(state.quota&&state.quota[r.id]!==undefined){state.quota[r.id]--}
  if(r.type==='instant'){
    state.frame=true;
    log(r.name,'Предмет добавлен в профиль',`−${r.price} баллов`);
    toast('Рамка добавлена в профиль. Опыт сохранён.');
  } else {
    state.reserved+=r.price;
    state.orders.push({id:state.nextOrder++,reward:r.id,status:'pending'});
    log(r.name,'Заявка создана · баллы в резерве',`Резерв ${r.price}`);
    toast('Заявка создана. Баллы зарезервированы.');
  }
  pendingReward=null;
  $('#purchase-dialog').close();
  render();
});
$('#purchase-cancel').addEventListener('click',()=>$('#purchase-dialog').close());

// Proposals modal
$('#proposal-confirm').addEventListener('click',()=>{
  const title=$('#prop-title').value.trim();
  const desc=$('#prop-desc').value.trim();
  const type=$('#prop-type').value;
  if(title.length<5){$('#prop-error').textContent='Укажите название — не менее 5 символов.';return}
  if(desc.length<10){$('#prop-error').textContent='Опишите ценность — не менее 10 символов.';return}
  const id=state.nextProposalId++;
  state.proposals.push({id,title,type,desc,status:'pending',author:'А. Лазарев'});
  log('Инициатива: '+title,'Отправлена на рассмотрение командиру','Без начисления');
  toast('Инициатива отправлена на рассмотрение командиру.');
  $('#prop-title').value='';$('#prop-desc').value='';$('#prop-error').textContent='';
  $('#proposal-dialog').close();
  render();
});
$('#proposal-cancel').addEventListener('click',()=>{
  $('#prop-error').textContent='';
  $('#proposal-dialog').close();
});

// Kudos modal
$('#kudos-confirm').addEventListener('click',()=>{
  const target=$('#kudos-target').value;
  const text=$('#kudos-text').value.trim();
  if(text.length<5){$('#kudos-error').textContent='Добавьте пояснение — не менее 5 символов.';return}
  state.kudosSent++;
  state.kudosReceived++;
  log('Благодарность сослуживцу',target+': '+text,'Признание');
  toast('Благодарность отправлена! Достижение «Наставник» обновлено.');
  $('#kudos-text').value='';$('#kudos-error').textContent='';
  $('#kudos-dialog').close();
  render();
});
$('#kudos-cancel').addEventListener('click',()=>{
  $('#kudos-error').textContent='';
  $('#kudos-dialog').close();
});

function updateMilestoneSync(){
  const syncEl=$('#task-milestones-sync');
  if(!syncEl)return;
  const rows=document.querySelectorAll('#task-milestones-container .milestone-form-row');
  const taskXp=Math.max(10,Number($('#task-create-xp').value)||0);
  const taskCoins=Math.max(5,Number($('#task-create-coins').value)||0);

  if(rows.length===0){
    syncEl.innerHTML=`<span style="color:var(--muted)">Вехи не заданы — весь фонд ${taskXp} XP / ${taskCoins} баллов будет выплачен при сдаче всей задачи.</span>`;
    return;
  }

  let sumXp=0,sumCoins=0;
  rows.forEach(r=>{
    sumXp+=Math.max(0,Number(r.querySelector('.m-xp').value)||0);
    sumCoins+=Math.max(0,Number(r.querySelector('.m-coins').value)||0);
  });

  const ok=(sumXp===taskXp && sumCoins===taskCoins);
  if(ok){
    syncEl.innerHTML=`<span style="color:var(--mint);display:flex;align-items:center;gap:4px">✓ Сумма вех (${sumXp} XP / ${sumCoins} б.) полностью синхронизирована с фондом задачи</span>`;
  } else {
    syncEl.innerHTML=`<div style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap">
      <span style="color:var(--gold)">⚠ Сумма вех: <strong>${sumXp}</strong>/${taskXp} XP · <strong>${sumCoins}</strong>/${taskCoins} б.</span>
      <button type="button" class="btn quiet small" id="task-sync-fund-btn" style="padding:2px 7px;font-size:10px;min-height:22px;color:var(--mint);border-color:var(--mint)">Приравнять фонд к вехам</button>
    </div>`;
    const btn=$('#task-sync-fund-btn');
    if(btn){
      btn.addEventListener('click',()=>{
        $('#task-create-xp').value=sumXp;
        $('#task-create-coins').value=sumCoins;
        updateMilestoneSync();
      });
    }
  }
}

// Add milestone in create task dialog
$('#task-add-milestone').addEventListener('click',()=>{
  const c=$('#task-milestones-container');
  const count=c.children.length+1;
  const taskXp=Math.max(10,Number($('#task-create-xp').value)||100);
  const taskCoins=Math.max(5,Number($('#task-create-coins').value)||30);

  let curSumXp=0,curSumCoins=0;
  c.querySelectorAll('.milestone-form-row').forEach(r=>{
    curSumXp+=Math.max(0,Number(r.querySelector('.m-xp').value)||0);
    curSumCoins+=Math.max(0,Number(r.querySelector('.m-coins').value)||0);
  });

  let defXp=taskXp-curSumXp;
  let defCoins=taskCoins-curSumCoins;
  if(defXp<10 || defCoins<5){
    defXp=Math.max(20, Math.round(taskXp / (count || 1)));
    defCoins=Math.max(10, Math.round(taskCoins / (count || 1)));
    $('#task-create-xp').value=curSumXp+defXp;
    $('#task-create-coins').value=curSumCoins+defCoins;
  }

  const div=document.createElement('div');
  div.className='milestone-form-row';
  div.innerHTML=`<label class="field">Название этапа<input type="text" class="m-title" maxlength="80" placeholder="Веха ${count}" required></label><label class="field">Критерий приёмки<input type="text" class="m-criteria" maxlength="200" placeholder="Как проверить готовность этапа" required></label><div class="milestone-budget"><label class="field">XP<input type="number" class="m-xp" value="${defXp}" min="10" max="500" step="1"></label><label class="field">Баллы<input type="number" class="m-coins" value="${defCoins}" min="5" max="200" step="1"></label><button type="button" class="btn quiet small m-remove" aria-label="Удалить веху ${count}">Удалить</button></div>`;
  div.querySelector('.m-remove').addEventListener('click',()=>{
    div.remove();
    updateMilestoneSync();
  });
  div.querySelectorAll('input').forEach(inp=>{
    inp.addEventListener('input',updateMilestoneSync);
  });
  c.appendChild(div);
  updateMilestoneSync();
  div.querySelector('.m-title').focus();
});

// Distribute milestones evenly
$('#task-distribute-milestones').addEventListener('click',()=>{
  const c=$('#task-milestones-container');
  const rows=c.querySelectorAll('.milestone-form-row');
  if(rows.length===0){
    toast('Сначала добавьте вехи кнопкой «+ Добавить веху»');
    return;
  }
  const taskXp=Math.max(10,Number($('#task-create-xp').value)||100);
  const taskCoins=Math.max(5,Number($('#task-create-coins').value)||30);
  const n=rows.length;

  const baseEachXp=Math.floor(taskXp/n);
  const remXp=taskXp-baseEachXp*n;
  const baseEachCoins=Math.floor(taskCoins/n);
  const remCoins=taskCoins-baseEachCoins*n;

  rows.forEach((r,idx)=>{
    r.querySelector('.m-xp').value=baseEachXp+(idx===0?remXp:0);
    r.querySelector('.m-coins').value=baseEachCoins+(idx===0?remCoins:0);
  });
  updateMilestoneSync();
  toast('Фонд ' + taskXp + ' XP и ' + taskCoins + ' баллов поровну распределён по вехам.');
});

$('#task-create-xp').addEventListener('input',updateMilestoneSync);
$('#task-create-coins').addEventListener('input',updateMilestoneSync);

// Create task modal
$('#task-create-confirm').addEventListener('click',()=>{
  const title=$('#task-create-title').value.trim();
  const type=$('#task-create-type').value;
  const prio=$('#task-create-prio').value;
   let xp=Number($('#task-create-xp').value);
   let coins=Number($('#task-create-coins').value);
  const due=$('#task-create-due').value.trim()||'30 сентября';
  const criteria=$('#task-create-criteria').value.trim();
   if(title.length<5){$('#task-create-error').textContent='Укажите название — не менее 5 символов.';return}
   if(!Number.isInteger(xp)||xp<10||xp>1000||!Number.isInteger(coins)||coins<5||coins>500){$('#task-create-error').textContent='Укажите целые значения фонда в допустимых пределах.';return}
   if(criteria.length<10){$('#task-create-error').textContent='Добавьте проверяемые критерии — не менее 10 символов.';return}
  const cat=type==='Разработка'?'dev':type==='НИР'?'science':'duty';
  
  const mRows=document.querySelectorAll('#task-milestones-container .milestone-form-row');
  let taskMilestones=undefined;
  if(mRows.length>0){
    taskMilestones=[];
    let sumXp=0,sumCoins=0;
     for(const [idx,r] of [...mRows].entries()){
       const mTitle=r.querySelector('.m-title').value.trim();
       const mCriteria=r.querySelector('.m-criteria').value.trim();
       const mXp=Number(r.querySelector('.m-xp').value);
       const mCoins=Number(r.querySelector('.m-coins').value);
       if(mTitle.length<3||mCriteria.length<10||!Number.isInteger(mXp)||mXp<10||mXp>500||!Number.isInteger(mCoins)||mCoins<5||mCoins>200){$('#task-create-error').textContent=`Проверьте название, критерий и целые суммы вехи ${idx+1}.`;return}
       sumXp+=mXp;
       sumCoins+=mCoins;
       taskMilestones.push({
         id:idx+1,
         title:mTitle,
         criteria:mCriteria,
         status:idx===0?'doing':'pending',
         reward:`${mXp} XP / ${mCoins} баллов`,
         xp:mXp,
         coins:mCoins,
         report:''
       });
     }
    // Strict mathematical synchronization:
    xp=sumXp;
    coins=sumCoins;
  }

   if(xp>1000||coins>500){$('#task-create-error').textContent='Сумма вех превышает предел фонда задачи.';return}
   const nextId=state.nextTaskId++;
  state.tasks.push({
    id:nextId,
    title,
    type,
    priority:prio,
    sla:'До '+due,
     status:$('#task-create-assignment').value,
    xp,
    coins,
    due,
    report:'',
    reason:'',
    category:cat,
     criteriaText:criteria,
    milestones:taskMilestones
  });
  log('Назначена задача: '+title,`${state.role==='admin'?'Администратор':'Командир'} установил ${xp} XP / ${coins} баллов`+(taskMilestones?` (${taskMilestones.length} вех)`:''),'Новая задача');
  toast('Задача назначена с фондом '+xp+' XP и '+coins+' баллов!');
  $('#task-create-title').value='';$('#task-create-criteria').value='';$('#task-create-error').textContent='';
  $('#task-milestones-container').innerHTML='';
  $('#create-task-dialog').close();
  render();
});
$('#task-create-cancel').addEventListener('click',()=>{
  $('#task-create-error').textContent='';
  $('#task-milestones-container').innerHTML='';
  $('#create-task-dialog').close();
});

document.addEventListener('click',e=>{
  const b=e.target.closest('[data-action]');
  if(!b||b.disabled)return;
  const a=b.dataset.action,t=state.tasks.find(t=>t.id===activeTask);

  if(a==='task'){activeTask=Number(b.dataset.id);go('task')}
  else if(a==='filter'){state.filter=b.dataset.value;render()}
  else if(a==='set-season'){state.seasonView=b.dataset.value;render()}
  else if(a==='back-tasks'){go(state.role==='commander'?'reviews':state.role==='admin'?'admin':'tasks')}
  else if(a==='open-proposal'){$('#prop-error').textContent='';$('#proposal-dialog').showModal()}
  else if(a==='open-kudos'){$('#kudos-error').textContent='';$('#kudos-dialog').showModal()}
   else if(a==='open-create-task'&&state.role==='commander'){$('#task-create-error').textContent='';updateMilestoneSync();$('#create-task-dialog').showModal()}
  else if(a==='take-task'&&state.role==='soldier'&&t&&t.status==='available'){
    t.status='doing';
    log(t.title,'Задача взята из открытого пула роты','В работе');
    toast('Вы взяли задачу в работу!');
    render();
  }
  else if(a==='start-task'&&state.role==='soldier'&&t.status==='assigned'){t.status='doing';render();toast('Задача взята в работу.')}
   else if(a==='submit-milestone'&&state.role==='soldier'){
     const mid=Number(b.dataset.mid);
     const m=t.milestones&&t.milestones.find(x=>x.id===mid);
     if(m&&m.status==='doing'&&t.status==='doing'){
       const report=$(`#milestone-report-${mid}`).value.trim();
       if(report.length<10){$(`#milestone-error-${mid}`).textContent='Опишите результат этапа — не менее 10 символов.';return}
       m.report=report;
       m.status='submitted';
      log(t.title,'Этап отправлен на проверку: '+m.title,'Веха');
      toast('Этап «'+m.title+'» отправлен командиру на проверку.');
      render();
    }
  }
   else if(a==='accept-milestone'&&state.role==='commander'){
    const mid=Number(b.dataset.mid);
    const m=t.milestones&&t.milestones.find(x=>x.id===mid);
     if(m&&m.status==='submitted'&&m.report&&m.report.length>=10){
      m.status='accepted';
      const old=level();
      state.xp+=m.xp;
      state.season+=m.xp;
      state.points+=m.coins;
      if(t.category&&state.labModules[t.category]){
        state.labModules[t.category].count=Math.min(state.labModules[t.category].total,state.labModules[t.category].count+1);
      }
      if(t.category==='dev') state.skills.web=Math.min(100,state.skills.web+5);
      else if(t.category==='science') state.skills.science=Math.min(100,state.skills.science+5);
      else if(t.category==='duty') state.skills.duty=Math.min(100,state.skills.duty+5);
      const nextPending=t.milestones.find(x=>x.status==='pending');
      if(nextPending)nextPending.status='doing';
      if(t.milestones.every(x=>x.status==='accepted')){
        t.status='accepted';
        state.goal++;
      }
      log(t.title,'Этап принят: '+m.title,`+${m.xp} XP / +${m.coins}`);
      toast('Этап принят! Начислено +'+m.xp+' XP и +'+m.coins+' баллов.');
      celebrate(m.xp,m.coins,old);
      render();
    }
  }
  else if(a==='approve-proposal'&&state.role==='commander'){
    const pid=Number(b.dataset.id);
    const p=state.proposals.find(x=>x.id===pid);
    if(p){
      p.status='approved';
      const cat=p.type==='Разработка'?'dev':p.type==='НИР'?'science':'duty';
       state.tasks.push({
         id:state.nextTaskId++,
        title:p.title,
        type:p.type,
        priority:'normal',
        sla:'Новая',
        status:'assigned',
        xp:120,
        coins:40,
        due:'30 сентября',
        report:'',
        reason:'',
         category:cat,
         criteriaText:p.desc
      });
      log('Инициатива утверждена: '+p.title,'Создана новая задача роты','+1 задача');
      toast('Инициатива утверждена и добавлена в задачи!');
      render();
    }
  }
  else if(a==='reject-proposal'&&state.role==='commander'){
    const pid=Number(b.dataset.id);
    const p=state.proposals.find(x=>x.id===pid);
    if(p){
      p.status='rejected';
      log('Инициатива отклонена: '+p.title,'Решение командира','Без начисления');
      toast('Инициатива отклонена.');
      render();
    }
  }
  else if(a==='submit-task'&&state.role==='soldier'&&['doing','rework'].includes(t.status)){
    const report=$('#report').value.trim();
    if(report.length<10){$('#form-error').textContent='Добавьте описание результата — не менее 10 символов.';return}
    t.report=report;
    t.status='submitted';
    log(t.title,'Результат отправлен на проверку','Без начисления');
    go('tasks');
    toast('Результат отправлен. Переключитесь на командира.');
  }
   else if((a==='accept-task'||a==='return-task')&&state.role==='commander'&&t.status==='submitted'){
    const comment=$('#review-comment').value.trim();
    if(comment.length<5){$('#form-error').textContent='Укажите причину решения — не менее 5 символов.';return}
    if(a==='return-task'){
      t.status='rework';
      t.reason=comment;
      log(t.title,'На доработке: '+comment,'Без начисления');
      go(state.role==='admin'?'admin':'reviews');
      toast('Задача возвращена с комментарием.');
    } else {
      const rxp=$('#review-xp'),rcoins=$('#review-coins');
      const mEarnedXp=t.milestones?t.milestones.filter(m=>m.status==='accepted').reduce((s,m)=>s+m.xp,0):0;
      const mEarnedCoins=t.milestones?t.milestones.filter(m=>m.status==='accepted').reduce((s,m)=>s+m.coins,0):0;
      const remXp=Math.max(0, t.xp - mEarnedXp);
      const remCoins=Math.max(0, t.coins - mEarnedCoins);

       const customXp=rxp?Number(rxp.value):remXp;
       const customCoins=rcoins?Number(rcoins.value):remCoins;
       if(!Number.isInteger(customXp)||customXp<0||customXp>1000||!Number.isInteger(customCoins)||customCoins<0||customCoins>500){$('#form-error').textContent='Укажите целые суммы в допустимых пределах.';return}
      const bonus=bonuses[$('#bonus').value],old=level(),xp=customXp+bonus.xp,coins=customCoins+bonus.coins;
      t.status='accepted';
      if(t.milestones){t.milestones.forEach(m=>m.status='accepted')};
      if(t.category&&state.labModules[t.category]){
        state.labModules[t.category].count=Math.min(state.labModules[t.category].total,state.labModules[t.category].count+1);
      }
      if(t.category==='dev') state.skills.web=Math.min(100,state.skills.web+5);
      else if(t.category==='science') state.skills.science=Math.min(100,state.skills.science+5);
      else if(t.category==='duty') state.skills.duty=Math.min(100,state.skills.duty+5);
      state.xp+=xp;
      state.season+=xp;
      state.points+=coins;
      state.goal++;
      log(t.title,bonus.name+' · '+comment,`+${xp} XP / +${coins}`);
      go(state.role==='admin'?'admin':'reviews');
      celebrate(xp,coins,old);
    }
  }
   else if(a==='admin-quota'&&state.role==='admin'){
    const item=b.dataset.item,delta=Number(b.dataset.delta);
    if(state.quota[item]!==undefined){
      state.quota[item]=Math.max(0,Math.min(state.maxQuota[item],state.quota[item]+delta));
      log(`Квота изменена: ${item==='leave'?'Увольнения':'Наряды'}`, `Новое значение: ${state.quota[item]} из ${state.maxQuota[item]}`, 'Админ');
      toast(`Квота обновлена: ${state.quota[item]} мест`);
      render();
    }
  }
   else if(a==='admin-archive-season'&&state.role==='admin'&&!state.archivedSeason){
     const closedName=state.seasonName;
     state.archivedSeason={name:closedName,rows:ranking()};
     state.seasonName='Октябрь 2026';
     state.season=0;
     state.teamAchievement=state.teamAchievement||state.goal>=23;
     state.goal=0;
     Object.values(state.labModules).forEach(module=>module.count=0);
     state.otherSeasonScores=surnames.map(()=>0);
     state.seasonView='archive';
     log('Сезон завершён администратором',`${closedName} архивирован; открыт ${state.seasonName}`,'Архив');
     toast('Снимок сезона сохранён в демо. Открыт новый сезон.');
     go('leaderboard');
  }
  else if(a==='admin-reset-data'){
    $('#reset-demo').click();
  }
  else if(a==='close-celebration'){closeCelebration()}
  else if(a==='rank-toggle'){state.rankAll=!state.rankAll;render()}
  else if(a==='buy'){openPurchase(b.dataset.id)}
  else if(['approve-order','reject-order','fulfill-order','cancel-order'].includes(a)){
    const o=state.orders.find(o=>o.id===Number(b.dataset.id));
    if(!o)return;
    const r=rewards.find(r=>r.id===o.reward);
    if(a==='cancel-order'&&state.role==='soldier'&&o.status==='pending'){
      state.reserved-=r.price;
      state.points+=r.price;
      if(state.quota&&state.quota[r.id]!==undefined){state.quota[r.id]=Math.min(state.maxQuota[r.id],state.quota[r.id]+1)}
      o.status='cancelled';
      log(r.name,'Заявка отменена, резерв возвращён',`+${r.price} доступно`);
      toast('Заявка отменена. Баллы возвращены.');
    } else if(state.role==='commander'){
      if(a==='approve-order'&&o.status==='pending'){
        state.reserved-=r.price;
        o.status='approved';
        log(r.name,'Согласована · резерв списан',`−${r.price} из резерва`);
        toast('Заявка согласована в демо.');
      } else if(a==='reject-order'&&o.status==='pending'){
        state.reserved-=r.price;
        state.points+=r.price;
        if(state.quota&&state.quota[r.id]!==undefined){state.quota[r.id]=Math.min(state.maxQuota[r.id],state.quota[r.id]+1)}
        o.status='rejected';
        log(r.name,'Отказ: нет доступной возможности',`+${r.price} доступно`);
        toast('Заявка отклонена. Баллы возвращены.');
      } else if(a==='fulfill-order'&&o.status==='approved'){
        o.status='fulfilled';
        log(r.name,'Предоставление отмечено командиром','Без списания');
        toast('Предоставление отмечено в истории.');
      }
    }
    render();
  }
});

$('#bottomnav').addEventListener('click',e=>{const b=e.target.closest('[data-page]');if(b)go(b.dataset.page)});
document.querySelectorAll('[data-role]').forEach(b=>b.addEventListener('click',()=>{
  closeCelebration();
  state.role=b.dataset.role;
  go(state.role==='commander'?'reviews':state.role==='admin'?'admin':'home');
}));
$('#reset-demo').addEventListener('click',()=>{
  closeCelebration();
  if($('#purchase-dialog').open)$('#purchase-dialog').close();
  if($('#proposal-dialog').open)$('#proposal-dialog').close();
  if($('#kudos-dialog').open)$('#kudos-dialog').close();
  if($('#create-task-dialog').open)$('#create-task-dialog').close();
  const mc=$('#task-milestones-container');
  if(mc)mc.innerHTML='';
  state=initial();
  activeTask=1;
  pendingReward=null;
  render();
  toast('Демонстрационные данные восстановлены.');
});

// Search and category filter input
document.addEventListener('input', e => {
  if (e.target && e.target.id === 'task-search-input') {
    const start=e.target.selectionStart,end=e.target.selectionEnd;
    state.taskSearch = e.target.value;
    const scr = $('#screen').scrollTop;
    render();
    $('#screen').scrollTop = scr;
    const inp = $('#task-search-input');
    if (inp) { inp.focus(); inp.setSelectionRange(start,end); }
  }
});
document.addEventListener('change', e => {
  if (e.target && e.target.id === 'task-cat-select') {
    state.catFilter = e.target.value;
    render();
  }
});

// Telegram Frame interactive controls
$('#tg-back').addEventListener('click',()=>{
  if($('#purchase-dialog').open){$('#purchase-dialog').close();return}
  if($('#proposal-dialog').open){$('#proposal-dialog').close();return}
  if($('#kudos-dialog').open){$('#kudos-dialog').close();return}
  if($('#create-task-dialog').open){$('#create-task-dialog').close();return}
  if($('#celebration-host').innerHTML){closeCelebration();return}
  if(state.page==='task'){go(state.role==='commander'?'reviews':state.role==='admin'?'admin':'tasks');return}
  toast('Вы находитесь в основном разделе Mini App');
});

$('#tg-dots').addEventListener('click',e=>{
  e.stopPropagation();
  const m=$('#tg-menu-dropdown');
  if(m)m.hidden=!m.hidden;
});

document.addEventListener('click',e=>{
  const item=e.target.closest('[data-tg-action]');
  if(item){
    const act=item.dataset.tgAction;
    if($('#tg-menu-dropdown')) $('#tg-menu-dropdown').hidden=true;
    if(act==='info') toast('ИМПУЛЬС — концепт мотивационной платформы научной роты');
    else if(act==='restart') $('#reset-demo').click();
    else if(act==='close') if($('#tg-menu-dropdown')) $('#tg-menu-dropdown').hidden=true;
    return;
  }
  if(!e.target.closest('#tg-dots')&&$('#tg-menu-dropdown')) $('#tg-menu-dropdown').hidden=true;
});
$('#guide-start').addEventListener('click',()=>{
  closeCelebration();
  state.role='soldier';
  activeTask=1;
  go('task');
  $('.democol').scrollIntoView({behavior:motionBehavior(),block:'center'});
  toast('Отправьте готовый отчёт на проверку.');
});
$('#motion').checked=!matchMedia('(prefers-reduced-motion: reduce)').matches;
const motionBehavior=()=>$('#motion').checked&&!matchMedia('(prefers-reduced-motion: reduce)').matches?'smooth':'auto';
document.body.classList.toggle('no-motion',!$('#motion').checked);
$('#motion').addEventListener('change',()=>document.body.classList.toggle('no-motion',!$('#motion').checked));
$('#present-toggle').addEventListener('click',e=>{
  e.preventDefault();
  const on=document.body.classList.toggle('presentation');
  e.currentTarget.textContent=on?'Вернуться к проекту':'Режим показа';
  window.scrollTo({top:0,behavior:motionBehavior()});
});
document.querySelectorAll('a[href="#specification"]').forEach(a=>a.addEventListener('click',()=>{document.body.classList.remove('presentation');$('#present-toggle').textContent='Режим показа'}));
const docDetails=[...document.querySelectorAll('.doc details')];
$('#expand-doc').addEventListener('click',()=>{const all=docDetails.every(d=>d.open);docDetails.forEach(d=>d.open=!all);$('#expand-doc').textContent=all?'Раскрыть всё':'Свернуть всё'});
function openChapter(id){const d=document.getElementById(id);if(!d)return;d.open=true;d.scrollIntoView({behavior:motionBehavior(),block:'start'});document.querySelectorAll('.toc a').forEach(a=>a.classList.toggle('current',a.hash==='#'+id))}
document.querySelectorAll('.toc a').forEach(a=>a.addEventListener('click',e=>{e.preventDefault();openChapter(a.hash.slice(1))}));
$('#mobile-toc').addEventListener('change',e=>openChapter(e.target.value));
let printState=null;
function preparePrint(){if(printState)return;printState=docDetails.map(d=>d.open);docDetails.forEach(d=>d.open=true)}
window.addEventListener('beforeprint',preparePrint);
window.addEventListener('afterprint',()=>{if(printState){docDetails.forEach((d,i)=>d.open=printState[i]);printState=null}});
$('#print-doc').addEventListener('click',()=>{preparePrint();window.print()});
document.addEventListener('keydown',e=>{
  if($('#celebration-host').innerHTML){
    if(e.key==='Tab'){e.preventDefault();$('#celebration-host button').focus()}
    if(e.key==='Escape')closeCelebration();
  }
});
window.demoSnapshot=()=>JSON.parse(JSON.stringify(state));
render();
