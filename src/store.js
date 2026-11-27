// 설정 저장소: 프로젝트/PHP/설정은 JSON 파일, GitHub 토큰은 Windows DPAPI(safeStorage)로 암호화해 별도 파일에 저장한다.
const { app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  vscode: { path: '' },
  github: { user: '', expires: null, checkedAt: null },
  server: { portFrom: 8100, portTo: 8199, autoOpen: true },
  php: [],
  projects: []
};

let cache = null;
const configFile = () => path.join(app.getPath('userData'), 'config.json');
const tokenFile = () => path.join(app.getPath('userData'), 'github-token.bin');

/** 설정을 읽는다. 파일이 없거나 깨졌으면 기본값으로 시작한다. */
function load() {
  if (cache) return cache;
  try {
    cache = { ...structuredClone(DEFAULTS), ...JSON.parse(fs.readFileSync(configFile(), 'utf8')) };
  } catch {
    cache = structuredClone(DEFAULTS);
  }
  return cache;
}

/** 임시 파일에 쓴 뒤 이름을 바꿔서, 저장 도중 꺼져도 설정 파일이 깨지지 않게 한다. */
function save() {
  const file = configFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + '.tmp', JSON.stringify(cache, null, 2), 'utf8');
  fs.renameSync(file + '.tmp', file);
}

const hasToken = () => fs.existsSync(tokenFile());

/** 토큰을 암호화해서 저장한다. 암호화를 쓸 수 없으면 평문으로 저장하지 않고 오류를 낸다. */
function setToken(token) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('이 컴퓨터에서는 토큰을 안전하게 저장할 수 없습니다.');
  fs.mkdirSync(path.dirname(tokenFile()), { recursive: true });
  fs.writeFileSync(tokenFile(), safeStorage.encryptString(token));
}

function getToken() {
  if (!hasToken()) return null;
  try { return safeStorage.decryptString(fs.readFileSync(tokenFile())); } catch { return null; }
}

function clearToken() {
  fs.rmSync(tokenFile(), { force: true });
}

module.exports = { load, save, hasToken, setToken, getToken, clearToken };
