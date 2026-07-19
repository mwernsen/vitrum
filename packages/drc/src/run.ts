import { exclusionKey, SEVERITY_RANK } from './identity'
import { RULES } from './registry'
import type { DrcInput, Rule, RunResult, Severity, Violation } from './types'

/**
 * Run every enabled rule against the input and assemble the {@link RunResult}. Pure and
 * deterministic (FR-5): the output depends only on the input and the rule list, and violations
 * are ranked most-severe first with a stable tiebreak.
 *
 * Per-project overrides (FR-3/FR-4) are read from `input.project.drc`:
 * - a rule with `enabled === false` is skipped entirely (no violations, no waivers);
 * - a rule's `severity` override replaces its default on every violation it emits;
 * - a violation whose key is in `exclusions` is a waiver: it moves to `excluded` and does not
 *   count toward the active totals.
 */
export function runChecks(input: DrcInput, rules: readonly Rule[] = RULES): RunResult {
  const { rules: overrides, exclusions } = input.project.drc
  const active: Violation[] = []
  const excluded: Violation[] = []

  for (const rule of rules) {
    const override = overrides[rule.id]
    if (override?.enabled === false) continue
    const severity: Severity = override?.severity ?? rule.defaultSeverity

    for (const raw of rule.check(input)) {
      const key = exclusionKey(rule.id, raw)
      const waiver = exclusions[key]
      const violation: Violation = {
        ruleId: rule.id,
        title: rule.title,
        severity,
        message: raw.message,
        explain: rule.explain,
        at: raw.at,
        segmentIds: raw.segmentIds ?? [],
        pieceIds: raw.pieceIds ?? [],
        key,
        ...(raw.distance !== undefined ? { distance: raw.distance } : {}),
        ...(raw.quickFix ? { quickFix: raw.quickFix } : {}),
        ...(waiver ? { note: waiver.note } : {}),
      }
      if (waiver) excluded.push(violation)
      else active.push(violation)
    }
  }

  active.sort(rank)
  excluded.sort(rank)

  return {
    violations: active,
    excluded,
    counts: {
      error: active.filter((v) => v.severity === 'error').length,
      warning: active.filter((v) => v.severity === 'warning').length,
      info: active.filter((v) => v.severity === 'info').length,
    },
  }
}

/** Most-severe first, then by rule id, then by key — a total order for stable output. */
function rank(a: Violation, b: Violation): number {
  return (
    SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
    (a.ruleId < b.ruleId ? -1 : a.ruleId > b.ruleId ? 1 : 0) ||
    (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
  )
}
