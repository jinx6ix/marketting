"use client";

import Script from "next/script";
import { useEffect } from "react";
import { usePathname } from "next/navigation";

declare global {
  interface Window {
    fbAsyncInit?: () => void;
    FB?: {
      init: (opts: {
        appId: string;
        cookie?: boolean;
        xfbml?: boolean;
        version: string;
      }) => void;
      AppEvents: { logPageView: () => void };
    };
  }
}

const APP_ID = process.env.NEXT_PUBLIC_META_APP_ID;
const API_VERSION = process.env.NEXT_PUBLIC_META_API_VERSION ?? "v21.0";

/**
 * Loads the Facebook JS SDK and logs a page view on every client-side
 * navigation. Server-side OAuth (see lib/social/adapters/meta.ts) is
 * unaffected — this only powers Meta App Events and XFBML widgets.
 */
export function FacebookSdk() {
  const pathname = usePathname();

  useEffect(() => {
    if (!APP_ID) return;
    window.fbAsyncInit = () => {
      window.FB?.init({
        appId: APP_ID,
        cookie: true,
        xfbml: true,
        version: API_VERSION,
      });
      window.FB?.AppEvents.logPageView();
    };
  }, []);

  // App Router navigations don't re-run fbAsyncInit, so log manually.
  useEffect(() => {
    if (!APP_ID) return;
    window.FB?.AppEvents.logPageView();
  }, [pathname]);

  if (!APP_ID) return null;

  return (
    <Script
      id="facebook-jssdk"
      src="https://connect.facebook.net/en_US/sdk.js"
      strategy="afterInteractive"
      crossOrigin="anonymous"
    />
  );
}
