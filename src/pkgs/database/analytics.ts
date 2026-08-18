export class ChainSignatureStats {
  public chainId: string;
  public percentageSigned: number;
  public percentageMissed: number;

  constructor(chainId: string, percentageSigned: number, percentageMissed: number) {
    this.chainId = chainId;
    this.percentageSigned = percentageSigned;
    this.percentageMissed = percentageMissed;
  }
}

export class BlockWindowStats {
  public total: number;
  public missed: number;

  constructor(total: number, missed: number) {
    this.total = total;
    this.missed = missed;
  }
}
