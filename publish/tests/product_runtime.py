"""Run growth invariants against a disposable local Annulo project.

Example: python3 publish/tests/product_runtime.py --url http://127.0.0.1:7817 --project-id local-product-qa
"""
import urllib.request,json,uuid,argparse
from urllib.parse import urlparse
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--url',required=True)
parser.add_argument('--project-id',required=True)
args=parser.parse_args()
address=urlparse(args.url)
if address.scheme!='http' or address.hostname not in ['127.0.0.1','localhost','::1'] or not args.project_id.startswith('local-'):
    parser.error('Use a disposable local Annulo project and a localhost URL')
base=args.url.rstrip('/')+'/_shuttle/api/'
req=urllib.request.Request(base+'setup',headers={'X-Shuttle':'1'})
with urllib.request.urlopen(req,timeout=10) as response: active=json.load(response)
assert any(p.get('current') and p.get('offline') and p.get('project_id')==args.project_id for p in active.get('backends',[])), 'The active project must match the named disposable project'
checks=0
def call(fn,value={}):
 req=urllib.request.Request(base+'local/run',data=json.dumps({'fn':fn,'input':value}).encode(),headers={'X-Shuttle':'1','Content-Type':'application/json'})
 with urllib.request.urlopen(req,timeout=30) as r:raw=r.read().decode()
 for line in raw.splitlines():
  if not line.startswith('data: '):continue
  item=json.loads(line[6:])
  if item['type']=='error':raise ValueError(item['data']['message'])
  if item['type']=='result':return item['data']['value']
 raise ValueError('No result: '+raw)
def check(value,name):
 global checks
 assert value,name
 checks+=1
 print('PASS',name)
def rejects(fn,data):
 try:call(fn,data)
 except ValueError:return True
 return False
label='QA-'+uuid.uuid4().hex[:8]
p=call('products.save',{'name':label,'summary':'Test product','audience':'QA','features':'Verified feature','source_url':'https://example.com','verified_at':'2026-10-12T00:00:00+08:00'})
q=call('products.save',{'name':label+'-other'})
u=call('products.saveUseCase',{'product_id':p['id'],'title':label+'-usecase','problem':'A test task'})
check(rejects('growth.saveOpportunity',{'title':'Bad link','product_id':q['id'],'use_case_id':u['id']}),'cross-product use cases rejected')
check(rejects('growth.saveOpportunity',{'title':'Invented metric','product_id':p['id'],'search_volume':100}),'keyword metrics require provenance and date')
check(rejects('growth.saveOpportunity',{'title':'Unverified','product_id':p['id'],'status':'validated'}),'validated opportunities require evidence')
o=call('growth.saveOpportunity',{'title':label+'-opportunity','product_id':p['id'],'use_case_id':u['id'],'keyword':label.lower(),'language':'zh','status':'validated','evidence':'Test demand evidence','source_url':'https://example.com','checked_at':'2026-10-12T00:00:00+08:00','data_source':'QA source','search_volume':0,'difficulty':0})
check(o['search_volume']==0 and o['difficulty']==0,'measured zero keyword data preserved')
check(rejects('growth.saveOpportunity',{'title':'Duplicate','product_id':p['id'],'keyword':label.upper(),'language':'zh'}),'keyword opportunities deduplicated by intent and language')
c=call('growth.createCampaign',{'opportunity_id':o['id']})
check(call('growth.createCampaign',{'opportunity_id':o['id']})['id']==c['id'],'campaign creation is idempotent')
plan={'campaign_id':c['id'],'topics':[{'target_platform':a,'title':label+'-'+a,'outline':'Use real footage'} for a in ['website','xiaohongshu','douyin','x']]}
a=call('growth.savePlan',plan);b=call('growth.savePlan',plan)
check([t['id'] for t in a['topics']]==[t['id'] for t in b['topics']],'campaign plans are idempotent')
check([t['content_type'] for t in a['topics']]==['article','post','video','post'],'platforms use the correct content types')
post=next(t for t in a['topics'] if t['target_platform']=='x')
article=call('content.save',{'topic_id':post['id'],'type':'post','title':label+'-draft','body':'Real product test content'})
detail=call('growth.campaignContext',{'campaign_id':c['id']})
check(any(v['id']==article['article_id'] and v['campaign_id']==c['id'] and v['product_id']==p['id'] for v in detail['articles']),'content retains campaign and product links')
first={'date':'2026-10-12','source':label.lower(),'campaign_id':c['id'],'visits':20,'signups':0,'provenance':'QA fixture, sessions and event counts'}
call('metrics.importDaily',{'rows':[first]});r=call('metrics.importDaily',{'rows':[{**first,'visits':30,'signups':3}]})
check(r=={'created':0,'updated':1},'daily metrics replace snapshots on retries')
s=call('metrics.summary',{'start':'2026-10-12','end':'2026-10-12','campaign_id':c['id']})
check(s['totals']['visits']==30 and s['totals']['signups']==3 and s['totals']['activations'] is None,'aggregates preserve unknown and measured values')
check(rejects('metrics.importDaily',{'rows':[{**first,'date':'2026-02-30'}]}),'invalid calendar dates rejected')
check(rejects('metrics.importDaily',{'rows':[first,{**first,'signups':5}]}),'duplicate batch rows rejected before writing')
check(rejects('metrics.importDaily',{'rows':[{**first,'visits':10},{**first,'date':'2026-10-11','signups':-1}]}),'invalid batch rejected before partial writes')
s2=call('metrics.summary',{'start':'2026-10-12','end':'2026-10-12','campaign_id':c['id']})
check(s2['totals']['visits']==30,'failed import leaves existing data untouched')
csv='date,source,campaign_id,visits,signups,activations,payments,provenance\r\n2026-10-11,'+label.lower()+','+c['id']+',10,,0,,"QA, quoted source"\r\n'
call('metrics.importDaily',{'csv':csv});s3=call('metrics.summary',{'start':'2026-10-11','end':'2026-10-12','campaign_id':c['id']})
check(s3['totals']['visits']==40 and s3['totals']['activations']==0,'CSV quoted fields and measured zero conversion supported')
check(rejects('growth.saveCampaign',{'id':c['id'],'landing_url':'javascript:alert(1)'}),'unsafe link schemes rejected')
print('Completed',checks,'runtime checks; all data remains in the isolated QA project.')
