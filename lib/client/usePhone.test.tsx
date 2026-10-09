// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { PHONE_QUERY, usePhone } from './usePhone';

function Probe() {
  return <p>{usePhone() ? 'phone' : 'desktop'}</p>;
}

describe('usePhone', () => {
  afterEach(() => vi.mocked(window.matchMedia).mockReset());

  it('follows the (max-width: 767px) media query and reacts when it changes', () => {
    let listener: (() => void) | undefined;
    const media = {
      matches: false, media: PHONE_QUERY,
      addEventListener: vi.fn((_: string, cb: () => void) => { listener = cb; }), removeEventListener: vi.fn(),
    };
    vi.mocked(window.matchMedia).mockReturnValue(media as unknown as MediaQueryList);
    const { unmount } = render(<Probe />);
    expect(window.matchMedia).toHaveBeenCalledWith(PHONE_QUERY);
    expect(screen.getByText('desktop')).toBeTruthy();
    media.matches = true;
    act(() => listener?.());
    expect(screen.getByText('phone')).toBeTruthy();
    unmount();
    expect(media.removeEventListener).toHaveBeenCalled();
  });
});
