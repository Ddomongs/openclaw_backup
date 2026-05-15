# Errors

Command failures and integration errors.

---

## [ERR-20260514-001] self_improvement_skill_path_stale

**Logged**: 2026-05-14T22:22:00+09:00
**Priority**: low
**Status**: resolved
**Area**: config

### Summary
Attempted to read the self-improving-agent skill from the old workspace install path after moving ClawHub skills to the global managed install root.

### Error
```text
ENOENT: no such file or directory, access '/Users/dh/.openclaw/workspace/skills/self-improving-agent/SKILL.md'
```

### Context
- Operation attempted: read skill instructions before enabling the hook
- Correct path after global install: `/Users/dh/.openclaw/skills/self-improving-agent/SKILL.md`
- Cause: current session's injected available_skills snapshot still referenced the removed workspace copy.

### Suggested Fix
For skills moved from workspace to global install root, use the managed path under `/Users/dh/.openclaw/skills/` until a new session refreshes the skill snapshot.

### Metadata
- Reproducible: yes
- Related Files: /Users/dh/.openclaw/skills/self-improving-agent/SKILL.md

---

## [ERR-20260514-002] browser_navigation_blocked_local_dashboard

**Logged**: 2026-05-14T22:36:00+09:00
**Priority**: low
**Status**: resolved
**Area**: tooling

### Summary
OpenClaw browser tool blocked direct navigation to the local dashboard URL during visual QA.

### Error
```text
browser navigation blocked by policy
```

### Context
- Operation attempted: browser open/navigate to `http://127.0.0.1:8765/`
- Workaround used: Chrome headless screenshot with a temporary user-data-dir, then image QA on the saved PNG.
- Dashboard file: `/Users/dh/dashboard/workflow-kanban/index.html`

### Suggested Fix
For local dashboard QA when browser navigation is policy-blocked, use headless Chrome screenshot or another approved local browser path, then run image QA against the captured PNG.

### Metadata
- Reproducible: unknown
- Related Files: /Users/dh/dashboard/workflow-kanban/index.html

---

## [ERR-20260514-003] python_non_utf8_dashboard_script

**Logged**: 2026-05-14T23:25:00+09:00
**Priority**: low
**Status**: resolved
**Area**: tooling

### Summary
Temporary Python dashboard rewrite script failed because Korean text was present without an explicit source encoding declaration.

### Error
```text
SyntaxError: Non-UTF-8 code starting with '\xec' in file /tmp/redesign_workflow_dashboard.py, but no encoding declared
```

### Context
- Operation attempted: rewrite `~/dashboard/workflow-kanban/index.html` with Korean labels.
- Fix used: added `# -*- coding: utf-8 -*-` to the temporary Python script and reran successfully.

### Suggested Fix
When generating temporary Python scripts that include Korean or other non-ASCII labels, add an explicit UTF-8 coding header or write the file with a UTF-8-safe mechanism.

### Metadata
- Reproducible: environment-dependent
- Related Files: /Users/dh/dashboard/workflow-kanban/index.html

---

## [ERR-20260515-001] dashboard_localization_global_replace

**Logged**: 2026-05-15T00:01:00+09:00
**Priority**: medium
**Status**: resolved
**Area**: frontend

### Summary
A broad English-to-Korean string replacement for the dashboard HTML accidentally modified JavaScript identifiers and data property names.

### Error
```text
Examples of bad generated strings: 실패ures, 대기Outbox, render개요, render운영, not사용 가능
```

### Context
- Operation attempted: Korean-localize `~/dashboard/workflow-kanban/index.html`.
- Cause: global replacements like `failed -> 실패`, `queued -> 대기`, `Ready -> 사용 가능` were applied to JS code as well as visible labels.
- Fix used: regenerated the dashboard from the known-good template, then changed only static UI strings and visible render labels while preserving data keys.

### Suggested Fix
When localizing dashboards, avoid global replacements on mixed HTML/JS files. Use explicit UI label maps such as `labelStatus`, `labelPriority`, and `labelKind`, or edit only known static strings.

### Metadata
- Reproducible: yes
- Related Files: /Users/dh/dashboard/workflow-kanban/index.html

---

## [ERR-20260515-001] browser_open_localhost_policy

**Logged**: 2026-05-15T09:47:00+09:00
**Priority**: medium
**Status**: pending
**Area**: dashboard-qa

### Summary
OpenClaw browser tool reported `browser navigation blocked by policy` when opening local dashboard URL for visual QA.

### Details
After `scripts/browser-mcp/browser-ensure-ready.sh` returned ready, browser profile `user` tabs failed with missing DevToolsActivePort. Managed `openclaw` profile started successfully, but `browser.open`/`browser.navigate` to `http://127.0.0.1:8765/#actions` was blocked by policy.

### Suggested Action
For local dashboard QA, keep a fallback using Playwright/Chromium screenshot via exec when the browser tool cannot navigate to localhost, and report the browser-tool blocker separately.

### Metadata
- Source: conversation
- Related Files: /Users/dh/dashboard/workflow-kanban/index.html
- Tags: browser, dashboard, qa, localhost

---
