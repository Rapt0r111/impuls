"use client";

import { createContext, useContext } from "react";

export const SessionContext = createContext<{
  csrfToken: string;
  canReview?: boolean;
  canReadAudit?: boolean;
  canInspectCatalog?: boolean;
  canReadNotificationStatus?: boolean;
  canDecideRewards?: boolean;
  canFulfillRewards?: boolean;
  canCorrectLedger?: boolean;
  canManageTasks?: boolean;
  canSetTasks?: boolean;
  historyScopeIds?: string[];
  reportDirty(dirty: boolean): void;
  confirmLeave(): boolean;
  loseAccess(status: number): void;
} | null>(null);

export function useAuthorizedSession() {
  const session = useContext(SessionContext);
  if (!session) throw new Error("Authorized session is required");
  return session;
}
