import sys,json
from lib import *
n=int(sys.argv[1]); d=f'h{n}'
found=key_sheet(f'{d}/sheet.png'); print(n,'cells',[c[0] for c in found])
cuts={c[0]:cutout(c[1],c[2]) for c in found}
WS=found[0][1].shape[1]
rel={c[0]:np.where(c[2])[1].mean()-WS*((c[0]%4)+.5)/4 for c in found}
rely={c[0]:np.where(c[2])[0].mean()-found[0][1].shape[0]*((c[0]//4)+.5)/3 for c in found}
refrely=float(np.median([rely[i] for i in range(6) if i in rely]))
BOB=8
refrel=float(np.median([rel[i] for i in range(6) if i in rel]))
g=ref_geom(n); sh=shadow_layer(n)
stl=Image.new('RGBA',(CW,CH)); stl.paste(still_cell(n),(PX,PY))
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
    fit=min(1.0,(CW-20)/im.width,(CH-20)/im.height)
    if fit<1:
        im=im.resize((round(im.width*fit),round(im.height*fit)),Image.LANCZOS); m=np.asarray(im)[...,3]>200; ys,xs=np.where(m)
    cy_=ys.mean()
    if i<6: cx=xs.mean(); cyo=0.0
    else: cx=xs.mean()-(rel[i]-refrel)*med; cyo=-(rely[i]-refrely)*med
    bob=round(BOB*np.sin(2*np.pi*i/6)) if i<6 else 0
    ox=round(PX+g['cx']-cx); oy=round(PY+g['cy']-cy_+cyo)+bob
    ox=max(6,min(CW-6-im.width,ox)); oy=max(6,min(CH-6-im.height,oy))
    layer=Image.new('RGBA',(CW,CH)); layer.paste(im,(ox,oy))
    clipped=(oy<=4) or ox<=4 or ox+im.width>=CW-4 or oy+im.height>=CH-4
    cell=sh.copy(); cell.alpha_composite(layer)
    frames.append(cell)
    info.append(dict(i=i,scale=round(float(s),4),area_ratio=round(float((np.asarray(layer)[...,3]>200).sum()/g['area']),3),w=int(xs.max()-xs.min()+1),h=int(ys.max()-ys.min()+1),clipped=bool(clipped),oy=oy,ox=ox))
# row 0 = unchanged still
st=Image.new('RGBA',(CW,CH)); st.paste(still_cell(n),(PX,PY))
frames=[st]+frames
for k,f in enumerate(frames): f.save(f'{d}/frames/f{k:02d}.png')
json.dump(info,open(f'{d}/info.json','w'))
for r in info: print(r)
