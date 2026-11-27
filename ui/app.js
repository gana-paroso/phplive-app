// PHP Live 화면: 해시 라우팅 + main 프로세스(window.api)가 준 상태를 그린다.
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ico = n => `<svg class="i" aria-hidden="true"><use href="#i-${n}"/></svg>`;
const PAGE_SIZE = 10; // 한 페이지에 보여줄 프로젝트 수
const ui = { tab: 'all', q: '', page: 1 };
let DB = null;        // main 이 준 전체 상태(스냅샷)
let gitSt = {};       // 프로젝트 id -> Git 상태(또는 'loading'). Git 배포 관리 화면에 들어갈 때만 채운다.
let gitOp = null;     // 진행 중이거나 방금 끝난 pull/push 표시: { id, kind, busy, ok, text, at, msg }
let logTimer = null;  // 상세 화면의 접속 로그 갱신 타이머

/* ---------- 계산 ---------- */
const running = () => DB.projects.filter(p => p.port);
const usedBy = v => DB.projects.filter(p => p.php === v);
const phpOk = v => DB.php.find(x => x.version === v)?.ok;
// 토큰 잔여일: 만료일이 없는 토큰이면 null
const daysLeft = () => DB.github.expires ? Math.round((new Date(DB.github.expires) - new Date(DB.today)) / 864e5) : null;

function toast(msg, isError) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), isError ? 7000 : 3200);
}

/** 작업을 실행하고, 성공하면 최신 상태를 반영한다. 실패하면 오류 문구를 토스트로 보여준다. */
async function run(fn, okMsg) {
  try {
    const r = await fn();
    if (r?.projects) DB = r;
    if (okMsg) toast(typeof okMsg === 'function' ? okMsg(r) : okMsg);
    return true;
  } catch (e) {
    toast(e.message, true);
    return false;
  } finally { render(); }
}

/* ---------- 공통 조각 ---------- */
const serverCell = p => p.port
  ? `<a class="url" href="#" data-act="browser" data-id="${p.id}"><span class="dot run"></span>localhost:${p.port}${ico('ext')}</a>`
  : '<span class="state muted"><span class="dot"></span>중지됨</span>';
// 사람마다 고정된 옅은 색 (이름으로 색상 계산)
const avatar = a => { const h = [...a].reduce((s, c) => s + c.charCodeAt(0), 0) * 37 % 360; return `<span class="av" style="background:hsl(${h} 55% 90%);color:hsl(${h} 55% 22%)">${esc(a[0])}</span>`; };
const two = n => String(n).padStart(2, '0');
function fmtWhen(iso) {
  const d = new Date(iso), ymd = x => `${x.getFullYear()}-${two(x.getMonth() + 1)}-${two(x.getDate())}`;
  const y = new Date(DB.today); y.setDate(y.getDate() - 1);
  const hm = `${two(d.getHours())}:${two(d.getMinutes())}`;
  return ymd(d) === DB.today ? `오늘 ${hm}` : ymd(d) === ymd(y) ? `어제 ${hm}` : `${d.getMonth() + 1}월 ${d.getDate()}일`;
}

/** GitHub 연결 상태(none/checking/ok/fail)를 점 색과 문구로 정리한다. 연결됨은 초록, 연결 실패는 빨강. */
function ghView() {
  const g = DB.github, s = g.status ?? { state: 'none' }, d = daysLeft();
  if (s.state === 'fail') return { dot: 'bad', fail: true, chip: 'GitHub 연결 실패', summary: '연결 실패' };
  if (s.state === 'checking') return { dot: '', chip: 'GitHub 연결 확인 중…', summary: '연결 확인 중…' };
  if (s.state === 'ok') return { dot: 'ok', chip: `GitHub @${esc(g.user)}${d === null ? '' : ` · <span class="${d <= 30 ? 'warn-text' : ''}">토큰 ${d}일 남음</span>`}`, summary: `연결됨 · @${esc(g.user)}` };
  return { dot: '', chip: 'GitHub 연결 안 됨', summary: '연결 안 됨' };
}
const ghSummaryHtml = () => { const v = ghView(); return `<span class="state"><span class="dot ${v.dot}"></span>${v.summary}</span>`; };
/** 전역 설정의 GitHub 연결 영역 맨 위에 보여줄 실패 사유 */
function ghReasonHtml() {
  const s = DB.github.status;
  if (s?.state !== 'fail') return '';
  return `<div class="result err" role="alert" style="margin:0 0 16px;align-items:flex-start"><div><b style="font-weight:600">연결 실패 사유</b><div>${esc(s.reason)}</div><div style="margin-top:4px;opacity:.85">문제를 해결한 뒤 아래 “만료일 다시 확인”을 눌러 주세요.</div></div><span class="stamp">${esc(s.at ?? '')}</span></div>`;
}
/** 상단 연결 표시와(열려 있다면) 전역 설정의 연결 상태·실패 사유를 갱신한다. */
function renderGh() {
  const v = ghView(), chip = $('#gh-chip');
  chip.className = 'gh-chip' + (v.fail ? ' fail' : '');
  chip.innerHTML = `<span class="dot ${v.dot}"></span><span>${v.chip}</span>`;
  if ($('#gh-summary')) $('#gh-summary').innerHTML = ghSummaryHtml();
  if ($('#gh-reason')) $('#gh-reason').innerHTML = ghReasonHtml();
}

/** 사이드바 아래의 업데이트 알림(받는 중 / 재시작 대기)과 앱 버전을 그린다. */
function renderUpdate() {
  const u = DB.update, el = $('#upd');
  $('#ver').textContent = `v${DB.version}`;
  el.hidden = !u || u.state === 'idle';
  if (el.hidden) return;
  el.innerHTML = u.state === 'ready'
    ? `<b>새 버전 ${esc(u.version)} 준비 완료</b><div class="muted">재시작하면 바로 업데이트됩니다.</div><button class="btn btn-primary btn-sm" data-act="update-install">재시작하여 업데이트</button>`
    : `<b>새 버전 ${esc(u.version)} 받는 중…</b><div class="bar" role="progressbar" aria-valuenow="${u.percent}" aria-valuemin="0" aria-valuemax="100"><i style="width:${u.percent}%"></i></div><div class="muted" style="margin-top:4px">${u.percent}%</div>`;
}

function render() {
  clearInterval(logTimer);
  const view = $('#view');
  if (!DB) { view.innerHTML = '<div class="empty">불러오는 중…</div>'; return; }
  const [, route = 'projects', arg, sub] = location.hash.slice(1).split('/');
  const views = { projects: arg ? detailView(arg, sub) : projectsView, php: phpView, settings: settingsView };
  const v = views[route] ?? projectsView;
  view.innerHTML = v.html;
  $('#crumb').innerHTML = v.crumb;
  document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('on', a.dataset.nav === route));
  renderGh();
  $('#side-count').textContent = `${DB.projects.length}개`;
  renderUpdate();
  if (v.after) v.after();
}

/* ---------- 프로젝트 목록 ---------- */
function filtered() {
  const q = ui.q.trim().toLowerCase();
  return DB.projects.filter(p =>
    (ui.tab === 'all' || (ui.tab === 'run' && p.port)) &&
    (!q || (p.name + p.path + p.memo).toLowerCase().includes(q)));
}

function rowHtml(p) {
  return `<tr>
    <td class="c-name"><a class="name-link" href="#/projects/${p.id}">${esc(p.name)}</a><div class="l2 mono">${esc(p.path)}</div></td>
    <td class="c-memo"><div class="ell muted" title="${esc(p.memo)}">${p.memo ? esc(p.memo) : '<span>—</span>'}</div></td>
    <td class="c-php mono">${esc(p.php)}</td>
    <td class="c-srv">${serverCell(p)}</td>
    <td class="act">
      <button class="btn btn-sm" data-act="src" data-id="${p.id}">${ico('code')}소스 열기</button>
      <button class="btn btn-sm" data-act="${p.port ? 'stop' : 'start'}" data-id="${p.id}">${ico(p.port ? 'stop' : 'play')}${p.port ? '서버 중지' : '서버 시작'}</button>
      <a class="btn btn-sm" href="#/projects/${p.id}/git">${ico('git')}Git 배포 관리</a>
      <button class="btn btn-sm btn-icon btn-ghost" data-act="menu" data-id="${p.id}" aria-label="${esc(p.name)} 더 보기">${ico('kebab')}</button>
    </td></tr>`;
}

/** 목록 표와 페이지 이동 줄을 그린다. 검색어·탭·페이지는 ui 상태에서 읽는다. */
function tableHtml() {
  const all = filtered(), pages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
  ui.page = Math.min(ui.page, pages);
  const start = (ui.page - 1) * PAGE_SIZE, rows = all.slice(start, start + PAGE_SIZE);
  $('#count').textContent = ui.q.trim() ? `검색 결과 ${all.length}개` : `${all.length}개 프로젝트`;
  $('#tbody').innerHTML = rows.length ? rows.map(rowHtml).join('')
    : `<tr><td colspan="5"><div class="empty">${DB.projects.length ? '조건에 맞는 프로젝트가 없습니다.' : (DB.php.length ? '등록된 프로젝트가 없습니다. “프로젝트 추가”로 로컬 폴더를 등록해 보세요.' : '먼저 “PHP 버전” 메뉴에서 PHP를 등록한 뒤 프로젝트를 추가해 주세요.')}</div></td></tr>`;
  const pg = (p, label, cur) => `<button class="btn btn-sm btn-icon ${cur ? 'btn-primary' : ''}" data-act="page" data-p="${p}" ${cur ? 'aria-current="page"' : ''}>${label}</button>`;
  $('#pager').innerHTML = `<span class="muted">${all.length ? `${start + 1}–${start + rows.length} / ${all.length}` : '0 / 0'}</span>
    <span class="pager-btns"><button class="btn btn-sm btn-icon" data-act="page" data-p="${ui.page - 1}" aria-label="이전 페이지" ${ui.page <= 1 ? 'disabled' : ''}><svg class="i flip"><use href="#i-chev"/></svg></button>
    ${Array.from({ length: pages }, (_, i) => pg(i + 1, i + 1, i + 1 === ui.page)).join('')}
    <button class="btn btn-sm btn-icon" data-act="page" data-p="${ui.page + 1}" aria-label="다음 페이지" ${ui.page >= pages ? 'disabled' : ''}>${ico('chev')}</button></span>`;
  const n = { all: DB.projects.length, run: running().length };
  document.querySelectorAll('.tab').forEach(t => { t.querySelector('.n').textContent = n[t.dataset.tab]; t.classList.toggle('on', t.dataset.tab === ui.tab); });
}

const projectsView = {
  crumb: '<b>프로젝트</b>',
  get html() {
    const sub = `서버 ${running().length}개 실행 중 · 등록된 프로젝트 ${DB.projects.length}개`;
    return `<div class="title-row"><div><h1>프로젝트</h1><p class="sub">${sub}</p></div>
      <div class="actions"><button class="btn btn-primary btn-lg" data-act="add">${ico('plus')}프로젝트 추가</button></div></div>
      <div class="tabs" role="tablist">
        <button class="tab" role="tab" data-tab="all">전체<span class="n"></span></button>
        <button class="tab" role="tab" data-tab="run">서버 실행 중<span class="n"></span></button></div>
      <div class="toolbar"><form class="search" id="sf" role="search">${ico('search')}<input id="q" placeholder="이름, 경로, 메모 검색" aria-label="프로젝트 검색" value="${esc(ui.q)}"><button class="btn" type="submit">검색</button></form><span class="count" id="count"></span></div>
      <table><colgroup><col style="width:26%"><col style="width:20%"><col style="width:80px"><col style="width:180px"><col style="width:370px"></colgroup>
        <thead><tr><th>프로젝트</th><th>메모</th><th>PHP</th><th>서버</th><th></th></tr></thead><tbody id="tbody"></tbody></table><div class="pager" id="pager"></div>`;
  },
  after: tableHtml
};

/* ---------- 프로젝트 상세 / Git 배포 관리 ---------- */
const logHtml = rows => rows.length
  ? rows.map(l => `<div><span class="t">${l.time}</span><span>${esc(l.method)}</span><span class="ell">${esc(l.path)}</span><span class="${l.status >= 400 ? 'bad' : ''}">${l.status}</span></div>`).join('')
  : '<div class="t">아직 들어온 요청이 없습니다.</div>';

/** 올리기/내려받기 진행 중에는 진행 막대를, 끝나면 결과(성공/실패)를 카드 위에 보여준다. */
function opBanner(p) {
  if (gitOp?.id !== p.id) return '';
  if (gitOp.busy) return `<div class="progress" role="status" aria-live="polite"><div>${gitOp.kind === 'push' ? 'GitHub에 올리는 중입니다…' : 'GitHub에서 내려받는 중입니다…'}</div><div class="bar-ind"><i></i></div></div>`;
  return `<div class="result ${gitOp.ok ? 'ok' : 'err'}" role="status">${gitOp.ok ? ico('check') : ''}<span>${esc(gitOp.text)}</span><span class="stamp">${gitOp.at}</span></div>`;
}

/** pull/push 를 실행한다. 진행 막대를 최소 0.8초 보여주고, 끝나면 완료/실패 결과를 남긴다. */
async function gitAction(id, kind, fn, msg = '') {
  const label = kind === 'push' ? '올리기' : '내려받기';
  gitOp = { id, kind, busy: true }; render();
  try {
    await Promise.all([fn(), new Promise(r => setTimeout(r, 800))]);
    gitOp = { id, kind, ok: true, text: kind === 'push' ? `${label} 완료 · 변경 내용이 GitHub main에 반영되었습니다.` : `${label} 완료 · GitHub main의 변경을 가져왔습니다.`, at: new Date().toTimeString().slice(0, 5) };
    delete gitSt[id]; // 완료 후 최신 상태를 다시 읽는다
  } catch (e) {
    gitOp = { id, kind, ok: false, text: `${label} 실패 · ${e.message}`, at: new Date().toTimeString().slice(0, 5), msg }; // 입력한 커밋 메시지는 유지
  }
  render();
}

/** Git 배포 관리 카드. st 는 undefined/'loading'(확인 중), { error }, { isRepo:false }, 또는 상태 객체. */
function gitPanel(p, st) {
  const head = body => `<div class="panel"><div class="panel-h"><h2>GitHub 동기화</h2>${body ?? ''}</div>`;
  if (!st || st === 'loading') return head() + opBanner(p) + '<div class="empty" style="margin-top:12px">GitHub 상태를 확인하는 중입니다…</div></div>';
  if (st.error) return head() + `<div class="notice">${esc(st.error)}</div><div style="margin-top:12px"><button class="btn" data-act="fetch">다시 시도</button></div></div>`;
  if (!st.isRepo) return head() + '<div class="empty">이 폴더는 아직 Git 저장소가 아닙니다. 개발 담당자에게 저장소 연결을 요청해 주세요.</div></div>';
  const b = st.incoming.length, c = st.changes.length, wrongBranch = st.branch !== 'main';
  const title = b ? `새 커밋 ${b}` : c || st.ahead ? `올릴 변경 ${c || st.ahead}` : '최신 상태';
  const note = b ? '다른 작업자가 GitHub main에 올린 변경입니다.' : c || st.ahead ? '내 컴퓨터에만 있는 변경입니다.' : 'GitHub main과 같습니다.';
  const stamp = `<span class="stamp">origin/main · ${st.checkedAt} 확인 <button class="btn btn-sm btn-icon btn-ghost" data-act="fetch" aria-label="GitHub 상태 새로고침">${ico('refresh')}</button></span>`;
  const busy = gitOp?.id === p.id && gitOp.busy; // 올리기/내려받기 진행 중에는 버튼을 잠근다
  return head(stamp) + opBanner(p) +
    (wrongBranch ? `<div class="notice" style="margin:12px 0 0">현재 브랜치가 ${esc(st.branch)}입니다. 이 프로그램은 main 브랜치만 다룹니다.</div>` : '') +
    (st.fetchError ? `<div class="notice" style="margin:12px 0 0">${esc(st.fetchError)} (아래 내용은 마지막으로 확인된 상태입니다)</div>` : '') +
    `<div class="sync"><div><div class="sync-fig">${title}</div><div class="sync-note">${note}</div></div>
      <button class="btn btn-lg" data-act="pull" data-id="${p.id}" ${b && !wrongBranch && !busy ? '' : 'disabled'}>${ico('down')}내려받기 (Pull)</button></div>
    <div class="sub-h"><span>GitHub에서 온 커밋</span><span class="muted">${b}</span></div>` +
    (b ? `<div class="rows">${st.incoming.map(m => `<div>${avatar(m.author)}<div><div class="ell">${esc(m.msg)}</div><div class="meta">${esc(m.author)} · ${fmtWhen(m.when)}</div></div><span class="hash">${esc(m.hash)}</span></div>`).join('')}</div>`
      : '<div class="empty">내려받을 커밋이 없습니다.</div>') +
    `<div class="sub-h" style="margin-top:24px"><span>내 변경</span><span class="muted">${c}개 파일</span></div>` +
    (c ? `<div class="files">${st.changes.map(f => `<div><span class="pill ${f.status === '추가' ? 'pos' : ''}">${f.status}</span><span class="mono ell">${esc(f.path)}</span></div>`).join('')}</div>`
      : `<div class="empty">${st.ahead ? `커밋은 했지만 아직 GitHub에 올리지 않은 변경이 ${st.ahead}개 있습니다.` : '올릴 변경이 없습니다.'}</div>`) +
    `<div class="commit"><input id="msg" placeholder="${c ? '변경 내용을 한 줄로 적어주세요' : '새로 커밋할 변경이 없습니다'}" aria-label="커밋 메시지" value="${esc(gitOp?.id === p.id ? gitOp.msg ?? '' : '')}" ${c && !busy ? '' : 'disabled'}>
      <button class="btn btn-lg" data-act="push" data-id="${p.id}" ${(c || st.ahead) && !wrongBranch && !busy ? '' : 'disabled'}>${ico('up')}올리기 (Push)</button></div></div>`;
}

function detailView(id, mode) {
  const p = DB.projects.find(x => x.id === id);
  if (!p) return { crumb: '<b>프로젝트</b>', html: '<div class="empty">프로젝트를 찾을 수 없습니다. 목록에서 제거되었을 수 있습니다.</div>' };
  const crumb = `<a href="#/projects">프로젝트</a>${ico('chev')}`;

  // Git 배포 관리 화면: GitHub 동기화 카드만 보여준다. 들어올 때 이 프로젝트의 상태만 읽는다.
  if (mode === 'git') return {
    crumb: `${crumb}<a href="#/projects/${p.id}">${esc(p.name)}</a>${ico('chev')}<b>Git 배포 관리</b>`,
    html: `<div class="title-row"><div><h1>Git 배포 관리</h1><p class="sub">${esc(p.name)} · <span class="mono">${esc(p.path)}</span></p></div>
      <div class="actions"><a class="btn btn-lg" href="#/projects/${p.id}">프로젝트 상세</a></div></div>${gitPanel(p, gitSt[id])}`,
    after: () => { if (!gitSt[id]) loadGit(id); }
  };

  // 일반 상세 화면: 서버, 메모 카드만 보여준다.
  const primary = p.port
    ? `<button class="btn btn-primary btn-lg" data-act="browser" data-id="${p.id}">${ico('ext')}브라우저에서 열기</button>`
    : `<button class="btn btn-primary btn-lg" data-act="start" data-id="${p.id}">${ico('play')}서버 시작</button>`;
  const phpWarn = phpOk(p.php) ? '' : `<div class="notice" style="margin-bottom:12px">PHP ${esc(p.php)} 경로를 찾을 수 없습니다. PHP 버전 메뉴에서 확인해 주세요.</div>`;
  const server = `<div class="panel"><div class="panel-h"><h2>서버</h2>${p.port ? '<span class="pill pos">실행 중</span>' : '<span class="pill">중지됨</span>'}</div>${phpWarn}
      <dl class="kv"><div><dt>주소</dt><dd>${p.port ? `<a class="url" href="#" data-act="browser" data-id="${p.id}">localhost:${p.port}${ico('ext')}</a>` : '<span class="muted">—</span>'}</dd></div>
        <div><dt>PHP</dt><dd class="mono">${esc(p.php)}</dd></div>
        <div><dt>포트</dt><dd>${p.port ? '자동 선택' : `${DB.server.portFrom}–${DB.server.portTo} 중 자동`}</dd></div>
        <div><dt>시작 시각</dt><dd>${p.port ? `오늘 ${p.since}` : '<span class="muted">—</span>'}</dd></div></dl>
      ${p.port ? `<div class="log" id="log" aria-label="최근 요청"></div><div style="margin-top:12px"><button class="btn" data-act="stop" data-id="${p.id}">${ico('stop')}서버 중지</button></div>`
        : '<div class="empty" style="margin-top:8px">서버를 시작하면 최근 요청이 여기에 표시됩니다.</div>'}</div>
    <div class="panel"><div class="panel-h"><h2>메모</h2><button class="btn btn-sm" data-act="edit" data-id="${p.id}">편집</button></div>
      <p>${p.memo ? esc(p.memo) : '<span class="muted">적어 둔 메모가 없습니다.</span>'}</p></div>`;
  return {
    crumb: `${crumb}<b>${esc(p.name)}</b>`,
    html: `<div class="title-row"><div><h1>${esc(p.name)}</h1><p class="sub mono">${esc(p.path)}</p></div>
      <div class="actions"><a class="btn btn-lg" href="#/projects/${p.id}/git">${ico('git')}Git 배포 관리</a><button class="btn btn-lg" data-act="src" data-id="${p.id}">${ico('code')}소스 열기</button>${primary}</div></div>
      <div class="detail">${server}</div>`,
    after: () => {
      if (!p.port) return;
      const paint = async () => { try { const el = $('#log'); if (el) el.innerHTML = logHtml(await api.server.log(id)); } catch { /* 서버가 방금 꺼진 경우 무시 */ } };
      paint(); logTimer = setInterval(paint, 2000);
    }
  };
}

/** 선택한 프로젝트의 Git 상태를 읽어 카드에 반영한다. (이 화면에 들어올 때와 새로고침 때만 호출) */
async function loadGit(id) {
  gitSt[id] = 'loading';
  try { gitSt[id] = await api.git.status(id); } catch (e) { gitSt[id] = { error: e.message }; }
  if (location.hash.endsWith(`${id}/git`)) render();
}

/* ---------- PHP 관리 ---------- */
const phpView = {
  crumb: '<b>PHP 버전</b>',
  get html() {
    const bad = DB.php.find(x => !x.ok), def = DB.php.find(x => x.isDefault);
    const sub = !DB.php.length ? '아직 등록된 PHP가 없습니다. 설치된 php.exe 경로를 등록해 주세요.'
      : bad ? `${bad.version}의 경로를 찾을 수 없습니다. 파일이 이동되었는지 확인하세요.` : `${DB.php.length}개 등록 · 기본 ${def?.version ?? '—'}`;
    const rows = DB.php.map(x => { const used = usedBy(x.version); return `<tr>
      <td><span class="mono" style="font-weight:500">${x.version}</span> ${x.isDefault ? '<span class="pill" style="margin-left:6px">기본</span>' : ''}</td>
      <td><div class="ell mono" title="${esc(x.path)}">${esc(x.path)}</div></td>
      <td>${x.ok ? '<span class="pill pos">사용 가능</span>' : '<span class="pill neg">경로 없음</span>'}</td>
      <td><div style="text-align:right">${used.length}개</div><div class="l2 ell" style="text-align:right">${esc(used.map(p => p.name).join(', ')) || '—'}</div></td>
      <td class="act">${x.ok ? `<button class="btn btn-sm" data-act="php-ini" data-v="${x.version}">php.ini 열기</button>` : ''}
        ${x.ok && !x.isDefault ? `<button class="btn btn-sm" data-act="php-default" data-v="${x.version}">기본으로 설정</button>` : ''}
        <button class="btn btn-sm" data-act="php-remove" data-v="${x.version}" ${used.length ? 'disabled title="사용 중인 프로젝트가 있어 제거할 수 없습니다"' : ''}>목록에서 제거</button></td></tr>`; }).join('');
    return `<div class="title-row"><div><h1>PHP 버전</h1><p class="sub">${sub}</p></div>
      <div class="actions"><button class="btn btn-primary btn-lg" data-act="php-add">${ico('plus')}PHP 추가</button></div></div>
      <table><colgroup><col style="width:150px"><col><col style="width:110px"><col style="width:150px"><col style="width:340px"></colgroup>
      <thead><tr><th>버전</th><th>php.exe 경로</th><th>상태</th><th style="text-align:right">사용 중 프로젝트</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="5"><div class="empty">등록된 PHP가 없습니다.</div></td></tr>'}</tbody></table>`;
  }
};

/* ---------- 전역 설정 ---------- */
const settingsView = {
  crumb: '<b>전역 설정</b>',
  get html() {
    const g = DB.github, d = daysLeft(), s = DB.server;
    const section = (title, desc, body, extra = '') => `<section class="set"><div><h2>${title}</h2><p class="desc">${desc}</p>${extra}</div><div class="set-panel">${body}</div></section>`;
    const vs = DB.vscode;
    return `<div class="title-row"><div><h1>전역 설정</h1><p class="sub">VSCode와 GitHub 연결은 모든 프로젝트에 공통으로 적용됩니다.</p></div></div>` +
      section('VSCode', '프로젝트의 “소스 열기”를 누르면 여기 등록한 VSCode로 폴더가 열립니다.',
        `<label class="field"><span>실행 파일 경로</span><span class="joined"><input id="s-vscode" class="mono" value="${esc(vs.path)}" placeholder="C:\\Users\\...\\Microsoft VS Code\\Code.exe" aria-label="VSCode 실행 파일 경로"><button class="btn" type="button" data-act="pick-vscode">찾아보기</button></span>
          <div class="hint">${vs.ok ? '확인됨 · 파일이 존재합니다' : vs.path ? '경로의 파일을 찾을 수 없습니다' : '아직 등록하지 않았습니다 (Code.exe 를 선택해 주세요)'}</div></label>
          <div class="save"><button class="btn btn-primary" data-act="save-vscode">저장</button></div>`) +
      section('GitHub 연결', '내려받기·올리기에 쓰는 토큰입니다. 계정은 토큰으로 자동 확인되고, 토큰은 Windows 사용자 계정으로 암호화되어 이 컴퓨터에만 저장됩니다.',
        `<div id="gh-reason">${ghReasonHtml()}</div>${d !== null && d <= 30 ? `<div class="notice" style="margin-bottom:16px">${d <= 0 ? '토큰이 만료되었습니다.' : `${d}일 뒤 토큰이 만료됩니다.`} 만료되면 내려받기·올리기가 실패하니 새 토큰으로 바꿔 주세요.</div>` : ''}
        <label class="field"><span>GitHub 계정</span><input value="${esc(g.user)}" placeholder="토큰을 저장하면 자동으로 채워집니다" readonly aria-label="GitHub 계정"></label>
        <label class="field"><span>액세스 토큰</span><input id="s-token" class="mono" type="password" autocomplete="off" placeholder="${g.hasToken ? '저장됨 · 바꾸려면 새 토큰을 붙여넣으세요' : 'github_pat_… 를 붙여넣으세요'}" aria-label="액세스 토큰">
          <div class="hint">필요 권한: 저장소 Contents 읽기·쓰기</div></label>
        <div class="field"><span>토큰 유효기간</span>
          <div class="state">${!g.hasToken ? '<span class="muted">—</span>' : g.expires ? `<b style="font-weight:500">${g.expires}</b><span class="muted">까지 · ${d}일 남음</span>` : '<span class="muted">만료일이 없는 토큰입니다</span>'}</div>
          ${g.checkedAt ? `<div class="hint">${g.checkedAt}에 GitHub에서 확인</div>` : ''}</div>
        <div class="save" style="justify-content:space-between"><button class="btn" data-act="recheck" ${g.hasToken ? '' : 'disabled'}>${ico('refresh')}만료일 다시 확인</button><button class="btn btn-primary" data-act="save-github">저장</button></div>`,
        `<p class="summary" id="gh-summary">${ghSummaryHtml()}</p>`) +
      section('서버 기본값', '프로젝트에서 서버를 시작할 때 적용됩니다.',
        `<div class="switch-row"><div><b>시작하면 브라우저 자동 열기</b><div class="muted">서버가 준비되면 기본 브라우저에서 주소를 엽니다.</div></div>
          <label class="toggle"><input id="s-auto" type="checkbox" ${s.autoOpen ? 'checked' : ''} aria-label="브라우저 자동 열기"><i></i></label></div>
         <div class="field" style="margin:8px 0 0"><span>임의 포트 범위</span><div style="display:flex;gap:8px;align-items:center"><input id="s-from" class="mono" value="${s.portFrom}" style="width:100px" aria-label="시작 포트"><span class="muted">~</span><input id="s-to" class="mono" value="${s.portTo}" style="width:100px" aria-label="끝 포트"></div></div>
         <div class="save"><button class="btn btn-primary" data-act="save-server">저장</button></div>`) +
      section('GitHub 연결 해제', '저장된 토큰을 이 컴퓨터에서 지웁니다. 프로젝트와 로컬 파일은 그대로 남습니다.',
        `<p style="margin-bottom:12px">연결을 해제하면 ${g.user ? `<b style="font-weight:500">@${esc(g.user)}</b> 계정으로 하는 ` : ''}내려받기·올리기가 모두 중단됩니다.</p><button class="btn btn-danger" data-act="disconnect" ${g.hasToken ? '' : 'disabled'}>연결 해제</button>`);
  }
};

/* ---------- 대화상자 ---------- */
let editing = null;
function openProject(id) {
  if (!DB.php.length) { toast('먼저 PHP 버전을 등록해 주세요.', true); location.hash = '#/php'; return; }
  editing = id; const p = DB.projects.find(x => x.id === id), f = $('#f-project');
  $('#dlg-project-title').textContent = p ? '프로젝트 편집' : '프로젝트 추가';
  $('#php-select').innerHTML = DB.php.filter(x => x.ok).map(x => `<option>${x.version}</option>`).join('');
  f.name.value = p?.name ?? ''; f.path.value = p?.path ?? ''; f.memo.value = p?.memo ?? '';
  f.php.value = p?.php ?? DB.php.find(x => x.isDefault)?.version ?? DB.php[0].version;
  $('#dlg-project').showModal();
}

$('#f-project').addEventListener('submit', async e => {
  e.preventDefault(); const f = e.target;
  const data = { id: editing, name: f.name.value, path: f.path.value, php: f.php.value, memo: f.memo.value };
  if (await run(() => api.project.save(data), editing ? '프로젝트를 수정했습니다.' : '프로젝트를 추가했습니다.')) $('#dlg-project').close();
});
$('#f-project').querySelector('[data-pick="folder"]').addEventListener('click', async () => {
  const p = await api.pick('folder').catch(() => null);
  if (p) { const f = $('#f-project'); f.path.value = p; if (!f.name.value) f.name.value = p.split('\\').pop(); }
});

/** php.exe 경로가 바뀌면 php -v 로 버전을 읽어 표시한다. */
async function probePhp() {
  const f = $('#f-php'), path = f.path.value.trim();
  if (!path) { f.version.value = ''; return; }
  f.version.value = '확인 중…';
  try { f.version.value = 'PHP ' + await api.php.probe(path); } catch (e) { f.version.value = e.message; }
}
$('#f-php').path.addEventListener('change', probePhp);
$('#f-php').querySelector('[data-pick="exe"]').addEventListener('click', async () => {
  const p = await api.pick('exe').catch(() => null);
  if (p) { $('#f-php').path.value = p; probePhp(); }
});
$('#f-php').addEventListener('submit', async e => {
  e.preventDefault();
  if (await run(() => api.php.add($('#f-php').path.value.trim()), r => `PHP ${r.php.at(-1).version}을(를) 등록했습니다.`)) $('#dlg-php').close();
});
document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => b.closest('dialog').close()));

/* ---------- 이벤트 ---------- */
function closeMenu() { document.querySelector('.menu')?.remove(); }
document.addEventListener('click', e => {
  const t = e.target.closest('[data-act],[data-tab]');
  if (!t) return closeMenu();
  if (t.dataset.tab) { ui.tab = t.dataset.tab; ui.page = 1; return tableHtml(); }
  e.preventDefault(); closeMenu();
  const id = t.dataset.id, p = DB.projects.find(x => x.id === id), a = t.dataset.act;
  // 시간이 걸리는 작업은 처리 중 중복 클릭을 막는다 (끝나면 화면이 다시 그려진다)
  if (t.tagName === 'BUTTON' && /^(src|start|stop|browser|pull|push|php-ini|php-default|php-remove|save-.+|recheck|remove|disconnect)$/.test(a)) t.disabled = true;
  const val = sel => $(sel).value.trim();
  const act = {
    'update-install': () => run(() => api.installUpdate(), '업데이트를 설치하기 위해 앱을 다시 시작합니다…'),
    page: () => { ui.page = +t.dataset.p; tableHtml(); },
    add: () => openProject(null),
    edit: () => openProject(id),
    src: () => run(() => api.openVscode(id), `VSCode로 ${p.name} 폴더를 열었습니다.`),
    start: () => run(() => api.server.start(id), r => { const q = r.projects.find(x => x.id === id); return `localhost:${q.port} 에서 서버를 시작했습니다 · PHP ${q.php}`; }),
    stop: () => run(() => api.server.stop(id), `${p.name} 서버를 중지했습니다.`),
    browser: () => run(() => api.openBrowser(id)),
    menu: () => {
      const m = document.createElement('div'); m.className = 'menu'; const r = t.getBoundingClientRect();
      m.style.left = r.right - 148 + scrollX + 'px'; m.style.top = r.bottom + 4 + scrollY + 'px';
      m.innerHTML = `<button data-act="edit" data-id="${id}">편집</button><button class="neg" data-act="remove" data-id="${id}">목록에서 제거</button>`;
      document.body.append(m); t.disabled = false;
    },
    remove: () => confirm(`“${p.name}”을(를) 목록에서 제거할까요?\n로컬 폴더의 파일은 삭제되지 않습니다.`) ? run(() => api.project.remove(id), '목록에서 제거했습니다. 로컬 폴더는 그대로 남아 있습니다.') : render(),
    fetch: () => { delete gitSt[location.hash.split('/')[2]]; render(); },
    pull: () => gitAction(id, 'pull', () => api.git.pull(id)),
    push: () => { const msg = $('#msg')?.value ?? ''; return gitAction(id, 'push', () => api.git.push(id, msg), msg); },
    'php-add': () => { $('#f-php').reset(); $('#dlg-php').showModal(); t.disabled = false; },
    'php-ini': async () => {
      const v = t.dataset.v, done = '열었습니다. 수정 후에는 실행 중인 서버를 다시 시작해야 반영됩니다.';
      try {
        let r = await api.php.openIni(v, false);
        if (r.needsCreate) {
          if (!confirm(`PHP ${v}에 php.ini가 없습니다.\n${r.template}을(를) 복사해서 php.ini를 만들까요?`)) return render();
          r = await api.php.openIni(v, true);
        }
        toast(`${r.path} ${done}`);
      } catch (e) { toast(e.message, true); }
      render();
    },
    'php-default': () => run(() => api.php.setDefault(t.dataset.v), `기본 PHP를 ${t.dataset.v}(으)로 바꿨습니다.`),
    'php-remove': () => run(() => api.php.remove(t.dataset.v), `PHP ${t.dataset.v}을(를) 목록에서 제거했습니다.`),
    'pick-vscode': async () => { const p = await api.pick('exe').catch(() => null); if (p) $('#s-vscode').value = p; t.disabled = false; },
    'save-vscode': () => run(() => api.settings({ vscodePath: val('#s-vscode') }), '저장했습니다.'),
    'save-server': () => run(() => api.settings({ server: { portFrom: val('#s-from'), portTo: val('#s-to'), autoOpen: $('#s-auto').checked } }), '저장했습니다.'),
    'save-github': () => run(() => api.github.save({ token: val('#s-token') }), r => `GitHub @${r.github.user} 계정으로 연결했습니다.`),
    recheck: () => run(() => api.github.recheck(), '만료일을 다시 확인했습니다.'),
    disconnect: () => confirm('GitHub 연결을 해제할까요? 저장된 토큰이 이 컴퓨터에서 삭제됩니다.') ? run(() => api.github.disconnect(), 'GitHub 연결을 해제했습니다.') : render()
  };
  act[a]?.();
});
// 검색은 버튼(또는 Enter)을 눌렀을 때만 실행된다. 입력 중에는 목록이 바뀌지 않는다.
document.addEventListener('submit', e => { if (e.target.id === 'sf') { e.preventDefault(); ui.q = $('#q').value; ui.page = 1; tableHtml(); } });
addEventListener('hashchange', () => { gitSt = {}; gitOp = null; render(); });

api.onGithub(g => { if (DB) { DB.github = g; renderGh(); } }); // 연결 확인 결과는 화면 전체를 다시 그리지 않고 표시만 갱신한다
api.onUpdate(s => { if (DB) { DB.update = s; renderUpdate(); } }); // 업데이트 상태는 화면 전체를 다시 그리지 않고 알림만 갱신한다
api.load().then(d => { DB = d; render(); }).catch(e => toast(e.message, true));
