import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type {
  DeleteFileInput,
  GetFileInput,
  PutFileInput,
  SignedUrlInput,
  StorageProvider,
  StoredFile,
} from "../../domain/ports/storage-provider";

export interface S3Config {
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** URL pública exposta à Evolution e ao cliente (quando difere do endpoint interno). */
  publicUrl?: string;
}

export class S3StorageProvider implements StorageProvider {
  private readonly client: S3Client;
  /** Cliente usado apenas para assinar URLs — usa publicUrl se configurado. */
  private readonly signingClient: S3Client;
  private readonly bucket: string;

  constructor(config: S3Config) {
    const base = {
      region: config.region,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
      forcePathStyle: true, // obrigatório para MinIO e S3-compatíveis com path-style
    };
    this.client = new S3Client({ ...base, endpoint: config.endpoint });
    this.signingClient =
      config.publicUrl && config.publicUrl !== config.endpoint
        ? new S3Client({ ...base, endpoint: config.publicUrl })
        : this.client;
    this.bucket = config.bucket;
  }

  async put(input: PutFileInput): Promise<StoredFile> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: input.key,
        Body: input.data,
        ContentType: input.contentType,
        Metadata: { ownerId: input.ownerId },
      }),
    );
    return { key: input.key, sizeBytes: input.data.byteLength, contentType: input.contentType };
  }

  async get(input: GetFileInput): Promise<Uint8Array> {
    const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: input.key }));
    if (!response.Body) throw new Error(`Arquivo não encontrado no storage: ${input.key}`);
    return new Uint8Array(await response.Body.transformToByteArray());
  }

  async getSignedUrl(input: SignedUrlInput): Promise<string> {
    return getSignedUrl(
      this.signingClient,
      new GetObjectCommand({ Bucket: this.bucket, Key: input.key }),
      { expiresIn: input.expiresInSeconds },
    );
  }

  async delete(input: DeleteFileInput): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: input.key }));
  }
}
