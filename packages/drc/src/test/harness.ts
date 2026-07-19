import { detectPieces, pieceKey } from '@vitrum/core'
import { outputSegments, type Project } from '@vitrum/model'

import type { DrcInput, RunResult, Severity } from '../types'

/**
 * Build the {@link DrcInput} for a project the way the app does: detect pieces + diagnostics
 * (F-020), then resolve `assignedKeys` as the content ids of pieces that have a stored glass. In
 * the pure/golden path effective glass equals the direct assignment (cold detection), which is
 * exactly the reload state the engine is specified against.
 */
export function buildInput(project: Project): DrcInput {
  const { pieces, diagnostics } = detectPieces(outputSegments(project))
  const assignedKeys = pieces.map(pieceKey).filter((key) => key in project.assignments)
  return { project, pieces, diagnostics, assignedKeys }
}

/** Active-violation counts by rule id, for comparing against a scene's expected set. */
export function countByRule(result: RunResult): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const v of result.violations) counts[v.ruleId] = (counts[v.ruleId] ?? 0) + 1
  return counts
}

export function countBySeverity(result: RunResult, severity: Severity): number {
  return result.violations.filter((v) => v.severity === severity).length
}
