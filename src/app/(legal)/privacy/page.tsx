import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "How Wanderlust Marketing OS collects, uses, and protects your information.",
};

export default function PrivacyPage() {
  return (
    <article className="space-y-6 text-foreground">
      <header className="space-y-2">
        <h1 className="text-4xl font-bold tracking-tight">Privacy Policy</h1>
        <p className="text-sm text-muted-foreground">
          Last updated:{" "}
          {new Date().toLocaleDateString("en-US", {
            year: "numeric",
            month: "long",
            day: "numeric",
          })}
        </p>
      </header>

      <section className="space-y-2">
        <h2 className="text-2xl font-semibold">1. Information we collect</h2>
        <p className="leading-relaxed text-muted-foreground">
          We collect information you provide when you create an account
          (email, organization name) and information that flows through the
          service when you connect social media accounts (post content,
          scheduling metadata, engagement metrics).
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-2xl font-semibold">2. How we use your information</h2>
        <p className="leading-relaxed text-muted-foreground">
          We use the information to operate the service, generate AI-assisted
          marketing content, publish to the social platforms you connect,
          and improve the product. We do not sell your data.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-2xl font-semibold">3. Data storage and security</h2>
        <p className="leading-relaxed text-muted-foreground">
          Your data is stored with our infrastructure provider using
          industry-standard encryption in transit and at rest. Access is
          limited to authorized personnel.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-2xl font-semibold">4. Your rights</h2>
        <p className="leading-relaxed text-muted-foreground">
          You can request export or deletion of your data at any time by
          contacting it@jaetravel.co.ke. We will respond within 30 days.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-2xl font-semibold">5. Cookies</h2>
        <p className="leading-relaxed text-muted-foreground">
          We use a single first-party cookie to maintain your authenticated
          session. We do not use third-party tracking cookies.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-2xl font-semibold">6. Contact</h2>
        <p className="leading-relaxed text-muted-foreground">
          Questions about this policy can be sent to
          it@jaetravel.co.ke.
        </p>
      </section>
    </article>
  );
}
