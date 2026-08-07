export interface DownloadedInboundMedia { data: Uint8Array; contentType: string; }
export interface InboundMediaDownloader {
  download(input: { externalId: string; contentType: string; providerMetadata: unknown }): Promise<DownloadedInboundMedia>;
}
