// Light/dark choice for the app surfaces. The key and values are the Console's
// (components/console/ConsoleApp.tsx), so a choice made on one surface holds on
// the others.

export const THEME_KEY = "counter.console.theme";
export const STORED_LIGHT = "console-light";
export const STORED_DARK = "console-dark";

export type AppTheme = "light" | "dark";

/**
 * Runs inline as the first child of the themed root, before paint: applies a
 * saved choice so the page never flashes the other theme. With no saved
 * choice the system setting applies through CSS.
 */
export const THEME_BOOT_SCRIPT = `(function(){try{var r=document.currentScript&&document.currentScript.parentElement;if(!r)return;var m=localStorage.getItem(${JSON.stringify(
  THEME_KEY,
)});if(m===${JSON.stringify(STORED_DARK)})r.setAttribute("data-theme","dark");else if(m===${JSON.stringify(
  STORED_LIGHT,
)})r.setAttribute("data-theme","light");}catch(e){}})();`;
