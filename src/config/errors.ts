export class GeneralLoaderError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "GeneralLoaderError";
  }
}

export class ArkLoaderError extends GeneralLoaderError {
  public summary: string;
  public flatProblemsByPath: Record<string, string[]>;

  constructor(
    message: string,
    info: { summary: string; flatProblemsByPath: Record<string, string[]> },
  ) {
    super(message);
    this.name = "ArkLoaderError";
    this.summary = info.summary;
    this.flatProblemsByPath = info.flatProblemsByPath;
  }
}
