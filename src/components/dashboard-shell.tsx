"use client";

import { useState } from "react";
import { Sidebar } from "@/components/sidebar";
import { Topbar } from "@/components/topbar";

/**
 * Dashboard chrome with mobile-aware sidebar drawer. On md+ the sidebar is
 * always visible; on small screens it slides in over a backdrop when the
 * hamburger in the Topbar is tapped.
 */
export function DashboardShell({
  orgName,
  userEmail,
  failedCount,
  children,
}: {
  orgName: string;
  userEmail: string;
  failedCount: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Desktop sidebar: always visible on md+ */}
      <div className="hidden md:flex">
        <Sidebar />
      </div>

      {/* Mobile drawer: shown when toggled */}
      {open && (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-black/50"
          />
          <div className="relative z-10 h-full w-64 max-w-[80vw] animate-in slide-in-from-left">
            <Sidebar collapsible={false} onNavigate={() => setOpen(false)} onClose={() => setOpen(false)} />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          orgName={orgName}
          userEmail={userEmail}
          failedCount={failedCount}
          onOpenMenu={() => setOpen(true)}
        />
        <main className="flex-1 overflow-y-auto p-3 sm:p-4 md:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}