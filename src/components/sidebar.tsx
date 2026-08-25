"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Calendar,
  FileText,
  Megaphone,
  Target,
  Inbox,
  BarChart3,
  Users,
  Lightbulb,
  Settings,
  Plane,
  ChevronsLeft,
  ChevronsRight,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const GROUPS: NavGroup[] = [
  {
    label: "Overview",
    items: [{ href: "/dashboard", label: "Dashboard", icon: LayoutDashboard }],
  },
  {
    label: "Content",
    items: [
      { href: "/calendar", label: "Calendar", icon: Calendar },
      { href: "/items", label: "Marketing Items", icon: FileText },
      { href: "/campaigns", label: "Campaigns", icon: Megaphone },
      { href: "/ads", label: "Ads", icon: Target },
    ],
  },
  {
    label: "Engagement",
    items: [
      { href: "/inbox", label: "Inbox", icon: Inbox },
      { href: "/competitors", label: "Competitors", icon: Users },
    ],
  },
  {
    label: "Insights",
    items: [
      { href: "/analytics", label: "Analytics", icon: BarChart3 },
      { href: "/strategies", label: "Strategies", icon: Lightbulb },
    ],
  },
];

const SETTINGS_ITEM: NavItem = {
  href: "/settings/accounts",
  label: "Settings",
  icon: Settings,
};

const STORAGE_KEY = "sidebar-collapsed";
// Fired after a same-tab write so the toggle takes effect immediately —
// the native "storage" event only fires in OTHER tabs/windows, not the one
// that made the change.
const COLLAPSE_EVENT = "sidebar-collapsed-change";

/**
 * Reading localStorage needs to happen outside render (SSR has no
 * localStorage), and useSyncExternalStore is the correct primitive for
 * that — unlike an effect + setState, it has a built-in, lint-clean
 * contract for "render this on the server, then reconcile with the real
 * client value right after hydration" with no manual flicker-avoidance
 * state needed.
 */
function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(COLLAPSE_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(COLLAPSE_EVENT, callback);
  };
}
function getSnapshot(): boolean {
  return localStorage.getItem(STORAGE_KEY) === "1";
}
function getServerSnapshot(): boolean {
  return false; // default expanded until the client value is known
}
function setCollapsedPreference(value: boolean) {
  localStorage.setItem(STORAGE_KEY, value ? "1" : "0");
  window.dispatchEvent(new Event(COLLAPSE_EVENT));
}

function isActive(pathname: string, href: string): boolean {
  if (href === "/dashboard") return pathname === href;
  const section = "/" + href.split("/")[1];
  return pathname === href || pathname.startsWith(section + "/") || pathname === section;
}

export function Sidebar({
  onNavigate,
  onClose,
  /** Mobile drawer instance: always fully expanded, no collapse toggle. */
  collapsible = true,
}: {
  onNavigate?: () => void;
  onClose?: () => void;
  collapsible?: boolean;
}) {
  const pathname = usePathname();
  const collapsed = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const showCollapsed = collapsible && collapsed;

  function renderItem(item: NavItem) {
    const active = isActive(pathname, item.href);
    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={onNavigate}
        title={showCollapsed ? item.label : undefined}
        className={cn(
          "group flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
          showCollapsed && "justify-center px-0",
          active
            ? "bg-white/10 font-medium text-sidebar-foreground"
            : "text-sidebar-foreground/70 hover:bg-white/5 hover:text-sidebar-foreground"
        )}
      >
        <item.icon className="size-4 shrink-0" />
        {!showCollapsed && <span className="truncate">{item.label}</span>}
      </Link>
    );
  }

  return (
    <aside
      className={cn(
        "flex h-full shrink-0 flex-col bg-sidebar text-sidebar-foreground transition-[width] duration-150 md:h-screen",
        showCollapsed ? "w-16" : "w-56"
      )}
    >
      <div className="flex items-center gap-2 px-4 py-5">
        <Plane className="size-6 shrink-0" />
        {!showCollapsed && (
          <span className="truncate text-sm font-semibold tracking-tight">
            Wanderlust OS
          </span>
        )}
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="ml-auto rounded-md p-1 text-sidebar-foreground/70 hover:bg-white/5 hover:text-sidebar-foreground"
          >
            <X className="size-4" />
          </button>
        )}
      </div>

      <nav className="flex-1 space-y-4 overflow-y-auto px-2">
        {GROUPS.map((group) => (
          <div key={group.label}>
            {!showCollapsed && (
              <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/40">
                {group.label}
              </div>
            )}
            <div className="space-y-0.5">{group.items.map(renderItem)}</div>
          </div>
        ))}
      </nav>

      <div className="space-y-0.5 border-t border-white/10 px-2 py-2">
        {renderItem(SETTINGS_ITEM)}
      </div>

      {collapsible && (
        <button
          type="button"
          onClick={() => setCollapsedPreference(!collapsed)}
          className="flex items-center gap-2 border-t border-white/10 px-4 py-3 text-xs text-sidebar-foreground/60 hover:bg-white/5 hover:text-sidebar-foreground"
        >
          {showCollapsed ? (
            <ChevronsRight className="size-4" />
          ) : (
            <>
              <ChevronsLeft className="size-4" /> Collapse
            </>
          )}
        </button>
      )}

      {!showCollapsed && !collapsible && (
        <div className="px-4 py-4 text-xs text-sidebar-foreground/50">
          Travel & Tours Marketing
        </div>
      )}
    </aside>
  );
}