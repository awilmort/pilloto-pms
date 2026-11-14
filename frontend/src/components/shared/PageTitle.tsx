import React from 'react';

/**
 * Lets a page set the title shown in the app shell's header. The shell (AppShell) stays mounted
 * across navigation, so pages no longer wrap themselves in a layout and pass `title` down —
 * they call `usePageTitle(...)` instead.
 *
 * The context carries only the (stable) state setter, so setting a title never re-renders pages.
 */
type SetTitle = (title: string | undefined) => void;

export const PageTitleSetterContext = React.createContext<SetTitle>(() => undefined);

/**
 * Sets the header title for as long as the calling page is mounted. Runs in a layout effect so the
 * new title is committed before paint (no empty-header flash when navigating); the old page's cleanup
 * and the new page's effect land in the same commit, so the title swaps without an intermediate blank.
 * Call it before any early return in the component.
 */
export function usePageTitle(title: string | undefined): void {
  const setTitle = React.useContext(PageTitleSetterContext);
  React.useLayoutEffect(() => {
    setTitle(title);
    return () => setTitle(undefined);
  }, [setTitle, title]);
}
