import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
const { build } = createRequire(import.meta.url)(process.env.ESBUILD_MODULE || 'esbuild')
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'), temps=[], prepared=[]
after(()=>{ for(const dir of temps) fs.rmSync(dir,{recursive:true,force:true}) })
for(const template of ['creator','product']) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),`${template}-cover-`));temps.push(dir)
  fs.cpSync(path.join(root,template),dir,{recursive:true})
  fs.cpSync(path.join(root,'core/local'),path.join(dir,'local'),{recursive:true})
  if(template==='product') fs.cpSync(path.join(root,'core/features/websites'),dir,{recursive:true})
  await build({stdin:{contents:"export * as content from './local/content';export * as convert from './local/convert';",resolveDir:dir},bundle:true,platform:'node',format:'esm',outfile:path.join(dir,'test.mjs'),logLevel:'silent',plugins:[{name:'social-fixture',setup(b){
    b.onResolve({filter:/plugins\/social\//},a=>({path:a.path,namespace:'fixture'}))
    b.onLoad({filter:/.*/,namespace:'fixture'},()=>({loader:'ts',contents:"export const FIELDS={};export const CONTENT_TYPES=['article','post','video'];export const contentType=c=>c?.type||'article';export const parseList=v=>Array.isArray(v)?v:JSON.parse(v||'[]');export const platformsFor=()=>[];export const htmlImages=()=>[];export const lengthOn=()=>0;export const supports=()=>false;export const fromContent=c=>c;export const summary=()=>[];"}))
  }}]})
  const {content,convert}=await import(pathToFileURL(path.join(dir,'test.mjs')))
  prepared.push({template,content,convert})
}
for(const {template,content,convert} of prepared) {
  function fixture(){
    const tables={articles:[],topics:[],assets:[],profile:[],social_accounts:[]}
    const ctx={locale:'en',db:{get:(t,id)=>(tables[t]||[]).find(r=>r.id===id),query:t=>({list:tables[t]||[]}),insert:(t,v)=>{tables[t] ||= [];const row={...v,id:'row-'+tables[t].length};tables[t].push(row);return row},update:(t,id,v)=>Object.assign(tables[t].find(r=>r.id===id),v)}}
    return {ctx,tables}
  }
  test(`${template}: cover survives save, partial edits, copies and conversions with the same video`,()=>{
    const {ctx,tables}=fixture(),cover='/_annulo/uploaded/cover.png'
    const {article_id:id}=content.save({type:'video',title:'Title',body:'Description',video:'local:demo.mp4',video_cover:cover},ctx)
    content.update({article_id:id,title:'Edited'},ctx)
    assert.equal(ctx.db.get('articles',id).video_cover,cover)
    const copied=convert.copy({article_id:id},ctx)
    assert.equal(ctx.db.get('articles',copied.article_id).video_cover,cover)
    const article=convert.toType({article_id:id,type:'article'},ctx)
    const video=convert.toType({article_id:article.article_id,type:'video'},ctx)
    assert.equal(ctx.db.get('articles',video.article_id).video_cover,cover)
    assert.equal(content.rewriteContext({article_id:id,type:'video'},ctx).source.video_cover,cover)
    const before=JSON.stringify(tables)
    assert.throws(()=>content.update({article_id:id,video_cover:'javascript:alert(1)'},ctx),/Library/)
    assert.equal(JSON.stringify(tables),before)
    content.update({article_id:id,video_cover:''},ctx)
    assert.equal(ctx.db.get('articles',id).video_cover,'')
  })
  test(`${template}: image posts do not save independent video covers`,()=>{
    const {ctx}=fixture()
    const {article_id:id}=content.save({type:'post',title:'Title',body:'Body',images:['https://assets.test/first.png'],video_cover:'https://assets.test/cover.png'},ctx)
    assert.equal(ctx.db.get('articles',id).video_cover,undefined)
    assert.deepEqual(JSON.parse(ctx.db.get('articles',id).images),['https://assets.test/first.png'])
    assert.equal(JSON.parse(fs.readFileSync(path.join(root,template,'tables/articles.json'),'utf8')).json_schema.properties.video_cover.type,'string')
  })
}
