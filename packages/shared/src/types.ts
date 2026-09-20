/**
 * 提花编织口令：共享类型定义
 *
 * 编织约定（与提花机实际走针一致）：
 * - 第 1 行为奇数行，自左向右编织（→）
 * - 第 2 行为偶数行，自右向左编织（←）
 * - 视觉网格坐标恒定：列 0 始终在左侧，偶数行绝不镜像显示
 * - 口令按“实际编织方向”记录游程：偶数行最右侧的游程先被读出
 */

/** 单个符号游程：符号 + 连续针数 */
export interface Run {
  symbol: string;
  count: number;
}

/** 逐行编码结果中的一行 */
export interface EncodedLine {
  /** 1 基行号 */
  row: number;
  direction: 'LR' | 'RL';
  /** 按实际编织方向排列的游程序列 */
  runs: Run[];
  /** 规范化口令文本（不含行号/箭头），如 B3 A4 B1 */
  text: string;
  /** 含行号与方向箭头的完整文本，如 02 ← A2 B4 A2 */
  canonical: string;
}

export interface EncodeRequest {
  grid: string[][];
  width: number;
  height: number;
}

export interface EncodeResponse {
  lines: EncodedLine[];
  text: string;
}

/** 口令解析阶段的错误类型 */
export type DecodeErrorCode =
  | 'BAD_TOKEN' // 无法识别的片段
  | 'UNKNOWN_SYMBOL' // 出现网格符号集之外的符号
  | 'EMPTY_RUNS' // 只有行号没有游程
  | 'DUPLICATE_ROW' // 显式行号重复
  | 'ROW_OUT_OF_RANGE' // 显式行号超出 [1,height]
  | 'COUNT_MISMATCH'; // 行针数不等于行宽（过多/过少）

export interface DecodeIssue {
  /** 口令文本中的 1 基行号（第几行文本，跳过空行后仍按物理行计算） */
  line: number;
  /** 对应的图案行（1 基），无法判定时为 null */
  row: number | null;
  code: DecodeErrorCode;
  message: string;
  /** 该行针数；针数错误时存在 */
  actualCount?: number;
  expectedCount?: number;
}

export interface DecodeRequest {
  text: string;
  width: number;
  height: number;
  /** 当前网格：针数错误的行保留此原图内容 */
  fallback: string[][];
  /** 允许的符号集合（如 ['A','B','C']） */
  symbols: string[];
}

export interface DecodeResponse {
  /** 合并后的网格：合法行回写，非法行保留原图 */
  grid: string[][];
  issues: DecodeIssue[];
  /** 成功回写的 1 基行号列表 */
  appliedRows: number[];
  ok: boolean;
}

/** 对版逐格差异类型（以 A 为底色判定） */
export type ProofDiffType = 'added' | 'missing' | 'replaced';

/** 对版：逐格差异（全部使用视觉坐标，1 基；偶数行不镜像） */
export interface ProofDiff {
  /** 1 基行号 */
  row: number;
  /** 1 基视觉列号（列 1 恒在最左，偶数行差异列绝不镜像） */
  col: number;
  kind: ProofDiffType;
  /** 当前网格该格符号 */
  current: string;
  /** 候选图案该格符号 */
  candidate: string;
}

/** 一行的对版汇总 */
export interface ProofRowSummary {
  /** 1 基行号 */
  row: number;
  /** 本行是否可比较（恰好一条合法且针数正确的候选行才可比较） */
  comparable: boolean;
  /** 不可比较或候选行解析失败时的原因（可比较时为 null） */
  reason: string | null;
  /** 对应用户口令文本中的物理行号（1 基），无法判定时为 null */
  line: number | null;
  added: number;
  missing: number;
  replaced: number;
  /** 本行首个差异（列序最小），供点击条目定位 */
  firstDiff: ProofDiff | null;
  /** 本行是否完全一致（仅可比较行可能为 true） */
  match: boolean;
}

export interface ProofRequest {
  /** 编辑区中的候选口令文本（解析为临时图案，不回写网格） */
  text: string;
  /** 当前网格（仅作逐格比较基准，不会被修改） */
  grid: string[][];
  width: number;
  height: number;
  /** 允许的符号集合（如 ['A','B','C']） */
  symbols: string[];
  /** 底色符号（默认 'A'）：候选/当前为底色的非 A 纹样分别计为新增/缺失 */
  baseSymbol?: string;
}

export interface ProofResult {
  /** 逐格差异（按视觉坐标排序：行 → 列） */
  diffs: ProofDiff[];
  /** 逐行汇总（按行号升序） */
  rows: ProofRowSummary[];
  /** 候选行解析问题（与 DecodeIssue 同构：针数错误/无法解析等） */
  issues: DecodeIssue[];
  totals: {
    added: number;
    missing: number;
    replaced: number;
    /** 可比较且无差异的行数 */
    matchedRows: number;
    /** 可比较但存在差异的行数 */
    diffRows: number;
    /** 不可比较的行数 */
    incomparableRows: number;
  };
}

/**
 * 一段浮线：同一行内某种颜色相邻两次落针之间、被同色针脚两端夹住的区间。
 * 全部使用视觉坐标（1 基），与奇偶行编织方向无关。
 */
export interface FloatSpan {
  /** 1 基行号 */
  row: number;
  /** 浮线所属符号（颜色） */
  symbol: string;
  /** 左端同色针脚所在视觉列（1 基） */
  startCol: number;
  /** 右端同色针脚所在视觉列（1 基） */
  endCol: number;
  /** 跨过的其他颜色针数 = endCol - startCol - 1 */
  length: number;
}

export interface FloatCheckResult {
  /** 本次检查使用的最大浮线针数阈值 */
  maxFloat: number;
  /** 全部浮线区间（按视觉坐标排序：行 → 起始列 → 结束列） */
  spans: FloatSpan[];
  /** 超过阈值的浮线（spans 的子集，同样按视觉坐标排序） */
  risks: FloatSpan[];
}

/**
 * 循环花版：最小二维重复单元的搜索结果。
 * 全部使用视觉坐标——重复单元与奇偶行编织方向无关，偶数行绝不镜像。
 */
export interface RepeatResult {
  /** 单元行数（垂直周期） */
  unitRows: number;
  /** 单元列数（水平周期） */
  unitCols: number;
  /** 单元面积（格数）= unitRows × unitCols */
  unitArea: number;
  /** 单元内容（视觉坐标，锚定于网格左上角的零偏移相位） */
  cells: string[][];
  /** 整幅行数 */
  gridRows: number;
  /** 整幅列数 */
  gridCols: number;
  /** 整幅总格数 = gridRows × gridCols */
  totalCells: number;
  /** 压缩比 = totalCells / unitArea（≥ 1） */
  ratio: number;
}
