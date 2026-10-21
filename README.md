# hwp-redline

HWP(한글) 문서를 AI 에이전트가 수정할 때, **수정한 부분을 빨간 글자로 표시**하는 Agent Skill입니다.
검토자가 원본 대비 무엇이 바뀌었는지 한눈에 확인할 수 있습니다.

- 본문 텍스트 삽입 · 전체 치환 · 삭제(빨간 취소선 옵션)
- 표 셀 수정 (중첩 표 포함)
- `fill`: 각 칸의 최종 문자열만 주면 원본과 글자 단위 diff 후 **실제로 바뀐 글자만** 빨갛게 표시 — 양식(신청서 등) 채우기에 적합
- 원본 파일은 건드리지 않고 항상 새 `.hwp` 로 저장

엔진: [`k-skill-rhwp`](https://www.npmjs.com/package/k-skill-rhwp) / [`@rhwp/core`](https://github.com/edwardkim/rhwp) (Rust + WASM)

## 설치

```bash
npx skills add isk2026/hwp-redline
```

설치 후 스킬 폴더에서 의존성을 한 번 설치합니다 (Node.js 18+).

```bash
npm install --prefix .claude/skills/hwp-redline   # 설치된 에이전트의 스킬 경로에 맞게
```

## 사용 예

```bash
R=.claude/skills/hwp-redline/scripts/redline.js
node $R replace in.hwp out.hwp --query 2025 --replacement 2026
node $R fill form.hwp form_filled.hwp --spec edits.json
```

자세한 사용법은 [`skills/hwp-redline/SKILL.md`](skills/hwp-redline/SKILL.md)를 참고하세요.

## 제한 사항

- HWPX 입력도 출력은 HWP 5.x 바이너리로 저장됩니다 (rhwp 업스트림 제약).
- 삭제된 글자는 색으로 표시할 수 없으므로, 흔적이 필요하면 `delete --strike` 를 사용합니다.
- 중첩 표 셀에 쓸 때는 글꼴/크기(`font`/`size`)를 지정해야 합니다.

## License

MIT
