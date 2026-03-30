# BACKUP.md — Workspace 백업 규칙

## 목적
OpenClaw workspace 설정 파일과 운영 문서를 GitHub private repo로 백업한다.

## 현재 백업 방식
- 로컬: git 관리
- 원격: GitHub private repo
- remote: `origin`
- branch: `main`

## 백업 대상
- `AGENTS.md`
- `SOUL.md`
- `USER.md`
- `IDENTITY.md`
- `TOOLS.md`
- `HEARTBEAT.md`
- 자동화 스크립트 및 운영 문서

## 기본 제외 대상
`.gitignore` 기준:
- `.openclaw/`
- `memory/`
- `MEMORY.md`
- `.env*`
- 키/인증서 파일
- 로그/임시 파일

## 운영 원칙
- 민감정보는 workspace에 두더라도 기본적으로 git 제외 처리한다.
- 외부 공유 가능성이 없는 private repo만 사용한다.
- 큰 변경 전후에는 커밋을 남긴다.
- 의미 있는 설정 변경은 한 번에 묶어서 커밋한다.

## 권장 작업 흐름
1. `git status`
2. `git add .`
3. `git commit -m "<변경 요약>"`
4. `git push`

## 커밋 메시지 예시
- `Update assistant identity and tone`
- `Add marketplace automation notes`
- `Refine backup ignore rules`

## 참고
- `memory/`와 `MEMORY.md`를 백업에 포함하고 싶다면, 민감도 검토 후 `.gitignore`를 수정한다.
- 시스템/자격증명 관련 파일은 가능하면 repo 밖에서 관리한다.
