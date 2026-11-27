// git.js 통합 테스트: 임시 폴더에 bare 원격 저장소와 두 작업 폴더(디자이너 A, B)를 만들어 pull/push 흐름을 검증한다.
const test = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const git = require('../src/git');

const sh = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8' });
const auth = { user: 'tester', token: 'dummy' }; // 파일 원격에서는 헤더가 무시된다

test('다른 작업자 커밋 내려받기 → 내 변경 올리기', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phplive-git-'));
  const remote = path.join(root, 'remote.git'), a = path.join(root, 'a'), b = path.join(root, 'b');
  sh(root, 'init', '--bare', '-b', 'main', remote);
  sh(root, 'clone', remote, a);
  for (const d of [a]) { sh(d, 'config', 'user.name', 'A'); sh(d, 'config', 'user.email', 'a@x.com'); }
  sh(a, 'checkout', '-b', 'main');
  fs.writeFileSync(path.join(a, 'index.php'), '<?php echo 1;');
  sh(a, 'add', '-A'); sh(a, 'commit', '-m', '첫 커밋'); sh(a, 'push', '-u', 'origin', 'main');
  sh(root, 'clone', remote, b);

  // A가 새 커밋을 올린다 → B에서는 '받을 커밋 1'
  fs.writeFileSync(path.join(a, 'about.php'), '<?php echo 2;');
  sh(a, 'add', '-A'); sh(a, 'commit', '-m', '소개 페이지 추가'); sh(a, 'push');
  let st = await git.status(b, auth);
  assert.equal(st.isRepo, true);
  assert.equal(st.branch, 'main');
  assert.equal(st.incoming.length, 1);
  assert.equal(st.incoming[0].msg, '소개 페이지 추가');
  assert.equal(st.fetchError, null);

  await git.pull(b, auth);
  assert.ok(fs.existsSync(path.join(b, 'about.php')));
  st = await git.status(b, auth);
  assert.equal(st.incoming.length, 0);

  // B에서 한글 파일명 포함 변경 → 커밋 메시지 없이는 실패, 있으면 push 성공
  fs.writeFileSync(path.join(b, '한글.css'), 'a{}');
  st = await git.status(b, auth);
  assert.deepEqual(st.changes, [{ status: '추가', path: '한글.css' }]);
  await assert.rejects(git.push(b, '  ', auth), /커밋 메시지/);
  await git.push(b, '스타일 추가', auth);
  assert.equal(sh(remote, 'log', '--format=%s', '-1').trim(), '스타일 추가');
  st = await git.status(b, auth);
  assert.equal(st.changes.length, 0);
  assert.equal(st.ahead, 0);
});

test('Git 저장소가 아닌 폴더', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'phplive-nogit-'));
  assert.deepEqual(await git.status(dir, auth), { isRepo: false });
});
