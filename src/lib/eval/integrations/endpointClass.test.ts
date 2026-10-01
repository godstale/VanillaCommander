import { describe, expect, it } from 'vitest';
import { classifyEndpoint } from './endpointClass';

const SETTINGS = { trustedLanHosts: ['192.168.1.20', 'nas.local'] };

describe('classifyEndpoint', () => {
  it.each([
    ['http://localhost:1234/v1', 'local'],
    ['http://LOCALHOST:1234/v1', 'local'],
    ['http://127.0.0.1:11434', 'local'],
    ['http://127.0.0.2:8080/v1', 'local'],
    ['http://127.255.255.255:8000', 'local'],
    ['http://[::1]:11434', 'local'],
  ])('classifies %s as local', (url, expected) => {
    expect(classifyEndpoint(url, SETTINGS)).toBe(expected);
  });

  it.each([
    ['http://192.168.1.20:8000/v1', 'lan-trusted'],
    ['http://NAS.LOCAL:8000', 'lan-trusted'],
  ])('classifies %s as lan-trusted', (url, expected) => {
    expect(classifyEndpoint(url, SETTINGS)).toBe(expected);
  });

  it.each([
    ['https://api.openai.com/v1', 'external'],
    // 사설 IP라도 신뢰 목록에 없으면 external
    ['http://192.168.1.21:8000/v1', 'external'],
    ['http://10.0.0.5:8000', 'external'],
    ['http://172.16.0.2:8000', 'external'],
    ['http://128.0.0.1:8000', 'external'],
    ['not a url', 'external'],
    ['', 'external'],
  ])('classifies %s as external', (url, expected) => {
    expect(classifyEndpoint(url, SETTINGS)).toBe(expected);
  });
});
