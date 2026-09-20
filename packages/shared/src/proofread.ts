import type {
  DecodeIssue,
  ProofDiff,
  ProofRequest,
  ProofResult,
  ProofRowSummary,
} from './types.js';
import { isOddRow, parseRawLine, placeRuns } from './rle.js';

/**
 * 对版（proofreading）：把编辑区中的候选口令解析为**临时图案**，
 * 逐格按**视觉坐标**与当前网格比较，绝不回写当前网格。
 *
 * 关键约定（与浮线/循环花版一致）：
 * - 奇数行候选按 → 自左向右铺展，偶数行候选按 ← 自右向左铺展；
 * - 比较一律使用视觉坐标，列 1 恒在最左，**偶数行的差异列绝不镜像**；
 * - 针数错误或无法解析（坏片段、未知符号、行号冲突/越界、空游程）的候选行，
 *   以及没有任何候选的行，整行列为“不可比较”，不能用部分结果参与该行差异。
 *
 * 差异分类（以 A 为底色）：
 * - added（新增纹样）：当前为底色、候选为非底色；
 * - missing（缺失纹样）：当前为非底色、候选为底色；
 * - replaced（颜色替换）：两格均为非底色但符号不同。
 */

type LineError = Pick<DecodeIssue, 'line' | 'row' | 'code' | 'message'> & {
  actualCount?: number;
  expectedCount?: number;
};

/** 一条通过全部校验、可铺展为视觉行的候选口令 */
interface ValidCandidate {
  line: number;
  row: number;
  cells: string[];
}

/**
 * 第一遍：行号映射，与 decodeText 完全同构。
 * 返回 row(1 基) -> 中选的口令物理行号；冲突/越界记录为错误。
 */
function mapRows(
  parsed: ReturnType<typeof parseRawLine>[],
  height: number,
): { owner: Map<number, number>; issues: LineError[] } {
  const rowMap = new Map<number, { line: number; explicit: boolean }>();
  const issues: LineError[] = [];
  for (const p of parsed) {
    if (p.empty) continue;
    const target = p.explicitRow ?? p.line;
    const existing = rowMap.get(target);
    if (existing) {
      const bothExplicit = existing.explicit && p.explicitRow !== null;
      issues.push({
        line: p.line,
        row: target,
        code: 'DUPLICATE_ROW',
        message: bothExplicit
          ? `图案第 ${target} 行被行号重复指定（口令第 ${existing.line}、${p.line} 行），对版无法确定候选`
          : `图案第 ${target} 行已由口令第 ${existing.line} 行指定，与第 ${p.line} 行冲突，对版无法确定候选`,
      });
      continue;
    }
    if (target < 1 || target > height) {
      issues.push({
        line: p.line,
        row: p.explicitRow !== null ? target : null,
        code: 'ROW_OUT_OF_RANGE',
        message:
          p.explicitRow !== null
            ? `行号 ${target} 超出范围（应为 1–${height}），该候选不参与对版`
            : `口令第 ${p.line} 行隐含对应图案第 ${target} 行，但图案只有 ${height} 行，该候选不参与对版`,
      });
      continue;
    }
    rowMap.set(target, { line: p.line, explicit: p.explicitRow !== null });
  }
  const owner = new Map<number, number>();
  for (const [row, v] of rowMap) owner.set(row, v.line);
  return { owner, issues };
}

/**
 * 对版核心：候选口令 → 临时图案 → 逐格差异。
 * 纯函数，不修改入参 grid；候选文本或当前网格变化时由调用方重新执行即可实时重算。
 */
export function proofread(req: ProofRequest): ProofResult {
  const { text, grid, width, height, symbols } = req;
  const base = (req.baseSymbol ?? 'A').toUpperCase();
  const allowed = new Set(symbols.map((s) => s.toUpperCase()));
  const rawLines = text.split(/\r?\n/);
  const parsed = rawLines.map((raw, i) => parseRawLine(raw, i + 1));
  const issues: LineError[] = [];

  const { owner, issues: mapIssues } = mapRows(parsed, height);
  issues.push(...mapIssues);

  // row(1 基) -> 可比较的候选视觉行；未进入此表的行不可比较
  const candidates = new Map<number, ValidCandidate>();

  for (const p of parsed) {
    if (p.empty) continue;
    const mapped = owner.get(p.explicitRow ?? p.line);
    if (mapped !== p.line) continue; // 冲突/越界落败的文本行
    const row = p.explicitRow ?? p.line;

    // 语法错误：无法解析，整行不可比较
    if (p.runs === null) {
      issues.push(
        p.badToken !== undefined
          ? {
              line: p.line,
              row,
              code: 'BAD_TOKEN',
              message: `第 ${p.line} 行存在无法识别的片段“${p.badToken}”（格式应为 符号+针数，如 A4），整行不可比较`,
            }
          : {
              line: p.line,
              row,
              code: 'EMPTY_RUNS',
              message: `第 ${p.line} 行只有行号、没有游程，整行不可比较`,
            },
      );
      continue;
    }

    // 未启用符号：整行不可比较
    const badSymbolRun = p.runs.find((r) => !allowed.has(r.symbol));
    if (badSymbolRun) {
      issues.push({
        line: p.line,
        row,
        code: 'UNKNOWN_SYMBOL',
        message: `第 ${p.line} 行出现未启用的符号“${badSymbolRun.symbol}”（当前符号：${symbols.join('/')}），整行不可比较`,
      });
      continue;
    }

    // 针数不符：整行不可比较，绝不能用部分落针结果参与差异
    const total = p.runs.reduce((sum, r) => sum + r.count, 0);
    if (total !== width) {
      const ltr = isOddRow(row);
      issues.push({
        line: p.line,
        row,
        code: 'COUNT_MISMATCH',
        message:
          total > width
            ? `第 ${row} 行（口令第 ${p.line} 行）共 ${total} 针，比行宽多 ${total - width} 针，整行不可比较`
            : `第 ${row} 行（口令第 ${p.line} 行）共 ${total} 针，比行宽少 ${width - total} 针，整行不可比较`,
        actualCount: total,
        expectedCount: width,
      });
      continue;
    }

    // 合法候选：按编织方向铺回视觉坐标（偶数行从最右端起，视觉不镜像）
    candidates.set(row, { line: p.line, row, cells: placeRuns(p.runs, row, width) });
  }

  const diffs: ProofDiff[] = [];
  const rows: ProofRowSummary[] = [];
  let added = 0;
  let missing = 0;
  let replaced = 0;
  let matchedRows = 0;
  let diffRows = 0;
  let incomparableRows = 0;

  for (let r = 1; r <= height; r += 1) {
    const cand = candidates.get(r);
    const currentRow = grid[r - 1] ?? [];

    if (!cand) {
      incomparableRows += 1;
      // 判定不可比较原因：优先引用该图案行上的解析问题；否则为缺少候选
      const line = owner.get(r) ?? null;
      const issue = issues.find((i) => i.row === r && (line === null || i.line === line));
      rows.push({
        row: r,
        comparable: false,
        reason: issue?.message ?? `图案第 ${r} 行没有对应的候选口令，整行不可比较`,
        line,
        added: 0,
        missing: 0,
        replaced: 0,
        firstDiff: null,
        match: false,
      });
      continue;
    }

    const rowDiffs: ProofDiff[] = [];
    for (let c = 0; c < width; c += 1) {
      const cur = (currentRow[c] ?? '').toUpperCase();
      const nextSym = cand.cells[c] ?? '';
      if (cur === nextSym) continue;
      const kind =
        cur === base && nextSym !== base
          ? 'added'
          : cur !== base && nextSym === base
            ? 'missing'
            : 'replaced';
      rowDiffs.push({ row: r, col: c + 1, kind, current: cur, candidate: nextSym });
    }

    let firstDiff: ProofDiff | null = null;
    for (const d of rowDiffs) {
      diffs.push(d);
      if (d.kind === 'added') added += 1;
      else if (d.kind === 'missing') missing += 1;
      else replaced += 1;
      // 逐格按视觉列升序遍历，首个即列序最小者
      if (!firstDiff) firstDiff = d;
    }

    if (rowDiffs.length === 0) matchedRows += 1;
    else diffRows += 1;

    const counts = { added: 0, missing: 0, replaced: 0 };
    for (const d of rowDiffs) counts[d.kind] += 1;

    rows.push({
      row: r,
      comparable: true,
      reason: null,
      line: cand.line,
      added: counts.added,
      missing: counts.missing,
      replaced: counts.replaced,
      firstDiff,
      match: rowDiffs.length === 0,
    });
  }

  // 问题按口令物理行号稳定排序，便于侧栏/编辑器展示
  issues.sort((a, b) => a.line - b.line);

  return {
    diffs,
    rows,
    issues: issues as DecodeIssue[],
    totals: {
      added,
      missing,
      replaced,
      matchedRows,
      diffRows,
      incomparableRows,
    },
  };
}
