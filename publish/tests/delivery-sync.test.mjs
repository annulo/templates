import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
const source = fs.readFileSync(new URL('../../core/features/websites/local/_delivery_reports.ts', import.meta.url), 'utf8').replace(/^import .*$/gm, '')
const api = await import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(`const mcpName = (ctx, host) => host === 'https://creght.com' ? 'creght-com' : 'creght'; const hostOf = () => 'https://creght.cn';\n${source}`)).toString('base64')}`)
function fixture() {
 const store = { delivery_sync: [], index_status: [], geo_results: [], geo_runs: [] }
 let seq = 0, fail = false, duringSend = null
 const calls = []
 const ctx = { db: {
  query: (t, q = {}) => ({ list: store[t].filter(r => Object.entries(q.where || {}).every(([k,v]) => r[k] === v)).slice(0,q.limit || 20).map(r => structuredClone(r)) }),
  insert: (t, r) => { const row = { id: 'r'+(++seq), ...r };store[t].push(row);return structuredClone(row) },
  update: (t,id,r) => Object.assign(store[t].find(x => x.id === id),r),
  get: (t,id) => structuredClone(store[t].find(x => x.id === id) || null),
 }, log() {}, mcp: async (server, tool, args) => {
  calls.push({ server, tool, args: structuredClone(args) })
  if (tool === 'site_status') return { published:true,live_url:'https://alias.example.com',report_url:'https://example.com' }
  if (fail) throw Error('temporary transport failure')
  if (duringSend) { const fn=duringSend;duringSend=null;fn() }
  return { id:'remote1',received_at:'2026-11-25T00:00:00Z' }
 } }
 const ch = { id:'c1',type:'creght_site',project_id:'p1',site_id:'s1',api_host:'https://creght.com',gsc_property:'sc-domain:example.com' }
 return {store,calls,ctx,ch,setFail:v=>fail=v,duringSend:fn=>duringSend=fn}
}
const search = { kind:'google-search',collected_at:'2026-11-24T00:00:00Z',property:'sc-domain:example.com',site_url:'https://example.com',period_start:'2026-11-01',period_end:'2026-11-23',summary:{clicks:10,impressions:100,ctr:.1,position:4},daily:[],pages:[{url:'https://example.com/product',clicks:3,impressions:30,ctr:.1,position:4},{url:'https://foreign.example/secret',clicks:1,impressions:2,ctr:.5,position:1}],queries:[] }
test('existing regional MCP, canonical report origin, no Google credentials, scope filtering',async()=>{
 const f=fixture();api.queueReport(f.ctx,f.ch,{...search,refresh_token:'never-upload',api_key:'never-upload'})
 assert.deepEqual(await api.flushReports(f.ctx,f.ch),{synced:1,failed:0})
 const sent=f.calls.find(c=>c.tool==='site_report_sync')
 assert.equal(sent.server,'creght-com');assert.equal(sent.args.report.site_url,'https://example.com');assert.equal(sent.args.report.pages.length,1)
 assert.equal(sent.args.report.truncated,true);assert.equal(sent.args.report.summary.clicks,10)
 assert.doesNotMatch(JSON.stringify(sent),/refresh_token|api_key|never-upload/)
 assert.equal(f.store.delivery_sync[0].status,'synced')
})
test('failed acknowledgement survives reload and retries with identical report ID',async()=>{
 const f=fixture();api.queueReport(f.ctx,f.ch,search);f.setFail(true)
 assert.equal((await api.flushReports(f.ctx,f.ch)).failed,1);assert.equal(f.store.delivery_sync[0].status,'failed')
 const before=f.calls.find(c=>c.tool==='site_report_sync').args.report
 f.setFail(false);assert.equal((await api.flushReports(f.ctx,f.ch)).synced,1)
 assert.deepEqual(f.calls.filter(c=>c.tool==='site_report_sync').at(-1).args.report,before)
 assert.equal((await api.flushReports(f.ctx,f.ch)).synced,0)
})
test('late acknowledgement cannot clear a newly queued snapshot',async()=>{
 const f=fixture();api.queueReport(f.ctx,f.ch,search)
 f.duringSend(()=>api.queueReport(f.ctx,f.ch,{...search,collected_at:'2026-11-25T00:00:00Z'}))
 await api.flushReports(f.ctx,f.ch)
 assert.equal(f.store.delivery_sync[0].status,'pending');assert.equal(f.store.delivery_sync[0].collected_at,'2026-11-25T00:00:00Z')
 await api.flushReports(f.ctx,f.ch);assert.equal(f.store.delivery_sync[0].status,'synced')
})
test('arbitrary external site channels have no delivery export target',async()=>{
 const f=fixture();assert.equal(api.queueReport(f.ctx,{...f.ch,type:'external'},search),null)
 assert.deepEqual(await api.flushReports(f.ctx,{...f.ch,type:'external'}),{skipped:true});assert.equal(f.calls.length,0)
})
test('index upload retains individual inspection dates and no inferred indexing',async()=>{
 const f=fixture();f.store.index_status.push({channel_id:'c1',page:'https://example.com/',state:'unknown',coverage:'URL is unknown to Google',inspected_at:'2026-11-01T00:00:00Z'})
 await api.publishIndex(f.ctx,f.ch,2)
 const report=f.calls.find(c=>c.tool==='site_report_sync').args.report
 assert.equal(report.inspections[0].state,'unknown');assert.equal(report.inspections[0].inspected_at,'2026-11-01T00:00:00Z');assert.equal(report.failed,2)
})
test('AI exports excerpts, distinguishes brand questions, deduplicates retry answers and never exports internal notes',async()=>{
 const f=fixture();f.store.geo_runs.push({id:'run1',engine:'chatgpt',model:'web',finished_at:'2026-11-25T00:00:00Z',summary:JSON.stringify({failed:[{error:'private failure'}]})})
 f.store.geo_results.push({id:'a',channel_id:'c1',run_id:'run1',question_id:'q1',question:'Which diffuser?',kind:'recommend',answer_excerpt:'Old',cited_urls:'[]'}, {id:'b',channel_id:'c1',run_id:'run1',question_id:'q1',question:'Which diffuser?',kind:'recommend',answer_excerpt:'New with reference',cited:true,cited_urls:'["https://example.com/product","https://foreign.example/product"]',user_report:'operator private note',answer:'full answer'}, {id:'c',channel_id:'c1',run_id:'run1',question_id:'q2',question:'Who is Example?',kind:'facts',answer_excerpt:'Example brand',cited_urls:'[]'})
 await api.publishAI(f.ctx,f.ch,'run1')
 const report=f.calls.find(c=>c.tool==='site_report_sync').args.report
 assert.equal(report.samples.length,2);assert.equal(report.samples[0].answer_excerpt,'New with reference');assert.deepEqual(report.samples[0].cited_urls,['https://example.com/product']);assert.equal(report.samples[1].kind,'facts');assert.equal(report.failed,1)
 assert.doesNotMatch(JSON.stringify(report),/operator private note|full answer|private failure/)
})

test('domain changes cannot repurpose an already collected report',async()=>{
 const f=fixture();api.queueReport(f.ctx,f.ch,{...search,site_url:'https://old.example.com'})
 assert.equal((await api.flushReports(f.ctx,f.ch)).failed,1)
 assert.equal(f.calls.filter(c=>c.tool==='site_report_sync').length,0)
 assert.match(f.store.delivery_sync[0].error,/domain changed/)
})
test('GSC query scopes domain properties to an escaped origin URL prefix',async()=>{
 const file=fs.readFileSync(new URL('../../core/features/websites/local/_gsc.ts',import.meta.url),'utf8').replace(/^import .*$/gm,'')
 const gsc=await import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes('const L = (ctx,cn,en) => en;\n'+file)).toString('base64')}`)
 const old=global.fetch;let body
 global.fetch=async(url,opts)=>{body=JSON.parse(opts.body);return {ok:true,json:async()=>({rows:[]})}}
 try { await gsc.query({oauth:async()=> 'test-token'},'sc-domain:example.com',{start:'2026-01-01',end:'2026-01-02',dimensions:[],pagePrefix:'https://example.com/'}) }
 finally {global.fetch=old}
 const expression=body.dimensionFilterGroups[0].filters[0].expression
 assert.equal(body.dimensionFilterGroups[0].filters[0].operator,'includingRegex')
 assert.ok(new RegExp(expression).test('https://example.com/product'))
 assert.equal(new RegExp(expression).test('https://exampleXcom/product'),false)
 assert.equal(new RegExp(expression).test('https://shop.example.com/product'),false)
})

test('rebinding a channel cannot send the old report to another project',async()=>{
 const f=fixture();api.queueReport(f.ctx,f.ch,search)
 assert.equal((await api.flushReports(f.ctx,{...f.ch,project_id:'p2',site_id:'s2'})).failed,1)
 assert.equal(f.calls.filter(c=>c.tool==='site_report_sync').length,0)
 assert.match(f.store.delivery_sync[0].error,/target changed/)
})
test('unlinking Google pauses pending Google report delivery',async()=>{
 const f=fixture();api.queueReport(f.ctx,f.ch,search)
 await api.flushReports(f.ctx,{...f.ch,gsc_link_disabled:true})
 assert.equal(f.calls.length,0);assert.equal(f.store.delivery_sync[0].status,'pending')
})
