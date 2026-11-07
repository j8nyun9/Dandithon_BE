# API 계약 (로컬 시제품)

성공 `{ "data": ... }`, 실패 `{ "error": { "code": "...", "message": "..." } }`. `/api/health`, `/api/activities`, 로그인 외에는 Bearer 토큰 필요. 실제 AI 호출은 `data.mode`가 `live`일 때만 발생합니다.

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| GET | /api/health | 상태 |
| GET | /api/activities | 기존 FE 호환 데이터. minutes·points는 임시 0 |
| POST | /api/auth/login | `{ "email": "knu@demo.local", "password": "DemoStudent!123" }` → 토큰 |
| GET | /api/missions | 관리자 확인 및 모집 중인 미션 목록 |
| GET | /api/missions/1 | 상세 및 조회 이벤트 |
| POST | /api/missions/1/click | 학생 클릭 기록 및 공식 신청 URL. 클릭은 신청 아님 |
| POST | /api/ai/structure | 관리자/기관 `{ "notice": "기관이 제공한 공고" }` → AI 구조화 제안 |
| POST | /api/ai/recommend | 학생 `{ "profile": { "interests": ["mentoring"] } }` → 등록된 미션 ID 추천 |
| POST | /api/missions | 관리자 미션 등록. 예시는 아래 |
| POST | /api/missions/1/verification | 관리자/기관 실적 상태 변경. 예시는 아래 |
| POST | /api/admin/import-csv | 관리자/기관 CSV 일괄 승인. 오류시 전부 롤백 |
| GET | /api/league?semester_id=1 | 학교별 종합값과 여섯 축 |
| GET | /api/partner/funnel?organization_id=1 | 소속 기관별 집계. 상태별 인원, 5명 미만 null |

미션 등록: `{"organization_id":1,"semester_id":1,"title":"시연 멘토링","notice":"기관 제공 시연 원문","source_url":"https://example.org/notice","apply_url":"https://example.org/apply","eligibility":"대학생","application_note":"선착순 조기 마감","application_start":"2026-11-07","application_end":"2026-11-30","completion_policy":"기관 확인","rules_version":"demo-v1","weights":{"mentoring":0.5,"scholarship":0.5},"contribution_value":2,"is_demo":true}`. 최대 2축, 가중치 합계 1. URL은 HTTPS만 허용합니다. **제출자는 공고와 분류를 확인해야 합니다.**

상태 변경: `{"user_id":1,"status":"approved","source":"기관 확인","external_record_id":"DEMO-001"}`. `applied`, `started`, `pending`, `approved`, `rejected`, `cancelled` 상태가 있으며 허용된 전환만 가능합니다. 승인에는 별도의 출처나 실적 ID가 필수는 아니며 담당자가 완료 사실을 확인해야 합니다. 클릭은 실적 상태를 자동 변경하지 않습니다.

CSV 요청 예: `{"csv":"mission_id,user_id\n1,1"}`. 기존 4열 형식도 지원합니다. 이 시제품은 쉼표나 따옴표를 값에 포함하는 CSV를 지원하지 않습니다. 동일 ID 또는 참여자·미션 중복은 거부합니다. 정식 CSV 파서와 데이터 대조 정책이 필요합니다.

리그 축: `volunteer`, `mentoring`, `community`, `sharing`, `scholarship`, `blood`. 현재 각 미션의 인정 기여량을 합계 1인 분야 가중치로 배분하는 임시 산식입니다. 기존 미션 기여량 기본값은 1입니다. 모집 기간은 한국 시간 기준 시작일 00:00부터 마감일 23:59:59.999까지입니다. 개인 조건에 따른 엄격한 필터링은 구현하지 않았습니다.

추가 연동 API:

- `POST /api/missions/1/submit`: 학생의 확인 요청을 pending으로 생성. 증빙 업로드는 지원하지 않음.
- `GET /api/me/verifications`: 본인의 상태 목록.
- `GET /api/verifications`: 관리자 전체 목록 또는 기관 담당자의 소속 기관 목록.

- `GET /api/admin/missions`: 관리자 전체 또는 기관 소속 미션 목록과 현재 모집 여부.
- `POST /api/missions/{id}/schedule`: `{ "application_start":"2026-11-07", "application_end":"2026-11-30" }`로 기간 변경.
- `POST /api/missions/{id}/close`: 담당자가 수동 마감 (재개 미지원).
- `GET /api/me/verification-missions`: 학생 학기의 미션 목록. 마감 후에도 완료 확인 요청 가능.

기존 날짜 없는 시연 미션만 임시로 모집 중 취급합니다. 날짜가 없는 비시연 미션은 노출·추천·클릭에서 제외하며 운영자가 기간을 설정해야 합니다. 기존 SQLite 파일은 서버 시작 시 날짜 열이 추가되므로 사전 백업을 권장합니다.

- `POST /api/missions/{id}/archive`: 관리자 또는 소속 기관 담당자가 마감된 미션을 목록에서 삭제(보관). 마감된 미션만 가능하며 되돌리기 화면은 없습니다. 참여·승인 이력과 리그 점수는 유지하고, 완료 확인 요청을 위해 학생의 확인 요청용 목록에는 남습니다. 서버 시작 시 기존 로컬 DB에 보관 열이 추가됩니다.

- `POST /api/missions/{id}/publish`: 관리자만 기존 등록자 미확인 미션을 원문·출처 검토 후 확인 처리합니다. 기존 상태·기간이 모집 조건에 맞을 때만 학생에게 표시됩니다.

모집 안내 `application_note`는 선택사항이며, `application_period`는 날짜에서 서버가 자동 생성합니다. 인정 기여량 `contribution_value`는 필수 숫자(0.01~10, 소수 둘째 자리)이며 공식 봉사시간이 아닙니다. 다른 출처의 동일 실적을 ID 없이 자동 식별할 수 없습니다.

학생 확인 요청 흐름: 공식 신청 링크 클릭 → 기관에서 신청한 뒤 `POST /api/missions/{id}/application-confirmation`으로 본인이 신청 완료 표시 → `GET /api/me/verification-missions`에서 확인 요청 대상 조회 → 담당자 승인. 표시한 신청은 학생 자기 신고이며 기관의 신청 확인이나 활동 완료를 뜻하지 않습니다. 확인 대기·승인된 미션은 요청 대상에서 제외하고 반려·취소된 실적은 다시 요청할 수 있습니다. 관리자가 직접 처리한 실적도 본인이 재요청할 수 있습니다. 기존 클릭 기록만으로는 신청 완료로 처리하지 않습니다.

`GET /api/community-progress?semester_id=1`: 해당 학기 관리자 승인 완료 건수, 목표 건수, 인정 기여량 및 참여 분야 집계. 취소·대기는 제외합니다. 헌혈 가중치가 포함된 활동은 이 집계 전체에서 제외합니다. 목표 기본값은 100건이며 `COMMUNITY_GOAL_TARGET` 서버 환경변수로 지정할 수 있습니다. 개인정보별 목록은 반환하지 않습니다.


리그 산식: 승인된 활동 1건당 1회, 학교별 재학생 1,000명당 완료 횟수입니다. `GET /api/admin/school-populations?semester_id=1`, `POST /api/admin/school-populations` (관리자; school_id, semester_id, student_count, reference_year, source_url)로 학교 전체 재학생 수·기준연도·HTTPS 출처를 관리합니다. 수치가 없으면 순위는 미산정입니다. 실제 헌혈이 포함된 활동은 정책 확정 전 리그와 공동 집계에서 제외합니다. 기존 기여량 필드 값은 이 산식에 사용하지 않습니다.


`POST /api/admin/public-notice/preview` (관리자) 요청 `{ "url": "공식 개별 공고 URL" }`: 서버가 1365·VMS 공개 상세 페이지를 직접 읽고 제목과 허용된 공고 필드만 추출해 AI 분류를 제안합니다. 신청자 목록은 처리하지 않습니다. URL·출처·자격·기간·모집 상태·완료 방법은 관리자가 공식 원문을 확인해야 하며 미리보기는 미션을 등록하지 않습니다. 해당 사이트의 접근·이용 조건 확인이 필요합니다. 외부 네트워크 제한으로 실제 페이지 동작은 아직 검증하지 못했습니다.
