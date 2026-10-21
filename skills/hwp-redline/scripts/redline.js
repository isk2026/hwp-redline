#!/usr/bin/env node
"use strict";

// HWP 편집 + 수정 부분 빨간 글자 표시.
// k-skill-rhwp(@rhwp/core WASM) 위에서 동작하며, 편집한 글자 범위에 applyCharFormat 으로 textColor 를 입힌다.

const fs = require("node:fs");
const path = require("node:path");

let lib;
try {
  lib = require("k-skill-rhwp");
} catch {
  const skillDir = path.resolve(__dirname, "..");
  console.error(
    `k-skill-rhwp 가 없습니다. 먼저 설치하세요:\n  npm install --prefix "${skillDir}"`
  );
  process.exit(2);
}
const { getRhwpCore } = require("k-skill-rhwp/src/wasm-init");

const DEFAULT_COLOR = "#FF0000";
// 줄바꿈 + U+2028/U+2029(줄·문단 구분자)
const NEWLINE_RE = new RegExp("[\n\r" + String.fromCharCode(0x2028, 0x2029) + "]");

function ok(raw, op) {
  const parsed = JSON.parse(raw);
  if (!parsed || parsed.ok !== true) throw new Error(`${op} rejected by rhwp: ${raw}`);
  return parsed;
}

async function load(file) {
  const core = await getRhwpCore();
  return new core.HwpDocument(new Uint8Array(fs.readFileSync(file)));
}

function save(doc, output) {
  const bytes = doc.exportHwp();
  fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
  fs.writeFileSync(output, Buffer.from(bytes));
  return { bytesWritten: bytes.length, outputPath: output };
}

function redProps(color, extra = {}) {
  return JSON.stringify({ textColor: color, ...extra });
}

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      positional.push(a);
      continue;
    }
    const eq = a.indexOf("=");
    if (eq > 0) {
      flags[a.slice(2, eq)] = a.slice(eq + 1);
    } else if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
      flags[a.slice(2)] = argv[++i];
    } else {
      flags[a.slice(2)] = true;
    }
  }
  return { positional, flags };
}

function num(flags, name, fallback) {
  if (flags[name] === undefined) {
    if (fallback !== undefined) return fallback;
    throw new Error(`missing required --${name}`);
  }
  const n = Number(flags[name]);
  if (!Number.isInteger(n) || n < 0) throw new Error(`--${name} must be a non-negative integer`);
  return n;
}

function str(flags, name) {
  if (typeof flags[name] !== "string") throw new Error(`missing required --${name}`);
  return flags[name];
}

function assertNoNewline(text) {
  if (NEWLINE_RE.test(text)) {
    throw new Error("text must not contain newline characters; call insert once per paragraph");
  }
}

// 본문 문단에 삽입 → 삽입된 범위를 빨갛게
function insert(doc, flags, color) {
  const s = num(flags, "section");
  const p = num(flags, "paragraph");
  const o = num(flags, "offset");
  const text = str(flags, "text");
  assertNoNewline(text);
  ok(doc.insertText(s, p, o, text), "insertText");
  ok(doc.applyCharFormat(s, p, o, o + text.length, redProps(color)), "applyCharFormat");
  return { changes: [{ section: s, paragraph: p, start: o, end: o + text.length, text }] };
}

// 본문 전체 치환 → 바뀐 글자마다 빨갛게
function replace(doc, flags, color) {
  const query = str(flags, "query");
  const replacement = flags.replacement === undefined ? "" : String(flags.replacement);
  assertNoNewline(replacement);
  const caseSensitive = flags["case-sensitive"] === true;
  const changes = [];
  for (let s = 0; s < doc.getSectionCount(); s += 1) {
    for (let p = 0; p < doc.getParagraphCount(s); p += 1) {
      const len = doc.getParagraphLength(s, p);
      if (len < query.length) continue;
      const text = doc.getTextRange(s, p, 0, len);
      const hay = caseSensitive ? text : text.toLowerCase();
      const needle = caseSensitive ? query : query.toLowerCase();
      if (hay.length !== text.length || needle.length !== query.length) {
        throw new Error("case folding changes UTF-16 length; rerun with --case-sensitive");
      }
      const offsets = [];
      for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + needle.length)) {
        offsets.push(i);
      }
      // 뒤에서부터 바꿔야 앞쪽 오프셋이 유지된다
      for (let m = offsets.length - 1; m >= 0; m -= 1) {
        const at = offsets[m];
        ok(doc.replaceText(s, p, at, query.length, replacement), "replaceText");
        if (replacement.length > 0) {
          ok(doc.applyCharFormat(s, p, at, at + replacement.length, redProps(color)), "applyCharFormat");
        }
        changes.unshift({ section: s, paragraph: p, start: at, end: at + replacement.length, before: text.substr(at, query.length), text: replacement });
      }
    }
  }
  return { count: changes.length, changes };
}

// 본문 텍스트 삭제. 기본은 실제 삭제(색 표시 불가),
// --strike 면 지우지 않고 빨간 취소선으로 남긴다.
function del(doc, flags, color) {
  const s = num(flags, "section");
  const p = num(flags, "paragraph");
  const o = num(flags, "offset");
  const count = num(flags, "count");
  const before = doc.getTextRange(s, p, o, count);
  if (flags.strike === true) {
    ok(doc.applyCharFormat(s, p, o, o + count, redProps(color, { strikethrough: true })), "applyCharFormat");
    return { changes: [{ section: s, paragraph: p, start: o, end: o + count, struck: before }] };
  }
  ok(doc.deleteText(s, p, o, count), "deleteText");
  return { changes: [{ section: s, paragraph: p, start: o, deleted: before }], note: "삭제된 글자는 색으로 표시할 수 없습니다. 흔적을 남기려면 --strike 를 쓰세요." };
}

// 표 셀 내용 교체(또는 --append 로 뒤에 덧붙임) → 새로 쓴 글자를 빨갛게
function setCell(doc, flags, color) {
  const s = num(flags, "section");
  const pp = num(flags, "parent-paragraph");
  const c = num(flags, "control");
  const cell = num(flags, "cell");
  const cp = num(flags, "cell-paragraph", 0);
  const text = str(flags, "text");
  assertNoNewline(text);
  let start = 0;
  const len = doc.getCellParagraphLength(s, pp, c, cell, cp);
  let before = "";
  if (flags.append === true) {
    start = len;
  } else if (len > 0) {
    before = doc.getTextInCell(s, pp, c, cell, cp, 0, len);
    ok(doc.deleteTextInCell(s, pp, c, cell, cp, 0, len), "deleteTextInCell");
  }
  ok(doc.insertTextInCell(s, pp, c, cell, cp, start, text), "insertTextInCell");
  ok(doc.applyCharFormatInCell(s, pp, c, cell, cp, start, start + text.length, redProps(color)), "applyCharFormatInCell");
  return { changes: [{ section: s, parentParagraph: pp, control: c, cell, cellParagraph: cp, start, end: start + text.length, before, text }] };
}

// 이미 편집된 범위에 색만 칠한다(다른 도구로 수정한 부분 표시용)
function mark(doc, flags, color) {
  const s = num(flags, "section");
  const start = num(flags, "start");
  const end = num(flags, "end");
  if (flags.control !== undefined) {
    const pp = num(flags, "parent-paragraph");
    const c = num(flags, "control");
    const cell = num(flags, "cell");
    const cp = num(flags, "cell-paragraph", 0);
    ok(doc.applyCharFormatInCell(s, pp, c, cell, cp, start, end, redProps(color)), "applyCharFormatInCell");
    return { changes: [{ section: s, parentParagraph: pp, control: c, cell, cellParagraph: cp, start, end }] };
  }
  const p = num(flags, "paragraph");
  ok(doc.applyCharFormat(s, p, start, end, redProps(color)), "applyCharFormat");
  return { changes: [{ section: s, paragraph: p, start, end }] };
}

// ---- fill: 목표 문자열과 현재 문자열을 diff 해서 바뀐 글자만 빨갛게 ----

// LCS 기반 문자 diff → [{ start, end, text }] (원본 [start,end) 를 text 로 교체)
function diffHunks(oldStr, newStr) {
  const n = oldStr.length;
  const m = newStr.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i][j] = oldStr[i] === newStr[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const hunks = [];
  let cur = null;
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && oldStr[i] === newStr[j]) {
      if (cur) hunks.push(cur);
      cur = null;
      i += 1;
      j += 1;
    } else {
      if (!cur) cur = { start: i, end: i, text: "" };
      if (j < m && (i >= n || dp[i][j + 1] >= dp[i + 1][j])) {
        cur.text += newStr[j];
        j += 1;
      } else {
        i += 1;
        cur.end = i;
      }
    }
  }
  if (cur) hunks.push(cur);
  return hunks;
}

function normalizePath(p) {
  return JSON.stringify(
    p.map((e) => (Array.isArray(e) ? { controlIndex: e[0], cellIndex: e[1], cellParaIndex: e[2] } : e))
  );
}

// 중첩 셀에는 직접 서식 API 가 없으므로, 본문 임시 위치에 빨간 글자를 만들어 복사 → 셀에 붙여넣기
function pasteRedIntoPath(doc, s, parentPara, pathJson, offset, text, props) {
  let scratch = -1;
  for (let p = 0; p < doc.getParagraphCount(s); p += 1) {
    if (doc.getParagraphLength(s, p) > 0 && p !== parentPara) {
      scratch = p;
      break;
    }
  }
  if (scratch < 0) throw new Error(`section ${s} has no non-empty body paragraph to use as scratch`);
  const L = doc.getParagraphLength(s, scratch);
  ok(doc.insertText(s, scratch, L, text), "insertText(scratch)");
  try {
    ok(doc.applyCharFormat(s, scratch, L, L + text.length, JSON.stringify(props)), "applyCharFormat(scratch)");
    ok(doc.copySelection(s, scratch, L, scratch, L + text.length), "copySelection");
  } finally {
    ok(doc.deleteText(s, scratch, L, text.length), "deleteText(scratch)");
  }
  ok(doc.pasteInternalInCellByPath(s, parentPara, pathJson, offset), "pasteInternalInCellByPath");
}

function fillOne(doc, e, defaults, color) {
  const s = e.section ?? 0;
  const p = e.paragraph;
  if (!Number.isInteger(p)) throw new Error(`edit missing paragraph: ${JSON.stringify(e)}`);
  if (typeof e.text !== "string" || NEWLINE_RE.test(e.text)) throw new Error(`edit text must be a single-line string: ${JSON.stringify(e)}`);
  let before;
  let pathJson = null;
  if (e.path) {
    pathJson = normalizePath(e.path);
    before = doc.getTextInCellByPath(s, p, pathJson, 0, doc.getCellParagraphLengthByPath(s, p, pathJson));
  } else {
    before = doc.getTextRange(s, p, 0, doc.getParagraphLength(s, p));
  }
  const hunks = diffHunks(before, e.text);
  const font = e.font ?? defaults.font;
  const size = e.size ?? defaults.size;
  const props = { textColor: color };
  if (font) props.fontId = doc.findOrCreateFontId(font);
  if (size) props.fontSize = Math.round(size * 100);
  // 뒤에서부터 적용해야 앞쪽 오프셋이 유지된다
  for (let h = hunks.length - 1; h >= 0; h -= 1) {
    const { start, end, text } = hunks[h];
    if (pathJson) {
      if (end > start) ok(doc.deleteTextInCellByPath(s, p, pathJson, start, end - start), "deleteTextInCellByPath");
      if (text) pasteRedIntoPath(doc, s, p, pathJson, start, text, props);
    } else {
      if (end > start) ok(doc.deleteText(s, p, start, end - start), "deleteText");
      if (text) {
        ok(doc.insertText(s, p, start, text), "insertText");
        ok(doc.applyCharFormat(s, p, start, start + text.length, JSON.stringify({ textColor: color })), "applyCharFormat");
      }
    }
  }
  return { section: s, paragraph: p, path: e.path, label: e.label, before, after: e.text, hunks: hunks.length };
}

function fill(doc, flags, color) {
  const spec = JSON.parse(fs.readFileSync(str(flags, "spec"), "utf8"));
  const defaults = spec.defaults || {};
  const changes = spec.edits.map((e) => fillOne(doc, e, defaults, color));
  return { count: changes.length, changes };
}

const COMMANDS = { insert, replace, delete: del, "set-cell": setCell, mark, fill };

const USAGE = `usage: node redline.js <command> <input.hwp> <output.hwp> [flags] [--color #RRGGBB]

commands:
  insert    --section N --paragraph N --offset N --text "..."
  replace   --query "..." --replacement "..." [--case-sensitive]
  delete    --section N --paragraph N --offset N --count N [--strike]
  set-cell  --section N --parent-paragraph N --control N --cell N [--cell-paragraph N] --text "..." [--append]
  mark      --section N (--paragraph N | --parent-paragraph N --control N --cell N [--cell-paragraph N]) --start N --end N
  fill      --spec edits.json   (목표 문자열과 diff 해서 바뀐 글자만 빨갛게, 중첩 표 셀 path 지원)`;

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const run = COMMANDS[command];
  if (!run) {
    console.error(USAGE);
    process.exit(command ? 1 : 0);
  }
  const { positional, flags } = parseArgs(rest);
  const [input, output] = positional;
  if (!input || !output) throw new Error("input and output paths are required");
  if (path.resolve(input) === path.resolve(output)) throw new Error("output must differ from input");
  const color = typeof flags.color === "string" ? flags.color : DEFAULT_COLOR;
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) throw new Error("--color must be #RRGGBB");

  const doc = await load(input);
  try {
    const result = run(doc, flags, color);
    console.log(JSON.stringify({ ok: true, command, color, ...result, ...save(doc, output) }, null, 2));
  } finally {
    doc.free();
  }
}

main().catch((err) => {
  console.error(err && err.message ? err.message : String(err));
  process.exit(1);
});
