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
  <a href="README.md">English</a> ·
  <a href="README.ko.md"><strong>한국어</strong></a>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License"></a>
  <img src="https://img.shields.io/badge/node-%E2%89%A520-brightgreen.svg" alt="Node">
  <img src="https://img.shields.io/badge/claude--code-compatible-orange.svg" alt="Claude Code">
  <img src="https://img.shields.io/badge/status-working-success.svg" alt="Status">
</p>

<p align="center">
  <a href="#before--after">Before/After</a> •
  <a href="#install">Install</a> •
  <a href="#how-it-works">How it works</a> •
  <a href="#token-discipline-rules">Token discipline</a> •
  <a href="#commands">Commands</a>
</p>

---

Claude는 영어로 생각할 때 가장 정확하다. 그런데 한국 개발자는 한국어로 생각한다.
어색한 영어 프롬프트 짜느라 우리의 시간이 낭비되고, 그렇다고 자국어만 쓰자니 비영어 토큰 더 먹고 결과는 더 나쁘다.

**klaude는 그 사이에 끼어든다.** 한국어로 타이핑하면, Enter 누르는 순간 영어로 번역해서
Claude Code에 흘려보내고, Claude는 영어로 추론하다가 한국어로 답한다. TUI는 그대로,
지연은 한 번뿐, 품질 손실 없음.

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

- 영어 작문에 정신력 소모
- "fetches"? "retrieves"? 망설임
- 토큰 더 먹는 비효율적 표현
- 답변도 영어 → 다시 머리로 번역

</td>
<td width="50%">

### 🇰🇷 klaude

```
> /api/users 에서 유저 데이터 받아와서
  페이지네이션 있는 테이블로 보여주는
  React 컴포넌트 만들어줘
```

- 한국어 그대로 타이핑
- `@path`, `/command`, 코드는 그대로 보존
- Enter 누르면 영어로 자동 번역 전송
- Claude는 **한국어로 답함**

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

## Install

```bash
npm install -g klaude
```

설치 후 `claude` 대신 `klaude`로 실행:

```bash
klaude                  # Claude Code 그대로 실행, 인터셉트 활성
klaude --help
```

> **First run:** 처음 실행하면 토큰 절약 규칙 4개를 글로벌 `~/.claude/CLAUDE.md`에
> 추가할지 묻는다. 기본값은 No, 거부해도 klaude는 정상 동작한다. ([자세히](#token-discipline-rules))

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
                  Ctrl+U → 영문 retype → Enter ←
```

핵심:

- **TUI는 손대지 않음.** Claude Code 화면은 upstream 그대로.
- **키스트로크 패스스루.** `@` 멘션, `/` 슬래시 명령, 자동완성 전부 네이티브로 동작.
- **Enter 시점에만 개입.** `xterm-headless`로 입력박스의 *실제 렌더링된* 텍스트를 읽음
  (Tab으로 확장된 `@path`까지 정확히 캡처).
- **선택적 번역.** 한국어 부분만 영어로, 영어/코드/경로/URL은 placeholder로 보호한 뒤 복원.
- **한국어 응답.** 번역 끝에 `Respond in Korean.`을 조용히 붙임.

## Token preservation

Enter 시점에 아래는 **절대 번역하지 않고** 원본 그대로 보존됨:

| 보호 대상 | 예시 |
|---|---|
| Fenced code blocks | <code>```python ... ```</code> |
| Inline code | `` `useState()` `` |
| URLs | `https://example.com` |
| File mentions | `@src/index.ts` |
| Slash commands | `/review`, `/plan` |
| English identifiers | `React`, `useState`, `npm`, `Docker` |
| Korean transliterations of tech terms | `리액트` → `React`, `타입스크립트` → `TypeScript` |

번역 엔진(Haiku/Ollama)에는 `{K0}`, `{K1}` 같은 placeholder가 전달되고, 복원은
클라이언트가 한다 — 작은 모델(gemma3:4b)도 안전.

## Smart pass-through

klaude는 **내가 입력한 것**만 번역한다. Claude Code의 confirmation 메뉴, 자동완성
popup, 모달 다이얼로그, 이미지 첨부 등은 Enter 가 그대로 통과해서 네이티브 UX
그대로 보존됨.

| 상황 | 감지 방법 | 동작 |
|---|---|---|
| 자동완성 popup 열림 (`@`, `/`) | prompt 아래 popup item row 2개 이상 매칭 | 패스스루 (popup 선택) |
| 인터랙티브 form widget | 화면에 `✓ Submit` 헤더 표시 | 패스스루 (widget 이 Enter 를 자체 navigation/toggle 용으로 점유) |
| 입력에 한국어 없음 | 추출 텍스트에 CJK 문자 없음 | 즉시 패스스루 (render-delay 없음) |
| Confirmation 메뉴 (`1. Yes` …) | prompt 내용이 `1. Yes` 로 시작 | 패스스루 (CR 이 메뉴 항목 선택) |
| 이미지 / 붙여넣은 텍스트 첨부 | `[Image #N]` / `[Pasted text #N]` 마커 존재 | 패스스루 (지우고 재타이핑하면 첨부 객체가 사라짐) |
| 모달 다이얼로그 (picker 등) | prompt 가 박스 안에 렌더 (`│ ❯ …`) | 패스스루 (모달 에디터는 우리 retype 을 안 받음) |

`1. Yes` 앵커는 Claude Code 컴파일된 바이너리에서 추출한 모든
confirmation/permission 메뉴를 커버한다 — 옵션 1 의 8 가지 변형
(`Yes`, `Yes, auto-accept edits`, `Yes, manually approve edits`,
`Yes, and don't ask again for ...`, `Yes, and allow Claude to edit its own settings ...`,
`Yes, and bypass permissions`, `Yes, and use auto mode`, `Yes, run it`)
모두 literal `Yes` 로 시작. Picker 다이얼로그 (ModelPicker / ThemePicker / settings)
는 `borderStyle: "single"` 을 써서 boxed-prompt 분기에서 catch. Claude Code TUI
는 영어 전용이라 이 앵커들은 안정적.

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

환경 변수로 일회성 오버라이드:

```bash
KLAUDE_BACKEND=ollama:gemma3:4b klaude
```

## Glossary

프로젝트별 고유명사를 등록해두면 일관되게 번역됨. 사용자 사전이 빌트인 jargon 리스트보다 우선.

```bash
klaude glossary add 베가베리 Vegavery
klaude glossary add 옴니버스 Omniverse
klaude glossary list
klaude glossary remove 베가베리
```

## 토큰 경제학

klaude 의 토큰 절감은 두 단계로 작동한다 — 매 프롬프트마다 고정적으로 발생하는
번역 단계의 절감, 그리고 opt-in 으로 활성화되는 훨씬 큰 tool-result 단계의 절감.

### 1. 한국어 → 영어 변환 (프롬프트 자체 ~50% 축소)

한국어는 동일한 의미의 영어 대비 **약 2배의 토큰** 을 사용한다. OpenAI 의
`cl100k_base` 토크나이저로 측정 — Claude 의 BPE 와 절대값은 약간 다르지만, 한·영
**상대 비율** 은 모던 subword 토크나이저 간 거의 동일:

| 샘플 프롬프트 (의미 기준) | KO 토큰 | EN 토큰 | KO/EN |
|---|---:|---:|---:|
| "리액트 컴포넌트 만들어줘" | 17 | 4 | 4.25× |
| "이 useState 훅이 왜 작동을 안 하지? 콘솔에 undefined 가…" | 45 | 19 | 2.37× |
| "`/api/users` 에서 받아와서 페이지네이션 테이블로 (TypeScript)" | 47 | 25 | 1.88× |
| "docker-compose 로 Postgres + Redis, `.env` 에서 env 읽도록" | 55 | 20 | 2.75× |
| "비동기 처리 좀 봐줘 — race condition 같음" | 34 | 23 | 1.48× |
| "`handleKeyInput` 리팩터링, fast path 들 한 곳으로" | 42 | 28 | 1.50× |
| **합계 (6 프롬프트, 338/567 자)** | **240** | **119** | **2.02×** |

프롬프트 자체는 매 턴 ~50% 줄어든다. 세션 전체 비용 영향은 컨텍스트 구성 비율
(시스템 프롬프트 / 툴 결과 / 유저 입력)에 따라 달라지는데, 유저 입력은 비중이
크진 않지만 **캐시된 대화 컨텍스트로 후속 모든 턴까지 남아있어** 긴 세션에서
누적 효과 발생. 현실적 효과: 세션 총비용의 low single digit % ~ 10% 수준, 품질
손실 없음.

Anthropic 의 model card 는 Claude 가 영어 위주 코퍼스로 학습됐다는 점을 명시 —
따라서 영어 프롬프트가 벤치마크에서 더 잘 나오는 경향이 있다. klaude 는 한국어로
사고하되 모델에는 영어로 전달.

### 2. Tool 결과 토큰 낭비 (더 큰 레버)

Claude Code 세션의 토큰 사용량은 **유저 프롬프트가 아니라 툴 결과** 가 압도적으로
차지한다. 2,000 줄 `Read` 한 번이 사람 턴 수십 번 분량. 진짜 절감은 여기서 나오며,
아래 opt-in 규칙들이 이 부분을 노린다.

## Token discipline rules

Claude Code에서 토큰 낭비는 대부분 **input 측** (tool result 누적)에서 발생함.
caveman 같은 output 압축은 전체 비용의 5~15%만 건드림. 진짜 효과는 입력 줄이기에서 나옴.

klaude는 첫 실행 시 다음 4가지 규칙을 글로벌 `~/.claude/CLAUDE.md`에 추가할지 제안:

| Rule | What it does |
|---|---|
| **Grep first, Read narrow** | `Grep`(ripgrep)으로 위치 찾고 `Read`는 `offset`/`limit`으로 좁게 |
| **Trim large output** | 빌드/테스트/서버 로그는 `head`/`tail`/`rg`로 잘라서만 컨텍스트 투입 |
| **Delegate exploration** | 광범위 다중 파일 탐색은 `Agent` (Explore) 서브에이전트에 위임 |
| **Diff before re-read** | 이미 읽은 파일은 `git diff <file>`로 변경 확인 후 의심 시에만 재읽기 |

**Safety:**
- 기본값 **No**, 첫 실행 시 한 번만 질문 (`~/.klaude/rules-prompted` flag)
- non-TTY 환경(CI, pipe)에서는 자동 스킵
- `<!-- klaude:token-rules:start -->` / `<!-- klaude:token-rules:end -->` 마커로 감싸짐
- 재설치 idempotent, 제거 시 기존 CLAUDE.md 콘텐츠 보존

**Manual control:**

```bash
klaude install-rules     # 마커 블록 추가 (idempotent)
klaude uninstall-rules   # 마커 블록만 제거
```

## Commands

```bash
klaude                              # Claude Code 실행 (인터셉트 ON)
klaude --version
klaude --help

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

설치 흐름 테스트 (실제 `~/.claude/CLAUDE.md`를 건드리지 않음):

```bash
TMPHOME=$(mktemp -d)
HOME="$TMPHOME" node dist/index.js install-rules
cat "$TMPHOME/.claude/CLAUDE.md"
HOME="$TMPHOME" node dist/index.js uninstall-rules
rm -rf "$TMPHOME"
```

## Status

✅ **Working.** PTY intercept, Korean→English 번역, 토큰 보호, Haiku/Ollama 백엔드,
글로서리, 토큰 절약 규칙 install/uninstall 모두 동작.

🚧 추가 예정: 더 다양한 백엔드 (Bedrock, Vertex), 번역 결과 confirm UI 옵션,
잘못된 번역 학습용 피드백 루프.

## License

MIT — see [LICENSE](LICENSE).

Author: **Max Kim (Dindb-dong)**
