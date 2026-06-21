'use client';
import { ReactNode, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface TooltipProps {
  label: string;
  children: ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
  align?: 'start' | 'center' | 'end';
  className?: string;
}

type TooltipPosition = {
  left: number;
  top: number;
};

const TOOLTIP_Z_INDEX = 2147483647;
const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export default function Tooltip({
  label,
  children,
  side = 'top',
  align = 'center',
  className = '',
}: TooltipProps) {
  const tooltipId = useId();
  const rootRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<TooltipPosition | null>(null);
  const hasPositionClass = /\b(absolute|fixed|relative|sticky)\b/.test(className);

  const updatePosition = useCallback(() => {
    const root = rootRef.current;
    const tooltip = tooltipRef.current;
    if (!root || !tooltip || typeof window === 'undefined') return;

    const rect = root.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    const gap = 10;
    const edge = 12;

    let left = rect.left + rect.width / 2 - tooltipRect.width / 2;
    let top = rect.top - tooltipRect.height - gap;

    if (side === 'bottom') {
      top = rect.bottom + gap;
    }
    if (side === 'left') {
      left = rect.left - tooltipRect.width - gap;
      top = rect.top + rect.height / 2 - tooltipRect.height / 2;
    }
    if (side === 'right') {
      left = rect.right + gap;
      top = rect.top + rect.height / 2 - tooltipRect.height / 2;
    }

    if (side === 'top' || side === 'bottom') {
      if (align === 'start') {
        left = rect.left;
      }
      if (align === 'end') {
        left = rect.right - tooltipRect.width;
      }
    }

    if (side === 'left' || side === 'right') {
      if (align === 'start') {
        top = rect.top;
      }
      if (align === 'end') {
        top = rect.bottom - tooltipRect.height;
      }
    }

    const maxLeft = Math.max(edge, window.innerWidth - tooltipRect.width - edge);
    const maxTop = Math.max(edge, window.innerHeight - tooltipRect.height - edge);

    setPosition({
      left: clamp(left, edge, maxLeft),
      top: clamp(top, edge, maxTop),
    });
  }, [align, side]);

  const show = useCallback(() => {
    setOpen(true);
  }, []);

  const hide = useCallback(() => {
    setOpen(false);
    setPosition(null);
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;

    const handlePointerLeave = () => {
      if (root.contains(document.activeElement)) return;
      hide();
    };
    const handlePointerOut = (event: Event) => {
      const relatedTarget = 'relatedTarget' in event ? event.relatedTarget : null;
      if (relatedTarget instanceof Node && root.contains(relatedTarget)) return;
      handlePointerLeave();
    };
    const handleFocusOut = (event: FocusEvent) => {
      if (event.relatedTarget instanceof Node && root.contains(event.relatedTarget)) return;
      hide();
    };

    root.addEventListener('mouseover', show);
    root.addEventListener('mouseout', handlePointerOut);
    root.addEventListener('mouseenter', show);
    root.addEventListener('mouseleave', handlePointerLeave);
    root.addEventListener('pointerover', show);
    root.addEventListener('pointerout', handlePointerOut);
    root.addEventListener('pointerenter', show);
    root.addEventListener('pointerleave', handlePointerLeave);
    root.addEventListener('focusin', show);
    root.addEventListener('focusout', handleFocusOut);

    return () => {
      root.removeEventListener('mouseover', show);
      root.removeEventListener('mouseout', handlePointerOut);
      root.removeEventListener('mouseenter', show);
      root.removeEventListener('mouseleave', handlePointerLeave);
      root.removeEventListener('pointerover', show);
      root.removeEventListener('pointerout', handlePointerOut);
      root.removeEventListener('pointerenter', show);
      root.removeEventListener('pointerleave', handlePointerLeave);
      root.removeEventListener('focusin', show);
      root.removeEventListener('focusout', handleFocusOut);
    };
  }, [hide, show]);

  useIsoLayoutEffect(() => {
    if (!open) return;
    updatePosition();
  }, [label, open, updatePosition]);

  useEffect(() => {
    if (!open) return undefined;

    const handleViewportChange = () => updatePosition();
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);

    return () => {
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
    };
  }, [open, updatePosition]);

  return (
    <span
      ref={rootRef}
      aria-describedby={open ? tooltipId : undefined}
      onMouseOver={show}
      onMouseOut={(event) => {
        if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
        if (event.currentTarget.contains(document.activeElement)) return;
        hide();
      }}
      onMouseEnter={show}
      onMouseLeave={(event) => {
        if (event.currentTarget.contains(document.activeElement)) return;
        hide();
      }}
      onPointerOver={show}
      onPointerOut={(event) => {
        if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
        if (event.currentTarget.contains(document.activeElement)) return;
        hide();
      }}
      onPointerEnter={show}
      onPointerLeave={(event) => {
        if (event.currentTarget.contains(document.activeElement)) return;
        hide();
      }}
      onFocus={show}
      onBlur={(event) => {
        if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
        hide();
      }}
      data-tooltip-root="portal"
      className={`inline-flex ${hasPositionClass ? '' : 'relative'} ${className}`}
    >
      {children}
      {open && typeof document !== 'undefined'
        ? createPortal(
            <span
              ref={tooltipRef}
              id={tooltipId}
              role="tooltip"
              style={{
                left: position?.left ?? 0,
                top: position?.top ?? 0,
                visibility: position ? 'visible' : 'hidden',
                zIndex: TOOLTIP_Z_INDEX,
              }}
              data-tooltip-layer="global"
              className="pointer-events-none fixed w-max max-w-64 rounded-md border border-[var(--arena-line-strong)] bg-[var(--arena-panel-strong)] px-2 py-1 text-left text-xs leading-5 text-[var(--arena-ink)] opacity-100 shadow-[0_8px_8px_rgba(0,0,0,0.28)]"
            >
              {label}
            </span>,
            document.body
          )
        : null}
    </span>
  );
}
