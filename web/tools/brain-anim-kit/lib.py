import numpy as np, os
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage as ndi
STILL='D:/Coding/BYMR/worktrees/anim-brain/server/public/assets/monsters/brain-repaint@4x.png'
S=Image.open(STILL).convert('RGBA')
OW,OH=136,96              # old cell (4x)
CW,CH=184,152            # new cell (4x) = 46x42 at 1x
PX,PY=(CW-OW)//2,48   # still offset inside the new cell (24,40)
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
    ground=((r-255)**2+g**2+(b-255)**2<28**2)&(r>215)&(b>215)
    strict=ground&((r-255)**2+g**2+(b-255)**2<16**2)
    gl,gn=ndi.label(ground); gs=ndi.sum(ground,gl,range(1,gn+1))
    sl,sn=ndi.label(strict); ss=ndi.sum(strict,sl,range(1,sn+1))
    ground=np.isin(gl,[i+1 for i in range(gn) if gs[i]>=600])|np.isin(sl,[i+1 for i in range(sn) if ss[i]>=60])  # specks of magenta-ish paint inside the creature are not background
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
    # the still's ground shadow, rebuilt as a clean soft ellipse fitted to its dark core pixels, baked in every frame
    a=np.array(still_cell(n)); solid=a[...,3]>200
    m=(a[...,3]>0)&~solid&(a[...,:3].max(-1)<=30)
    m[:60]=False
    ys,xs=np.where(m)
    cnt=m.sum(1); ym=int(np.argmax(cnt)); yb=ys.max()
    r=np.where(m[ym])[0]; cx=(r.min()+r.max())/2; rx=(r.max()-r.min())/2+3; ry=(yb-ym)+4
    peak=float(np.percentile(a[m][:,3],90))
    yy,xx=np.mgrid[0:OH+8,0:OW]
    q=((xx-cx)/rx)**2+((yy-ym)/ry)**2
    al=np.clip(1-q,0,1)**0.6*peak
    al=ndi.gaussian_filter(al,2.0)
    out=np.zeros((OH+8,OW,4),np.uint8); out[...,:3]=25; out[...,3]=np.clip(al,0,255).astype(np.uint8)
    c=Image.new('RGBA',(CW,CH)); c.paste(Image.fromarray(out,'RGBA'),(PX,PY)); return c
def ref_geom(n):
    a=np.array(still_cell(n))[...,3]; m=body_mask(a); ys,xs=np.where(m)
    return dict(area=m.sum(),foot=ys.max(),cx=xs.mean(),w=xs.max()-xs.min()+1,h=ys.max()-ys.min()+1)
