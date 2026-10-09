'use client';

import { useSyncExternalStore } from 'react';

/** Phone layout — keep equal to the `max-width: 767px` media queries in app/*.css. */
export const PHONE_QUERY = '(max-width: 767px)';

function subscribe(onChange: () => void) {
  const media = window.matchMedia(PHONE_QUERY);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}

/** True at phone widths. The server and the first client render say false, then it follows the viewport. */
export function usePhone(): boolean {
  return useSyncExternalStore(subscribe, () => window.matchMedia(PHONE_QUERY).matches, () => false);
}
