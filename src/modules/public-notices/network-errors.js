// Only expose a fixed, non-sensitive category; never relay raw network errors or addresses.
export function networkFailureReason(error){
 const queue=[error],seen=new Set();let timeout=false;
 while(queue.length){const item=queue.shift();if(!item||typeof item!=='object'||seen.has(item))continue;seen.add(item);
  const code=typeof item.code==='string'?item.code:'';
  if(['ENOTFOUND','EAI_AGAIN','EAI_FAIL'].includes(code))return 'DNS 조회 실패';
  if(['CERT_HAS_EXPIRED','CERT_NOT_YET_VALID','DEPTH_ZERO_SELF_SIGNED_CERT','SELF_SIGNED_CERT_IN_CHAIN','UNABLE_TO_VERIFY_LEAF_SIGNATURE','UNABLE_TO_GET_ISSUER_CERT_LOCALLY','ERR_TLS_CERT_ALTNAME_INVALID'].includes(code))return 'TLS 인증서 확인 실패';
  if(['ECONNRESET','ECONNREFUSED','EHOSTUNREACH','ENETUNREACH','EPIPE'].includes(code))return '서버 연결 거부 또는 중단';
  if(['ETIMEDOUT','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT'].includes(code)||item.name==='TimeoutError'||item.name==='AbortError')timeout=true;
  if(item.cause)queue.push(item.cause);if(Array.isArray(item.errors))queue.push(...item.errors);
 }
 return timeout?'연결 시간 초과':'네트워크 오류 원인 미확인';
}
