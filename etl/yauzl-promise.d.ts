declare module "yauzl-promise" {
  import type { Readable } from "node:stream";

  interface Entry {
    filename: string;
    openReadStream(): Promise<Readable>;
  }

  interface Zip extends AsyncIterable<Entry> {
    close(): Promise<void>;
  }

  const yauzl: {
    open(path: string): Promise<Zip>;
  };

  export default yauzl;
}
