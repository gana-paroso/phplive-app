// git CLI 래퍼: 상태 확인, pull, commit+push. main 브랜치/origin 만 다룬다. electron 에 의존하지 않는다.
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const BRANCH = 'main';
const REMOTE = 'origin';

/** git 명령을 실행하고 stdout 을 돌려준다. 실패하면 git 이 남긴 첫 오류 줄을 메시지로 던진다. */
function git(cwd, args, auth) {
  // 토큰은 이번 명령에만 인증 헤더로 넘기고 원격 주소나 .git/config 에는 남기지 않는다.
  const pre = ['-c', 'core.quotepath=false', '-c', 'credential.helper='];
  if (auth) pre.push('-c', `http.extraHeader=Authorization: Basic ${Buffer.from(`${auth.user}:${auth.token}`).toString('base64')}`);
  return new Promise((resolve, reject) => {
    execFile('git', [...pre, ...args], { cwd, windowsHide: true, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' } },
      (err, stdout, stderr) => {
        if (!err) return resolve(stdout);
        if (err.code === 'ENOENT') return reject(new Error('Git이 설치되어 있지 않습니다. Git for Windows를 설치해 주세요.'));
        reject(new Error(friendly(String(stderr || err.message))));
      });
  });
}

/** git 오류 문구를 디자이너가 이해할 수 있는 한국어 안내로 바꾼다. */
function friendly(msg) {
  if (/Authentication failed|could not read Username|403|401/.test(msg)) return 'GitHub 인증에 실패했습니다. 전역 설정에서 토큰을 확인해 주세요.';
  if (/Could not resolve host|unable to access/.test(msg)) return 'GitHub에 연결할 수 없습니다. 인터넷 연결을 확인해 주세요.';
  if (/non-fast-forward|rejected|fetch first/.test(msg)) return '다른 작업자의 변경이 먼저 올라와 있습니다. 먼저 내려받기(Pull)를 해 주세요.';
  if (/Not possible to fast-forward|diverging|divergent/.test(msg)) return '내 커밋과 GitHub의 변경이 갈라져 자동으로 합칠 수 없습니다. 개발 담당자에게 문의해 주세요.';
  if (/would be overwritten|local changes/.test(msg)) return '아직 올리지 않은 내 변경과 겹치는 파일이 있어 내려받을 수 없습니다. 먼저 내 변경을 올려 주세요.';
  if (/Please tell me who you are|empty ident/.test(msg)) return 'Git 사용자 이름과 이메일이 설정되어 있지 않습니다.';
  if (/Repository not found|not found/.test(msg)) return 'GitHub 저장소를 찾을 수 없거나 접근 권한이 없습니다.';
  return msg.split('\n').map(s => s.trim()).filter(Boolean)[0] || '알 수 없는 Git 오류';
}

const isRepo = cwd => fs.existsSync(path.join(cwd, '.git'));

/** 파일 상태 코드를 화면 표시용 '추가/수정/삭제' 로 바꾼다. */
const label = code => (code.includes('?') || code.includes('A') ? '추가' : code.includes('D') ? '삭제' : '수정');

/**
 * 한 프로젝트의 Git 상태를 읽는다. 목록에서는 호출하지 않고 'Git 배포 관리' 화면에 들어갈 때만 호출한다.
 * auth 가 있으면 GitHub 에서 먼저 fetch 하고, 실패해도 로컬 상태는 돌려준다(fetchError 에 사유).
 */
async function status(cwd, auth) {
  if (!fs.existsSync(cwd)) throw new Error(`프로젝트 폴더를 찾을 수 없습니다: ${cwd}`);
  if (!isRepo(cwd)) return { isRepo: false };

  let fetchError = null;
  if (auth) {
    try { await git(cwd, ['fetch', REMOTE, BRANCH], auth); } catch (e) { fetchError = e.message; }
  } else fetchError = 'GitHub 연결이 필요합니다. 전역 설정에서 토큰을 등록해 주세요.';

  const branch = (await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
  let ahead = 0, incoming = [];
  const hasRemote = await git(cwd, ['rev-parse', '--verify', `${REMOTE}/${BRANCH}`]).then(() => true, () => false);
  if (hasRemote) {
    const [a] = (await git(cwd, ['rev-list', '--left-right', '--count', `HEAD...${REMOTE}/${BRANCH}`])).trim().split(/\s+/);
    ahead = +a;
    const log = await git(cwd, ['log', `HEAD..${REMOTE}/${BRANCH}`, '-n', '30', '--format=%h%x1f%an%x1f%s%x1f%cI']);
    incoming = log.split('\n').filter(Boolean).map(l => { const [hash, author, msg, when] = l.split('\x1f'); return { hash, author, msg, when }; });
  }
  const porcelain = await git(cwd, ['status', '--porcelain']);
  const changes = porcelain.split('\n').filter(Boolean).map(l => ({ status: label(l.slice(0, 2)), path: l.slice(3).replace(/^"|"$/g, '') }));
  return { isRepo: true, branch, ahead, incoming, changes, hasRemote, fetchError, checkedAt: new Date().toTimeString().slice(0, 5) };
}

/** main 브랜치에서만 동작하도록 확인한다. */
async function ensureMain(cwd) {
  const b = (await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
  if (b !== BRANCH) throw new Error(`현재 브랜치가 ${b}입니다. 이 프로그램은 ${BRANCH} 브랜치만 다룹니다.`);
}

/** GitHub main 의 변경을 내려받는다. 합칠 수 없으면(ff-only) 오류로 알린다. */
async function pull(cwd, auth) {
  await ensureMain(cwd);
  await git(cwd, ['pull', '--ff-only', REMOTE, BRANCH], auth);
}

/** 변경 파일을 모두 커밋하고 GitHub main 에 올린다. 커밋할 변경이 없으면 이미 만든 커밋만 올린다. */
async function push(cwd, message, auth) {
  await ensureMain(cwd);
  const dirty = (await git(cwd, ['status', '--porcelain'])).trim();
  if (dirty) {
    if (!message?.trim()) throw new Error('커밋 메시지를 적어 주세요.');
    await git(cwd, ['add', '-A']);
    // 사용자 이름/이메일이 없는 PC 에서도 커밋되도록 GitHub 계정으로 대신 채운다(이미 설정돼 있으면 그대로 사용).
    const name = (await git(cwd, ['config', 'user.name']).catch(() => '')).trim();
    const email = (await git(cwd, ['config', 'user.email']).catch(() => '')).trim();
    const who = [];
    if (!name) who.push('-c', `user.name=${auth.user}`);
    if (!email) who.push('-c', `user.email=${auth.user}@users.noreply.github.com`);
    await git(cwd, [...who, 'commit', '-m', message.trim()]);
  }
  await git(cwd, ['push', REMOTE, `HEAD:${BRANCH}`], auth);
}

module.exports = { status, pull, push, isRepo };
