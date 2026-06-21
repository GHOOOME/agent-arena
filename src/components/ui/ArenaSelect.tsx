'use client';

import { Check, ChevronDown } from 'lucide-react';
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface ArenaSelectOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
}

interface ArenaSelectProps {
  value: string;
  options: ArenaSelectOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  menuClassName?: string;
}

type MenuPosition = {
  left: number;
  top: number;
  width: number;
};

const SELECT_Z_INDEX = 2147483200;
const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export default function ArenaSelect({
  value,
  options,
  onChange,
  ariaLabel,
  placeholder = '请选择',
  disabled = false,
  className = '',
  menuClassName = '',
}: ArenaSelectProps) {
  const listboxId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const selectedOption = useMemo(() => options.find((option) => option.value === value), [options, value]);
  const enabledOptions = useMemo(() => options.filter((option) => !option.disabled), [options]);

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    const menu = menuRef.current;
    if (!trigger || !menu || typeof window === 'undefined') return;

    const rect = trigger.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const edge = 12;
    const gap = 6;
    const width = Math.max(rect.width, Math.min(360, menuRect.width || rect.width));
    const maxLeft = Math.max(edge, window.innerWidth - width - edge);
    const below = rect.bottom + gap;
    const above = rect.top - menuRect.height - gap;
    const fitsBelow = below + menuRect.height < window.innerHeight - edge;

    setPosition({
      left: clamp(rect.left, edge, maxLeft),
      top: fitsBelow ? below : Math.max(edge, above),
      width,
    });
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    setPosition(null);
  }, []);

  const commit = useCallback((nextValue: string) => {
    onChange(nextValue);
    close();
    requestAnimationFrame(() => triggerRef.current?.focus());
  }, [close, onChange]);

  useIsoLayoutEffect(() => {
    if (!open) return;
    updatePosition();
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return undefined;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
      if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && enabledOptions.length > 0) {
        event.preventDefault();
        const currentIndex = Math.max(0, enabledOptions.findIndex((option) => option.value === value));
        const direction = event.key === 'ArrowDown' ? 1 : -1;
        const next = enabledOptions[(currentIndex + direction + enabledOptions.length) % enabledOptions.length];
        if (next) onChange(next.value);
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        close();
      }
    };
    const onViewportChange = () => updatePosition();

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onViewportChange);
    window.addEventListener('scroll', onViewportChange, true);

    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onViewportChange);
      window.removeEventListener('scroll', onViewportChange, true);
    };
  }, [close, enabledOptions, onChange, open, updatePosition, value]);

  const menu = open && typeof document !== 'undefined'
    ? createPortal(
      <div
        ref={menuRef}
        id={listboxId}
        role="listbox"
        aria-label={ariaLabel}
        style={{
          left: position?.left ?? 0,
          top: position?.top ?? 0,
          width: position?.width ?? undefined,
          visibility: position ? 'visible' : 'hidden',
          zIndex: SELECT_Z_INDEX,
        }}
        className={`arena-select-menu fixed max-h-72 overflow-y-auto p-1 ${menuClassName}`}
      >
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={selected}
              disabled={option.disabled}
              onClick={() => commit(option.value)}
              className={`arena-select-option ${selected ? 'is-selected' : ''}`}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate">{option.label}</span>
                {option.description && (
                  <span className="mt-0.5 block truncate text-[11px] text-[var(--arena-dim)]">{option.description}</span>
                )}
              </span>
              {selected && <Check size={14} className="shrink-0 text-[var(--arena-accent-readable)]" />}
            </button>
          );
        })}
      </div>,
      document.body
    )
    : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        onClick={() => setOpen((next) => !next)}
        className={`arena-select-trigger ${open ? 'is-open' : ''} ${className}`}
      >
        <span className="min-w-0 flex-1 truncate text-left">{selectedOption?.label || placeholder}</span>
        <ChevronDown size={15} className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {menu}
    </>
  );
}
