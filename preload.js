// 화면(renderer)에는 아래 기능만 노출한다. Node/Electron API 에는 직접 접근할 수 없다.
const { contextBridge, ipcRenderer } = require('electron');

/** IPC 호출 결과({ ok, data | error })를 풀어서, 실패하면 Error 로 던진다. */
const call = channel => async (...args) => {
  const r = await ipcRenderer.invoke(channel, ...args);
  if (!r.ok) throw new Error(r.error);
  return r.data;
};

contextBridge.exposeInMainWorld('api', {
  load: call('load'),
  installUpdate: call('update:install'),
  onUpdate: cb => ipcRenderer.on('update', (_e, state) => cb(state)),
  pick: call('pick'),
  project: { save: call('project:save'), remove: call('project:remove') },
  php: { probe: call('php:probe'), add: call('php:add'), remove: call('php:remove'), setDefault: call('php:default'), openIni: call('php:ini') },
  settings: call('settings:save'),
  github: { save: call('github:save'), recheck: call('github:recheck'), disconnect: call('github:disconnect') },
  server: { start: call('server:start'), stop: call('server:stop'), log: call('server:log') },
  openBrowser: call('browser:open'),
  openVscode: call('vscode:open'),
  git: { status: call('git:status'), pull: call('git:pull'), push: call('git:push') }
});
