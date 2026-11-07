// Only sanitized public notice fields leave this Worker; applicant lists stay out.
import {canonicalNoticeUrl,extractNotice} from '../src/modules/public-notices/extract.js';
export default {
  async fetch(request, env) {
    if (!env.PROBE_TOKEN || request.headers.get('Authorization') !== `Bearer ${env.PROBE_TOKEN}`) {
      return new Response('Unauthorized', { status: 401 });
    }
    const url = new URL(request.url);
    const probe = url.pathname === '/';
    const seq = probe ? '505081' : url.searchParams.get('seq');
    if (request.method !== 'GET' || (!probe && url.pathname !== '/notice') || !/^\d{1,15}$/.test(seq || '')) {
      return new Response('Bad request', { status: 400 });
    }
    const source = canonicalNoticeUrl(`https://www.vms.or.kr/partspace/recruitView.do?seq=${seq}`);
    try {
      const response = await fetch(source.url, {
        redirect: 'manual', signal: AbortSignal.timeout(10000),
        headers: { Accept: 'text/html', 'User-Agent': 'DandiConnectivityCheck/1.0' },
      });
      if (probe || !response.ok) {
        if (response.body) await response.body.cancel();
        return Response.json({ reachable: true, http_status: response.status });
      }
      if (!/^(text\/html|application\/xhtml\+xml)/i.test(response.headers.get('content-type') || '')) throw Error('format');
      const reader = response.body?.getReader();
      if (!reader) throw Error('empty');
      const chunks = []; let size = 0;
      while (true) {
        const {done,value} = await reader.read(); if (done) break;
        size += value.length; if (size > 1_000_000) { await reader.cancel(); throw Error('size'); }
        chunks.push(value);
      }
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk,offset); offset += chunk.length; }
      const charset = (response.headers.get('content-type') || '').match(/charset\s*=\s*([^;\s]+)/i)?.[1]?.replace(/["']/g,'') || 'utf-8';
      const notice = extractNotice(new TextDecoder(charset).decode(bytes),source);
      return Response.json(notice, {headers:{'Cache-Control':'no-store'}});
    } catch {
      return Response.json({ reachable: false, reason: 'VMS 연결 또는 공고 분석 실패' }, { status: 502 });
    }
  },
};
