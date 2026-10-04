"use client";

import { createAuthClient } from "better-auth/react";
import { adminClient, usernameClient } from "better-auth/client/plugins";

/** Browser-side auth client for the admin login form. */
export const authClient = createAuthClient({
  plugins: [usernameClient(), adminClient()],
});

export const { signIn, signOut, useSession } = authClient;
