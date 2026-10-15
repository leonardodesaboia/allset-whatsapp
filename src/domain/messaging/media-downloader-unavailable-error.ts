/** No configured adapter can recover this persisted media; an operator must intervene. */
export class MediaDownloaderUnavailableError extends Error {
  readonly code = "MEDIA_DOWNLOADER_UNAVAILABLE";
  constructor(readonly provider: string | undefined) {
    super(`Downloader não configurado para provider: ${provider}`);
    this.name = "MediaDownloaderUnavailableError";
  }
}
