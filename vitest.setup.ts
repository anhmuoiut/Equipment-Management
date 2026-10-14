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

// jsdom does no layout, so every element measures 0×0. useAnchoredPopover (ActionMenu, SearchableSelect, …) reads that as
// "the anchor is hidden" and closes its popover at once. Give every element a visible box inside the default 1024×768 window.
if (typeof Element !== 'undefined') {
  Element.prototype.getBoundingClientRect = () => ({
    x: 10, y: 10, left: 10, top: 10, width: 120, height: 32, right: 130, bottom: 42, toJSON: () => ({}),
  });
}
