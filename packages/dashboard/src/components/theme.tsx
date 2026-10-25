/**
 * @fileoverview Light / dark / system theme, stored in localStorage and
 * applied as the `dark` class on <html> (shadcn/ui convention).
 */

import type {ReactElement, ReactNode} from 'react';
import {createContext, useContext, useEffect, useState} from 'react';
import {Monitor, Moon, Sun} from 'lucide-react';

import {Button} from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/** The user's choice. */
export type Theme = 'light' | 'dark' | 'system';

interface ThemeState {
  readonly theme: Theme;
  readonly resolved: 'light' | 'dark';
  setTheme(theme: Theme): void;
}

const STORAGE_KEY = 'loom.theme';
const ThemeContext = createContext<ThemeState>({
  theme: 'system',
  resolved: 'light',
  setTheme: () => {},
});

function readTheme(): Theme {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (value === 'light' || value === 'dark') return value;
  } catch {
    // Storage unavailable: follow the system.
  }
  return 'system';
}

const systemDark = (): boolean => matchMedia('(prefers-color-scheme: dark)').matches;

/** Provides the theme to the tree. */
export function ThemeProvider({children}: {children: ReactNode}): ReactElement {
  const [theme, setThemeState] = useState<Theme>(readTheme);
  const [system, setSystem] = useState<'light' | 'dark'>(() => (systemDark() ? 'dark' : 'light'));
  const resolved = theme === 'system' ? system : theme;

  useEffect(() => {
    const query = matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setSystem(query.matches ? 'dark' : 'light');
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', resolved === 'dark');
  }, [resolved]);

  const setTheme = (next: Theme) => {
    setThemeState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // The choice then lasts for this page only.
    }
  };

  return <ThemeContext.Provider value={{theme, resolved, setTheme}}>{children}</ThemeContext.Provider>;
}

/** Current theme. */
export function useTheme(): ThemeState {
  return useContext(ThemeContext);
}

/** Header button that switches the theme. */
export function ThemeToggle(): ReactElement {
  const {theme, resolved, setTheme} = useTheme();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="切换主题">
          {resolved === 'dark' ? <Moon /> : <Sun />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-36">
        <DropdownMenuRadioGroup value={theme} onValueChange={value => setTheme(value as Theme)}>
          <DropdownMenuRadioItem value="light">
            <Sun className="mr-2 size-4" />
            浅色
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">
            <Moon className="mr-2 size-4" />
            深色
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system">
            <Monitor className="mr-2 size-4" />
            跟随系统
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
