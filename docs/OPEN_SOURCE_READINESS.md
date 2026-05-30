# Open-Source Readiness Audit

> klaude를 npm 공개 배포 전, 오픈소스 프로젝트로서 갖춰야 할 항목을 점검한 문서.
> 우선순위(Critical / High / Medium / Low)와 각 항목의 **현재 상태 → 권장 조치 → 적용 예시**를 정리했습니다.
>
> 작성일: 2026-05-27
> 대상 버전: `0.0.1`
> 검토 범위: `package.json`, `tsconfig.json`, `src/**`, `docs/**`, repo 구조 전반

---

## 우선순위 한눈에 보기

| 순위 | 카테고리 | 항목 수 | 배포 전 필수? |
|------|---------|--------|--------------|
| 🔴 Critical | 메타데이터·의존성 | 4 | ✅ 필수 |
| 🟡 High | 신뢰성·커뮤니티 | 5 | ✅ 권장 |
| 🟢 Medium | UX·보안 공지 | 5 | ⚠️ 검토 |
| 🔵 Low | 코드 품질·최적화 | 2 | 선택 |
| **합계** | | **16** | |

권장 로드맵: [§ 18 우선순위 제안](#18-우선순위-제안)

---

## 🔴 Critical — npm 배포 전 필수

### 1. `package.json` 메타데이터 누락

**현재 상태**
```json
{
  "name": "klaude",
  "version": "0.0.1",
  "description": "...",
  "bin": { "klaude": "./dist/index.js" },
  "files": ["dist", "README.md", "README.ko.md", "LICENSE"]
}
```

`repository`, `homepage`, `bugs` 필드가 없습니다. 이 필드들이 빠지면 npm 페이지에 "Repository / Homepage / Issues" 링크가 표시되지 않아 사용자가 코드/이슈 트래커로 이동할 경로를 못 찾습니다.

**권장 조치**
```json
{
  "repository": {
    "type": "git",
    "url": "git+https://github.com/Leviosa-AI/klaude.git"
  },
  "homepage": "https://github.com/Leviosa-AI/klaude#readme",
  "bugs": {
    "url": "https://github.com/Leviosa-AI/klaude/issues"
  },
  "funding": "https://github.com/sponsors/Leviosa-AI"
}
```

**검증**: `npm publish --dry-run` 출력에서 위 필드가 모두 보이는지 확인.

---

### 2. `author` 필드와 GitHub org 불일치

**현재 상태**
```json
"author": "Max Kim (Dindb-dong)"
```

repo는 `Leviosa-AI` org 소유. 회사 계정(`leviosaai2025`)으로 push한 상태와 author 표기가 어긋납니다. npm 페이지 author 링크가 잘못된 GitHub 프로필로 연결될 수 있습니다.

**권장 조치 (2가지 옵션)**

```json
// Option A: 회사 명의로 통일
"author": {
  "name": "Leviosa AI",
  "email": "260330475+leviosaai2025@users.noreply.github.com",
  "url": "https://github.com/Leviosa-AI"
},
"contributors": ["Max Kim <dongwook443@yonsei.ac.kr> (https://github.com/Dindb-dong)"]
```

```json
// Option B: 개인 명의 + org만 holder
"author": {
  "name": "Max Kim",
  "url": "https://github.com/Dindb-dong"
},
"publisher": "Leviosa AI"
```

회사 자산이면 **Option A** 권장.

---

### 3. `node-pty` 베타 버전 의존

**현재 상태**
```json
"node-pty": "^1.2.0-beta.13"
```

베타 의존은 다음 문제를 일으킵니다:

1. **prebuild binary 부재** → npm install 시 `node-gyp` rebuild 시도
2. 빌드 도구 없는 환경(`python`, MSVC Build Tools, Xcode CLI 미설치)에서 `npm install -g klaude` 실패
3. 사용자가 "왜 안 되지?"로 이슈를 쏟아내는 가장 흔한 원인

**권장 조치**

```bash
# 1. 안정 버전 확인
npm view node-pty versions --json | tail -20

# 2. 1.x 안정 버전이 있으면 다운그레이드
npm install node-pty@^1.0.0

# 3. 베타가 필수라면 README에 명시
```

`README.md` Install 섹션에 추가:
```markdown
> ⚠️ klaude depends on `node-pty` which compiles native bindings.
> If `npm install` fails, install build prerequisites:
> - macOS: `xcode-select --install`
> - Linux: `apt-get install python3 make g++`
> - Windows: `npm install -g windows-build-tools` (or install Visual Studio Build Tools)
```

---

### 4. `@anthropic-ai/sdk` 버전 노후

**현재 상태**
```json
"@anthropic-ai/sdk": "^0.32.0"
```

`0.32.0`은 2024년 초 버전. 그 사이 SDK는 다음과 같은 변경을 겪었습니다:
- prompt caching API 안정화
- streaming API 개선
- Claude 4.x 모델 추가 (Haiku 4.5 등)

`translate.ts`가 `model: "claude-haiku-4-5-20251001"`을 사용하는데 구버전 SDK가 신규 모델을 정상 처리하는지 검증 필요.

**권장 조치**

```bash
# 최신 버전 확인 + 업그레이드
npm install @anthropic-ai/sdk@latest
npm run build && npm run dev   # 동작 회귀 테스트
```

업그레이드 후 다음 검증:
- [ ] `translate.ts` 의 `messages.create()` 시그니처
- [ ] 응답 파싱 (`response.content[0].text`)
- [ ] 에러 핸들링 (AnthropicError 타입)

---

## 🟡 High — 커뮤니티 신뢰도

### 5. 테스트 0개

**현재 상태**
프로젝트 전체에 `*.test.ts` / `*.spec.ts` 파일이 없습니다. `package.json`의 `scripts.test`도 없음.

특히 다음 모듈들은 정규식과 휴리스틱 덩어리라 회귀 위험이 큽니다:

| 모듈 | 회귀 위험 |
|-----|---------|
| `tokenize.ts` | CJK 감지, placeholder 보호 (@mention, /, code, URL) |
| `mirror.ts` | popup 감지, input box 추출, divider 판별 |
| `intercept.ts` | 위젯 분기 (submit form, boxed modal, selection menu) |
| `translate.ts` | placeholder 복구, retry 로직 |

**권장 조치**

`vitest` 도입:
```bash
npm install -D vitest @vitest/coverage-v8
```

`vitest.config.ts`:
```typescript
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    environment: 'node',
    coverage: { provider: 'v8', reporter: ['text', 'html'], exclude: ['dist'] },
  },
});
```

**최소 테스트 셋 (예시 구조)**

```
src/
├── tokenize.test.ts      # needsTranslation, protectPlaceholders
├── mirror.test.ts        # extractInputBox, hasAutocompletePopup
├── translate.test.ts     # repairPlaceholders, glossary 적용
└── intercept.test.ts     # findBareCR, isSelectionMenuPrompt
```

스크립트 추가:
```json
"scripts": {
  "test": "vitest run",
  "test:watch": "vitest",
  "test:coverage": "vitest run --coverage"
}
```

---

### 6. CI/CD 부재

**현재 상태**
`.github/workflows/` 디렉토리 자체가 없음.

**권장 조치**

`.github/workflows/ci.yml`:
```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    strategy:
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
        node: [20, 22]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: ${{ matrix.node }}, cache: npm }
      - run: npm ci
      - run: npm run build
      - run: npm test
      - run: npx tsc --noEmit
```

`.github/workflows/release.yml`:
```yaml
name: Release
on:
  push:
    tags: ['v*']

jobs:
  publish:
    runs-on: ubuntu-latest
    permissions:
      id-token: write   # npm provenance
      contents: write
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          registry-url: 'https://registry.npmjs.org'
      - run: npm ci
      - run: npm run build
      - run: npm publish --provenance --access public
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

**npm provenance** (`--provenance`)는 npm 패키지가 어느 GitHub Actions 워크플로에서 빌드됐는지 암호화 서명하는 기능. 공급망 공격 방어에 효과적이고 npm 페이지에 "Provenance" 뱃지가 붙어 신뢰도 ↑.

`README.md` 상단 뱃지:
```markdown
[![CI](https://github.com/Leviosa-AI/klaude/actions/workflows/ci.yml/badge.svg)](https://github.com/Leviosa-AI/klaude/actions/workflows/ci.yml)
[![npm version](https://badge.fury.io/js/klaude.svg)](https://www.npmjs.com/package/klaude)
```

---

### 7. 린터·포매터 미설정

**현재 상태**
ESLint, Prettier, Biome 어느 것도 없음. PR 들어오면 스타일 통일 못 함.

**권장 조치: Biome**

선택 이유:
- 단일 도구 (ESLint + Prettier 통합)
- 설정 가벼움 (`biome.json` 한 파일)
- Rust 기반 → 빠름
- ESM/TypeScript 기본 지원

```bash
npm install -D --save-exact @biomejs/biome
npx biome init
```

`biome.json`:
```json
{
  "$schema": "https://biomejs.dev/schemas/2.0.0/schema.json",
  "files": { "ignore": ["dist", "node_modules"] },
  "linter": {
    "enabled": true,
    "rules": { "recommended": true }
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 90
  }
}
```

스크립트:
```json
"scripts": {
  "check": "biome check src",
  "format": "biome format --write src",
  "lint": "biome lint src"
}
```

CI에 `npm run check` 추가.

---

### 8. 기여 가이드·표준 메타파일 부재

**현재 상태**
다음 파일들이 모두 누락:
- `CONTRIBUTING.md`
- `CODE_OF_CONDUCT.md`
- `SECURITY.md`
- `CHANGELOG.md`
- `.github/ISSUE_TEMPLATE/`
- `.github/pull_request_template.md`

GitHub Insights → Community Standards 체크리스트가 거의 비어있는 상태가 됩니다.

**권장 조치 (최소 골격)**

`CONTRIBUTING.md`:
```markdown
# Contributing to klaude

Thanks for your interest!

## Development setup
\`\`\`bash
git clone https://github.com/Leviosa-AI/klaude
cd klaude
npm install
npm run dev   # tsx src/index.ts
\`\`\`

## Before submitting a PR
- [ ] `npm test` passes
- [ ] `npm run check` passes (Biome)
- [ ] `npm run build` succeeds
- [ ] Manual smoke test: type Korean in dev mode and verify translation

## Commit message format
`type: what changed` (e.g. `feat: add Bedrock backend`)
Types: feat / fix / docs / chore / refactor / test / ci

## Reporting bugs
Use the bug_report issue template. Include:
- OS + node version
- klaude version (`klaude --version`)
- Backend (`klaude config get`)
- ~/.klaude/debug.log excerpt (redact secrets!)
```

`SECURITY.md`:
```markdown
# Security Policy

## Reporting a vulnerability
Do NOT open a public issue.
Email: security@leviosa.ai (or create a private security advisory on GitHub)

## What klaude transmits
- User input from the Claude Code prompt box → translation backend
- Haiku backend: sent to Anthropic API over TLS
- Ollama backend: sent to localhost (configurable host)
- klaude does NOT log or transmit anything other than the prompt text

## Sensitive prompts
Avoid putting secrets in the Korean prompt — the translator does not
strip them. Review before pressing Enter.
```

`CHANGELOG.md` (Keep a Changelog 형식):
```markdown
# Changelog

All notable changes documented here. Format: https://keepachangelog.com/en/1.1.0/

## [Unreleased]

## [0.1.0] - 2026-XX-XX
### Added
- Initial public release
- Korean → English intercept via PTY
- Haiku and Ollama backends
- Token-discipline rules install/uninstall
- User glossary management
```

`.github/ISSUE_TEMPLATE/bug_report.yml`:
```yaml
name: Bug report
description: Report a bug
body:
  - type: input
    attributes: { label: klaude version, placeholder: "0.1.0" }
    validations: { required: true }
  - type: dropdown
    attributes:
      label: OS
      options: [macOS, Linux, Windows, WSL]
  - type: textarea
    attributes: { label: Steps to reproduce }
    validations: { required: true }
  - type: textarea
    attributes: { label: Expected vs actual behavior }
```

---

### 9. 타입 선언 미발행

**현재 상태**
```json
// tsconfig.json
"declaration": false
```

`dist/`에 `*.d.ts` 파일이 없음. 순수 CLI 도구라면 OK지만, 다음 시나리오에 제약:

- 사용자가 `import { needsTranslation } from 'klaude/tokenize'`처럼 서브 모듈 활용
- 라이브러리로서의 향후 확장 가능성

**권장 조치 (확장 계획 있을 때만)**

```json
// tsconfig.json
"declaration": true,
"declarationMap": true
```

```json
// package.json
"main": "./dist/index.js",
"types": "./dist/index.d.ts",
"exports": {
  ".": {
    "types": "./dist/index.d.ts",
    "import": "./dist/index.js"
  }
}
```

CLI 전용 유지 계획이면 현재 상태 그대로 두고 이 항목은 무시.

---

## 🟢 Medium — UX·보안 공지

### 10. Privacy/Telemetry 공지 부족

**현재 상태**
`README.md`에 다음 정보가 명시되지 않음:
- 사용자 입력이 매 Enter마다 외부 API로 전송된다는 사실
- Haiku 백엔드 사용 시 Anthropic 서버로 평문 전송
- Ollama 백엔드는 로컬 전용

**위험 시나리오**: 사용자가 회사 코드/API 키/비밀번호를 프롬프트에 입력 → klaude가 자동 번역 → Anthropic API로 전송 → 정책 위반.

**권장 조치**

`README.md`에 섹션 추가:

```markdown
## Privacy & Data Handling

**klaude transmits your prompt to a translation backend every time you press Enter.**

- **Haiku backend** (default): prompt sent to Anthropic API over TLS.
  Subject to Anthropic's [data handling policy](https://www.anthropic.com/legal/privacy).
- **Ollama backend**: prompt processed locally; nothing leaves your machine.

### What is NOT transmitted by klaude itself
- File contents (Claude Code may transmit these separately)
- Environment variables (except `ANTHROPIC_API_KEY` for auth)
- Anything outside the visible input box

### Before pressing Enter
Review your prompt for secrets, PII, and confidential code.
Once submitted, klaude has no way to recall the transmission.

### Local-only mode
\`\`\`bash
klaude config set backend ollama:gemma3:4b
ollama pull gemma3:4b
\`\`\`
```

---

### 11. 디버그 로그 위치·회전 미관리

**현재 상태**
`log.ts`가 `~/.klaude/debug.log`에 평문으로 모든 input/translated output을 기록 (`debug: true`일 때).

문제:
1. 사용자 모르게 민감 정보 평문 저장
2. 로그 파일 크기 무제한 증가 (회전 없음)
3. 자동 truncate / rotation 로직 부재

**권장 조치**

`log.ts` 수정:
```typescript
const MAX_LOG_BYTES = 10 * 1024 * 1024;  // 10MB

function rotateIfLarge() {
  try {
    const stat = statSync(LOG_PATH);
    if (stat.size > MAX_LOG_BYTES) {
      renameSync(LOG_PATH, LOG_PATH + '.old');
    }
  } catch { /* file doesn't exist yet */ }
}
```

`README.md`에 명시:
```markdown
### Debug logging
When `debug: true`, klaude writes every translation pair to
`~/.klaude/debug.log` in plaintext (rotated at 10MB).
**This file may contain sensitive prompt text.**
Disable with `klaude config set debug false`.
```

---

### 12. 에러 메시지 한국어 미지원

**현재 상태**
한국어 사용자가 주 타겟이지만 에러는 영어:
```
klaude: could not locate 'claude' binary on PATH. Set KLAUDE_CLAUDE_BIN to its absolute path.
```

**권장 조치**

간단한 i18n:
```typescript
// src/i18n.ts
const messages = {
  en: { noClaude: "klaude: could not locate 'claude'..." },
  ko: { noClaude: "klaude: PATH에서 'claude' 명령을 찾을 수 없습니다..." },
};

export function t(key: keyof typeof messages.en): string {
  const lang = process.env.KLAUDE_LANG ?? process.env.LANG?.split('.')[0]?.split('_')[0] ?? 'en';
  return messages[lang as 'en' | 'ko']?.[key] ?? messages.en[key];
}
```

또는 영어/한국어 양언어 출력:
```
klaude: could not locate 'claude' binary on PATH.
klaude: PATH에서 'claude' 명령을 찾을 수 없습니다.
Set KLAUDE_CLAUDE_BIN to its absolute path.
KLAUDE_CLAUDE_BIN 환경변수로 절대경로를 지정하세요.
```

---

### 13. `files` 필드 누락 항목

**현재 상태**
```json
"files": ["dist", "README.md", "README.ko.md", "LICENSE"]
```

다음 항목이 npm 패키지에 들어가지 않음:
- `docs/WINDOWS.md` → README.md에서 "see docs/WINDOWS.md" 링크가 npm 페이지에서 404
- 향후 `CHANGELOG.md`도 자동 포함 안 됨

**권장 조치**
```json
"files": [
  "dist",
  "docs",
  "README.md",
  "README.ko.md",
  "LICENSE",
  "CHANGELOG.md"
]
```

또는 `.npmignore`로 반전 관리 (더 위험. `files` 명시 권장).

검증:
```bash
npm pack --dry-run | grep -E "docs|CHANGELOG"
```

---

### 14. 버전 0.0.1

**현재 상태**
`"version": "0.0.1"` — npm 첫 publish 버전으로는 "내부 작업 중" 느낌.

**SemVer 관례**:
- `0.0.x` — 미공개·실험·로컬
- `0.x.0` — 공개 베타 (API 변경 자유)
- `1.0.0` — 안정 API 약속

**권장 조치**
첫 npm publish 직전 `0.1.0`으로 bump:
```bash
npm version 0.1.0 -m "release: v0.1.0 — initial public release"
```

이후 매 릴리스 `npm version patch/minor/major`로 일관성 유지.

---

## 🔵 Low — 코드 품질·최적화

### 15. 의존성 사이즈

**현재 상태**

| 의존성 | 크기 (unpacked) | 사용 위치 |
|-------|---------------|---------|
| `@anthropic-ai/sdk` | ~5 MB | `translate.ts` (Haiku 백엔드만) |
| `@xterm/headless` | ~1.5 MB | `mirror.ts` (필수) |
| `node-pty` | native, ~600 KB | `pty.ts` (필수) |

Ollama 사용자에게 `@anthropic-ai/sdk`는 dead weight.

**권장 조치 (Option 1: dynamic import)**

`translate.ts`:
```typescript
async function makeHaikuTranslator(cfg: HaikuBackend): Promise<Translator> {
  const { Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  // ...
}
```

`package.json`:
```json
"peerDependencies": {
  "@anthropic-ai/sdk": "^0.65.0"
},
"peerDependenciesMeta": {
  "@anthropic-ai/sdk": { "optional": true }
}
```

설치 안내:
```bash
# Haiku 사용자
npm install -g klaude @anthropic-ai/sdk

# Ollama 사용자 (sdk 불필요)
npm install -g klaude
```

**Option 2: 그대로 두기** — npm 글로벌 설치 5MB 추가는 큰 부담 아님. 1차 릴리스 후 사용자 피드백 보고 결정.

---

### 16. 코드 품질 디테일

#### 16a. `mirror.ts:273` POPUP_ITEM_PATTERN 한글 파일명 미검증
```typescript
const POPUP_ITEM_PATTERN =
  /^[▌▶›❯>]\s|^\/[\w:\-]+(?:\s|$)|^[\w][\w.\-]*\.[a-zA-Z]{1,6}(?:\s|$)|\/[\w.\-]+\.[a-zA-Z]{1,6}(?:\s|$)/;
```
한글 파일명 (`설계.md`, `회의록.txt`)이 `[\w]`에 매칭 안 됨. autocomplete popup에서 한글 파일을 제시할 때 detect 실패 가능.

수정안:
```typescript
const POPUP_ITEM_PATTERN =
  /^[▌▶›❯>]\s|^\/[\w:\-]+(?:\s|$)|^[\p{L}\p{N}][\p{L}\p{N}.\-_]*\.[a-zA-Z]{1,6}(?:\s|$)|\/[\p{L}\p{N}.\-_]+\.[a-zA-Z]{1,6}(?:\s|$)/u;
```

#### 16b. picker 화이트리스트 → 블랙리스트 패러다임 검토
현재 `intercept.ts`는 "translate 안 할 경우"를 하나씩 명시 (autocomplete, submit form, boxed modal, selection menu, attachment marker, no Korean). Claude Code가 새 위젯 추가하면 매번 패치 필요.

대안: **"입력박스에 사용자가 직접 타이핑 중인 텍스트가 있을 때만 intercept"** — 위젯/picker는 기본적으로 통과. 어떻게 구분? 현재 row 위에 `❯ ` 마커가 있고, 마지막 키스트로크가 printable이었다면 user input. 마지막 키스트로크가 arrow/tab/enter이고 화면에 selection 표시(`▶`, `❯ 1.` 등)가 있으면 widget.

#### 16c. `translate.ts` timeout/backoff 부재
Ollama 멈추면 무한 대기. fetch에 `AbortSignal.timeout(15000)` 추가 권장.

```typescript
const response = await fetch(`${cfg.host}/api/generate`, {
  method: 'POST',
  body: JSON.stringify({ model: cfg.model, prompt }),
  signal: AbortSignal.timeout(15000),
});
```

재시도 backoff:
```typescript
async function withRetry<T>(fn: () => Promise<T>, attempts = 2): Promise<T> {
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); }
    catch (err) {
      if (i === attempts - 1) throw err;
      await sleep(500 * Math.pow(2, i));  // 500ms, 1s
    }
  }
  throw new Error('unreachable');
}
```

#### 16d. stderr 디버그 옵션 미지원
TTY raw 모드라 `console.log`는 충돌 위험 → 파일 로거만 사용. 하지만 개발 중에는 stderr가 편함. `KLAUDE_DEBUG_STDERR=1` 옵션 추가:
```typescript
if (process.env.KLAUDE_DEBUG_STDERR === '1') {
  process.stderr.write(`[klaude] ${message}\n`);
}
```

---

## 17. npm 배포 체크리스트

배포 직전 한 번 더 훑을 항목:

```bash
# 1. 의존성 보안 감사
npm audit

# 2. 사이즈 확인
npm pack --dry-run
ls -lh klaude-*.tgz

# 3. 메타데이터 검증
npm publish --dry-run

# 4. .npmrc 토큰 확인 (CI에서 NPM_TOKEN secret 사용 권장)
cat ~/.npmrc | grep -v authToken

# 5. tag 일치
git tag v$(node -p "require('./package.json').version")
git push origin v0.1.0

# 6. provenance 활성화
npm publish --provenance --access public
```

`npm publish --access public` 명시 (scoped 패키지가 아니어도 명시적으로 public 표기 권장).

---

## 18. 우선순위 제안

### 1주차 (배포 전 minimum bar)

| # | 항목 | 예상 소요 |
|---|------|---------|
| 1 | package.json 메타데이터 추가 | 10분 |
| 2 | author 통일 | 10분 |
| 4 | @anthropic-ai/sdk 업그레이드 + 회귀 테스트 | 1시간 |
| 6 | CI workflow (ci.yml만) | 30분 |
| 8 | CONTRIBUTING + SECURITY + CHANGELOG | 1시간 |
| 10 | README Privacy 섹션 | 30분 |
| 13 | files 필드 정리 | 5분 |
| 14 | 버전 0.1.0 bump | 5분 |

**합계**: 약 4시간

### 2주차 (권장)

| # | 항목 | 예상 소요 |
|---|------|---------|
| 3 | node-pty 안정 버전 검토 + Windows 설치 매뉴얼 검증 | 2시간 |
| 5 | 핵심 모듈 테스트 (tokenize, translate, mirror) | 4시간 |
| 7 | Biome 설정 + 자동 포맷팅 | 1시간 |
| 11 | 로그 회전 | 30분 |

**합계**: 약 7-8시간

### 3주차+ (선택)

| # | 항목 |
|---|------|
| 9 | 타입 선언 발행 (라이브러리 사용 계획 시) |
| 12 | 에러 메시지 i18n |
| 15 | dynamic import로 SDK 사이즈 절감 |
| 16 | 코드 품질 디테일 4건 |

---

## 19. 검증 방법

배포 직전 다음 항목을 수동 검증:

- [ ] `npm install -g klaude` (clean 환경, Docker container 권장)
- [ ] `klaude --version` 정상 출력
- [ ] `klaude config set backend ollama:gemma3:4b` 동작
- [ ] `klaude` 실행 → claude TUI 정상 → 한글 입력 → Enter → 번역 → 응답
- [ ] `klaude install-rules` → `~/.claude/CLAUDE.md` 갱신
- [ ] `klaude uninstall-rules` → 갱신 되돌림
- [ ] 3개 OS 매트릭스 (macOS / Linux / Windows) 각각 smoke test
- [ ] `klaude --resume <session-id>` 정상 동작 (passthrough)

---

## 변경 이력

| 날짜 | 작성자 | 변경 |
|------|-------|-----|
| 2026-05-27 | Claude (audit) | 초안 작성 |
| 2026-05-30 | Claude | 1주차 항목 실행 — 적용 상태 §20 참조 |

---

## 20. 적용 상태 (2026-05-30 기준)

### ✅ 완료

- **#1 package.json 메타데이터** — `repository`, `homepage`, `bugs`, `funding` 추가
- **#2 author 통일** — `Leviosa AI` 로 변경, `Max Kim`을 `contributors`로 이동
- **#4 SDK 업그레이드** — `0.32.0 → 0.100.1`. 우리가 사용하는
  `client.messages.create({ model, max_tokens, system, messages })`와
  `res.content.find(b => b.type === "text").text` API는 0.32 이후 안정.
  **코드 변경 없이 통과** (tsc + 빌드 검증). 추가로 얻은 것: 새 모델
  alias 지원, prompt caching API 안정화, 보안 패치.
- **#5 핵심 테스트** — `vitest` 도입. 67개 단위 테스트 4개 파일:
  - `tokenize.test.ts` — CJK 감지, placeholder 보호/복원, 라인 마스킹 (19개)
  - `mirror.test.ts` — input box 추출, popup/widget/modal 감지, resize (15개)
  - `translate.test.ts` — placeholder restore, 실패 감지+재시도 4종, 폴백 (15개)
  - `intercept.test.ts` — findBareCR, isSelectionMenuPrompt, hasAttachmentMarker,
    sanitizeForRetype (18개)
- **#6 CI** — `.github/workflows/ci.yml`. macOS-only matrix (node 20, 22).
  단계: lint(Biome) → typecheck → test(vitest) → build → install/uninstall
  smoke test. **CD는 의도적으로 제외** — 추후 별도 워크플로로 분리.
- **#7 Biome 린트/포맷** — `biome.json` 도입. `npm run check / format / lint`
  스크립트 추가. 기존 코드 자동 포맷팅 적용.
- **#10 Privacy 섹션** — README.md/README.ko.md 양쪽에 추가:
  Haiku/Ollama 전송 동작, 시크릿 검토 권고, 로컬 모드 안내
- **#13 `files` 필드** — `docs`, `CHANGELOG.md` 추가
- **플랫폼 지원 명시** — README에 "macOS tested, Linux/Windows experimental"
  표 추가. `node-pty` 빌드 도구 사전 요구사항도 OS별로 명시.

### ⏳ 다음 단계 (별도 PR)

- **#3 node-pty 안정 버전** — `^1.2.0-beta.13` 현 상태 유지. 실제 사용자
  설치 실패 사례 들어오면 재검토.
- **#8 기여 가이드** — `CONTRIBUTING.md`, `SECURITY.md`, `CHANGELOG.md`,
  이슈/PR 템플릿. 첫 외부 기여자 받기 전 작성.
- **#11 로그 회전** — 10MB 임계값 + rotation. 현재 무제한 증가.
- **#14 버전 0.1.0 bump** — npm 첫 publish 직전에 실행.
- **나머지 Medium / Low** — 우선순위 §18 참조.

### 검증 명령

```bash
unset NODE_OPTIONS
npm run check       # Biome lint + format
npm run typecheck   # tsc --noEmit
npm test            # vitest run (67 tests)
npm run build       # tsc → dist/
```
