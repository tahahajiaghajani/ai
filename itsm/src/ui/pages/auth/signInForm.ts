/**
 * Which form the sign-in page shows: the organisation's account (Active Directory) or e-mail and password.
 *
 * Nothing is shown until the server has said which ways in are open (GET /api/auth/options). A form shown before that
 * answer would be swapped under someone already typing: bank-sim run 43180784825 typed the administrator's address into
 * the e-mail form, the late answer switched the page to «حساب سازمانی», and the address went to the domain sign-in.
 * After the first answer the choice stays put (a later refetch never swaps the form); only the person's own pick changes
 * it, and the domain form needs the directory to still be there.
 */
export type SignInWay = "directory" | "local";

export function signInForm(known: boolean, directory: boolean, picked: SignInWay | null, first: SignInWay | null): SignInWay | null {
  if (!known) return null;
  const way = picked ?? first ?? (directory ? "directory" : "local");
  return way === "directory" && directory ? "directory" : "local";
}

/** The way the page opens on, fixed at the server's first answer: the domain account when the directory is on. */
export function firstSignInWay(directory: boolean): SignInWay {
  return directory ? "directory" : "local";
}
