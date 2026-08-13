import { createContext, useContext, useEffect, useMemo, useState } from 'react';

const ThemeContext = createContext(null);
const STORAGE = 'kap.theme';

const initial = () => {
  try {
    const saved = localStorage.getItem(STORAGE);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    /* localStorage can be blocked - fall through to the OS preference */
  }
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
};

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(initial);

  useEffect(() => {
    const root = document.documentElement;

    // Properties with a CSS transition keep their previously computed colour when
    // only a custom property changes, so suppress transitions for one frame while
    // the palette swaps. Also stops the whole UI cross-fading on toggle.
    root.classList.add('theme-switching');
    root.setAttribute('data-theme', theme);

    const timer = setTimeout(() => root.classList.remove('theme-switching'), 80);

    try {
      localStorage.setItem(STORAGE, theme);
    } catch {
      /* localStorage can be blocked - the theme just will not persist */
    }

    return () => clearTimeout(timer);
  }, [theme]);

  const value = useMemo(
    () => ({ theme, setTheme, toggle: () => setTheme((t) => (t === 'dark' ? 'light' : 'dark')) }),
    [theme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
};

/**
 * Recharts takes colours as props, not CSS, so charts need the palette in JS.
 * Keep these in step with the light/dark blocks in theme.css.
 */
export function useChartColors() {
  const { theme } = useTheme();
  return theme === 'light'
    ? {
        grid: '#e2e8f0',
        axis: '#7a8aa3',
        tooltipBg: '#ffffff',
        tooltipBorder: '#d5dde9',
        label: '#51617f',
        clicks: '#15a34a',
        conversions: '#ea580c',
        revenue: '#7c3aed',
        cost: '#b45309',
      }
    : {
        grid: '#223049',
        axis: '#63768f',
        tooltipBg: '#141b2a',
        tooltipBorder: '#223049',
        label: '#8fa3bf',
        clicks: '#35d07f',
        conversions: '#ff8a3d',
        revenue: '#a78bfa',
        cost: '#ffb020',
      };
}
