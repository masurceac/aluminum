import type * as React from 'react';
import { Toaster as Sonner, type ToasterProps } from 'sonner';

/* shadcn's generated wrapper reads the active theme from `next-themes`. This
 * app has no theme provider: appearance is driven by nativeTheme in the main
 * process, which flips prefers-color-scheme inside Chromium — and sonner's own
 * "system" theme reads exactly that. So the dependency is dropped, and the
 * status icon set with it (the only toast here is undo, which has no status). */
const Toaster = ({ ...props }: ToasterProps) => (
  <Sonner
    theme="system"
    className="toaster group"
    style={
      {
        '--normal-bg': 'var(--popover)',
        '--normal-text': 'var(--popover-foreground)',
        '--normal-border': 'var(--border)',
        '--border-radius': 'var(--radius)',
      } as React.CSSProperties
    }
    {...props}
  />
);

export { Toaster };
