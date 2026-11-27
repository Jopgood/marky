# Marky Factory

A software factory modeled on the [Warp Learn course](https://www.warp.dev/learn), without Warp. The definition files use Warp's format and started as copies of Warp's lesson 5 checkpoint (`warpdotdev-demos/warp-learn-factory-checkpoints`). GitHub Actions plus Claude Code replace the Warp runtime.

| Warp                  | Here                                                                 |
| --------------------- | -------------------------------------------------------------------- |
| Factory runtime       | `.github/workflows/factory.yml` → `runner/run-stage.mjs`             |
| Worker sandbox        | A fresh headless Claude Code session per stage on `ubuntu-latest`    |
| Factory chat          | Comments on the issue; mention `@factory` to start or nudge a task  |
| Runs tab              | Actions runs. Transcripts and media are uploaded as run artifacts    |
| Task state            | One hidden comment on the tracking issue                             |
| Webhook source        | `repository_dispatch` of type `error-monitor` (from a relay)         |

## How a task moves

1. The `factory` label on an issue, an `@factory` comment, or an error-monitor dispatch starts a task.
2. The runner walks `factory.yaml`'s blueprint: triage → spec → implement → handoff. Each stage gets its worker prompt, stage prompt and inputs, and replies with `outputs`, `next` and `message`.
3. A stage that needs a human (spec questions, spec approval, an unclear request) posts its message and sets `next: wait`. The next comment from a collaborator resumes that stage.
4. The factory opens draft PRs only. Merging stays with you.

Only comments from repo owners, members and collaborators reach the factory. Issue and payload text is passed to workers as untrusted data.

## Setup

```sh
claude setup-token                                # then:
gh secret set CLAUDE_CODE_OAUTH_TOKEN             # or: gh secret set ANTHROPIC_API_KEY
gh label create factory --color 5319e7 --description "Send to Marky Factory"
gh api -X PUT repos/Jopgood/marky/actions/permissions/workflow \
  -f default_workflow_permissions=write -F can_approve_pull_request_reviews=false
```

That last setting doesn't let Actions open PRs by itself. Also turn on "Allow GitHub Actions to create and approve pull requests" under Settings → Actions. PRs opened with the default token don't start other workflows. If you want CI to run on factory PRs, add a fine-grained PAT as `FACTORY_GH_TOKEN`.

Seed Warp's sample backlog, then label one issue to start:

```sh
pnpm seed-backlog
```

## Develop

```sh
cd .factory/runner && npm install --no-package-lock && npm test
```

To dry-run locally, set `FACTORY_DRY_RUN=1`, point `FACTORY_CLAUDE_BIN` at a fake `claude`, and set `GITHUB_EVENT_NAME`, `GITHUB_EVENT_PATH` and `GITHUB_REPOSITORY`.

## Not yet

- Linear intake. For now, use Linear's GitHub issue sync and the `factory` label.
- Error-monitor relay: a small public endpoint that verifies the Standard Webhooks signature and calls `repository_dispatch`.
- Unit 3 work: scorers, self-improvement and benchmarks. Per-task cost and transcripts are already recorded for it.
