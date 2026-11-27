# PHP Live

디자이너가 로컬에서 PHP 사이트를 쉽게 띄우고, VSCode로 열고, GitHub(main)과 동기화하는 Windows용 Electron 앱입니다.

## 개발 환경 준비

| 필요한 것 | 비고 |
|---|---|
| Node.js 22 이상 | npm 포함 |
| Git for Windows | Git 기능(내려받기·올리기)에 필요 |
| PHP | 프로젝트에서 쓸 버전의 `php.exe` (앱의 “PHP 버전” 메뉴에서 경로 등록) |
| VSCode | “소스 열기”용 (앱의 “전역 설정”에서 `Code.exe` 경로 등록) |

## 로컬 실행 (개발)

```powershell
cd <프로젝트 폴더>
npm install
npm start
```

- 처음 한 번만 `npm install`을 실행합니다. Electron 실행 파일이 함께 내려받아집니다.
- 이후에는 `npm start`만 실행하면 앱 창이 뜹니다.
- 화면(`ui/` 폴더)을 고친 뒤에는 앱에서 `Ctrl+R`로 새로고침하면 됩니다.
- `main.js`, `preload.js`, `src/` 아래를 고친 뒤에는 앱을 닫고 `npm start`를 다시 실행합니다.

`npm install` 뒤에 `npm start`가 “Electron failed to install correctly” 오류를 내면 아래를 한 번 실행합니다.

```powershell
node node_modules/electron/install.js
```

## 처음 사용하는 순서

1. **PHP 버전** → “PHP 추가”에서 `php.exe`를 고릅니다. (버전은 자동 인식)
2. **전역 설정** → VSCode `Code.exe` 경로를 등록하고 저장합니다.
3. **전역 설정** → GitHub 액세스 토큰을 붙여넣고 저장합니다. 계정과 만료일은 자동으로 채워집니다.
   - 필요 권한: 대상 저장소의 Contents 읽기·쓰기
4. **프로젝트** → “프로젝트 추가”에서 로컬 폴더, 이름, PHP 버전을 등록합니다.
5. 행의 “서버 시작”, “소스 열기”, “Git 배포 관리”를 사용합니다.

## 테스트

```powershell
npm test
```

- `test/git.test.js`: 임시 저장소로 내려받기·올리기 흐름을 확인합니다. (GitHub 연결 불필요)
- `test/server.test.js`: 실제 `php -S`를 띄워 응답·로그·중지를 확인합니다. 기본 PHP 경로는 `C:\php\current\php.exe`이며, 다른 경로는 `PHP_EXE` 환경 변수로 지정합니다.

```powershell
$env:PHP_EXE = "D:\php\8.3.12\php.exe"; npm test
```

## 설치 파일(exe) 만들기

```powershell
cd <프로젝트 폴더>
npm install
npm run dist
```

- 결과물: `dist\PHP-Live-Setup-0.1.0.exe` (약 120MB, Windows x64 설치 프로그램). 이 파일 하나를 디자이너에게 전달하면 됩니다.
- 처음 빌드할 때는 Electron과 NSIS 도구를 내려받느라 몇 분 걸립니다. 이후에는 빠릅니다.
- 설치 프로그램은 설치 폴더를 고를 수 있고, 현재 사용자 계정에만 설치됩니다(관리자 권한 불필요). 바탕화면과 시작 메뉴에 “PHP Live” 바로가기가 생기고, 제거는 Windows “앱 및 기능”에서 합니다.
- 버전을 올릴 때는 `package.json`의 `version`을 바꾼 뒤 다시 `npm run dist`를 실행합니다. 파일 이름에도 버전이 반영됩니다.
- 빌드 설정은 `package.json`의 `build` 항목입니다. 포함할 파일은 `main.js`, `preload.js`, `src/`, `ui/`뿐이고 `test/`는 들어가지 않습니다.
- 빌드 중간 산출물은 `dist\win-unpacked\`에 만들어집니다. 설치 없이 `dist\win-unpacked\PHP Live.exe`로 바로 실행해 볼 수 있습니다.

### 디자이너 PC 준비
- 설치 파일 외에 **Git for Windows**가 필요합니다. (Git 기능 사용 시)
- PHP와 VSCode는 이미 설치된 것을 앱에서 경로로 등록해서 씁니다.
- 앱 설정은 사용자별로 `%APPDATA%\phplive\`에 저장되므로 설치 파일을 다시 설치해도 유지됩니다.

### 알려진 사항
- **서명되지 않은 설치 파일**입니다. 처음 실행할 때 Windows SmartScreen이 “알 수 없는 게시자” 경고를 띄울 수 있으며, “추가 정보 → 실행”을 누르면 진행됩니다. 경고를 없애려면 코드 서명 인증서가 필요합니다.
- 자동 업데이트가 들어간 **첫 버전은 설치 파일을 직접 전달**해서 설치해야 합니다. 그 이후 버전부터 앱이 알아서 새 버전을 받습니다.

## 새 버전 배포 (릴리즈와 자동 업데이트)

설치된 앱은 켠 뒤 5초 후와 이후 4시간마다 GitHub Releases에서 새 버전을 확인합니다. 새 버전이 있으면 백그라운드에서 받고, 사이드바에 “재시작하여 업데이트” 버튼이 나옵니다. (개발 중 `npm start`에서는 확인하지 않습니다.)

릴리즈는 **태그를 올리면 GitHub Actions가 자동으로 빌드**합니다. (`.github/workflows/release.yml`)

```powershell
# 1. package.json 의 version 을 올립니다. (예: 0.1.1)
# 2. 변경을 커밋하고 푸시합니다.
git add -A
git commit -m "v0.1.1"
git push

# 3. 같은 버전의 태그를 만들어 올립니다. (v + 버전)
git tag v0.1.1
git push origin v0.1.1
```

4. GitHub 저장소의 **Actions** 탭에서 `release`가 끝나기를 기다립니다. (몇 분 걸립니다)
5. **Releases** 탭에 **초안(Draft) 한 개**가 만들어지고, 설치 파일, `latest.yml`, `.blockmap` 3개 파일이 함께 들어 있습니다. (파일이 3개가 아니면 빌드가 실패하도록 해 두었습니다.)
6. 내용을 확인한 뒤 **“Publish release”** 를 누릅니다. **이 순간부터 사용자 앱이 새 버전을 받기 시작합니다.**

- 태그와 `package.json`의 `version`이 다르면 빌드가 실패합니다. (실수로 잘못된 버전이 나가는 것을 막기 위함)
- 빌드 전에 `npm test`가 실행되며, 실패하면 릴리즈를 만들지 않습니다.
- 초안 상태에서는 사용자에게 보이지 않으므로, 문제가 있으면 초안을 지우고 다시 태그를 올리면 됩니다.
- 이미 공개한 릴리즈에 문제가 있으면 더 높은 버전(예: 0.1.2)을 새로 내는 것이 안전합니다. 같은 버전을 덮어쓰지 마세요.
- Releases를 올릴 수 있는 GitHub 계정이 곧 모든 사용자 PC에 프로그램을 설치할 수 있는 권한입니다. 저장소 소유 계정에 **2단계 인증**을 켜고 쓰기 권한자를 최소로 유지하세요. (설치 파일이 서명되지 않아 앱이 파일의 진위를 확인할 수 없습니다)

## 구조

```
main.js        창 생성, 기능(IPC) 연결, 종료 시 서버 정리
preload.js     화면에 노출하는 기능(window.api)
src/store.js   설정 JSON 저장, 토큰 암호화 저장(Windows DPAPI)
src/server.js  php -S 실행·중지, 포트 선택, 접속 로그
src/git.js     git 상태·pull·commit+push (main/origin 전용)
src/github.js  토큰 검증, 만료일 조회
.github/       태그를 올리면 설치 파일을 빌드하는 워크플로
ui/            화면 (HTML/CSS/JS, 폰트 포함)
test/          자동 테스트
dist/          설치 파일 빌드 결과 (git 제외)
```

## 저장 위치

설정과 토큰은 `%APPDATA%\phplive\` 아래에 저장됩니다.

- `config.json`: 프로젝트, PHP, 설정
- `github-token.bin`: 암호화된 토큰 (이 Windows 계정에서만 복호화 가능)

초기화하려면 앱을 닫고 이 폴더를 삭제하면 됩니다.

## 동작 규칙

- Git은 `main` 브랜치와 `origin`만 다룹니다. 다른 브랜치에 있으면 내려받기·올리기를 막습니다.
- 내려받기는 `pull --ff-only`입니다. 내 커밋과 갈라져 합칠 수 없으면 자동 병합하지 않고 안내만 합니다.
- Git 상태는 목록에서 읽지 않고, 프로젝트의 “Git 배포 관리” 화면에 들어갈 때 그 프로젝트만 확인합니다.
- 앱을 종료하면 켜 둔 PHP 서버도 함께 종료됩니다.

## 라이선스

- 이 프로젝트의 소스는 별도 라이선스를 부여하지 않는 비공개 사용 조건(`UNLICENSED`)입니다. 공개 저장소에 있어도 복제·재배포 권한은 부여되지 않습니다.
- 포함된 글꼴·아이콘 등 제3자 구성 요소의 라이선스는 `THIRD_PARTY.md`를 참고하세요.
