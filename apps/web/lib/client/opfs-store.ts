"use client";
import { MemorySegmentStore, type SegmentStore, type SegmentWriter } from "@mediagrab/shared";

const ROOT = "mediagrab-downloads";

type WritableWithSeek = FileSystemWritableFileStream & { seek(position: number): Promise<void> };

export function opfsSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    !!navigator.storage?.getDirectory &&
    typeof FileSystemFileHandle !== "undefined" &&
    "createWritable" in FileSystemFileHandle.prototype
  );
}

async function rootDir(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(ROOT, { create: true });
}

/**
 * Segment storage in the Origin Private File System. Each segment is its own file, so concurrent
 * segments never contend for one writer, and progress survives page reloads (true resume).
 * The final Blob is assembled from disk-backed File objects without copying into memory.
 */
export class OpfsSegmentStore implements SegmentStore {
  private dir: FileSystemDirectoryHandle | null = null;
  constructor(private id: string) {}

  private async taskDir(): Promise<FileSystemDirectoryHandle> {
    if (!this.dir) this.dir = await (await rootDir()).getDirectoryHandle(this.id, { create: true });
    return this.dir;
  }
  private async file(index: number): Promise<FileSystemFileHandle> {
    return (await this.taskDir()).getFileHandle(`seg-${index}`, { create: true });
  }
  async init(count: number): Promise<void> {
    const dir = await this.taskDir();
    for (let i = 0; i < count; i++) await dir.getFileHandle(`seg-${i}`, { create: true });
    // Remove stale segments from an older plan.
    for await (const name of (dir as unknown as { keys(): AsyncIterable<string> }).keys()) {
      const m = /^seg-(\d+)$/.exec(name);
      if (m && Number(m[1]) >= count) await dir.removeEntry(name).catch(() => undefined);
    }
  }
  async size(index: number): Promise<number> {
    return (await (await this.file(index)).getFile()).size;
  }
  async writer(index: number): Promise<SegmentWriter> {
    const handle = await this.file(index);
    const existing = (await handle.getFile()).size;
    const w = (await handle.createWritable({ keepExistingData: true })) as WritableWithSeek;
    await w.seek(existing);
    // Batch small network chunks into fewer writes.
    let buf: Uint8Array[] = [];
    let bufSize = 0;
    const flush = async () => {
      if (!bufSize) return;
      const merged = new Uint8Array(bufSize);
      let o = 0;
      for (const c of buf) {
        merged.set(c, o);
        o += c.byteLength;
      }
      buf = [];
      bufSize = 0;
      await w.write(merged);
    };
    return {
      write: async (chunk) => {
        buf.push(chunk);
        bufSize += chunk.byteLength;
        if (bufSize >= 1024 * 1024) await flush();
      },
      close: async () => {
        try {
          await flush();
        } finally {
          await w.close();
        }
      },
    };
  }
  async reset(index: number): Promise<void> {
    const w = await (await this.file(index)).createWritable({ keepExistingData: false });
    await w.close();
  }
  async assemble(count: number, mimeType: string): Promise<Blob> {
    const parts: File[] = [];
    for (let i = 0; i < count; i++) parts.push(await (await this.file(i)).getFile());
    return new Blob(parts, { type: mimeType });
  }
  async destroy(): Promise<void> {
    this.dir = null;
    await (await rootDir()).removeEntry(this.id, { recursive: true }).catch(() => undefined);
  }
}

export function createStore(id: string): SegmentStore {
  return opfsSupported() ? new OpfsSegmentStore(id) : new MemorySegmentStore();
}

export async function clearAllStoredData(): Promise<void> {
  if (!opfsSupported()) return;
  const root = await navigator.storage.getDirectory();
  await root.removeEntry(ROOT, { recursive: true }).catch(() => undefined);
}

export async function removeStoredData(id: string): Promise<void> {
  if (!opfsSupported()) return;
  await (await rootDir()).removeEntry(id, { recursive: true }).catch(() => undefined);
}

/** Bytes this app currently keeps in browser storage. */
export async function storedBytes(): Promise<number> {
  if (!opfsSupported()) return 0;
  let total = 0;
  const walk = async (dir: FileSystemDirectoryHandle) => {
    for await (const handle of (dir as unknown as { values(): AsyncIterable<FileSystemHandle> }).values()) {
      if (handle.kind === "file") total += (await (handle as FileSystemFileHandle).getFile()).size;
      else await walk(handle as FileSystemDirectoryHandle);
    }
  };
  await walk(await rootDir());
  return total;
}
