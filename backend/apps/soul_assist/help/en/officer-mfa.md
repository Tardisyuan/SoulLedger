---
id: officer-mfa
screens: [profile, users, welcome, other]
audience: officer
civilizations: []
codes: []
questions:
  - "how do I turn on two-step verification"
  - "what if I lose my recovery codes"
  - "why am I asked for a code when signing in"
  - "why does the page keep reminding me to set up two-step verification"
  - "how do I turn off two-step verification"
  - "what if an officer loses their phone"
---
Two-step verification: once on, signing in asks for the six-digit code from an authenticator app after your username and password. It is in "Profile" on the officer desk, in a block called "Two-step verification"; the officer app has an entry of the same name under "Me".
Turning it on: tap "Turn on two-step verification", enter your current password to show it is you, then four steps. One, install any time-based authenticator app on your phone. Two, scan the QR code with it, or copy the key and type it in by hand. Three, enter the six digits the app shows right now. Four, save the recovery codes with "Copy all" or "Download .txt", and tick "I have saved these recovery codes somewhere safe" before you can finish; they are not shown again after this step. Leaving midway does not turn it on. If the code is refused, first check that the phone's clock is accurate.
Managing it: once on, "Profile" shows when it was turned on, whether the code or a recovery code was used last, and how many recovery codes are left. "Regenerate" voids the old set at once and shows a new set once. "Turn off two-step verification" asks you to confirm with a code from the authenticator or a recovery code; the password alone cannot turn it off. Afterwards signing in needs only the password.
Signing in: after the password you are asked for the code, and may tick not to be asked again on this device for a while. A wrong code says how many tries are left; too many locks it for a while, and the page says when you can try again. If the code has expired, wait for the app to refresh and enter the new one; if the sign-in step timed out, enter your username and password again.
Phone not with you: tap "Phone not with you? Use a recovery code" and enter one you have not used; it is case-insensitive and the dash is optional. If you have lost the recovery codes too, ask an administrator with the user management permission to tap "Reset two-step verification" in User Management; the reason goes to the audit log, and afterwards your password is enough and you can turn it on again.
Being required: administrators are always required; whether other roles are required is set per hall by a global administrator under "Tenant Management > Edit settings". Someone who is required but has not set it up can still sign in, but until it is done they can only set up two-step verification, change their password or sign out; the server refuses every other page and action, and both the officer desk and the officer app take them straight to the setup.
