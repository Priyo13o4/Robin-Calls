export class NotImplementedInPublicBuild extends Error {
  constructor(symbol: string) {
    super(`Not implemented in public build: ${symbol}`);
    this.name = "NotImplementedInPublicBuild";
  }
}
