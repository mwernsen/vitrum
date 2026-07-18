# F-XXX: <Feature name>

|                |                                        |
| -------------- | -------------------------------------- |
| **Phase**      | N — <phase name>                       |
| **Status**     | draft \| agreed \| in-progress \| done |
| **Depends on** | F-YYY, F-ZZZ                           |
| **Complexity** | S \| M \| L \| XL                      |

## Summary

Two or three sentences: what this feature is and why it exists.

## User story

As a stained glass designer, I want … so that …

## Scope

What is included. Bullet list, each item testable.

### Non-goals

What is explicitly deferred, and to which feature doc it is deferred.

## Design

Which design-system components/screens apply (see F-004): name the `components/core`
primitives and any `ui_kits/studio` screen this feature's UI must match. New UI with
no existing design goes to the Claude Design project first. Omit this section only
for features with no UI surface.

## Functional requirements

Numbered, testable requirements (FR-1, FR-2, …). These are the contract.

## Technical guidance

Suggested approach, key data structures, libraries to consider, pitfalls. The
implementing agent may deviate with justification, but must not deviate from the
functional requirements without supervisor sign-off.

## Acceptance criteria

Concrete checks a reviewer performs to call this done, including tests that must exist.

## Open questions

Decisions the supervisor (Mathieu) must make before or during implementation.

## Implementation notes

(Filled in by the implementing agent after completion: deviations, follow-ups.)
