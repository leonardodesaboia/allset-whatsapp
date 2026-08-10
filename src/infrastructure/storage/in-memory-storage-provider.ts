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

  async get(input: { key: string }): Promise<Uint8Array> {
    const file = this.files.get(input.key);
    if (!file) throw new Error("Arquivo não encontrado");
    return file.data.slice();
  }

  async delete(input: DeleteFileInput): Promise<void> {
    this.files.delete(input.key);
  }
}
