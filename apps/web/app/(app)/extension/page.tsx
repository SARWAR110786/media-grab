import type { Metadata } from "next";
import { ExtensionView } from "./view";

export const metadata: Metadata = { title: "Browser Extension" };

export default function ExtensionPage() {
  return <ExtensionView />;
}
