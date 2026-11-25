import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: { default: "MediaGrab — Smart Media Downloader", template: "%s · MediaGrab" },
  description: "Paste a link and download the file. Simple, fast and free — plus a browser extension that finds media on any page.",
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
  colorScheme: "light",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${inter.variable} font-sans min-h-dvh`}>
        {children}
        <Toaster richColors closeButton position="bottom-right" theme="light" />
      </body>
    </html>
  );
}
