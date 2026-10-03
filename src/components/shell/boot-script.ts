/** Session flag for the opening titles; shared by the server layout and the client intro. */
export const INTRO_KEY = "tf-intro";

/**
 * Runs in <head> before paint: the theme (saved choice, else the system's), hides the intro when
 * it was already shown in this session, and flags the announcement version the user closed.
 */
export const bootScript = [
  `(function(){try{var t=localStorage.getItem('tf-theme');var d=t?t==='dark':window.matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.classList.toggle('dark',d);}catch(e){document.documentElement.classList.add('dark')}})();`,
  `(function(){try{if(sessionStorage.getItem('${INTRO_KEY}'))document.documentElement.setAttribute('data-intro','done')}catch(e){}})();`,
  `(function(){try{var b=localStorage.getItem('tf-banner');if(b)document.documentElement.setAttribute('data-banner',b)}catch(e){}})();`,
].join("");
