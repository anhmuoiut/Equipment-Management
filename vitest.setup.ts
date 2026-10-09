import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { listCache } from '@/lib/client/cache';

// Danh sách đã nhớ (lib/client/cache.ts) không được lọt từ bài test này sang bài test khác.
afterEach(() => { cleanup(); listCache.clear(); });

if (typeof window !== 'undefined') {
  window.matchMedia = vi.fn().mockImplementation((media: string) => ({
    matches: false, media, onchange: null,
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
    addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
  }));
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
}
