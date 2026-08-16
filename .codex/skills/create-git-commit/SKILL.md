---
name: create-git-commit
description: Prepare, review, or create clean atomic Git commits for Agent Framework Capability Lab using the repository's trunk-based workflow and Conventional Commit format, without AI attribution. Use when asked to plan commits, write commit messages, split changes into commits, stage changes, or create a commit.
---

# Create an atomic Git commit

## Workflow

1. Confirm that the user explicitly requested or approved creating commits. A request to review a
   diff or suggest a message does not authorize a commit.
2. Inspect `git status`, unstaged and staged diffs, the current branch, and recent commit subjects.
   Preserve user changes and never stage unrelated files.
3. Confirm the work is on a short-lived branch created from `main`. If `main` has no initial commit,
   stop and obtain approval for a baseline commit before creating the task branch.
4. Split the diff into independent logical changes. Propose the split before committing when more
   than one commit is needed or file ownership is ambiguous.
5. Run the checks appropriate to each change. Do not use a commit to bypass a failing hook or test.
6. Stage only the files or hunks for the next atomic change and inspect `git diff --cached`.
7. Create the commit with the format below, then verify the commit and remaining working tree.

## Commit content

- Give each commit one clear purpose. If the subject needs “and” or a comma for separate changes,
  split it.
- Keep commits independently understandable, reviewable, and revertible.
- Keep tests, contracts, migrations, and documentation required by a behavior in the same commit as
  that behavior.
- Do not reference `PLAN.md` milestone or step numbers; name the technical outcome.
- Never rewrite, squash, amend, or force-push existing history without explicit user approval.

## Message format

Use Conventional Commits:

```text
<type>(<scope>): <short description>

<optional body explaining why>
```

Allowed types: `feat`, `fix`, `docs`, `chore`, `refactor`, `test`, `style`, `perf`, `ci`.

Use a scope only when the change is confined to a clear component or layer. Write the subject in
the imperative, keep it concise, and omit a trailing period. Add a body only when the motivation or
trade-off is not evident from the diff.

Examples:

```text
feat(ui): add Tailwind theme primitives
chore(test): configure Vitest with Testing Library
docs: document τ³-inspired scenario design
```

## No AI attribution

Write every commit as a human developer. Never mention an AI agent or tool in the subject, body, or
trailers. Never add `Generated-by`, `Made-with`, AI `Co-authored-by`, or similar metadata.
