import { describe, expect, it } from 'vitest';
import { isSameOriginRequest } from './requestOrigin';
const request = (origin?: string, host = '127.0.0.1:3000', url = 'http://localhost:3000/api/auth/login') => ({
  url, headers: new Headers({ host, ...(origin === undefined ? {} : { origin }) }),
});
describe('login request origin', () => {
  it('accepts the browser host when Next normalizes the request URL', () => {
    expect(isSameOriginRequest(request('http://127.0.0.1:3000'))).toBe(true);
  });
  it('accepts matching localhost and HTTPS origins', () => {
    expect(isSameOriginRequest(request('http://localhost:3000', 'localhost:3000'))).toBe(true);
    expect(isSameOriginRequest(request('https://equipment.example', 'equipment.example', 'https://equipment.example/api/auth/login'))).toBe(true);
  });
  it('rejects another host, port, protocol, or opaque origin', () => {
    for (const origin of ['https://evil.example', 'http://127.0.0.1:3001', 'https://127.0.0.1:3000', 'null', 'http://localhost:3000']) {
      expect(isSameOriginRequest(request(origin))).toBe(false);
    }
  });
  it('preserves requests without an Origin header', () => {
    expect(isSameOriginRequest(request())).toBe(true);
  });
});
