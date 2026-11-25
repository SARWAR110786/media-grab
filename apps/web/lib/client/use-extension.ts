"use client";
import { useEffect, useState } from "react";

/** The extension's content script marks pages it runs on with data-mediagrab-extension="<version>". */
export function useExtensionVersion(): string | null {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    const read = () => setVersion(document.documentElement.dataset.mediagrabExtension ?? null);
    read();
    const obs = new MutationObserver(read);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-mediagrab-extension"] });
    return () => obs.disconnect();
  }, []);
  return version;
}
