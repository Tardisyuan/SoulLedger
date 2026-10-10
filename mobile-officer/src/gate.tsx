/**
 * Which of the three the officer sees: the shell (signed in), the sign-in page, or -- signed out, with a
 * reset link open -- the 设置新密码 form.
 *
 * The reset link is the one link that does NOT wait for sign-in (links.ts): the officer opening it is the
 * one who cannot sign in. While signed in, the shell takes it instead and draws the form over itself. Either
 * way a successful reset ends in the sign-in page with a line saying to use the new password; a dead link can
 * go straight on to 忘记密码 (signed out only).
 */
import { useEffect, useState } from "react";

import { isRetiredResetLink, resetLinks, type ResetLink } from "./links";
import { LoginScreen, type LoginHint } from "./screens/login";
import { ResetPasswordScreen } from "./screens/reset";
import { useSession } from "./session";
import { Shell } from "./shell";

export function Gate() {
  const { state } = useSession();
  const signedIn = state.status === "signedIn";
  const [reset, setReset] = useState<ResetLink | null>(null);
  const [hint, setHint] = useState<LoginHint | null>(null);

  useEffect(() => {
    if (signedIn) return;
    return resetLinks.subscribe((link) => {
      if (!isRetiredResetLink(link)) setReset(link);
    });
  }, [signedIn]);

  if (signedIn) {
    // A sign-in ends the hint; the one the shell sets on its way out (onResetDone) is set after this render.
    if (hint) setHint(null);
    return <Shell onResetDone={() => setHint("reset_done")} />;
  }
  if (reset) {
    return (
      <ResetPasswordScreen
        credential={reset}
        onClose={() => setReset(null)}
        onDone={() => {
          setReset(null);
          setHint("reset_done");
        }}
        onRequestAgain={() => {
          setReset(null);
          setHint("forgot");
        }}
      />
    );
  }
  return <LoginScreen hint={hint} />;
}
