# Dandithon_BE

단디보상운동 API · Node.js JavaScript.

## 실행

Node.js 22 이상. 이 폴더에서 `npm.cmd install` 후 `npm.cmd run dev`.
상태 확인: http://127.0.0.1:3001/api/health

현재 외부 패키지 없이 실행됩니다. `.env.example`은 환경변수 참고용입니다. `.env`는 자동 로드하지 않습니다. 포트 변경은 PowerShell에서 `$env:PORT=3002`로 설정하고 실행하세요. FE 개발 프록시 포트도 함께 변경해야 합니다.

## 구조

- `src/server.js`: 서버 시작과 기본 라우팅
- `src/routes/activities.js`: 연결 확인용 활동 데이터
- `src/modules/auth`: 로그인·인증
- `src/modules/users`: 사용자·관심사
- `src/modules/universities`: 소속 대학
- `src/modules/activities`: 활동 조회
- `src/modules/recommendations`: AI 활동 추천
- `src/modules/verifications`: 활동 인증·담당자 승인
- `src/modules/league`: 대학 리그·점수 집계
- `src/modules/records`: 개인 실천 기록·의연록
- `src/config`, `src/middlewares`, `src/utils`: 설정·공통 요청 처리·도구
- `src/repositories`: DB 접근
- `docs/api.md`: API 약속

기능별 폴더는 구현 시작점이며 아직 실제 기능은 없습니다. 각 기능이 커지면 모듈 안에 route, controller, service 파일을 추가하세요. 검증된 인증만 점수에 반영하는 정책은 서버에서 구현해야 합니다. 비밀 키와 DB 접속 정보는 환경변수로 관리합니다.

검사: `npm.cmd run check`. 현재 활동 목록은 예시 데이터이며 DB는 연결하지 않았습니다.
