import { useEffect, useState } from 'react';
import type { ThemeMode } from '@shared/api';
import { api, fire } from '@/lib/api';

/** accent palettes — the metal family, picked in the titlebar popover */
export const THEMES = ['copper', 'steel', 'brass', 'patina'] as const;
export type Theme = (typeof THEMES)[number];

export const MODES = ['system', 'light', 'dark'] as const;

/** each swatch shows its OWN metal, not the active accent */
export const SWATCH: Record<Theme, string> = {
  copper: 'linear-gradient(135deg, #f0872d, #c2510a)',
  steel: 'linear-gradient(135deg, #64a6db, #23689b)',
  brass: 'linear-gradient(135deg, #d8b544, #9c7c10)',
  patina: 'linear-gradient(135deg, #43c3ab, #0e7a6a)',
};

/** defaults apply when storage is empty or holds a since-removed palette name */
function storedTheme(): Theme {
  const saved = localStorage.getItem('theme') ?? '';
  return (THEMES as readonly string[]).includes(saved) ? (saved as Theme) : 'copper';
}

function storedMode(): ThemeMode {
  const saved = localStorage.getItem('themeMode') ?? '';
  return (MODES as readonly string[]).includes(saved) ? (saved as ThemeMode) : 'system';
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(storedTheme);
  const [mode, setMode] = useState<ThemeMode>(storedMode);

  useEffect(() => {
    // copper = no attribute: the base tokens ARE the copper palette
    if (theme === 'copper') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
    localStorage.setItem('theme', theme);
  }, [theme]);

  useEffect(() => {
    // routed through nativeTheme so the acrylic/vibrancy backdrop switches
    // with the CSS, not just the tokens
    fire(api.setThemeMode(mode));
    localStorage.setItem('themeMode', mode);
  }, [mode]);

  return { theme, setTheme, mode, setMode };
}
