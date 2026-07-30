import type { SessionUser } from "@pas/shared-types";

/** Display name for the signed-in clerk on worksheets and outbound documents. */
export function clerkDisplayName(user: Pick<SessionUser, "name" | "username"> | null | undefined): string {
  return user?.name?.trim() || user?.username?.trim() || "Brokerage Team";
}
