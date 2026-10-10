import sys,json
from lib import *
n=int(sys.argv[1]); d=f'h{n}'
found=key_sheet(f'{d}/sheet.png'); print(n,'cells',[c[0] for c in found])
cuts={c[0]:cutout(c[1],c[2]) for c in found}
g=ref_geom(n); sh=shadow_layer(n)
os.makedirs(f'{d}/frames',exist_ok=True)
def asize(im): return (np.asarray(im)[...,3]>200).sum()
walk=[i for i in range(6)]
# scale per walk frame: match still's opaque area exactly
sc={}
for i in range(11):
    if i in cuts: sc[i]=np.sqrt(g['area']/asize(cuts[i]))
med=float(np.median([sc[i] for i in walk if i in sc]))
frames=[]; info=[]
for i in range(11):
    cut=cuts[i]; s=sc[i] if i<6 else med
    im=premul_resize(cut,(max(1,round(cut.width*s)),max(1,round(cut.height*s))))
    px=np.asarray(im).astype(float); px[...,:3]=255*(px[...,:3]/255)**GAMMA
    im=Image.fromarray(px.astype('uint8'),'RGBA')
    a=np.asarray(im)[...,3]; m=a>200
    if i<6:
        k=np.sqrt(g['area']/m.sum()); im=premul_resize(cut,(round(cut.width*s*k),round(cut.height*s*k))); px=np.asarray(im).astype(float); px[...,:3]=255*(px[...,:3]/255)**GAMMA; im=Image.fromarray(px.astype('uint8'),'RGBA'); a=np.asarray(im)[...,3]; m=a>200
    ys,xs=np.where(m)
    if i<6: cx=xs.mean()
    else:
        lo=ys>ys.min()+0.6*(ys.max()-ys.min()); cx=xs[lo].mean()
    ox=round(PX+g['cx']-cx); oy=round(PY+g['foot']-ys.max())
    ox=max(2,min(CW-2-im.width,ox))
    layer=Image.new('RGBA',(CW,CH)); layer.paste(im,(ox,oy))
    clipped=(oy<0) or ox<0 or ox+im.width>CW
    cell=sh.copy(); cell.alpha_composite(layer)
    frames.append(cell)
    info.append(dict(i=i,scale=round(float(s),4),area_ratio=round(float((np.asarray(layer)[...,3]>200).sum()/g['area']),3),w=int(xs.max()-xs.min()+1),h=int(ys.max()-ys.min()+1),clipped=bool(clipped),oy=oy,ox=ox))
# row 0 = unchanged still
st=Image.new('RGBA',(CW,CH)); st.paste(still_cell(n),(PX,PY))
frames=[st]+frames
for k,f in enumerate(frames): f.save(f'{d}/frames/f{k:02d}.png')
json.dump(info,open(f'{d}/info.json','w'))
for r in info: print(r)
