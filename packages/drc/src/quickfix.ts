import { mergeNodes, type Command } from '@vitrum/model'

import type { QuickFix } from './types'

/**
 * Turn a violation's {@link QuickFix} data into the document `Command` that applies it (F-030 open
 * question 1). Keeping this the single quick-fix seam means new fixes (F-031/F-032) add a `QuickFix`
 * variant and a branch here, not new plumbing. The weld pilot reuses F-013's `mergeNodes`, so the
 * fix is one undo entry and reuses the tested junction-merge path.
 */
export function quickFixCommand(fix: QuickFix): Command {
  switch (fix.kind) {
    case 'weld':
      return mergeNodes(fix.keepNodeId, fix.dropNodeId)
  }
}
