import assert from 'node:assert/strict';
import { test } from 'node:test';
import { proofread } from '../dist/index.js';

const SYMBOLS = ['A', 'B', 'C'];
// 4 列 × 4 行；特意让第 4 行（偶数行）非对称，验证差异列不镜像
const GRID = [
  ['A', 'B', 'B', 'A'], // 行1 →：A B B A
  ['A', 'B', 'B', 'A'], // 行2 ←
  ['A', 'A', 'B', 'A'], // 行3 →
  ['A', 'A', 'B', 'A'], // 行4 ←（非对称：B 在视觉第 3 列）
];

function run(text, grid = GRID, width = 4, height = 4) {
  return proofread({ text, grid, width, height, symbols: SYMBOLS, baseSymbol: 'A' });
}

test('完全一致：无差异，全部行 match', () => {
  // 行1/2 视觉 A B B A：奇行 → A1B2A1；偶行右起仍是 A1B2A1（回文）
  // 行3 视觉 A A B A → A2B1A1；行4 视觉 A A B A，偶行右起 A1B1A2
  const res = run(['A1B2A1', 'A1B2A1', 'A2B1A1', 'A1B1A2'].join('\n'));
  assert.equal(res.issues.length, 0);
  assert.equal(res.diffs.length, 0);
  assert.deepEqual(
    res.rows.map((r) => r.match),
    [true, true, true, true],
  );
  assert.equal(res.totals.matchedRows, 4);
  assert.equal(res.totals.diffRows, 0);
  assert.equal(res.totals.incomparableRows, 0);
});

test('新增 / 缺失 / 颜色替换三类差异，按视觉列定位', () => {
  // 行1 当前 A B B A；候选 B B B A（口令 B3A1）→ 第 1 列 A→B：新增纹样
  // 行2 当前 A B B A；候选 A C C A（回文，口令 A1C2A1）→ 2、3 列 B→C：替换 ×2
  // 行3 当前 A A B A；候选 A A A A（口令 A4）→ 第 3 列 B→A：缺失纹样
  // 行4 给正确口令保持一致
  const text = ['B3A1', 'A1C2A1', 'A4', 'A1B1A2'].join('\n');
  const res = run(text);
  assert.equal(res.issues.length, 0);

  const r1 = res.rows[0];
  assert.equal(r1.added, 1);
  assert.deepEqual(r1.firstDiff, {
    row: 1,
    col: 1,
    kind: 'added',
    current: 'A',
    candidate: 'B',
  });

  const r2 = res.rows[1];
  assert.equal(r2.replaced, 2);
  assert.equal(r2.firstDiff?.col, 2);
  assert.equal(r2.firstDiff?.kind, 'replaced');
  assert.equal(r2.firstDiff?.candidate, 'C');

  const r3 = res.rows[2];
  assert.equal(r3.missing, 1);
  assert.equal(r3.firstDiff?.col, 3);
  assert.equal(r3.firstDiff?.kind, 'missing');

  assert.equal(res.totals.added, 1);
  assert.equal(res.totals.missing, 1);
  assert.equal(res.totals.replaced, 2);
});

test('偶数行差异列绝不镜像：非对称行按视觉坐标报告列号', () => {
  // 当前行4：视觉 A A B A（B 在第 3 列）
  // 候选行4：视觉 A A A A（偶数行口令 A4）→ B 缺失，缺失列必须是视觉第 3 列，
  // 若错误镜像会报第 2 列
  const res = run(['A1B2A1', 'A1B2A1', 'A2B1A1', 'A4'].join('\n'));
  const d = res.diffs.find((x) => x.row === 4);
  assert.ok(d);
  assert.equal(d.kind, 'missing');
  assert.equal(d.col, 3);
});

test('针数错误的候选行整行不可比较，不用部分落针结果参与该行差异', () => {
  // 行2 给 5 针（应为 4 针）：即便前 4 针“恰好”铺满视觉行也不参与比较
  const res = run(['A1B2A1', 'A1B2A2', 'A2B1A1', 'A1B1A2'].join('\n'));
  const issue = res.issues.find((i) => i.code === 'COUNT_MISMATCH');
  assert.ok(issue);
  assert.equal(issue.row, 2);
  assert.equal(issue.actualCount, 5);
  const r2 = res.rows[1];
  assert.equal(r2.comparable, false);
  assert.equal(r2.added, 0);
  assert.equal(r2.missing, 0);
  assert.equal(r2.replaced, 0);
  assert.equal(r2.firstDiff, null);
  assert.match(r2.reason ?? '', /不可比较/);
  // 该行不得产生任何差异格
  assert.equal(res.diffs.some((d) => d.row === 2), false);
  assert.equal(res.totals.incomparableRows, 1);
  // 其他行照常逐格比较
  assert.equal(res.rows[0].match, true);
  assert.equal(res.rows[2].match, true);
});

test('欠针、坏片段、未知符号、行号冲突均使对应行不可比较', () => {
  const text = [
    'B3' /* 行1 欠 1 针 */,
    'B?A2' /* 行2 坏片段 */,
    'A2X1A1' /* 行3 未知符号 */,
    'A1B1A2',
    '04 C4' /* 行5 显式与第 4 条隐式撞行 */,
  ].join('\n');
  const res = run(text);
  const codes = res.issues
    .map((i) => `${i.code}@${i.row}`)
    .sort();
  assert.deepEqual(codes, [
    'BAD_TOKEN@2',
    'COUNT_MISMATCH@1',
    'DUPLICATE_ROW@4',
    'UNKNOWN_SYMBOL@3',
  ]);
  // 撞行落败方（第 5 条）被拒；第 4 条先到者仍为合法候选
  assert.deepEqual(
    res.rows.map((r) => r.comparable),
    [false, false, false, true],
  );
  // 第 4 行候选与当前一致，不产生差异
  assert.equal(res.rows[3].match, true);
  assert.equal(res.totals.incomparableRows, 3);
  assert.equal(res.diffs.length, 0);
});

test('缺少候选口令的行不可比较，其余行正常比较', () => {
  const res = run(['A1B2A1', '', 'A2B1A1'].join('\n'));
  assert.equal(res.rows[1].comparable, false); // 第 2 行空
  assert.match(res.rows[1].reason ?? '', /没有对应/);
  assert.equal(res.rows[3].comparable, false); // 第 4 行缺失
  assert.equal(res.rows[0].match, true);
  assert.equal(res.rows[2].match, true);
  assert.equal(res.totals.incomparableRows, 2);
});

test('显式行号重排：候选按指定图案行在视觉坐标比较', () => {
  // 第 1 条显式指向第 4 行（偶数行 ←），第 2 条无行号对应图案第 2 行
  const res = run(['04 A4', 'B4'].join('\n'), GRID, 4, 4);
  // 第 4 行候选全 A：当前 B 在视觉第 3 列 → 缺失报第 3 列（不镜像）
  const d4 = res.diffs.find((d) => d.row === 4);
  assert.ok(d4);
  assert.equal(d4.col, 3);
  assert.equal(d4.kind, 'missing');
  // 第 2 行候选全 B：当前第 1、4 列为 A → 新增 ×2
  const r2 = res.rows[1];
  assert.equal(r2.comparable, true);
  assert.equal(r2.added, 2);
  // 第 1、3 行无候选
  assert.equal(res.rows[0].comparable, false);
  assert.equal(res.rows[2].comparable, false);
});

test('差异按行 → 视觉列排序，firstDiff 为列序最小者', () => {
  // 行1 候选全 B：第 1、4 列新增；firstDiff 必须是第 1 列
  const res = run(['B4', 'A1B2A1', 'A2B1A1', 'A1B1A2'].join('\n'));
  assert.deepEqual(
    res.diffs.filter((d) => d.row === 1).map((d) => d.col),
    [1, 4],
  );
  assert.equal(res.rows[0].firstDiff?.col, 1);
});

test('不回写当前网格：proofread 后入参 grid 保持原样', () => {
  const grid = GRID.map((r) => [...r]);
  const snapshot = GRID.map((r) => [...r]);
  run(['B4', 'B4', 'B4', 'B4'].join('\n'), grid);
  assert.deepEqual(grid, snapshot);
});
