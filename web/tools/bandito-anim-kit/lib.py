import numpy as np, os
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage as ndi
STILL='D:/Coding/BYMR/backyard-monsters-refitted/server/public/assets/monsters/bandito-repaint@4x.png'
S=Image.open(STILL).convert('RGBA')
OW,OH=116,112            # old cell (4x)
CW,CH=164,160            # new cell (4x) = 41x40 at 1x
PX,PY=(CW-OW)//2,CH-OH   # still offset inside the new cell
GAMMA=0.9
def still_cell(n): return S.crop((n*OW,0,n*OW+OW,OH))
def body_mask(a): return a>200
def shadow_info(n):
    a=np.array(still_cell(n)); m=(a[...,3]>10)&(a[...,3]<=200)&(a[...,:3].max(-1)<70)
    ys,xs=np.where(m)
    return xs.min(),xs.max(),ys.min(),ys.max()
def premul_resize(im,size):
    a=np.asarray(im).astype('float32'); a[...,:3]*=a[...,3:]/255
    ch=[np.asarray(Image.fromarray(a[...,i],'F').resize(size,Image.LANCZOS)) for i in range(4)]
    o=np.dstack(ch); al=np.clip(o[...,3:],0,255)
    rgb=np.where(al>0,o[...,:3]/np.maximum(al,1e-3)*255,0)
    return Image.fromarray(np.dstack([np.clip(rgb,0,255),al]).astype('uint8'),'RGBA')
def key_sheet(path):
    """-> list of (cellindex, RGBA full-size cutout, mask) for every creature found"""
    rgb=np.asarray(Image.open(path).convert('RGB'),dtype=float)
    H,W=rgb.shape[:2]; r,g,b=rgb[...,0],rgb[...,1],rgb[...,2]
    ground=(r>180)&(b>180)&(g<115)&(abs(r-b)<60)
    fg=~ground
    fg=ndi.binary_opening(fg,iterations=2)
    # cut apart creatures that touch across a column boundary (valley of least mass near the grid line)
    lab,n=ndi.label(fg)
    for i in range(1,n+1):
        mm=lab==i; ys,xs=np.where(mm)
        if xs.max()-xs.min()<W/4*0.9: continue
        for c in (1,2,3):
            bx=int(W*c/4); lo,hi=bx-70,bx+70
            cnt=mm[:,lo:hi].sum(0); 
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
        k=(min(2,int(cy/(H/3))),min(3,int(cx/(W/4))))
        mains.setdefault(k,np.zeros(fg.shape,bool)); mains[k]|=(lab==i)
    keys=sorted(mains)
    dist={k:ndi.distance_transform_edt(~mains[k]) for k in keys}
    for j in range(1,n+1):
        if j in big or areas[j-1]<20: continue
        fm=lab==j
        best=min(keys,key=lambda k:dist[k][fm].min())
        if dist[best][fm].min()<=24: mains[best]|=fm
    out=[]
    for k in keys:
        m=mains[k]&~ground
        out.append((k[0]*4+k[1],rgb.astype('uint8'),m))
    return out
def cutout(rgb,m):
    """tight RGBA crop: erode edge, decontaminate colour from the interior, soft alpha"""
    m=ndi.binary_erosion(m,iterations=2)
    # colour from the nearest solid interior pixel for the outer 4px band (no pink fringe)
    core=ndi.binary_erosion(m,iterations=3)
    idx=ndi.distance_transform_edt(~core,return_distances=False,return_indices=True)
    col=rgb.copy(); band=m&~core
    col[band]=rgb[idx[0][band],idx[1][band]]
    alpha=np.asarray(Image.fromarray((m*255).astype('uint8')).filter(ImageFilter.GaussianBlur(1.2)))
    ys,xs=np.where(alpha>20)
    im=Image.fromarray(np.dstack([col,alpha]).astype('uint8'),'RGBA')
    return im.crop((xs.min(),ys.min(),xs.max()+1,ys.max()+1))
def shadow_layer(n):
    g=ref_geom(n)
    sh=Image.new('L',(CW,CH),0)
    hw=g['w']*0.4; hh=hw*0.3; cx=PX+g['cx']; cy=PY+g['foot']-hh-6
    ImageDraw.Draw(sh).ellipse((cx-hw,cy-hh,cx+hw,cy+hh),fill=110)
    sh=sh.filter(ImageFilter.GaussianBlur(5.2))
    c=Image.new('RGBA',(CW,CH)); c.paste((20,25,15,255),(0,0),sh); return c
def ref_geom(n):
    a=np.array(still_cell(n))[...,3]; m=body_mask(a); ys,xs=np.where(m)
    return dict(area=m.sum(),foot=ys.max(),cx=xs.mean(),w=xs.max()-xs.min()+1,h=ys.max()-ys.min()+1)
