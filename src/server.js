// PHP 내장 서버(php -S) 실행·중지 관리. electron 에 의존하지 않아 node 로 단독 테스트할 수 있다.
const { spawn } = require('child_process');
const net = require('net');
const fs = require('fs');

const procs = new Map(); // 프로젝트 id -> { child, port, since, log[] }
const MAX_LOG = 40;

/** 해당 포트에 바인딩할 수 있는지(비어 있는지) 확인한다. */
const isFree = port => new Promise(resolve => {
  const s = net.createServer();
  s.once('error', () => resolve(false));
  s.listen(port, '127.0.0.1', () => s.close(() => resolve(true)));
});

/** 포트 범위에서 임의로 골라 실행 중인 서버와 겹치지 않는 빈 포트를 반환한다. */
async function pickPort(from, to) {
  const used = new Set([...procs.values()].map(p => p.port));
  const range = [];
  for (let p = from; p <= to; p++) if (!used.has(p)) range.push(p);
  for (let i = range.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [range[i], range[j]] = [range[j], range[i]]; }
  for (const port of range.slice(0, 30)) if (await isFree(port)) return port;
  throw new Error(`${from}~${to} 범위에 빈 포트가 없습니다. 설정에서 포트 범위를 넓혀 주세요.`);
}

/** PHP 접속 로그 한 줄을 { time, method, path, status } 로 해석한다. 예: [Tue Nov 25 14:31:52 2026] 127.0.0.1:5001 [200]: GET /index.php */
function parseLine(line) {
  const m = line.match(/\[(\d{3})\]:\s+(\w+)\s+(\S+)/);
  if (!m) return null;
  const d = new Date();
  const time = [d.getHours(), d.getMinutes(), d.getSeconds()].map(n => String(n).padStart(2, '0')).join(':');
  return { time, status: +m[1], method: m[2], path: m[3] };
}

const waitMs = ms => new Promise(r => setTimeout(r, ms));
const canConnect = port => new Promise(resolve => {
  const s = net.connect({ port, host: '127.0.0.1' }, () => { s.destroy(); resolve(true); });
  s.on('error', () => resolve(false));
});

/**
 * 프로젝트 폴더를 문서 루트로 PHP 서버를 시작한다.
 * 포트가 열릴 때까지 기다리고, 그 전에 프로세스가 죽으면 PHP의 오류 출력을 담아 실패시킨다.
 */
async function start(project, phpPath, { portFrom, portTo }) {
  if (procs.has(project.id)) throw new Error('이미 실행 중입니다.');
  if (!fs.existsSync(project.path)) throw new Error(`프로젝트 폴더를 찾을 수 없습니다: ${project.path}`);
  if (!fs.existsSync(phpPath)) throw new Error(`PHP 경로를 찾을 수 없습니다: ${phpPath}`);

  const port = await pickPort(portFrom, portTo);
  const child = spawn(phpPath, ['-S', `127.0.0.1:${port}`, '-t', project.path], { cwd: project.path, windowsHide: true });
  const entry = { child, port, since: new Date().toTimeString().slice(0, 5), log: [], out: [] };
  procs.set(project.id, entry);

  const onData = buf => {
    for (const line of buf.toString('utf8').split(/\r?\n/).filter(Boolean)) {
      const row = parseLine(line);
      if (row) { entry.log.push(row); if (entry.log.length > MAX_LOG) entry.log.shift(); }
      else { entry.out.push(line); if (entry.out.length > 10) entry.out.shift(); }
    }
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  let spawnError = null;
  child.on('error', e => { spawnError = e; });
  child.on('exit', () => { if (procs.get(project.id) === entry) procs.delete(project.id); });

  for (let i = 0; i < 30; i++) { // 최대 약 6초 대기
    if (spawnError || child.exitCode !== null) break;
    if (await canConnect(port)) return { port };
    await waitMs(200);
  }
  stop(project.id);
  throw new Error('서버를 시작하지 못했습니다. ' + (spawnError?.message || entry.out.slice(-3).join(' ') || 'PHP 경로와 버전을 확인해 주세요.'));
}

function stop(id) {
  const e = procs.get(id);
  if (!e) return;
  procs.delete(id);
  e.child.kill();
}

const stopAll = () => [...procs.keys()].forEach(stop);
const logOf = id => procs.get(id)?.log ?? [];

/** 실행 중인 서버의 { id: { port, since } } 목록 */
function status() {
  return Object.fromEntries([...procs].map(([id, e]) => [id, { port: e.port, since: e.since }]));
}

module.exports = { start, stop, stopAll, logOf, status, pickPort };
