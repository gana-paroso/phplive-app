// Electron 메인 프로세스: 창 생성과 화면(renderer)이 호출하는 기능(IPC)을 연결한다.
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const { execFile, spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const store = require('./src/store');
const server = require('./src/server');
const git = require('./src/git');
const github = require('./src/github');
const { autoUpdater } = require('electron-updater');

if (!app.requestSingleInstanceLock()) app.quit(); // 앱을 두 번 띄우면 서버 포트가 꼬이므로 하나만 허용

let win;
function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 900, minHeight: 600, title: 'PHP Live', backgroundColor: '#f6f8fa', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.loadFile(path.join(__dirname, 'ui', 'index.html'));
}
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.whenReady().then(() => { createWindow(); initUpdater(); });
app.on('before-quit', server.stopAll); // 앱을 끄면 켜 둔 PHP 서버도 함께 종료
app.on('window-all-closed', () => app.quit());

/* ---------- 자동 업데이트 (GitHub Releases) ---------- */
let updateState = { state: 'idle' }; // idle | downloading { version, percent } | ready { version }
function setUpdate(s) { updateState = s; win?.webContents.send('update', s); }

/** 앱을 켠 뒤 5초 후, 그리고 4시간마다 새 버전을 확인한다. 받는 것은 백그라운드로, 설치는 사용자가 재시작할 때 한다. */
function initUpdater() {
  if (!app.isPackaged) return; // 개발 중(npm start)에는 확인하지 않는다
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true; // 재시작 버튼을 누르지 않고 앱을 닫아도 다음 종료 때 설치된다
  autoUpdater.on('update-available', i => { if (updateState.state !== 'ready') setUpdate({ state: 'downloading', version: i.version, percent: 0 }); });
  autoUpdater.on('download-progress', p => setUpdate({ state: 'downloading', version: updateState.version, percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', i => setUpdate({ state: 'ready', version: i.version }));
  autoUpdater.on('error', e => console.error('업데이트 확인 실패:', e.message)); // 오프라인 등은 조용히 넘어간다
  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  setTimeout(check, 5000);
  setInterval(check, 4 * 60 * 60 * 1000);
}

/** 화면에 넘길 전체 상태. 토큰 값은 절대 포함하지 않는다. */
function snapshot() {
  const c = store.load(), run = server.status();
  const d = new Date();
  return {
    version: app.getVersion(), update: updateState,
    today: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
    vscode: { path: c.vscode.path, ok: !!c.vscode.path && fs.existsSync(c.vscode.path) },
    github: { user: c.github.user, hasToken: store.hasToken(), expires: c.github.expires, checkedAt: c.github.checkedAt },
    server: c.server,
    php: c.php.map(x => ({ ...x, ok: fs.existsSync(x.path) })),
    projects: c.projects.map(p => ({ ...p, port: run[p.id]?.port ?? null, since: run[p.id]?.since ?? null }))
  };
}

/** 성공/실패를 { ok, data | error } 로 감싸서 돌려준다. (화면에서 오류 문구를 그대로 보여주기 위함) */
const handle = (channel, fn) => ipcMain.handle(channel, async (_e, ...args) => {
  try { return { ok: true, data: await fn(...args) }; } catch (e) { return { ok: false, error: e.message }; }
});
const mutate = (channel, fn) => handle(channel, async (...a) => { await fn(...a); return snapshot(); });

const findProject = id => { const p = store.load().projects.find(x => x.id === id); if (!p) throw new Error('프로젝트를 찾을 수 없습니다.'); return p; };
const authOrNull = () => { const t = store.getToken(), u = store.load().github.user; return t && u ? { user: u, token: t } : null; };
const requireAuth = () => authOrNull() ?? (() => { throw new Error('GitHub 연결이 필요합니다. 전역 설정에서 토큰을 등록해 주세요.'); })();

/** php.exe 를 실행해 버전 문자열(예: 8.3.12)을 읽는다. */
const probePhp = file => new Promise((resolve, reject) => {
  if (!fs.existsSync(file)) return reject(new Error('파일을 찾을 수 없습니다.'));
  execFile(file, ['-v'], { windowsHide: true, timeout: 8000 }, (err, out) => {
    const m = /PHP (\d+\.\d+\.\d+)/.exec(out || '');
    m ? resolve(m[1]) : reject(new Error('PHP 실행 파일이 아닙니다. php.exe 를 선택해 주세요.'));
  });
});

handle('load', snapshot);
// 서버를 먼저 정리하고(before-quit) 업데이트를 설치한 뒤 앱을 다시 켠다.
handle('update:install', () => autoUpdater.quitAndInstall(true, true));

/* ---------- 프로젝트 ---------- */
mutate('project:save', data => {
  const c = store.load();
  const v = { name: String(data.name ?? '').trim(), path: String(data.path ?? '').trim(), php: data.php, memo: String(data.memo ?? '').trim() };
  if (!v.name) throw new Error('프로젝트명을 입력해 주세요.');
  if (!fs.existsSync(v.path) || !fs.statSync(v.path).isDirectory()) throw new Error('로컬 프로젝트 경로가 존재하는 폴더가 아닙니다.');
  if (!c.php.some(x => x.version === v.php)) throw new Error('등록된 PHP 버전을 선택해 주세요.');
  const dup = c.projects.find(p => p.path.toLowerCase() === v.path.toLowerCase() && p.id !== data.id);
  if (dup) throw new Error(`이미 “${dup.name}”(으)로 등록된 폴더입니다.`);
  if (data.id) { const p = findProject(data.id); if (p.php !== v.php && server.status()[p.id]) throw new Error('서버를 중지한 뒤 PHP 버전을 바꿀 수 있습니다.'); Object.assign(p, v); }
  else c.projects.push({ id: crypto.randomUUID().slice(0, 8), ...v });
  store.save();
});
mutate('project:remove', id => { const c = store.load(); server.stop(id); c.projects = c.projects.filter(p => p.id !== id); store.save(); });

/* ---------- PHP ---------- */
handle('php:probe', probePhp);
mutate('php:add', async file => {
  const c = store.load(), version = await probePhp(file);
  if (c.php.some(x => x.version === version)) throw new Error(`PHP ${version}은(는) 이미 등록되어 있습니다.`);
  c.php.push({ version, path: file, isDefault: c.php.length === 0 });
  store.save();
});
mutate('php:remove', version => {
  const c = store.load(), used = c.projects.filter(p => p.php === version);
  if (used.length) throw new Error(`${used.length}개 프로젝트가 사용 중이라 제거할 수 없습니다.`);
  c.php = c.php.filter(x => x.version !== version);
  if (c.php.length && !c.php.some(x => x.isDefault)) c.php[0].isDefault = true;
  store.save();
});
mutate('php:default', version => { store.load().php.forEach(x => (x.isDefault = x.version === version)); store.save(); });

/* ---------- 파일 선택 ---------- */
handle('pick', async kind => {
  const opt = kind === 'folder' ? { properties: ['openDirectory'] }
    : { properties: ['openFile'], filters: [{ name: '실행 파일', extensions: ['exe'] }] };
  const r = await dialog.showOpenDialog(win, opt);
  return r.canceled ? null : r.filePaths[0];
});

/* ---------- 전역 설정 ---------- */
mutate('settings:save', ({ vscodePath, server: s }) => {
  const c = store.load();
  if (vscodePath !== undefined) {
    if (vscodePath && !fs.existsSync(vscodePath)) throw new Error('VSCode 실행 파일을 찾을 수 없습니다.');
    c.vscode.path = vscodePath;
  }
  if (s) {
    const from = +s.portFrom, to = +s.portTo;
    if (!(Number.isInteger(from) && Number.isInteger(to) && from >= 1024 && to <= 65535 && from <= to)) throw new Error('포트 범위는 1024~65535 사이에서 시작 ≤ 끝이어야 합니다.');
    c.server = { portFrom: from, portTo: to, autoOpen: !!s.autoOpen };
  }
  store.save();
});
mutate('github:save', async ({ token }) => {
  const c = store.load();
  if (!token?.trim()) throw new Error('액세스 토큰을 입력해 주세요.');
  const r = await github.checkToken(token.trim());
  store.setToken(token.trim());
  c.github = { user: r.login, expires: r.expires, checkedAt: new Date().toTimeString().slice(0, 5) };
  store.save();
});
mutate('github:recheck', async () => {
  const token = store.getToken();
  if (!token) throw new Error('저장된 토큰이 없습니다.');
  const r = await github.checkToken(token);
  Object.assign(store.load().github, { user: r.login, expires: r.expires, checkedAt: new Date().toTimeString().slice(0, 5) });
  store.save();
});
mutate('github:disconnect', () => { store.clearToken(); store.load().github = { user: '', expires: null, checkedAt: null }; store.save(); });

/* ---------- 서버·VSCode·브라우저 ---------- */
const urlOf = port => `http://localhost:${port}`;
mutate('server:start', async id => {
  const c = store.load(), p = findProject(id), php = c.php.find(x => x.version === p.php);
  if (!php) throw new Error('이 프로젝트의 PHP 버전이 등록되어 있지 않습니다.');
  const { port } = await server.start(p, php.path, c.server);
  if (c.server.autoOpen) shell.openExternal(urlOf(port));
});
mutate('server:stop', id => server.stop(id));
handle('server:log', id => server.logOf(id));
handle('browser:open', id => {
  const port = server.status()[id]?.port;
  if (!port) throw new Error('서버가 실행 중이 아닙니다.');
  return shell.openExternal(urlOf(port));
});
/** 등록된 VSCode 로 폴더/파일을 연다. */
const openInVscode = target => new Promise((resolve, reject) => {
  const exe = store.load().vscode.path;
  if (!exe || !fs.existsSync(exe)) return reject(new Error('전역 설정에서 VSCode 실행 파일 경로를 먼저 등록해 주세요.'));
  const child = spawn(exe, [target], { detached: true, stdio: 'ignore', windowsHide: true });
  child.once('error', e => reject(new Error('VSCode를 실행하지 못했습니다. ' + e.message)));
  child.once('spawn', () => { child.unref(); resolve(); });
});
handle('vscode:open', id => {
  const p = findProject(id);
  if (!fs.existsSync(p.path)) throw new Error(`프로젝트 폴더를 찾을 수 없습니다: ${p.path}`);
  return openInVscode(p.path);
});

/** `php --ini` 로 이 PHP 가 실제로 읽는 php.ini 경로를 찾는다. 없으면 null. */
const findIni = file => new Promise(resolve => {
  execFile(file, ['--ini'], { windowsHide: true, timeout: 8000 }, (err, out) => {
    const m = /Loaded Configuration File:\s+(.+)/.exec(out || '');
    resolve(m && !/\(none\)/.test(m[1]) ? m[1].trim() : null);
  });
});
/**
 * 선택한 PHP 버전의 php.ini 를 VSCode 로 연다.
 * php.ini 가 없으면 create=false 일 때 { needsCreate, template } 만 알려주고,
 * create=true 일 때 php.ini-development(없으면 production)를 복사해서 만든 뒤 연다.
 */
handle('php:ini', async (version, create) => {
  const php = store.load().php.find(x => x.version === version);
  if (!php || !fs.existsSync(php.path)) throw new Error('PHP 경로를 찾을 수 없습니다.');
  let ini = await findIni(php.path);
  if (!ini) {
    const dir = path.dirname(php.path);
    const template = ['php.ini-development', 'php.ini-production'].find(n => fs.existsSync(path.join(dir, n)));
    if (!template) throw new Error('php.ini 도 템플릿(php.ini-development)도 찾을 수 없습니다. PHP 폴더를 확인해 주세요.');
    if (!create) return { needsCreate: true, template };
    ini = path.join(dir, 'php.ini');
    fs.copyFileSync(path.join(dir, template), ini);
  }
  await openInVscode(ini);
  return { path: ini };
});

/* ---------- Git ---------- */
handle('git:status', id => git.status(findProject(id).path, authOrNull()));
handle('git:pull', async id => { await git.pull(findProject(id).path, requireAuth()); });
handle('git:push', async (id, message) => { await git.push(findProject(id).path, message, requireAuth()); });
