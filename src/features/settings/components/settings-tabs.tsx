"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/settings/accounts", label: "Connected accounts" },
  { href: "/settings/team", label: "Team" },
  { href: "/settings/organization", label: "Organization" },
  { href: "/settings/jobs", label: "Jobs" },
];

export function SettingsTabs() {
  const pathname = usePathname();
  return (
    <nav className="mt-3 flex gap-1 border-b">
      {TABS.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          className={cn(
            "-mb-px border-b-2 px-3 py-2 text-sm transition-colors",
            pathname.startsWith(tab.href)
              ? "border-primary font-medium text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
