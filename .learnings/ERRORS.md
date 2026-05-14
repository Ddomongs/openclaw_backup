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
