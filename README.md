<p align="center">
  <img src="https://em-content.zobj.net/source/apple/391/flag-south-korea_1f1f0-1f1f7.png" width="120" />
</p>

<h1 align="center">klaude</h1>

<p align="center">
  <strong>한국어로 편하게 코딩하세요. Claude는 영어로 읽고, 한국어로 답합니다.</strong>
</p>

<p align="center">
  <em>Type Korean. Claude reads English. Replies in Korean. Zero cognitive overhead.</em>
</p>

<p align="center">
  <a href="README.md"><strong>한국어</strong></a> ·
  <a href="README.en.md">English</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@leviosa-ai/klaude"><img src="https://img.shields.io/npm/v/@leviosa-ai/klaude.svg?color=red" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/@leviosa-ai/klaude"><img src="https://img.shields.io/npm/dm/@leviosa-ai/klaude.svg" alt="npm downloads"></a>
  <a href="https://github.com/Leviosa-AI/klaude/actions/workflows/ci.yml"><img src="https://github.com/Leviosa-AI/klaude/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License"></a>
  <img src="https://img.shields.io/badge/node-%E2%89%A520-brightgreen.svg" alt="Node">
  <img src="https://img.shields.io/badge/claude--code-compatible-orange.svg" alt="Claude Code">
</p>

<p align="center">
  <a href="#before--after">Before/After</a> •
  <a href="#install">Install</a> •
  <a href="#how-it-works">How it works</a> •
  <a href="#token-discipline-rules">Token discipline</a> •
  <a href="#commands">Commands</a>
</p>

---

Claude는 영어로 생각할 때 가장 정확합니다. 그런데 한국 개발자는 한국어로 생각하죠.
어색한 영어 프롬프트를 짜느라 정작 문제에 쏟을 정신력이 낭비되고, 그렇다고 한국어로만 쓰자니
한국어에 맞지 않는 토크나이저가 토큰을 더 잡아먹고 결과물까지 나빠집니다.

**klaude는 그 사이에 끼어듭니다.** 한국어로 편하게 입력하면, Enter를 누르는 순간 klaude가
영어로 번역해 Claude Code에 전달하고, Claude는 영어로 추론한 뒤 한국어로 답합니다. TUI는
그대로이고, 번역 지연은 프롬프트당 한 번뿐이며, 답변 품질은 직접 완벽한 영어로 쓴 것과
똑같습니다.

> 🐕 **도그푸딩:** klaude 자체도 klaude로 만들었습니다 — 한국어로 개발하고, 영어로
> 추론하면서요.

## Before / After

<table>
<tr>
<td width="50%">

### 🤔 Raw Claude Code

```
> Make a React component that fetches
  user data from /api/users and shows
  it in a table with pagination
```

- 영어 작문에 정신력을 소모합니다
- "fetches"? "retrieves"? 매번 망설이게 됩니다
- 비효율적인 표현이 토큰을 더 먹습니다
- 답변도 영어라서 머릿속에서 다시 번역해야 합니다

</td>
<td width="50%">

### 🇰🇷 klaude

```
> /api/users 에서 유저 데이터 받아와서
  페이지네이션 있는 테이블로 보여주는
  React 컴포넌트 만들어줘
```

- 한국어를 생각나는 대로 입력합니다
- `@path`, `/command`, 코드는 그대로 보존됩니다
- Enter를 누르면 영어로 번역되어 전송됩니다
- Claude가 **한국어로 답합니다**

</td>
</tr>
</table>

```
┌──────────────────────────────────────────────┐
│  TUI 그대로            ████████████  100%    │
│  코드/경로/명령 보존    ████████████  100%    │
│  추론 품질             ████████████  영어급   │
│  뇌 부담               ░░░░░░░░░░░░  거의 0  │
└──────────────────────────────────────────────┘
```

## 지원 플랫폼

| 플랫폼 | 상태 |
|--------|------|
| **macOS** | ✅ 검증됨, 주 개발 환경 |
| Linux | ⚠️ 실험적 — 종단 검증 미완료 |
| Windows | ⚠️ 실험적 — 설치 경로는 문서화됐지만 TUI 상호작용 미검증 |

klaude는 `node-pty`와 `@xterm/headless` 위에서 동작합니다. 두 라이브러리는 원리상 세 플랫폼을
모두 지원하지만, 화면 미러 휴리스틱(autocomplete popup 감지, 모달 prompt 감지, divider 파싱)은
macOS의 Claude Code TUI 기준으로만 검증되었습니다. Linux/Windows 사용자께서는
`KLAUDE_DUMP_POPUP=1`로 화면 덤프를 떠서 이슈로 올려 주시면 감사하겠습니다.

## Install

```bash
npm install -g @leviosa-ai/klaude
```

npm 패키지는 Leviosa AI org 스코프로 게시되지만, 설치되는 실행 파일 이름은 그대로 `klaude`입니다.
평소 `claude`를 실행하던 자리에서 `klaude`로 실행하시면 됩니다:

```bash
klaude                  # Claude Code 그대로 실행, 인터셉트 활성
klaude --resume         # 이전 세션 재개 (claude 플래그는 그대로 전달됨)
klaude --help
```

klaude가 자기 서브커맨드(`config`, `glossary`, `install-rules`, `uninstall-rules`, `--version`,
`--help`)로 인식하지 않는 플래그는 모두 `claude`로 그대로 전달됩니다 — 따라서 `--resume` /
`--continue`, `-p "<프롬프트>"`, 모델 선택 플래그 등이 번역 레이어와 함께 정상 동작합니다.

> **첫 실행:** 처음 실행하면 토큰 절약 규칙 4개를 글로벌 `~/.claude/CLAUDE.md`에 추가할지
> 물어봅니다. 기본값은 No이고, 거부해도 klaude는 문제없이 동작합니다. ([자세히](#token-discipline-rules))

### 빌드 도구 사전 요구사항

klaude는 **네이티브 모듈**인 `node-pty`에 의존합니다. 일반 플랫폼용 prebuilt 바이너리를
제공하지만, `npm install` 도중 `node-gyp`가 실행되며 소스 빌드로 넘어가는 경우 아래 빌드
도구를 먼저 설치해 주세요:

| 플랫폼 | 명령 |
|--------|------|
| macOS | `xcode-select --install` |
| Debian / Ubuntu | `sudo apt-get install -y python3 make g++` |
| Fedora / RHEL | `sudo dnf install -y python3 make gcc-c++` |
| Windows | [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) + Python 3 설치 |

`@xterm/headless`는 순수 JavaScript라 별도 빌드 도구가 필요 없습니다.

## How it works

```
사용자 키보드 ──→ node-pty ──→ claude (표준 UI 그대로)
claude 출력 ←─── node-pty ────────┘
                  │
                  ↓
            xterm-headless (screen mirror)
                  │
   Enter 감지 → 입력칸 추출 → 토큰 보호 → Haiku / Ollama
                                              │
              입력칸 비우기 → 영문 번역 paste → Enter ←
```

핵심:

- **TUI를 건드리지 않습니다.** Claude Code 화면은 upstream 그대로입니다.
- **키스트로크 패스스루.** `@` 멘션, `/` 슬래시 명령, 자동완성이 전부 네이티브로 동작합니다.
- **Enter 시점에만 개입합니다.** `xterm-headless`로 입력박스의 *실제 렌더링된* 텍스트를 읽습니다
  (Tab으로 확장된 `@path`까지 정확히 캡처합니다).
- **선택적 번역.** 한국어 부분만 영어로 바꾸고, 영어/코드/경로/URL은 placeholder로 보호한 뒤
  복원합니다.
- **한국어 응답.** 번역문 끝에 `Respond in Korean.`을 조용히 덧붙입니다.
- **플래그 전달.** klaude가 자기 것이 아닌 플래그(`--resume`, `--continue`, `-p`, 모델 선택)는
  실제 `claude` 프로세스로 그대로 넘깁니다.
- **bash 모드 존중.** `!`로 시작하는 입력은 Claude Code 셸 명령으로 실행되며 번역하지 않습니다
  ([Smart pass-through](#smart-pass-through) 참고).
- **Ctrl+Enter로 원문 제출.** 번역을 건너뛰고 한국어를 그대로 보내고 싶을 때는 `Ctrl+Enter`를
  누르면 됩니다 ([원문 그대로 보내기](#원문-그대로-보내기-ctrlenter) 참고).

## Token preservation

Enter 시점에 아래 항목들은 **절대 번역하지 않고** 원본 그대로 보존됩니다:

| 보호 대상 | 예시 |
|---|---|
| Fenced code blocks | <code>```python ... ```</code> |
| Inline code | `` `useState()` `` |
| URLs | `https://example.com` |
| File mentions | `@src/index.ts` |
| Slash commands | `/review`, `/plan` |
| English identifiers | `React`, `useState`, `npm`, `Docker` |
| Korean transliterations of tech terms | `리액트` → `React`, `타입스크립트` → `TypeScript` |

번역 엔진(Haiku/Ollama)에는 `{K0}`, `{K1}` 같은 placeholder만 전달되고, 복원은 클라이언트가
처리합니다 — 그래서 작은 모델(gemma3:4b)을 써도 코드가 안전합니다.

## Smart pass-through

klaude는 **사용자가 입력한 것**만 번역합니다. Claude Code의 confirmation 메뉴, 자동완성 popup,
모달 다이얼로그, 이미지 첨부 등에서는 Enter가 그대로 통과해서 네이티브 UX가 그대로 유지됩니다.

| 상황 | 감지 방법 | 동작 |
|---|---|---|
| 자동완성 popup 열림 (`@`, `/`) | prompt 아래 popup item row 2개 이상 매칭 | 패스스루 (popup 선택) |
| 인터랙티브 form widget | 화면에 `✓ Submit` 헤더 표시 | 패스스루 (widget 이 Enter 를 자체 navigation/toggle 용으로 점유) |
| 입력에 한국어 없음 | 추출 텍스트에 CJK 문자 없음 | 즉시 패스스루 (render-delay 없음) |
| Confirmation 메뉴 (`1. Yes` …) | prompt 내용이 `1. Yes` 로 시작 | 패스스루 (CR 이 메뉴 항목 선택) |
| 이미지 / 붙여넣은 텍스트 첨부 | `[Image #N]` / `[Pasted text #N]` 마커 존재 | 패스스루 (지우고 재타이핑하면 첨부 객체가 사라짐) |
| 모달 다이얼로그 (picker 등) | prompt 가 박스 안에 렌더 (`│ ❯ …`) | 패스스루 (모달 에디터는 우리 retype 을 안 받음) |
| Bash 모드 (`!명령`) | 입력 첫 글자가 `!` — Claude Code 가 `❯` 마커를 `!` 로 교체 | 패스스루 (Claude Code 가 셸 명령으로 실행 — 번역 안 함) |

`1. Yes` 앵커는 Claude Code 컴파일 바이너리에서 추출한 모든 confirmation/permission 메뉴를
포괄합니다 — 옵션 1의 8가지 변형(`Yes`, `Yes, auto-accept edits`, `Yes, manually approve edits`,
`Yes, and don't ask again for ...`, `Yes, and allow Claude to edit its own settings ...`,
`Yes, and bypass permissions`, `Yes, and use auto mode`, `Yes, run it`)이 모두 literal `Yes`로
시작하기 때문입니다. Picker 다이얼로그(ModelPicker / ThemePicker / settings)는
`borderStyle: "single"`을 써서 boxed-prompt 분기에서 걸러집니다. Claude Code TUI는 현재 영어
전용이라 이 앵커들은 안정적입니다.

**Bash 모드**도 같은 방식으로 처리됩니다. 입력박스 첫 글자가 `!`이면 Claude Code가 bash
모드로 전환되며 `❯` 프롬프트 마커를 `!`로 바꿉니다. klaude는 이렇게 바뀐 마커(그리고
fallback으로 추출 텍스트의 `!` 접두사)를 감지해 Enter를 그대로 통과시킵니다 — 그래서
`!git pull` 같은 셸 명령은 한국어가 섞여 있어도(`!echo 안녕`) raw Claude Code와 똑같이
실행됩니다.

## 원문 그대로 보내기 (Ctrl+Enter)

번역이 어색하거나, 한국어를 일부러 그대로 Claude에게 보여주고 싶을 때가 있습니다. 그럴 때는
일반 `Enter` 대신 **`Ctrl+Enter`**를 누르면 됩니다 — klaude가 번역을 건너뛰고 입력한 한국어를
**원문 그대로** 제출합니다 (끝에 `Respond in Korean.`도 붙이지 않습니다).

```
일반 Enter:   이 변수 이름 그대로 둬   →   Keep this variable name as-is   (번역됨)
Ctrl+Enter:   이 변수 이름 그대로 둬   →   이 변수 이름 그대로 둬           (원문 그대로)
```

터미널은 `Ctrl+Enter`를 일반 Enter(`\r`)가 아니라 고유한 escape 시퀀스(`\x1b[27;5;13~`
또는 Kitty 프로토콜의 `\x1b[13;5u`)로 보냅니다. 덕분에 klaude가 일반 Enter·Shift+Enter와
충돌 없이 명확하게 구분해 처리할 수 있습니다. 참고로 `Cmd+Enter`·`fn+Enter`는 터미널이
앱으로 전달하지 않거나 일반 Enter와 동일한 바이트라 트리거로 쓸 수 없어, `Ctrl+Enter`를
선택했습니다.

## Privacy

**klaude는 Enter를 누를 때마다 입력 프롬프트를 번역 백엔드로 전송합니다.**

- **Haiku 백엔드**(기본): 프롬프트가 Anthropic API로 TLS를 통해 전송됩니다. Anthropic의 데이터
  처리 정책이 적용됩니다.
- **Ollama 백엔드**: 프롬프트가 로컬 Ollama 호스트(기본 `localhost:11434`)로 전송됩니다. 기기
  밖으로 나가지 않습니다.

klaude는 그 외 어떤 것도 전송하지 않습니다 — 파일 내용, 환경 변수(Haiku 인증용
`ANTHROPIC_API_KEY` 제외), 입력박스 바깥의 텍스트는 모두 해당하지 않습니다. 디스크에 남기는
유일한 산출물은 선택적 디버그 로그 `~/.klaude/debug.log`뿐입니다(`debug: true`일 때만 생성되고,
10MB에서 `debug.log.old`로 회전합니다 — `klaude config set debug false`로 끌 수 있습니다).

Enter를 누르기 전에 시크릿/PII/기밀 코드가 프롬프트에 들어 있지 않은지 확인해 주세요. 한번
전송되고 나면 klaude로는 되돌릴 수 없습니다. 완전히 로컬에서만 운용하려면 Ollama 백엔드를
사용하세요.

## Backends

| Backend | Cost | Latency | Setup |
|---|---|---|---|
| **Haiku** (default) | ~$0.25 / $1.25 per MTok | API round-trip (~수백 ms) | `ANTHROPIC_API_KEY` 필요 |
| **Ollama** (local) | Free, offline | 로컬 GPU/CPU 의존 | `ollama serve` + `ollama pull gemma3:4b` |

```bash
klaude config set backend haiku                  # 기본
klaude config set backend ollama:gemma3:4b       # 로컬
klaude config set backend ollama:qwen2.5:7b      # 다른 모델
```

환경 변수로 한 번만 오버라이드할 수도 있습니다:

```bash
KLAUDE_BACKEND=ollama:gemma3:4b klaude
```

## Glossary

프로젝트별 고유명사를 등록해 두면 일관되게 번역됩니다. 사용자 사전이 빌트인 jargon 목록보다
우선합니다.

```bash
klaude glossary add 베가베리 Vegavery
klaude glossary add 옴니버스 Omniverse
klaude glossary list
klaude glossary remove 베가베리
```

## 토큰 경제학

klaude의 토큰 절감은 두 단계로 작동합니다 — 매 프롬프트마다 고정적으로 발생하는 번역 단계의
절감, 그리고 opt-in으로 켜는 훨씬 더 큰 tool-result 단계의 절감입니다.

### 1. 한국어 → 영어 변환 (프롬프트 자체 ~50% 축소)

한국어는 같은 의미의 영어 대비 **약 2배의 토큰**을 사용합니다. OpenAI의 `cl100k_base`
토크나이저로 측정한 값으로, Claude의 BPE와 절대 수치는 조금 다르지만 한·영 **상대 비율**은
최신 subword 토크나이저들 사이에서 거의 일정합니다:

| 샘플 프롬프트 (의미 기준) | KO 토큰 | EN 토큰 | KO/EN |
|---|---:|---:|---:|
| "리액트 컴포넌트 만들어줘" | 17 | 4 | 4.25× |
| "이 useState 훅이 왜 작동을 안 하지? 콘솔에 undefined 가…" | 45 | 19 | 2.37× |
| "`/api/users` 에서 받아와서 페이지네이션 테이블로 (TypeScript)" | 47 | 25 | 1.88× |
| "docker-compose 로 Postgres + Redis, `.env` 에서 env 읽도록" | 55 | 20 | 2.75× |
| "비동기 처리 좀 봐줘 — race condition 같음" | 34 | 23 | 1.48× |
| "`handleKeyInput` 리팩터링, fast path 들 한 곳으로" | 42 | 28 | 1.50× |
| **합계 (6 프롬프트, 338/567 자)** | **240** | **119** | **2.02×** |

프롬프트 자체는 매 턴 약 50% 줄어듭니다. 세션 전체 비용에 미치는 영향은 컨텍스트 구성 비율
(시스템 프롬프트 / 툴 결과 / 사용자 입력)에 따라 달라집니다. 사용자 입력의 비중이 크지는
않지만, **캐시된 대화 컨텍스트에 남아 이후 모든 턴까지 따라다니기 때문에** 긴 세션에서는 절감이
누적됩니다. 현실적인 효과는 세션 총비용의 낮은 한 자릿수 %에서 10% 정도이며, 품질 손실은
없습니다.

Anthropic의 model card는 Claude가 영어 위주 코퍼스로 학습되었다고 밝히고 있어서, 영어
프롬프트가 벤치마크에서 더 좋은 점수를 받는 경향이 있습니다. klaude를 쓰면 한국어로 사고하면서도
모델에는 영어로 전달할 수 있습니다.

### 2. Tool 결과 토큰 낭비 (더 큰 레버)

Claude Code 세션의 토큰 사용량은 **사용자 프롬프트가 아니라 툴 결과**가 압도적으로
차지합니다. 2,000줄짜리 `Read` 한 번이 사람 턴 수십 번 분량입니다. 진짜 절감은 여기서 나오며,
아래 opt-in 규칙들이 바로 이 부분을 겨냥합니다.

## Token discipline rules

Claude Code에서 토큰 낭비는 대부분 **입력 측**(누적된 툴 결과, 파일 전체 읽기, 덤프된 로그)에서
발생합니다. caveman 같은 출력 압축 기법은 전체 비용의 5~15%만 건드립니다. 진짜 효과는 입력을
줄이는 데서 나옵니다.

klaude는 첫 실행 시 아래 짧은 규칙 4개를 글로벌 `~/.claude/CLAUDE.md`에 추가할지 제안합니다:

| Rule | What it does |
|---|---|
| **Grep first, Read narrow** | `Grep`(ripgrep)으로 위치 찾고 `Read`는 `offset`/`limit`으로 좁게 |
| **Trim large output** | 빌드/테스트/서버 로그는 `head`/`tail`/`rg`로 잘라서만 컨텍스트 투입 |
| **Delegate exploration** | 광범위 다중 파일 탐색은 `Agent` (Explore) 서브에이전트에 위임 |
| **Diff before re-read** | 이미 읽은 파일은 `git diff <file>`로 변경 확인 후 의심 시에만 재읽기 |

**안전장치:**
- 기본값은 **No**이고, 첫 실행 때 한 번만 물어봅니다(`~/.klaude/rules-prompted` 플래그로 추적).
- non-TTY 환경(CI, 파이프 입력)에서는 자동으로 건너뜁니다.
- 블록은 `<!-- klaude:token-rules:start -->` / `<!-- klaude:token-rules:end -->` 마커로 감쌉니다.
- 재설치는 idempotent하고, 제거 시 나머지 CLAUDE.md 내용은 보존됩니다.

**수동 제어:**

```bash
klaude install-rules     # 마커 블록 추가 (idempotent)
klaude uninstall-rules   # 마커 블록만 제거
```

## Commands

```bash
klaude                              # Claude Code 실행 (인터셉트 ON)
klaude --version
klaude --help

# 패스스루 — klaude 자기 것이 아닌 플래그는 claude 로 그대로 전달
klaude --resume                     # 이전 세션 재개
klaude --continue                   # 가장 최근 세션 이어가기
klaude -p "빌드 에러 고쳐줘"          # 헤드리스 / print 모드

# 설정
klaude config get
klaude config set backend haiku
klaude config set backend ollama:gemma3:4b
klaude config set sourceLang ko
klaude config set debug true        # → ~/.klaude/debug.log

# 사용자 사전
klaude glossary list
klaude glossary add 베가베리 Vegavery
klaude glossary remove 베가베리

# 토큰 절약 규칙
klaude install-rules
klaude uninstall-rules
```

## Architecture

| Module | Responsibility |
|---|---|
| `src/index.ts` | CLI 진입점, 서브커맨드 디스패치, 라이프사이클 |
| `src/pty.ts` | `claude` 프로세스를 PTY로 spawn, 양방향 I/O |
| `src/mirror.ts` | `xterm-headless` 화면 미러 — 입력박스 렌더링 상태 추출 |
| `src/intercept.ts` | Enter 감지, 입력 추출, clear+replay 흐름 |
| `src/tokenize.ts` | `@path`, `/cmd`, code, URL placeholder 보호/복원 |
| `src/translate.ts` | Haiku / Ollama 번역 백엔드 |
| `src/config.ts` | `~/.klaude/config.json` 로드/저장 |
| `src/firstRun.ts` | 첫 실행 프롬프트, 토큰 절약 규칙 install/uninstall |
| `src/log.ts` | 디버그 로거 (`~/.klaude/debug.log`) |

## Configuration files

| Path | Purpose |
|---|---|
| `~/.klaude/config.json` | 백엔드, 언어, 글로서리, 디버그 플래그 |
| `~/.klaude/rules-prompted` | 첫 실행 프롬프트 표시 여부 flag |
| `~/.klaude/debug.log` | `debug=true` 시 상세 로그 |
| `~/.claude/CLAUDE.md` | (옵션) 토큰 절약 규칙 주입 대상 |

## Environment

| Var | Effect |
|---|---|
| `ANTHROPIC_API_KEY` | Haiku 백엔드 사용 시 필수 |
| `KLAUDE_BACKEND` | `haiku` 또는 `ollama:<model>` — 설정 파일보다 우선 |
| `OLLAMA_HOST` | 기본 `http://localhost:11434` |

## Development

```bash
git clone https://github.com/<your-fork>/klaude
cd klaude
npm install
npm run dev          # tsx src/index.ts
npm run build        # tsc → dist/
node dist/index.js   # 빌드 산출물 실행
```

실제 `~/.claude/CLAUDE.md`를 건드리지 않고 설치/제거 흐름을 테스트하려면:

```bash
TMPHOME=$(mktemp -d)
HOME="$TMPHOME" node dist/index.js install-rules
cat "$TMPHOME/.claude/CLAUDE.md"
HOME="$TMPHOME" node dist/index.js uninstall-rules
rm -rf "$TMPHOME"
```

## Status

✅ **동작합니다.** PTY 인터셉트, 한국어→영어 번역, 토큰 보호, Haiku/Ollama 백엔드, 글로서리,
토큰 절약 규칙 install/uninstall이 모두 동작합니다.

🚧 추가 예정: 더 다양한 백엔드(Bedrock, Vertex), 번역 결과를 보내기 전에 확인하는 UI 옵션,
잘못된 번역을 학습하는 피드백 루프.

## License

MIT — see [LICENSE](LICENSE).

Author: **Max Kim (Dindb-dong)**
