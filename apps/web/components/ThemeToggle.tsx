/**
 * Light/dark toggle for the Echosphere `--eco-*` design tokens.
 *
 * Light is the app's default ground (see globals.css) — this toggle opts a
 * browser into the dark variant by setting `data-eco-theme="dark"` on
 * `<html>`, and persists the choice so it survives a reload.
 */

'use client';

import { useEffect, useState } from 'react';

const STORAGE_KEY = 'echosphere.theme';

type Theme = 'light' | 'dark';

function applyTheme(theme: Theme): void {
  document.documentElement.dataset.ecoTheme = theme;
  if (theme === 'dark') {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Private-mode browsers reject storage; the toggle still works for this tab.
  }
}

export function ThemeToggle() {
  // Starts undefined so the server-rendered and first client render match;
  // the real value is read from localStorage and applied right after mount.
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    let current: Theme = 'light';
    try {
      current = localStorage.getItem(STORAGE_KEY) === 'dark' ? 'dark' : 'light';
    } catch {
      current = document.documentElement.dataset.ecoTheme === 'dark' ? 'dark' : 'light';
    }
    applyTheme(current);
    setTheme(current);
  }, []);

  if (!theme) {
    // Reserve the button's footprint so nothing shifts once it hydrates.
    return <span className="inline-block h-9 w-9" aria-hidden />;
  }

  const toggle = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    setTheme(next);
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      className="flex h-9 w-9 items-center justify-center rounded-full border transition-colors"
      style={{ borderColor: 'var(--eco-rule)', color: 'var(--eco-cream-dim)' }}
    >
      {theme === 'dark' ? (
        // Sun — shown in dark mode, offers to switch to light.
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
          <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="2" />
          <path
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"
          />
        </svg>
      ) : (
        // Moon — shown in light mode, offers to switch to dark.
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </button>
  );
}
