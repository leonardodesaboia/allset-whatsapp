export interface PutFileInput {
  key: string;
  contentType: string;
  data: Uint8Array;
  ownerId: string;
}

export interface StoredFile {
  key: string;
  sizeBytes: number;
  contentType: string;
}

export interface SignedUrlInput {
  key: string;
  expiresInSeconds: number;
}

export interface DeleteFileInput {
  key: string;
}

export interface GetFileInput {
  key: string;
}

export interface StorageProvider {
  put(input: PutFileInput): Promise<StoredFile>;
  get(input: GetFileInput): Promise<Uint8Array>;
  getSignedUrl(input: SignedUrlInput): Promise<string>;
  delete(input: DeleteFileInput): Promise<void>;
}
