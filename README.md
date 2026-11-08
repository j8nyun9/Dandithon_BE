# Dandithon_BE — 단디보상운동 API

Node.js · SQLite(로컬) · PostgreSQL(배포) 기반 API입니다. 프론트엔드와 별도로 실행합니다.

## 실행과 검사

Node.js 22.19 이상이 필요합니다.

```powershell
npm.cmd ci
npm.cmd run seed
npm.cmd run dev
```

기본 주소는 http://127.0.0.1:3001/api/health 입니다. `.env.example`은 참고용이며 환경변수는 실행 환경에서 설정합니다.
`npm.cmd run check`, `npm.cmd test`로 검사합니다. `seed`는 기존 사용자가 있으면 초기화하지 않습니다. 로컬 기본 시드 계정은 `knu@demo.local` / `DemoStudent!123`, 관리자 `admin@demo.local` / `DemoAdmin!123`입니다. 공개 배포 계정은 별도 관리하며 기본 관리자 암호를 사용하지 않습니다.

## 구현 기능

로그인·역할별 권한 검사, 활동 조회·신청 표시·참여 확인, 관리자 승인, 학교별 대학 리그, 공동 목표 집계, 시즌별 의연록과 개인 참여 이력을 제공합니다.
공통 성공 응답은 `{ data: 결과 }`, 실패 응답은 `{ error: { code, message } }`입니다.
상세 계약은 [API 문서](docs/api.md)를 참고하며, 현재 동작의 기준은 라우트 구현과 테스트입니다.
비밀번호는 salt를 사용한 scrypt 해시로 저장하며 API에 반환하지 않습니다.
공식 외부 신청과 실제 봉사 여부 확인은 기관·관리자가 수행합니다. 신청 완료 표시는 학생의 자기 기록입니다.

## AI

`AI_MODE=live`, `OPENAI_API_KEY`를 설정하면 실제 모델 요청을 시도합니다. `OPENAI_MODEL`은 분류·추천에 사용할 모델을 지정합니다.
학생 추천은 선택한 관심 분야와 DB에서 조회한 분야별 승인 참여 횟수, 공개 가능한 활동 후보를 입력으로 사용합니다. 반환된 활동 ID와 이유를 검증하며 후보에 없는 ID를 허용하지 않습니다.
실제 성공 응답은 `mode: live`, 미설정·호출 실패·유효하지 않은 결과의 대체 응답은 `mode: mock`입니다. 기본 추천을 실제 AI 결과로 소개하지 않습니다.
공고 수집은 1365 목록과 VMS 검색·원문 확인을 사용합니다. 외부 사이트 접근 가능 여부, 검색 결과, 모델 설정에 따라 수집이 실패할 수 있습니다. `OPENAI_SEARCH_MODEL`은 검색용으로 별도 설정합니다. VMS 중계 설정은 `scripts/wrangler-vms.jsonc`와 관련 문서를 참고합니다.

## 배포

서비스 주소: https://dandi-backend.onrender.com
운영 환경은 `NODE_ENV=production`, `HOST=0.0.0.0`, 영구 `DATABASE_URL`, 32자 이상의 `DANDI_SECRET`을 설정합니다. 포트는 Render의 `PORT`를 사용합니다.
저장소 push와 실제 Render 배포 완료는 다릅니다. 배포 로그, `/api/health`, 로그인과 추천을 각각 확인합니다. 기본 시연 암호·비밀 키를 운영 환경에 사용하지 않습니다.

## 구조와 제한

`src/server.js`는 HTTP 진입점, `src/app.js`는 API 라우팅·권한·업무 처리를 담당합니다. `src/modules`에는 공고 수집과 PostgreSQL 연동 등이 분리되어 있습니다. 핵심 라우팅이 큰 파일에 모여 있어 후속 기능 확장 시 도메인별 분리가 필요합니다.
SQLite는 로컬 개발용이며 배포 데이터는 영구 PostgreSQL에 보관합니다. 공식 실적 자동 인증이나 외부 기관 신청 완료 확인은 제공하지 않습니다.
