import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";

export const metadata: Metadata = { title: "Privacy" };

const SECTIONS: Array<{ title: string; body: React.ReactNode }> = [
  {
    title: "The short version",
    body: (
      <>
        MediaGrab has no accounts, no ads and no analytics or tracking. Your download history and settings stay in your own browser. We don&apos;t sell or share data with anyone.
      </>
    ),
  },
  {
    title: "Browser extension",
    body: (
      <ul className="list-disc space-y-1.5 pl-5">
        <li>The extension reads the page you&apos;re viewing only to find video, audio and file links. That list stays inside the extension and is never sent to us or anyone else.</li>
        <li>Downloads go straight from the file&apos;s website to your computer through your browser&apos;s own download manager.</li>
        <li>Settings and the list of downloads you started are saved in your browser&apos;s extension storage (synced settings use your browser account&apos;s sync, if you have it on).</li>
        <li>If you turn on &ldquo;Look up file sizes&rdquo;, the extension asks the file&apos;s website for its size. These requests never include your cookies or logins.</li>
        <li>The extension only contacts the MediaGrab website when you choose &ldquo;Open in MediaGrab&rdquo; for a file.</li>
      </ul>
    ),
  },
  {
    title: "Website",
    body: (
      <ul className="list-disc space-y-1.5 pl-5">
        <li>When you paste a link, our server fetches that address to read the file&apos;s name, type and size, and (if needed) passes the file through to you. It never sends your cookies or passwords to other websites.</li>
        <li>We don&apos;t store the links you paste or the files you download. Our hosting provider keeps short-lived technical logs (such as IP addresses and request times) for security and to stop abuse.</li>
        <li>Your download history, settings and partly downloaded files are kept in your browser&apos;s storage. Clear them any time in Settings.</li>
      </ul>
    ),
  },
  {
    title: "What MediaGrab won't do",
    body: <>MediaGrab only downloads publicly accessible files. It doesn&apos;t bypass logins, paywalls, DRM or encryption, and it doesn&apos;t download from streaming services that forbid it.</>,
  },
  {
    title: "Contact",
    body: (
      <>
        Questions? Open an issue at{" "}
        <a className="text-primary underline-offset-2 hover:underline" href="https://github.com/SARWAR110786/media-grab/issues" target="_blank" rel="noopener noreferrer">
          github.com/SARWAR110786/media-grab
        </a>
        .
      </>
    ),
  },
];

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Privacy policy" description="Applies to the MediaGrab website and browser extension. Last updated 26 November 2026." />
      <Card className="divide-y px-5 sm:px-6">
        {SECTIONS.map((s) => (
          <section key={s.title} className="py-5">
            <h2 className="font-semibold">{s.title}</h2>
            <div className="mt-2 text-sm leading-relaxed text-muted-foreground">{s.body}</div>
          </section>
        ))}
      </Card>
    </div>
  );
}
