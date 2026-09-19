---
name: create-git-commit
description: Prepare, review, or create clean atomic Git commits for Agent Framework Capability Lab using the repository's trunk-based workflow and Conventional Commit format, without AI attribution. Use when asked to plan commits, write commit messages, split changes into commits, stage changes, or create a commit.
---

# Create an atomic Git commit

## Workflow

1. Confirm that the user explicitly requested or approved creating commits. A request to review a
   diff or suggest a message does not authorize a commit. Committing work in progress on a
   short-lived task branch is standing-approved and needs no separate ask; it is scaffolding for
   review and is collapsed before the branch lands.
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
  The one standing exception is collapsing a short-lived, unpushed task branch onto its merge
  base immediately before it fast-forwards into `main`.

## Two kinds of commit

An **iteration commit** lives on a task branch and exists so a reviewer can be handed one round
of changes instead of a whole branch. It may be as small or as messy as the work is, and a round
answering review findings is one commit with a `fixup:` subject. None of these reaches `main`.

A **landing commit** is what the branch becomes before it is merged: the content rules below
apply to it in full. Collapse with `git reset --soft $(git merge-base main HEAD)` and commit
again — the working tree is untouched, so the tree that passed `make check` is the tree that
lands, and `git diff <the recorded branch tip> HEAD` must print nothing. Do not use
`git rebase -i`; it is unavailable in the agent environment and unnecessary for a branch
collapsing to one commit.

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
