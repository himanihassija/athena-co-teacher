'use client';

import { useState } from 'react';
import type { LanguageCode } from '@echosphere/shared-types';

interface LanguageSelectorProps {
  currentLanguage: LanguageCode;
  onLanguageChange: (lang: LanguageCode) => void;
}

const LANGUAGES: Array<{ code: LanguageCode; label: string; native: string }> = [
  { code: 'en', label: 'English', native: 'English' },
  { code: 'hi', label: 'Hindi', native: 'हिन्दी' },
  { code: 'es', label: 'Spanish', native: 'Español' },
  { code: 'fr', label: 'French', native: 'Français' },
  { code: 'de', label: 'German', native: 'Deutsch' },
  { code: 'ta', label: 'Tamil', native: 'தமிழ்' },
  { code: 'te', label: 'Telugu', native: 'తెలుగు' },
];

export function LanguageSelector({ currentLanguage, onLanguageChange }: LanguageSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const active = LANGUAGES.find((l) => l.code === currentLanguage) ?? LANGUAGES[0];

  return (
    <div className="relative inline-block text-left">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 rounded-lg border border-[var(--eco-rule)] bg-[var(--eco-ink-sunken)] px-2.5 py-1.5 text-xs text-[var(--eco-cream)] transition hover:border-[var(--eco-rule)]/80 hover:bg-[color-mix(in_srgb,var(--eco-ink)_60%,transparent)] shadow-sm"
        title="Change Co-Teacher AI & Classroom Language"
      >
        <span className="font-medium">{active.native}</span>
        <span className="text-[10px] text-[var(--eco-cream-faint)]">▼</span>
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
          <div className="absolute right-0 z-50 mt-1 w-44 rounded-xl border border-[var(--eco-rule)] bg-[var(--eco-panel,var(--eco-ink-raised))] p-1.5 shadow-2xl backdrop-blur-md">
            <div className="px-2 py-1 text-[10px] font-semibold text-[var(--eco-cream-faint)] uppercase tracking-wider">
              Multilingual Agent
            </div>
            {LANGUAGES.map((lang) => (
              <button
                key={lang.code}
                type="button"
                onClick={() => {
                  onLanguageChange(lang.code);
                  setIsOpen(false);
                }}
                className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs transition ${
                  currentLanguage === lang.code
                    ? 'bg-[color-mix(in_srgb,var(--eco-amber)_20%,transparent)] text-[var(--eco-amber)] font-semibold'
                    : 'text-[var(--eco-cream)]/90 hover:bg-[var(--eco-ink-raised)]'
                }`}
              >
                <span className="flex items-center gap-2">
                  <span>{lang.native}</span>
                </span>
                {currentLanguage === lang.code && <span className="text-[var(--eco-amber)]">✓</span>}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
