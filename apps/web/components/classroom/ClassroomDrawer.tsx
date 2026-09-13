'use client';
import { type ReactNode } from 'react';
export interface DrawerTab {
  id: string;
  label: string;
  content: ReactNode;
}
export function ClassroomDrawer({
  open,
  onClose,
  tabs,
  activeTab,
  onTabChange,
  headerActions,
}: {
  open: boolean;
  onClose: () => void;
  tabs: DrawerTab[];
  activeTab: string;
  onTabChange: (id: string) => void;
  /** Rendered just below the title bar, visible regardless of which tab is active. */
  headerActions?: ReactNode;
}) {
  const active = tabs.find((t) => t.id === activeTab) ?? tabs[0];
  return (
    <>
      <div
        aria-hidden={!open}
        onClick={onClose}
        className={`fixed inset-0 z-40 bg-black/40 transition-opacity duration-200 ${
          open ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
        }`}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-hidden={!open}
        className={`fixed right-0 top-0 z-50 flex h-full w-full max-w-lg flex-col border-l transition-transform duration-200 ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
        style={{
          borderColor: 'var(--eco-rule)',
          background: 'var(--eco-ink)',
        }}
      >
        <div
          className="flex items-center justify-between border-b px-5 py-4"
          style={{ borderColor: 'var(--eco-rule)' }}
        >
          <h2 className="eco-label">Menu</h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-md text-[var(--eco-cream-dim)]"
            aria-label="Close menu"
          >
            ✕
          </button>
        </div>
        {headerActions && (
          <div
            className="flex shrink-0 flex-wrap gap-2 border-b px-5 py-3"
            style={{ borderColor: 'var(--eco-rule)' }}
          >
            {headerActions}
          </div>
        )}
        <div
          className="flex shrink-0 flex-wrap gap-1.5 border-b px-4 py-3"
          style={{ borderColor: 'var(--eco-rule)' }}
        >
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => onTabChange(tab.id)}
              className="shrink-0 rounded-md px-3 py-1.5 text-sm font-medium transition-colors"
              style={
                tab.id === active?.id
                  ? { background: 'var(--eco-glow-dim)', color: 'var(--eco-glow-bright)' }
                  : { color: 'var(--eco-cream-dim)' }
              }
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">{active?.content}</div>
      </aside>
    </>
  );
}
