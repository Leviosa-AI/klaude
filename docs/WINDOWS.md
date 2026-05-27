# Windows 설치 및 실행 가이드

klaude는 macOS / Linux 환경을 기준으로 개발되었습니다. Windows에서 동작시키려면 아래의 사전 준비와 코드상의 제약을 함께 해결해야 합니다.

---

## 1. 사전 요구 사항

| 항목 | 권장 버전 / 비고 |
|---|---|
| Windows | 10 1809 이상 또는 Windows 11 (ConPTY 지원 필수) |
| Node.js | 20.x LTS 이상 (`node --version`) |
| Python | 3.x (node-pty 빌드용) |
| Visual Studio Build Tools | 2022, "Desktop development with C++" 워크로드 |
| Git for Windows | 권장 (Git Bash, OpenSSH 동봉) |
| Claude Code CLI | `npm i -g @anthropic-ai/claude-code` |

PowerShell(관리자 권한)에서 일괄 설치하려면:

```powershell
winget install OpenJS.NodeJS.LTS
winget install Python.Python.3.12
winget install Microsoft.VisualStudio.2022.BuildTools --override "--add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
winget install Git.Git
npm install -g @anthropic-ai/claude-code
```

설치 후 새 터미널을 열어 `node -v`, `python --version`, `claude --version`이 모두 출력되는지 확인합니다.

---

## 2. 프로젝트 빌드

```powershell
git clone <repo-url> klaude
cd klaude
npm install
npm run build
```

`npm install` 단계에서 `node-pty`가 네이티브 컴파일됩니다. 실패하면 다음을 확인합니다.

- Build Tools의 C++ 워크로드 설치 여부
- `npm config get msvs_version`이 비어 있다면 `npm config set msvs_version 2022` 설정
- 그래도 실패할 경우 PowerShell에서 `npm rebuild node-pty --verbose` 로그 확인

---

## 3. 코드상의 알려진 제약 (현재 main 기준)

### 3-1. `src/pty.ts`의 `claude` 바이너리 탐지

`resolveClaudePath()`는 플랫폼별로 분기됩니다.

- **Windows**: `where.exe claude` → 실패 시 `%APPDATA%\npm\node_modules\@anthropic-ai\claude-code\cli.js` 와 `%APPDATA%\npm\claude.cmd`를 차례로 탐색합니다. `.cmd` 셰임이 잡혀도 동일 디렉터리의 `cli.js`가 있으면 우선 선택합니다(셸 래핑으로 인한 신호 손실 회피).
- **POSIX**: `/bin/sh -lc 'command -v claude'` → 실패 시 `~/.claude/local/claude`를 탐색합니다.

자동 탐색이 실패하거나 비표준 경로에 설치된 경우 `KLAUDE_CLAUDE_BIN` 환경 변수로 직접 지정합니다.

```powershell
# PowerShell에서 실제 경로 확인
(Get-Command claude).Source
# 예: C:\Users\<user>\AppData\Roaming\npm\claude.cmd

[Environment]::SetEnvironmentVariable(
  "KLAUDE_CLAUDE_BIN",
  "C:\Users\<user>\AppData\Roaming\npm\node_modules\@anthropic-ai\claude-code\cli.js",
  "User"
)
```

`KLAUDE_CLAUDE_BIN`이 `.js`로 끝나면 자동으로 `node.exe`(POSIX는 `node`)를 통해 실행됩니다.

### 3-2. 셸 종속성

`KLAUDE` 외 다른 셸 명령(`which`, `command -v`, `ls` 등)이 추가될 경우 Windows에서 실패할 수 있습니다. 새로운 셸 호출을 도입할 때는 `process.platform === "win32"` 분기를 함께 추가해야 합니다.

### 3-3. 줄바꿈 / 키 입력

- Windows 콘솔의 Enter는 `\r\n` 시퀀스로 들어오지만 PTY 모드에서는 `\r`만 처리되어야 합니다. `src/intercept.ts`의 Enter 감지는 `\r` 기준이므로 일반적으로 문제가 없으나, 외부 자동화 도구가 입력을 보낼 때는 주의가 필요합니다.
- Ctrl+U(라인 클리어) 재생 흐름은 ConPTY에서 정상 동작합니다. Windows Terminal 사용을 권장합니다.

### 3-4. 설정 파일 경로

`src/config.ts`는 `~/.klaude/config.json`을 사용합니다. Windows에서 `~`는 `os.homedir()`을 통해 `C:\Users\<user>`로 해석되므로 별도 작업이 필요 없습니다. 단, OneDrive로 동기화되는 홈 디렉터리를 사용한다면 동시 쓰기 충돌에 유의합니다.

---

## 4. 실행

```powershell
# 개발 모드
npm run dev -- <args>

# 빌드 후 전역 실행
npm link
klaude
```

`KLAUDE_CLAUDE_BIN`이 설정되어 있지 않으면 시작 즉시 다음 에러로 종료됩니다.

```
klaude: could not locate 'claude' binary on PATH. Set KLAUDE_CLAUDE_BIN to its absolute path.
```

---

## 5. 대안: WSL2 사용 (권장)

네이티브 Windows 빌드가 번거롭다면 WSL2(Ubuntu 22.04)에서 그대로 실행하는 것이 가장 단순합니다. node-pty는 리눅스 빌드를 사용하고, `/bin/sh` 탐지도 정상 동작합니다.

```bash
# WSL Ubuntu 내부
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs build-essential python3
npm i -g @anthropic-ai/claude-code
git clone <repo-url> ~/klaude && cd ~/klaude
npm install && npm run build
npm run dev
```

Windows Terminal에서 WSL 프로파일로 접속하면 IME/한글 입력도 그대로 동작합니다.

---

## 6. 동작 확인 체크리스트

- [ ] `claude` 단독 실행 시 정상 TUI가 뜨는가
- [ ] `echo $env:KLAUDE_CLAUDE_BIN` (PowerShell)이 유효한 경로를 출력하는가
- [ ] `npm run dev`로 띄운 klaude가 한글 입력 후 Enter 시 영어로 치환되는가
- [ ] `@` 멘션 Tab 자동완성이 보존되는가
- [ ] 종료(Ctrl+C, `/exit`) 시 PTY 자식 프로세스가 좀비로 남지 않는가 (`Get-Process claude`)

---

## 7. 알려진 미해결 이슈 / TODO

- ConPTY는 일부 ANSI 시퀀스를 재해석하므로 `xterm-headless` 미러 상태가 macOS와 100% 동일하지 않을 수 있습니다. 입력 박스 추출 로직(`src/mirror.ts`)에 Windows 회귀 테스트가 필요합니다.
- `node-pty` 1.2 beta는 ARM64 Windows 프리빌트 바이너리를 제공하지 않습니다. Snapdragon X 등에서는 소스 빌드가 필수입니다.
- `where.exe`가 PATH상 `claude.ps1`을 먼저 잡는 환경에서는 `.ps1` 실행이 실패할 수 있습니다. 그 경우 `KLAUDE_CLAUDE_BIN`으로 `cli.js`를 직접 지정합니다.
