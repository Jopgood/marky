# Implement

Implement the change as described, then verify it.

When there is an approved spec, implement it on the spec's branch and pull request; its validation section is your checklist. Link the pull request on the issue.

Verify in two parts:

1. Static checks: follow the repo's agent guidance (AGENTS.md) for which checks to run.
2. For any change a user can see, run the app and prove it works: follow skills/ui-verification/SKILL.md. The pull request is not done until its description has a Visual proof section with screenshots, or an exact account of why the app couldn't be run.

Before opening a PR, use skills/merge-risk/SKILL.md to mitigate risk ahead of PR, if possible.

Report the "Impact" and "Rollback cost" as sectioned headings in the PR, with a **Verdict** matching the risk for that category, and a brief summary for each.
