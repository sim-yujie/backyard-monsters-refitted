import sys,json,os
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from lib import *
os.chdir('D:/Coding/BYMR/art-trials/teratorn-anim/full')
n=int(sys.argv[1]); d=f'h{n}'
found=key_sheet(f'{d}/sheet.png'); print(n,'cells',[c[0] for c in found])
cuts={c[0]:cutout(c[1],c[2]) for c in found}
H,WS=found[0][1].shape[:2]
rel={c[0]:np.where(c[2])[1].mean()-WS*((c[0]%GRID_C)+.5)/GRID_C for c in found}
rely={c[0]:np.where(c[2])[0].mean()-H*((c[0]//GRID_C)+.5)/GRID_R for c in found}
REFS=[0,4]   # anticipation and recovery: the poses nearest the resting shape
refrel=float(np.median([rel[i] for i in REFS if i in rel])); refrely=float(np.median([rely[i] for i in REFS if i in rely]))
g=ref_geom(n,1)
def asize(im): return (np.asarray(im)[...,3]>200).sum()
sc={i:np.sqrt(g['area']/asize(cuts[i])) for i in range(NPOSE) if i in cuts}
med=float(np.median([sc[i] for i in REFS if i in sc]))   # one scale for the whole attack
os.makedirs(f'{d}/frames',exist_ok=True)
frames=[]; info=[]
for i in range(NPOSE):
    cut=cuts[i]
    im=premul_resize(cut,(max(1,round(cut.width*med)),max(1,round(cut.height*med))))
    px=np.asarray(im).astype(float); px[...,:3]=255*(px[...,:3]/255)**GAMMA
    im=Image.fromarray(px.astype('uint8'),'RGBA')
    m=np.asarray(im)[...,3]>200
    fit=min(1.0,(CW-20)/im.width,(CH-20)/im.height)
    if fit<1:
        im=im.resize((round(im.width*fit),round(im.height*fit)),Image.LANCZOS); m=np.asarray(im)[...,3]>200
    ys,xs=np.where(m)
    cx=xs.mean()-(rel[i]-refrel)*med; cyo=-(rely[i]-refrely)*med
    # the still's anchor point is the centroid of its half-open pose; keep that as the home position
    ox=round(PX+g['cx']-cx); oy=round(PY+g['cy']-ys.mean()+cyo)
    ox=max(6,min(CW-6-im.width,ox)); oy=max(6,min(CH-6-im.height,oy))
    layer=Image.new('RGBA',(CW,CH)); layer.paste(im,(ox,oy))
    clipped=(oy<=4) or ox<=4 or ox+im.width>=CW-4 or oy+im.height>=CH-4
    frames.append(layer)
    info.append(dict(i=i,scale=round(float(med),4),area_ratio=round(float((np.asarray(layer)[...,3]>200).sum()/g['area']),3),clipped=bool(clipped)))
# rows 0-2: today's three flap rows, unchanged, in the bigger cell
flap=[]
for r in range(3):
    cell=Image.new('RGBA',(CW,CH)); cell.paste(clean_flap(still_cell(n,r)),(PX,PY)); flap.append(cell)
allf=flap+frames
for k,f in enumerate(allf): f.save(f'{d}/frames/f{k:02d}.png')
json.dump(info,open(f'{d}/info.json','w'))
print(' '.join(f"{r['i']}:{r['area_ratio']}{'!CLIP' if r['clipped'] else ''}" for r in info),'scale',round(med,3))
