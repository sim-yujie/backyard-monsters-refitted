import numpy as np, os
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage as ndi
STILL='D:/Coding/BYMR/worktrees/anim-vorg/server/public/assets/monsters/vorg-repaint@4x.png'
S=Image.open(STILL).convert('RGBA')
OW,OH=160,160          # old cell at 4x (40x40 at 1x)
CW,CH=208,224          # new cell at 4x (52x56 at 1x): old cell + 6 px each side, 10 on top, 6 at the bottom (1x)
PX,PY=24,40
GAMMA=0.9
GRID_C,GRID_R=3,2      # Codex sheet: 3 columns x 2 rows, 5 poses + 1 empty cell
NPOSE=5
def still_cell(n,row=0): return S.crop((n*OW,row*OH,n*OW+OW,row*OH+OH))
def premul_resize(im,size):
    a=np.asarray(im).astype('float32'); a[...,:3]*=a[...,3:]/255
    ch=[np.asarray(Image.fromarray(a[...,i],'F').resize(size,Image.LANCZOS)) for i in range(4)]
    o=np.dstack(ch); al=np.clip(o[...,3:],0,255)
    rgb=np.where(al>0,o[...,:3]/np.maximum(al,1e-3)*255,0)
    return Image.fromarray(np.dstack([np.clip(rgb,0,255),al]).astype('uint8'),'RGBA')
def key_sheet(path):
    """-> list of (cellindex, rgb array, mask) for every creature found; cell index = row*GRID_C+col"""
    rgb=np.asarray(Image.open(path).convert('RGB'),dtype=float)
    H,W=rgb.shape[:2]; r,g,b=rgb[...,0],rgb[...,1],rgb[...,2]
    ground=(r>215)&(b>215)&(g<80)
    fg=~ground
    fg=ndi.binary_opening(fg,iterations=2)
    lab,n=ndi.label(fg)
    for i in range(1,n+1):
        mm=lab==i; ys,xs=np.where(mm)
        if xs.max()-xs.min()<W/GRID_C*0.9: continue
        for c in range(1,GRID_C):
            bx=int(W*c/GRID_C); lo,hi=bx-70,bx+70
            cnt=mm[:,lo:hi].sum(0)
            left=(xs<bx).sum(); right=(xs>=bx).sum()
            if left>0.2*len(xs) and right>0.2*len(xs):
                cut=lo+int(np.argmin(cnt)); fg[:,cut-1:cut+2]&=~mm[:,cut-1:cut+2]
    lab,n=ndi.label(fg)
    areas=ndi.sum(fg,lab,range(1,n+1)); cms=ndi.center_of_mass(fg,lab,range(1,n+1))
    amax=max(areas)
    big=[i+1 for i in range(n) if areas[i]>0.2*amax]
    mains={}
    for i in big:
        cy,cx=cms[i-1]
        k=(min(GRID_R-1,int(cy/(H/GRID_R))),min(GRID_C-1,int(cx/(W/GRID_C))))
        mains.setdefault(k,np.zeros(fg.shape,bool)); mains[k]|=(lab==i)
    keys=sorted(mains)
    dist={k:ndi.distance_transform_edt(~mains[k]) for k in keys}
    for j in range(1,n+1):
        if j in big or areas[j-1]<20: continue
        fm=lab==j
        best=min(keys,key=lambda k:dist[k][fm].min())
        if dist[best][fm].min()<=24: mains[best]|=fm
    return [(k[0]*GRID_C+k[1],rgb.astype('uint8'),mains[k]&~ground) for k in keys]
def cutout(rgb,m):
    m=ndi.binary_erosion(m,iterations=2)
    core=ndi.binary_erosion(m,iterations=3)
    idx=ndi.distance_transform_edt(~core,return_distances=False,return_indices=True)
    col=rgb.copy(); band=m&~core
    col[band]=rgb[idx[0][band],idx[1][band]]
    alpha=np.asarray(Image.fromarray((m*255).astype('uint8')).filter(ImageFilter.GaussianBlur(1.2)))
    ys,xs=np.where(alpha>20)
    im=Image.fromarray(np.dstack([col,alpha]).astype('uint8'),'RGBA')
    return im.crop((xs.min(),ys.min(),xs.max()+1,ys.max()+1))
def ref_geom(n,row=1):
    a=np.array(still_cell(n,row))[...,3]; m=a>200; ys,xs=np.where(m)
    return dict(area=m.sum(),cx=xs.mean(),cy=ys.mean(),w=xs.max()-xs.min()+1,h=ys.max()-ys.min()+1)
