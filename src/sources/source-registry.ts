import type { SourceAdapter } from './source-adapter';

export class SourceRegistry {
  constructor(private readonly adapters: SourceAdapter[]) {}

  forUrl(url: string) {
    const adapter = this.adapters.find((candidate) => candidate.supports(url));
    if (!adapter) throw new Error('unsupported source url');
    return adapter;
  }

  get(id: string) {
    const adapter = this.adapters.find((candidate) => candidate.id === id);
    if (!adapter) throw new Error(`unknown source adapter: ${id}`);
    return adapter;
  }
}
