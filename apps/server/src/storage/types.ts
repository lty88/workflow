import type { Readable } from 'node:stream';
export interface AttachmentStorage {
  put: (id: string, buffer: Buffer, mime: string) => Promise<string>;
  remove: (key: string) => Promise<void>;
  read: (key: string) => Promise<Readable>;
}
