import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service",
  description:
    "The terms and conditions governing your use of Wanderlust Marketing OS.",
};

export default function TermsPage() {
  return (
    <article className="space-y-6 text-foreground">
      <header className="space-y-2">
        <h1 className="text-4xl font-bold tracking-tight">Terms of Service</h1>
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
        <h2 className="text-2xl font-semibold">1. Acceptance of terms</h2>
        <p className="leading-relaxed text-muted-foreground">
          By creating an account or using Wanderlust Marketing OS, you agree
          to these terms. If you do not agree, do not use the service.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-2xl font-semibold">2. Account responsibilities</h2>
        <p className="leading-relaxed text-muted-foreground">
          You are responsible for the security of your account credentials
          and for all activity that occurs under your account. Notify us
          immediately of any unauthorized use.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-2xl font-semibold">3. Acceptable use</h2>
        <p className="leading-relaxed text-muted-foreground">
          You agree not to use the service to publish content that is
          illegal, infringing, deceptive, or that violates the terms of any
          connected social platform. You retain ownership of the content you
          create; you grant us a limited license to publish it on your
          behalf.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-2xl font-semibold">4. AI-generated content</h2>
        <p className="leading-relaxed text-muted-foreground">
          AI-generated suggestions are provided as drafts. You are
          responsible for reviewing and approving any content before it is
          published. We make no warranties about the accuracy or fitness of
          AI output.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-2xl font-semibold">5. Service availability</h2>
        <p className="leading-relaxed text-muted-foreground">
          We aim for high availability but do not guarantee uninterrupted
          access. We may modify or discontinue features with reasonable
          notice.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-2xl font-semibold">6. Termination</h2>
        <p className="leading-relaxed text-muted-foreground">
          You may delete your account at any time. We may suspend or
          terminate accounts that violate these terms.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-2xl font-semibold">7. Contact</h2>
        <p className="leading-relaxed text-muted-foreground">
          Questions about these terms can be sent to
          it@jaetravel.co.ke.
        </p>
      </section>
    </article>
  );
}
