import type { ProofResult, ProofRowSummary } from '@jacquard/shared';

interface ProofPanelProps {
  /** 对版结果（随候选文本/当前网格实时重算） */
  proof: ProofResult;
  /** 当前选中的行（1 基）；null 表示未选中 */
  selectedRow: number | null;
  onSelectRow: (summary: ProofRowSummary) => void;
}

/** 单行计数徽标（新增/缺失/替换；为 0 的项不显示） */
function CountChips({ row }: { row: ProofRowSummary }) {
  return (
    <span className="proof-chips">
      {row.added > 0 && <i className="proof-chip proof-chip-added">+{row.added}</i>}
      {row.missing > 0 && (
        <i className="proof-chip proof-chip-missing">−{row.missing}</i>
      )}
      {row.replaced > 0 && (
        <i className="proof-chip proof-chip-replaced">⇄{row.replaced}</i>
      )}
    </span>
  );
}

/**
 * 对版侧栏：按行汇总新增/缺失/替换数量与不可比较原因。
 * 一致行默认折叠；点击任意条目定位该行首个差异（视觉坐标，偶数行不镜像）。
 */
export default function ProofPanel({
  proof,
  selectedRow,
  onSelectRow,
}: ProofPanelProps) {
  const { totals, rows, issues } = proof;
  const visible = rows.filter(
    (r) => !r.comparable || !r.match || r.row === selectedRow,
  );

  return (
    <aside className="proof-sidebar" aria-label="对版结果（按行汇总）">
      <div className="proof-totals">
        <span className="proof-total proof-total-added">
          新增纹样 <strong>{totals.added}</strong>
        </span>
        <span className="proof-total proof-total-missing">
          缺失纹样 <strong>{totals.missing}</strong>
        </span>
        <span className="proof-total proof-total-replaced">
          颜色替换 <strong>{totals.replaced}</strong>
        </span>
        <span className="proof-total proof-total-info">
          一致 {totals.matchedRows} 行 · 差异 {totals.diffRows} 行 · 不可比较{' '}
          {totals.incomparableRows} 行
        </span>
      </div>

      <div className="proof-legend">
        <span className="legend-item">
          <i className="proof-swatch proof-swatch-added" /> 新增（底色→纹样）
        </span>
        <span className="legend-item">
          <i className="proof-swatch proof-swatch-missing" /> 缺失（纹样→底色）
        </span>
        <span className="legend-item">
          <i className="proof-swatch proof-swatch-replaced" /> 颜色替换（异色互换）
        </span>
        <span className="legend-item">
          <i className="proof-swatch proof-swatch-na" /> 不可比较行
        </span>
      </div>

      {visible.length === 0 ? (
        <div className="proof-all-ok">✓ 候选图案与当前网格逐格一致</div>
      ) : (
        <ul className="proof-row-list">
          {visible.map((row) => (
            <li key={row.row}>
              <button
                type="button"
                className={`proof-row-item${
                  row.row === selectedRow ? ' selected' : ''
                }${row.comparable ? '' : ' incomparable'}`}
                disabled={row.firstDiff === null}
                title={row.reason ?? undefined}
                onClick={() => onSelectRow(row)}
              >
                <span className="proof-row-no">
                  第 {String(row.row).padStart(2, '0')} 行
                </span>
                {row.comparable ? (
                  row.match ? (
                    <span className="proof-row-state proof-row-ok">一致</span>
                  ) : (
                    <CountChips row={row} />
                  )
                ) : (
                  <span className="proof-row-state proof-row-na">
                    不可比较
                    <span className="proof-row-reason">{row.reason}</span>
                  </span>
                )}
                {row.line !== null && (
                  <span className="proof-cmd-line">口令第 {row.line} 行</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      {issues.length > 0 && (
        <div className="proof-issues">
          <div className="proof-issues-head">
            {issues.length} 条候选行无法参与对版（针数错误或无法解析，整行不使用部分结果）：
          </div>
          <ul>
            {issues.map((issue, idx) => (
              <li key={`${issue.line}-${idx}`} className="proof-issue-msg">
                口令第 {issue.line} 行
                {issue.row !== null ? ` → 图案第 ${issue.row} 行` : ''}：
                {issue.message
                  .replace(/^第 \d+ 行（口令第 \d+ 行）/, '')
                  .replace(/^第 \d+ 行/, '')}
              </li>
            ))}
          </ul>
        </div>
      )}
    </aside>
  );
}
