// server.js 통합 테스트: 실제 php -S 를 띄워 응답, 접속 로그, 중지를 확인한다. PHP 가 없으면 건너뛴다.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const server = require('../src/server');

const PHP = process.env.PHP_EXE || 'C:\\php\\current\\php.exe';

test('php -S 시작 → 응답 → 로그 → 중지', { skip: !fs.existsSync(PHP) && 'PHP 없음' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'phplive-srv-'));
  fs.writeFileSync(path.join(dir, 'index.php'), '<?php echo "hello-" . PHP_VERSION;');
  const project = { id: 't1', path: dir };

  const { port } = await server.start(project, PHP, { portFrom: 8300, portTo: 8399 });
  assert.ok(port >= 8300 && port <= 8399);
  assert.equal(server.status().t1.port, port);
  await assert.rejects(server.start(project, PHP, { portFrom: 8300, portTo: 8399 }), /이미 실행 중/);

  const res = await fetch(`http://localhost:${port}/index.php`);
  assert.match(await res.text(), /^hello-\d/);
  await new Promise(r => setTimeout(r, 300));
  assert.ok(server.logOf('t1').some(l => l.path === '/index.php' && l.status === 200));

  server.stop('t1');
  assert.equal(server.status().t1, undefined);
  await new Promise(r => setTimeout(r, 300));
  await assert.rejects(fetch(`http://localhost:${port}/`));
});

test('존재하지 않는 PHP 경로는 오류', async () => {
  await assert.rejects(server.start({ id: 't2', path: os.tmpdir() }, 'C:\\none\\php.exe', { portFrom: 8300, portTo: 8399 }), /PHP 경로/);
});
