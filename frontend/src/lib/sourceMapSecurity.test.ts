import { SourceMapConsumer, SourceNode } from 'source-map-js';
import type { RawSourceMap } from 'source-map-js';
import { describe, expect, it } from 'vitest';

// The package's legacy declarations omit indexed maps and type version as a
// string; the runtime supports standard version-3 JSON with numeric versions.
const consumeMap = (map: object) => new SourceMapConsumer(map as RawSourceMap);

describe('source map security and compatibility', () => {
  it('rejects extreme indexed-map offsets before processing source text', () => {
    expect(() => consumeMap({
      version: 3,
      file: 'output.js',
      sections: [{
        offset: { line: 10_000_000_000, column: 0 },
        map: { version: 3, file: 'section.js', sources: ['input.js'], names: [], mappings: 'AAAA' },
      }],
    })).toThrow();
  });

  it('preserves ordinary source-map processing used by the build tools', () => {
    const map = consumeMap({
      version: 3,
      file: 'output.js',
      sources: ['input.js'],
      names: [],
      mappings: 'AAAA',
    });
    expect(SourceNode.fromStringWithSourceMap('const value = 1;', map).toString()).toBe('const value = 1;');
  });
});
