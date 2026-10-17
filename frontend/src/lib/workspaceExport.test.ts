/// <reference types="node" />
import { webcrypto, createHash } from 'node:crypto';
import { Blob as NodeBlob } from 'node:buffer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api } from './api';
import { emptyExportCursor, exportCatalog, originalCsv, prepareExportPart } from './workspaceExport';

const text = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const sample = { id: 1, name: '分析 🌱', content: { cells: [{ code: 'never execute()', output: 'é🌱'.repeat(100_000) }] } };
const records = { datasets: [{ id: 1, name: 'CSV' }], notebooks: [sample], dashboards: [], uploads: [] };
const signal = () => new AbortController().signal;
let post = vi.spyOn(api, 'post');
beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('Blob', NodeBlob);
  post = vi.spyOn(api, 'post').mockImplementation(async (url, body: unknown) => {
    const data = body as { category: keyof typeof records; record_id: string; offset: number };
    if (String(url).endsWith('/catalog')) return { data: { items: records[data.category].map((r) => ({ id: String(r.id), name: r.name, revision: '1', source_file: data.category === 'datasets' })), next_cursor: null } };
    const record = records[data.category].find((r) => r.id === Number(data.record_id));
    const bytes = text(record); const end = Math.min(data.offset + 384 * 1024, bytes.length);
    return { data: { data_base64: Buffer.from(bytes.slice(data.offset, end)).toString('base64'), total_bytes: bytes.length,
      next_offset: end < bytes.length ? end : null, sha256: createHash('sha256').update(bytes).digest('hex') } };
  });
});
afterEach(() => vi.unstubAllGlobals());

it('assembles every saved item and multibyte fragments into valid complete JSON without running code', async () => {
  const result = await prepareExportPart({ proof: 'memory-only', account: { id: 42 }, cursor: emptyExportCursor(), signal: signal(), startedAt: 'test-start' });
  const data = JSON.parse(await result.blob.text());
  expect(result.complete).toBe(true); expect(data.records).toHaveLength(2);
  expect(data.records[1]).toEqual({ kind: 'notebooks', data: sample });
  expect(data.account).toEqual({ id: 42 }); expect(data.final_part).toBe(true);
  expect(post.mock.calls.every(([, , config]) => Boolean(config?.signal))).toBe(true);
  expect(localStorage.length).toBe(0);
});

it('creates independently valid numbered parts and never advances the caller cursor', async () => {
  const cursor = emptyExportCursor();
  const first = await prepareExportPart({ proof: 'p', account: {}, cursor, signal: signal(), startedAt: 'start', targetBytes: 1 });
  expect(cursor).toEqual(emptyExportCursor()); expect(first.complete).toBe(false);
  const second = await prepareExportPart({ proof: 'p', account: {}, cursor: first.cursor, signal: signal(), startedAt: 'start', targetBytes: 1 });
  expect(second.cursor.part).toBe(2);
  const final = await prepareExportPart({ proof: 'p', account: {}, cursor: second.cursor, signal: signal(), startedAt: 'start' });
  const copies = [first, second, final];
  const ids = [];
  for (const part of copies) { const data=JSON.parse(await part.blob.text()); ids.push(...data.inventory.map((x: { category: string }) => x.category)); }
  expect(ids).toEqual(['datasets', 'notebooks']); expect(final.complete).toBe(true);
});

it('retains the cursor and returns no partial file when a record request fails', async () => {
  const cursor=emptyExportCursor(); const original=post.getMockImplementation()!;
  post.mockImplementation(async (...args) => { if (String(args[0]).endsWith('/record')) throw new Error('interrupted'); return original(...args); });
  await expect(prepareExportPart({ proof:'p',account:{},cursor,signal:signal(),startedAt:'s' })).rejects.toThrow('interrupted');
  expect(cursor).toEqual(emptyExportCursor());
});

it('bounds small-record work per part and continues across catalog pages without skips', async () => {
  post.mockImplementation(async (_url, body: unknown) => {
    const data=body as {category:string;after:string|null;record_id:string};
    if(String(_url).endsWith('/catalog')) {
      if(data.category!=='notebooks')return {data:{items:[],next_cursor:null}};
      const ids=data.after===null?Array.from({length:25},(_,i)=>i+1):[26,27,28,29,30];
      return {data:{items:ids.map(id=>({id:String(id),name:`N${id}`,revision:'1',source_file:false})),next_cursor:data.after===null?'25':null}};
    }
    const bytes=text({id:Number(data.record_id)});
    return {data:{data_base64:Buffer.from(bytes).toString('base64'),total_bytes:bytes.length,next_offset:null,sha256:createHash('sha256').update(bytes).digest('hex')}};
  });
  const first=await prepareExportPart({proof:'p',account:{},cursor:emptyExportCursor(),signal:signal(),startedAt:'s'});
  expect(first.records).toBe(25);expect(first.complete).toBe(false);
  const second=await prepareExportPart({proof:'p',account:{},cursor:first.cursor,signal:signal(),startedAt:'s'});
  expect(second.records).toBe(5);expect(second.complete).toBe(true);
  const all=[...JSON.parse(await first.blob.text()).records,...JSON.parse(await second.blob.text()).records];
  expect(all.map((r:{data:{id:number}})=>r.data.id)).toEqual(Array.from({length:30},(_,i)=>i+1));
});

it('rejects corrupt hashes and malformed pagination instead of claiming completeness', async () => {
  const original=post.getMockImplementation()!;
  post.mockImplementation(async (...args) => { const result=await original(...args); if(String(args[0]).endsWith('/record')) (result as { data: { sha256: string } }).data.sha256='0'.repeat(64); return result; });
  await expect(prepareExportPart({ proof:'p',account:{},cursor:emptyExportCursor(),signal:signal(),startedAt:'s' })).rejects.toThrow(/invalid/);
  post.mockResolvedValue({ data: { items:[{id:'1',name:'x',revision:'1',source_file:false}],next_cursor:'0' } });
  await expect(exportCatalog('p','notebooks',null,signal())).rejects.toThrow(/invalid/);
});

it('exports an empty account as a complete machine-readable file', async () => {
  post.mockResolvedValue({data:{items:[],next_cursor:null}});
  const result=await prepareExportPart({proof:'p',account:{id:1},cursor:emptyExportCursor(),signal:signal(),startedAt:'s'});
  expect(JSON.parse(await result.blob.text())).toMatchObject({final_part:true,records:[],account:{id:1}});
});

it('does not continue a cancelled export', async () => {
  const controller=new AbortController();controller.abort();
  await expect(prepareExportPart({proof:'p',account:{},cursor:emptyExportCursor(),signal:controller.signal,startedAt:'s'})).rejects.toThrow();
});

it('downloads original CSV bytes directly without cookie/proof headers and enforces size', async () => {
  post.mockResolvedValue({data:{url:'https://project.supabase.co/storage/v1/object/sign/datasets/users/42/source.csv?token=temporary',filename:'dataset-1.csv',max_bytes:50_000_000}});
  const body=new TextEncoder().encode('a,b\n1,2\n');
  const fetcher=vi.fn().mockResolvedValue({ok:true,headers:new Headers(),body:new ReadableStream({start(c){c.enqueue(body);c.close();}})});
  vi.stubGlobal('fetch',fetcher);
  const result=await originalCsv('private-proof',1,signal());
  expect(await result.blob.text()).toBe('a,b\n1,2\n');
  expect(fetcher).toHaveBeenCalledWith(expect.any(String),expect.objectContaining({credentials:'omit',referrerPolicy:'no-referrer',redirect:'error',cache:'no-store'}));
  expect(fetcher.mock.calls[0][1].headers).toBeUndefined();
  post.mockResolvedValue({data:{url:'https://project.supabase.co/storage/v1/object/sign/datasets/a.csv?token=t',filename:'dataset-1.csv',max_bytes:2}});
  fetcher.mockResolvedValue({ok:true,headers:new Headers(),body:new ReadableStream({start(c){c.enqueue(body);c.close();}})});
  await expect(originalCsv('p',1,signal())).rejects.toThrow(/size/);
});
