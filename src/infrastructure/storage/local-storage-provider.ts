import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  DeleteFileInput,
  PutFileInput,
  SignedUrlInput,
  StorageProvider,
  StoredFile,
} from "../../domain/ports/storage-provider";

/** Provider para desenvolvimento local. Produção usa um provider S3-compatível (Fase 8, TBD). */
export class LocalStorageProvider implements StorageProvider {
  constructor(private readonly baseDir: string) {}

  async put(input: PutFileInput): Promise<StoredFile> {
    const filePath = join(this.baseDir, input.key);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, input.data);
    const info = await stat(filePath);
    return { key: input.key, sizeBytes: info.size, contentType: input.contentType };
  }

  async getSignedUrl(input: SignedUrlInput): Promise<string> {
    const expires = Date.now() + input.expiresInSeconds * 1000;
    return `local-storage://${input.key}?expires=${expires}`;
  }

  async get(input: { key: string }): Promise<Uint8Array> {
    return readFile(join(this.baseDir, input.key));
  }

  async delete(input: DeleteFileInput): Promise<void> {
    await rm(join(this.baseDir, input.key), { force: true });
  }
}
