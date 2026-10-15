'use client';

import { useEffect, useRef, type RefObject } from 'react';
import { stepSidebarSpring } from './sidebarSpring';

type Controller = { move: (open: boolean, phone: boolean) => void };

/** One native animation loop drives sidebar geometry without rendering React each frame. */
export function useSidebarMotion(ref: RefObject<HTMLDivElement | null>, open: boolean, phone: boolean) {
  const controller = useRef<Controller | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    let state = { position: element.dataset.sidebarOpen === 'true' ? 1 : 0, velocity: 0 };
    let target = state.position, mode: boolean | undefined, frame = 0, previousTime = 0;
    const write = () => {
      const effect = Math.min(1, Math.max(0, state.position));
      element.style.setProperty('--sidebar-progress', state.position.toFixed(6));
      element.style.setProperty('--sidebar-fx-progress', effect.toFixed(6));
      element.style.setProperty('--sidebar-reveal-track', `${effect.toFixed(6)}fr`);
      element.style.setProperty('--sidebar-motion-visibility', mode && target === 0 && state.position === 0 ? 'hidden' : 'visible');
    };
    const stop = () => { if (frame) cancelAnimationFrame(frame); frame = 0; previousTime = 0; };
    const snap = () => { stop(); state = { position: target, velocity: 0 }; write(); };
    const tick = (time: number) => {
      const elapsed = previousTime ? Math.min((time - previousTime) / 1000, 0.064) : 1 / 60;
      previousTime = time;
      state = stepSidebarSpring(state, target, elapsed);
      if (Math.abs(state.position - target) < 0.0005 && Math.abs(state.velocity) < 0.006) { snap(); return; }
      write();
      frame = requestAnimationFrame(tick);
    };
    controller.current = {
      move(nextOpen, nextPhone) {
        target = nextOpen ? 1 : 0;
        if (mode !== undefined && mode !== nextPhone) { mode = nextPhone; snap(); return; }
        mode = nextPhone;
        if (reduced.matches) { snap(); return; }
        if (Math.abs(state.position - target) < 0.0005 && Math.abs(state.velocity) < 0.006) { snap(); return; }
        if (!frame) { previousTime = 0; frame = requestAnimationFrame(tick); }
      },
    };
    const onReducedMotion = () => { if (reduced.matches) snap(); };
    reduced.addEventListener('change', onReducedMotion);
    write();
    element.dataset.sidebarMotion = 'spring';
    return () => {
      stop();
      reduced.removeEventListener('change', onReducedMotion);
      controller.current = null;
      delete element.dataset.sidebarMotion;
      for (const name of ['--sidebar-progress', '--sidebar-fx-progress', '--sidebar-reveal-track', '--sidebar-motion-visibility']) element.style.removeProperty(name);
    };
  }, [ref]);

  useEffect(() => { controller.current?.move(open, phone); }, [open, phone]);
}
