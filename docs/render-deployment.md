# Render 무료 배포 안내

이 프로젝트는 해커톤 시연용입니다. 공개 서비스에 실제 개인정보나 증빙 자료를 입력하지 마세요. 현재 PostgreSQL 연결은 단일 프로세스에서 동기식으로 기다리는 임시 호환 계층입니다. 동시 접속이 많거나 Neon 연결이 느리면 전체 API가 지연될 수 있으므로 소규모 시연에만 사용합니다.

## 현재 데이터와 비밀 정보

- 현재 데이터는 Neon에 1회 복사한 시점의 스냅샷입니다. 이후 로컬 SQLite와 Neon은 자동 동기화되지 않습니다. 공개 시연에서는 Neon을 기준으로 사용합니다.
- `.env.local`의 `DATABASE_URL`은 비공개입니다. `.deployment-credentials`에는 생성된 관리자·기관 비밀번호와 `DANDI_SECRET`이 들어 있습니다. 두 파일을 Git, 채팅, 공개 문서에 올리지 마세요. 다른 사람이 접근할 수 없는 장소에 별도로 보관하세요.
- 학생 계정은 기존 데모 비밀번호를 사용합니다. 관리자·기관 계정은 Neon에서 새 비밀번호를 사용하며, 기존 로컬 SQLite 계정은 변경되지 않았습니다.
- 이관 스크립트는 대상 테이블이 있으면 중단합니다. 공개 서버에 사용하기 시작한 뒤 다시 이관하지 마세요.

## 준비

서버 배포에는 이번 변경이 포함된 Git 브랜치가 필요합니다. GitHub의 기존 브랜치에 올리는 것은 저장소 주인이 변경 사항을 검토하고 선택합니다. `.env.local`, `.deployment-credentials`, `*.sqlite`, `node_modules`는 올리지 마세요.

## 1. 백엔드: Render Web Service

Render에서 **New → Web Service**를 선택하고 BE 저장소와 준비된 브랜치를 연결합니다.

| 항목 | 값 |
| --- | --- |
| Region | Singapore |
| Instance type | Free |
| Build Command | `npm ci` |
| Start Command | `npm start` |
| Health Check Path | `/api/health` |

Environment에 아래 값을 설정합니다. Render 대시보드의 비밀 값에 입력하며 채팅이나 Git에 올리지 마세요.

| 이름 | 값 |
| --- | --- |
| `NODE_VERSION` | `22.19.0` |
| `NODE_ENV` | `production` |
| `HOST` | `0.0.0.0` |
| `DATABASE_URL` | 로컬 `.env.local`의 해당 값 |
| `DANDI_SECRET` | 로컬 `.deployment-credentials`의 해당 값 |
| `AI_MODE` | `live` 또는 비용 없는 `mock` |
| `OPENAI_API_KEY` | 실제 AI를 사용할 때만 입력 |

`PORT`는 Render가 제공합니다. 생성된 백엔드 주소의 `/api/health`가 정상인지 확인합니다. `production`에서는 데이터베이스, 긴 비밀키, 변경된 관리자 비밀번호가 없으면 서버가 시작되지 않습니다.

## 2. 프론트엔드: Render Static Site

**New → Static Site**에서 FE 저장소와 준비된 브랜치를 연결합니다. Build Command는 `npm ci && npm run build`, Publish Directory는 `dist`, `NODE_VERSION`은 `22.19.0`입니다.

Redirects/Rewrites에 다음 두 규칙을 **이 순서로** 추가합니다. 첫 번째 URL은 실제 백엔드 주소로 대체합니다.

| Action | Source | Destination |
| --- | --- | --- |
| Rewrite | `/api/*` | `https://백엔드주소.onrender.com/api/*` |
| Rewrite | `/*` | `/index.html` |

화면의 로그인과 POST 요청까지 실제로 성공하는지 확인합니다. 외부 rewrite 설정이 적용되지 않으면 배포를 완료한 것으로 간주하지 않습니다.

## 제출 전 확인

- 학생 다섯 학교의 데모 계정으로 로그인하고 활동 조회, 신청 완료 표시, 참여 확인 요청을 시험합니다.
- `.deployment-credentials`의 관리자 계정으로 승인·승인 취소와 리그 변화를 확인합니다. 제출 폼에는 운영진에게 필요한 시연 계정만 기입합니다.
- 활동 원문과 공식 신청 URL, 자동 수집 결과, 공개 GitHub 저장소, 전체 서비스 주소를 확인합니다. 공식 완료 인증은 관리자가 확인합니다.
- 무료 Render는 일정 시간 사용하지 않으면 잠들어 첫 응답이 느리고, 잠든 동안 정기 공고 수집은 실행되지 않습니다. OpenAI API는 별도 사용료가 발생할 수 있습니다. 외부 사이트 검색 결과도 보장되지 않습니다.
- 2026년 11월 10일 화요일의 정확한 마감 시각은 운영진에 재확인합니다. 제출 이후 변경이 금지되어 있으므로 마감 전 GitHub·Render 자동 배포 설정을 확인하고, 최종 제출물과 서비스의 상태를 유지합니다.
