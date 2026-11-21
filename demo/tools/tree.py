import json,sys,re
from html.parser import HTMLParser
VOID={'img','input','br','hr','meta','link','source'}
class P(HTMLParser):
    def __init__(s,maxd,root=None):
        super().__init__(); s.d=0; s.maxd=maxd; s.out=[]; s.skip=0
    def handle_starttag(s,tag,attrs):
        a=dict(attrs); extra=' '.join(f'{k}={v[:60] if v else v}' for k,v in a.items() if k not in('class','type') )
        if s.d<s.maxd: s.out.append('  '*s.d+f"{tag}.{(a.get('class') or '').replace(' ','.')} {extra}")
        if tag not in VOID: s.d+=1
    def handle_endtag(s,tag):
        if tag not in VOID: s.d-=1
    def handle_data(s,data):
        if data.strip() and s.d<=s.maxd: s.out.append('  '*s.d+'"'+data.strip()[:60]+'"')
d=json.load(open(sys.argv[1])); p=P(int(sys.argv[2])); p.feed(d['html']); 
out=p.out
if len(sys.argv)>3:
    # print only subtree whose first line matches
    pat=sys.argv[3]; res=[]; on=None
    for l in out:
        ind=len(l)-len(l.lstrip())
        if on is None and pat in l: on=ind; res.append(l); continue
        if on is not None:
            if ind<=on: on=None
            else: res.append(l)
    out=res
print('\n'.join(out))
