import test from 'node:test';
import assert from 'node:assert/strict';
import probe from '../scripts/vms-cloudflare-probe.js';

test('VMS 연결 시험은 인증되지 않은 요청을 거절한다', async () => {
  const response = await probe.fetch(new Request('https://probe.example/'), { PROBE_TOKEN: 'test-token' });
  assert.equal(response.status, 401);
});

test('VMS 중계는 공고의 허용된 항목만 전달한다', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async url => {
      assert.equal(url, 'https://www.vms.or.kr/partspace/recruitView.do?seq=123');
      return new Response('<h2>환경 봉사</h2><table><tr><th>봉사활동처</th><td>봉사센터</td></tr><tr><th>성명</th><td>신청자 개인정보</td></tr></table>', {headers:{'content-type':'text/html; charset=utf-8'}});
    };
    const request = new Request('https://probe.example/notice?seq=123', {headers:{Authorization:'Bearer test-token'}});
    const response = await probe.fetch(request,{PROBE_TOKEN:'test-token'});
    const value = await response.text();
    assert.equal(response.status,200);
    assert.equal(JSON.parse(value).fields.organization,'봉사센터');
    assert.doesNotMatch(value,/신청자 개인정보/);
    const invalid = new Request('https://probe.example/notice?seq=12abc', {headers:{Authorization:'Bearer test-token'}});
    assert.equal((await probe.fetch(invalid,{PROBE_TOKEN:'test-token'})).status,400);
  } finally { globalThis.fetch = original; }
});

test('VMS 연결 시험은 고정된 공식 주소만 읽고 공고 내용은 반환하지 않는다', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async url => {
      assert.equal(url, 'https://www.vms.or.kr/partspace/recruitView.do?seq=505081');
      return new Response('개인정보가 포함될 수 있는 공고 본문');
    };
    const request = new Request('https://probe.example/', { headers: { Authorization: 'Bearer test-token' } });
    const response = await probe.fetch(request, { PROBE_TOKEN: 'test-token' });
    assert.deepEqual(await response.json(), { reachable: true, http_status: 200 });
  } finally {
    globalThis.fetch = original;
  }
});
