---
name: copilot-api-upstream-sync
description: >
  Merge the latest caozhiyuan/copilot-api upstream/dev changes into this hrz6976
  fork, preserve the @hrz6976/copilot-api package identity, mirror any
  upstream version bump, validate the merged tree, tag the fork merge commit,
  push dev and the release tag, and restore unrelated local work. Use when the
  user asks to sync, merge, update, or release the fork from upstream.
---

# Copilot API Upstream Sync

Use this skill only for the repository containing:

- `origin`: `https://github.com/hrz6976/copilot-api`
- `upstream`: `https://github.com/caozhiyuan/copilot-api`
- release branch: `dev`
- npm package: `@hrz6976/copilot-api`

The goal is to preserve the fork's custom commits and package scope while
integrating the latest `upstream/dev` history. If upstream bumped its version,
the fork must use that exact version and tag the fork merge commit.

## Non-negotiable rules

1. Never include unrelated tracked or untracked work in the merge commit.
2. Never change the root package name away from `@hrz6976/copilot-api`.
3. Keep all fork-owned package metadata pointed at this fork: root `homepage`,
   `bugs`, and `repository.url` must use `https://github.com/hrz6976/copilot-api`
   (with `/issues` for `bugs`), and root/desktop `author` must be `hrz6976`.
4. Keep the version identical in `package.json`, `package-lock.json`, and
   `desktop/package.json` when upstream bumped it.
5. Tag the fork merge commit, not the raw upstream commit.
6. Do not rewrite `dev`, force-push the branch, or overwrite an existing remote
   tag without explicit user authorization.
7. Resolve conflicts semantically. Preserve both upstream behavior and fork
   customizations when they do not contradict each other.
8. Run release validation with `DEBUG` removed from the environment because an
   ambient `DEBUG` value can contaminate subprocess output in tests.
9. Restore the user's pre-existing local work after the push, even if release
   verification later fails.

## Phase 1: Inspect and protect local state

Start with read-only checks:

```bash
git status --short --branch
git remote -v
git branch -vv
git stash list
```

Confirm that the current branch is `dev`, `origin` is the fork, and `upstream`
is the source repository. If remotes do not match the expected repositories,
stop and ask the user before changing them.

If the working tree contains any changes or untracked files, create one named
stash that includes untracked files:

```bash
git stash push --include-untracked -m "codex-pre-upstream-sync-YYYYMMDD-HHMMSS"
```

Record the stash message. Do not assume it remains `stash@{0}` because commit
hooks may create temporary stashes later.

## Phase 2: Fetch and inspect upstream

Fetch branches without importing all upstream tags. Fork release tags often use
the same names as upstream tags but intentionally point to fork merge commits,
so a broad `git fetch --tags upstream` can produce tag-clobber conflicts.

```bash
git fetch --prune origin
git fetch --prune upstream +refs/heads/dev:refs/remotes/upstream/dev
git rev-list --left-right --count dev...upstream/dev
git log --oneline --decorate --no-merges dev..upstream/dev
git log --oneline --decorate --merges dev..upstream/dev
```

Read upstream package metadata directly from the fetched branch:

```bash
git show upstream/dev:package.json
git show upstream/dev:package-lock.json
git show upstream/dev:desktop/package.json
```

Record:

- the current fork version;
- the upstream version;
- whether a version bump occurred;
- the upstream commit being merged;
- the ahead/behind counts and incoming commit summary.

If `dev..upstream/dev` is empty, restore any saved stash before reporting that
the fork is already current. Do not create an empty merge commit or tag.

## Phase 3: Merge without auto-committing

Use a merge commit to preserve both histories and stop before committing so the
result can be audited:

```bash
git merge --no-ff --no-commit upstream/dev
```

If there are conflicts, list them with:

```bash
git diff --name-only --diff-filter=U
git diff --cc
```

Apply these conflict rules:

- `package.json`: keep `"name": "@hrz6976/copilot-api"`; keep `homepage`,
  `bugs`, and `repository.url` on `https://github.com/hrz6976/copilot-api`;
  keep `author` as `hrz6976`; and use the exact upstream version.
- `package-lock.json`: keep `@hrz6976/copilot-api` in both the top-level `name`
  and `packages[""].name`; use the exact upstream version in both version
  fields.
- `desktop/package.json`: keep `author` as `hrz6976` and use the exact upstream
  version.
- README files: keep fork-specific installation, package-scope, provider, and
  compatibility guidance while incorporating non-conflicting upstream updates.
- Source files: preserve fork provider behavior and integrate upstream logic.
- Tests: retain fork regression coverage and add upstream scenarios; do not
  choose one entire side merely to remove conflict markers.

Use `apply_patch` for manual edits. When a whole side is a suitable base, select
that side first and then patch the other side's unique behavior back in.

Before staging, verify there are no conflict markers:

```bash
rg -n '^(<<<<<<<|=======|>>>>>>>)' . \
  -g '!node_modules' -g '!dist' -g '!desktop/dist'
```

Stage only merge-related files. Then verify:

```bash
git diff --name-only --diff-filter=U
git diff --cached --check
git status --short
```

If upstream did not bump the version, retain the fork's current version and do
not create a new release tag.

## Phase 4: Validate the merged tree

Run focused tests for conflicted or behaviorally overlapping areas first. Then
run the complete release checks:

```bash
env -u DEBUG bun run lint:all
env -u DEBUG bun run typecheck
env -u DEBUG bun test
env -u DEBUG bun run build
env -u DEBUG bun run build:desktop
npm pkg get name version author homepage bugs repository
npm pack --dry-run --json --ignore-scripts
```

The metadata output must contain no `caozhiyuan` or `jeffreycao` identity. npm
trusted publishing validates `repository.url` against the GitHub Actions
provenance repository and rejects the release when it points upstream.

Do not commit or push if validation fails. Fix only failures caused by the merge;
report unrelated pre-existing failures separately.

After formatters or commit hooks modify files, rerun the checks relevant to the
modified files and confirm all intended changes are staged.

## Phase 5: Commit and tag

For a version bump to `<version>`, create the merge commit with:

```bash
git commit -m "chore: merge upstream v<version>"
```

Confirm it has two parents and that the second parent is the fetched upstream
commit:

```bash
git rev-parse HEAD^1 HEAD^2 upstream/dev
```

Before creating the tag, inspect local and fork-remote refs:

```bash
git show-ref --tags "v<version>"
git ls-remote --tags origin "refs/tags/v<version>"
```

Tag policy:

- If `origin` has no `v<version>` tag, create or locally retarget the lightweight
  tag to `HEAD`. A local tag may currently point to the raw upstream commit.
- If `origin/v<version>` already points to `HEAD`, no tag change is needed.
- If the remote tag exists at a different commit, stop. Do not force-update it
  unless the user explicitly authorizes replacing a published release.

For a new fork tag:

```bash
git tag -f "v<version>" HEAD
```

When there is no version bump, commit as `chore: merge upstream changes`, skip
tag creation, and push only `dev`.

## Phase 6: Push and verify refs

Push the branch first, then a newly created version tag:

```bash
git push origin dev
git push origin "refs/tags/v<version>"
```

Do not use `--force`. Verify exact remote refs:

```bash
git ls-remote origin refs/heads/dev "refs/tags/v<version>"
git rev-parse HEAD origin/dev "v<version>"
```

For a version release, all three hashes must match the fork merge commit.

Pushing `v*` triggers `.github/workflows/release.yml`, which runs lint,
typecheck, tests, build, GitHub release generation, and npm publication. Stable
versions publish under npm's `latest` tag. Prerelease versions such as
`1.14.5-post.1` publish under the channel before the first dot (`post`).

If the user asked to confirm publication and GitHub CLI authentication is
available, verify the CI run, Release run, GitHub release, and npm package
version. A successful Git push alone does not prove npm publication completed.

## Phase 7: Restore local work

Find the saved stash by its unique message rather than by position:

```bash
git stash list
```

Pop that exact stash. If restoration conflicts, do not discard anything; report
the conflicted paths and leave the stash available when Git has not dropped it.

Finally verify:

```bash
git status --short --branch
git stash list
```

The branch should match `origin/dev`. Any remaining changes should be the user's
original unrelated work, not release files accidentally left modified.

## Completion report

Report these facts concisely:

- upstream version and commit merged;
- fork merge commit;
- fork package name and final version;
- validation commands and test count;
- pushed branch and tag refs;
- publication status if checked;
- whether original local work was restored;
- any intentionally untouched untracked files.

Do not claim GitHub release or npm publication success unless it was explicitly
verified.
