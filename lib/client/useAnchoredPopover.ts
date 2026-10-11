'use client';

import { useLayoutEffect, useRef, useState, type RefObject } from 'react';

type Position = {
  position: 'fixed';
  top: number | 'auto';
  bottom: number | 'auto';
  left: number;
  right: 'auto';
  width: number;
  minWidth: 0;
  maxWidth: number;
  maxHeight: number;
};

/** Shared placement for body-portaled menus, including scroll containers and animated modals. */
export function useAnchoredPopover({
  open, triggerRef, align = 'start', minWidth = 220, preferredHeight = 280, maxHeight = 400, maxViewportRatio = 1, onAnchorHidden,
}: {
  open: boolean;
  triggerRef: RefObject<HTMLElement>;
  align?: 'start' | 'end' | 'auto';
  minWidth?: number;
  preferredHeight?: number;
  maxHeight?: number;
  maxViewportRatio?: number;
  onAnchorHidden?: () => void;
}) {
  const [position, setPosition] = useState<Position | null>(null);
  const onAnchorHiddenRef = useRef(onAnchorHidden);
  onAnchorHiddenRef.current = onAnchorHidden;

  useLayoutEffect(() => {
    if (!open) { setPosition(null); return; }
    let frame = 0;
    let visible = true;

    function update() {
      const trigger = triggerRef.current;
      if (!trigger) { setPosition((current) => current === null ? current : null); return; }
      const rect = trigger.getBoundingClientRect();
      const visual = window.visualViewport;
      const viewport = {
        left: visual?.offsetLeft ?? 0,
        top: visual?.offsetTop ?? 0,
        width: visual?.width ?? window.innerWidth,
        height: visual?.height ?? window.innerHeight,
      };
      const right = viewport.left + viewport.width;
      const bottom = viewport.top + viewport.height;
      // A clipped, inactive or scrolled-away control must not leave its menu elsewhere on screen.
      if (!visible || trigger.closest('[inert]') || !rect.width || !rect.height || rect.bottom <= viewport.top || rect.top >= bottom || rect.right <= viewport.left || rect.left >= right) {
        setPosition((current) => current === null ? current : null);
        onAnchorHiddenRef.current?.();
        return;
      }
      const margin = 8;
      const gap = 4;
      const availableWidth = Math.max(0, viewport.width - margin * 2);
      const width = Math.min(Math.max(rect.width, minWidth), availableWidth);
      const below = Math.max(0, bottom - margin - rect.bottom - gap);
      const above = Math.max(0, rect.top - viewport.top - margin - gap);
      const heightLimit = Math.min(maxHeight, viewport.height * maxViewportRatio);
      const upward = below < Math.min(preferredHeight, heightLimit) && above > below;
      const end = align === 'end' || (align === 'auto' && rect.left + rect.width / 2 > viewport.left + viewport.width / 2);
      const next: Position = {
        position: 'fixed',
        top: upward ? 'auto' : rect.bottom + gap,
        bottom: upward ? window.innerHeight - rect.top + gap : 'auto',
        left: Math.max(viewport.left + margin, Math.min(end ? rect.right - width : rect.left, right - margin - width)),
        right: 'auto', width, minWidth: 0, maxWidth: availableWidth,
        maxHeight: Math.max(0, Math.min(heightLimit, upward ? above : below)),
      };
      setPosition((current) => current && current.top === next.top && current.bottom === next.bottom
        && current.left === next.left && current.width === next.width && current.maxWidth === next.maxWidth
        && current.maxHeight === next.maxHeight ? current : next);
    }

    // Follow the actual anchor while open: scrolling, keyboard/viewport changes,
    // sidebar transitions and modal animations can move it without a window resize.
    function follow() { update(); frame = requestAnimationFrame(follow); }
    const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? false;
      update();
    });
    if (triggerRef.current) observer?.observe(triggerRef.current);
    update();
    frame = requestAnimationFrame(follow);
    return () => { cancelAnimationFrame(frame); observer?.disconnect(); };
  }, [open, triggerRef, align, minWidth, preferredHeight, maxHeight, maxViewportRatio]);

  return open ? position : null;
}
