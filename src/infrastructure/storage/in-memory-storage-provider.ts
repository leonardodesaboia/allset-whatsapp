import type {
  DeleteFileInput,
  PutFileInput,
  SignedUrlInput,
  StorageProvider,
  StoredFile,
} from "../../domain/ports/storage-provider";

/** Provider para testes unitários rápidos que não precisam tocar o disco. */
export class InMemoryStorageProvider implements StorageProvider {
  private readonly files = new Map<string, PutFileInput>();

  async put(input: PutFileInput): Promise<StoredFile> {
    this.files.set(input.key, input);
    return { key: input.key, sizeBytes: input.data.byteLength, contentType: input.contentType };
  }

  async getSignedUrl(input: SignedUrlInput): Promise<string> {
    return `memory-storage://${input.key}?expires=${Date.now() + input.expiresInSeconds * 1000}`;
  }

  async delete(input: DeleteFileInput): Promise<void> {
    this.files.delete(input.key);
  }
}
