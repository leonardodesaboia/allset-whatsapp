import { env } from "../../env";
import { LocalStorageProvider } from "./local-storage-provider";
import { S3StorageProvider } from "./s3-storage-provider";

/**
 * Composition root do storage. Retorna S3StorageProvider quando as variáveis
 * S3_* estão configuradas; cai para LocalStorageProvider em desenvolvimento.
 * O LocalStorageProvider não produz URLs HTTPS, portanto não serve para envio
 * de áudio pela Evolution em produção.
 */
export function createRuntimeStorage() {
  const required = [env.S3_ENDPOINT, env.S3_BUCKET, env.S3_REGION, env.S3_ACCESS_KEY_ID, env.S3_SECRET_ACCESS_KEY];
  if (required.every(Boolean)) {
    return new S3StorageProvider({
      endpoint: env.S3_ENDPOINT!,
      bucket: env.S3_BUCKET!,
      region: env.S3_REGION!,
      accessKeyId: env.S3_ACCESS_KEY_ID!,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY!,
      ...(env.S3_PUBLIC_URL ? { publicUrl: env.S3_PUBLIC_URL } : {}),
    });
  }
  if (required.some(Boolean)) {
    throw new Error(
      "Configuração S3 incompleta: S3_ENDPOINT, S3_BUCKET, S3_REGION, S3_ACCESS_KEY_ID e S3_SECRET_ACCESS_KEY devem ser definidos juntos",
    );
  }
  if (env.NODE_ENV === "production") {
    throw new Error("Storage S3 é obrigatório em produção");
  }
  return new LocalStorageProvider(process.env.LOCAL_STORAGE_DIR ?? ".data/storage");
}
