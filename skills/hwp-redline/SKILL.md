---
name: hwp-redline
description: HWP 문서를 수정할 때 Claude가 바꾼 부분을 빨간 글자로 표시한다. HWP/HWPX 본문 텍스트 삽입·치환·삭제, 표 셀 수정 등 모든 HWP 편집 요청에 rhwp-edit 대신 이 스킬을 사용한다. "HWP 수정", "한글 파일 고쳐줘", "수정한 부분 표시", "빨간색으로 표시" 같은 요청에 사용.
---

# hwp-redline

HWP 문서를 편집하면서 **Claude가 수정한 글자는 항상 빨간색(#FF0000)** 으로 표시한다.
검토자가 원본 대비 무엇이 바뀌었는지 한눈에 볼 수 있게 하는 것이 목적이다.

엔진은 `rhwp-edit` 스킬과 같은 `k-skill-rhwp`(@rhwp/core WASM)이며, 편집 직후 같은 범위에
`applyCharFormat({textColor})` 를 적용한다. 원래 글꼴·크기 등 다른 서식은 그대로 유지된다.

## 규칙

1. HWP 편집은 반드시 `scripts/redline.js` 로 한다. `k-skill-rhwp insert-text / replace-all / set-cell-text` 를 직접 쓰면 색이 들어가지 않는다.
2. 다른 도구로 어쩔 수 없이 고친 경우에는 바로 이어서 `mark` 명령으로 그 범위를 빨갛게 칠한다.
3. 출력은 항상 원본과 다른 `.hwp` 경로에 저장한다(원본 보존). HWPX 입력도 출력은 HWP 5.x 바이너리다.
4. 사용자가 다른 색을 원하면 `--color #RRGGBB` 를 쓴다.
5. 삭제는 기본적으로 글자가 사라져 색 표시가 불가능하다. 삭제 흔적이 필요하면 `--strike` (빨간 취소선으로 남김)를 쓰고, 어느 쪽인지 사용자에게 알린다.

## 준비 (최초 1회)

이 스킬 폴더(이 SKILL.md 가 있는 디렉터리, 예: `.claude/skills/hwp-redline`)에서 의존성을 설치한다.

```bash
npm install --prefix <이 스킬 폴더>
```

`scripts/redline.js` 실행 시 모듈이 없으면 정확한 설치 명령을 안내하고 종료한다.
아래 예시의 `R` 은 `<이 스킬 폴더>/scripts/redline.js` 다.

## 사용법

좌표(섹션/문단/오프셋, 표 control/cell)는 먼저 `npx k-skill-rhwp info <file>` / `list-paragraphs` / `search` 로 확인한다 (`rhwp-edit` 스킬 참고).

```bash
R=<이 스킬 폴더>/scripts/redline.js

# 본문에 텍스트 삽입 → 삽입 부분 빨강
node $R insert in.hwp out.hwp --section 0 --paragraph 0 --offset 0 --text "새 문장"

# 본문 전체 치환 → 바뀐 글자 빨강 (표 셀·머리말 안은 대상 아님)
node $R replace in.hwp out.hwp --query 2025 --replacement 2026

# 삭제 (기본: 실제 삭제 / --strike: 빨간 취소선으로 남김)
node $R delete in.hwp out.hwp --section 0 --paragraph 3 --offset 5 --count 4 --strike

# 표 셀 내용 교체 → 새 내용 빨강 (--append 면 기존 내용 뒤에 덧붙임)
node $R set-cell in.hwp out.hwp --section 0 --parent-paragraph 2 --control 0 --cell 5 --text "합계"

# 이미 바뀐 범위에 색만 칠하기 (본문 / 셀)
node $R mark in.hwp out.hwp --section 0 --paragraph 1 --start 0 --end 10
node $R mark in.hwp out.hwp --section 0 --parent-paragraph 2 --control 0 --cell 5 --start 0 --end 2
```

### 양식 채우기 / 여러 곳 수정: `fill` (권장)

각 위치의 **최종 문자열**만 적으면 원래 문자열과 글자 단위로 diff 해서 **실제로 바뀐 글자만** 빨갛게 만든다.
양식의 라벨·괄호·`@`·`㎾` 같은 템플릿 글자는 검정으로 남는다. 한 번의 로드/저장으로 끝나므로 다건 수정에 쓴다.

```json
{
  "defaults": { "font": "맑은 고딕", "size": 10 },
  "edits": [
    { "label": "본문", "section": 0, "paragraph": 13, "text": "새 본문 문장" },
    { "label": "성명", "paragraph": 0, "path": [[2,0,2],[0,1,0]], "text": "김하늘" },
    { "label": "선택요금", "paragraph": 0, "path": [[2,0,8],[0,17,0]], "text": "Ⅰ■,  Ⅱ□,  Ⅲ□,  Ⅳ□" }
  ]
}
```

```bash
node $R fill in.hwp out.hwp --spec edits.json
```

- `path` 는 표 셀(중첩 표 포함) 경로다. 각 원소 `[controlIndex, cellIndex, cellParaIndex]` 를 바깥에서 안쪽 순으로 적는다. `paragraph` 는 가장 바깥 표를 가진 본문 문단 번호다.
- 셀 경로는 `getTableDimensionsByPath` / `getCellInfoByPath` / `getTextInCellByPath` (@rhwp/core) 로 탐색해 라벨 셀과 입력 셀을 짝지은 뒤 작성한다.
- 셀 안에는 rhwp 에 경로 기반 서식 API 가 없어서, 본문의 임시 위치에 빨간 글자를 만들어 복사한 뒤 셀에 붙여넣는다. 이 때문에 **셀의 글꼴과 크기는 `font`/`size` 로 지정해야 한다**(편집마다 덮어쓸 수 있음). 값은 `render` SVG 에서 같은 셀 근처 글자의 `font-family`/`font-size`(px × 0.75 = pt)를 보고 맞춘다.
- 본문 문단(`path` 없음)은 주변 서식을 그대로 이어받는다.

여러 군데를 고칠 때는 이전 출력 파일을 다음 명령의 입력으로 이어 붙인다(`out1.hwp → out2.hwp ...`). 마지막 파일만 사용자에게 전달하고 중간 파일은 지운다.

출력 JSON 의 `changes` 배열에 바뀐 위치·이전 텍스트(`before`/`deleted`)·새 텍스트가 담기므로, 작업이 끝나면 이를 요약해 사용자에게 변경 내역으로 보고한다.

## 검증

- 결과 JSON 이 `ok: true` 인지 확인한다.
- 필요하면 `npx k-skill-rhwp render out.hwp --page 0 --format svg` 로 렌더링해 빨간 글자(`fill="#ff0000"`)가 들어갔는지 확인한다.
