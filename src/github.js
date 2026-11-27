// GitHub API: 토큰 검증과 만료일 조회.
const API = 'https://api.github.com/user';

/**
 * 토큰이 유효한지 확인하고 계정과 만료일을 돌려준다.
 * 만료일은 응답 헤더 github-authentication-token-expiration 에서 읽는다(만료일을 설정한 토큰만 값이 있음).
 */
async function checkToken(token) {
  let res;
  try {
    res = await fetch(API, { headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'PHP-Live', Accept: 'application/vnd.github+json' } });
  } catch {
    throw new Error('GitHub에 연결할 수 없습니다. 인터넷 연결을 확인해 주세요.');
  }
  if (res.status === 401) throw new Error('토큰이 올바르지 않거나 이미 만료되었습니다.');
  if (!res.ok) throw new Error(`GitHub 확인에 실패했습니다. (HTTP ${res.status})`);
  const { login } = await res.json();
  const exp = res.headers.get('github-authentication-token-expiration'); // 예: 2026-12-24 00:00:00 UTC
  return { login, expires: exp ? exp.slice(0, 10) : null };
}

module.exports = { checkToken };
