import numpy as np
from PIL import Image, ImageFilter, ImageDraw
from scipy import ndimage as ndi
K='D:/Coding/BYMR/art-trials/bolt/kit/run2/'
old=Image.open(K+'reference/frames.png').convert('RGB')
new=Image.open(K+'out/frames-new.png').convert('RGB').resize((640*2,512*2) if False else (640,512),Image.LANCZOS) if False else Image.open(K+'out/frames-new.png').convert('RGB')
W,H=new.size; sx=W/640
a=np.asarray(new).astype(float); R,G,B=a[...,0],a[...,1],a[...,2]
mx=np.maximum(R,B)
bg=(G<np.minimum(R,B)*0.62)&(np.abs(R-B)<0.4*mx)&(mx>60)
lab,n=ndi.label(bg)
edge=set(lab[0,:])|set(lab[-1,:])|set(lab[:,0])|set(lab[:,-1]); edge.discard(0)
# flood: bg comps touching border
bgm=np.isin(lab,list(edge))
# shadow is darker magenta; pure magenta halo too. Soft alpha at monster edge
fg=~bgm
fg=ndi.binary_opening(fg,iterations=2)
l2,n2=ndi.label(fg); 
# keep largest comp per quadrant cell
cw,ch=W//2,H//2
mask=np.zeros_like(fg)
for q in range(4):
    cx,cy=(q%2)*cw,(q//2)*ch
    sub=l2[cy:cy+ch,cx:cx+cw]
    ids,cnt=np.unique(sub[sub>0],return_counts=True)
    for i,c in zip(ids,cnt):
        if c>cnt.max()*0.02: mask[cy:cy+ch,cx:cx+cw]|=(sub==i)
mask=ndi.binary_fill_holes(mask)
mask&=~((R>190)&(B>150)&(G<90)&(np.abs(R-B)<70))
mask=ndi.binary_erosion(mask,iterations=1)
alpha=Image.fromarray((mask*255).astype('uint8')).filter(ImageFilter.GaussianBlur(1.2))
# despill magenta: reduce R,B toward G where pixel is near edge
rgb=a.copy()
edgeband=ndi.binary_dilation(~mask,iterations=4)&mask
spill=np.clip((np.minimum(R,B)-G)/255,0,1)[...,None]
# only fix edge band
rgb[edgeband]=rgb[edgeband]*(1-0.0)
for c in (0,2):
    ch_=rgb[...,c]; lim=G*1.0+20
    ch_[edgeband]=np.minimum(ch_[edgeband],np.maximum(lim[edgeband],0)) if False else ch_[edgeband]
rgba=np.dstack([rgb,np.asarray(alpha)]).astype('uint8')
cut=Image.fromarray(rgba,'RGBA')
cut.save(K+'out/frames-cut.png')
# old frames at real size: 8x down
oa=np.asarray(old).astype(float)
def sat(img):
    return np.abs(img-img.mean(axis=2,keepdims=True)).max(axis=2)
oldmask=(sat(oa)>45)|(oa.mean(axis=2)>175)
def bbox(m):
    ys,xs=np.where(m); return xs.min(),ys.min(),xs.max()+1,ys.max()+1
SC=8
tiles_new=[];tiles_old=[]
cellw,cellh=320,256
for q in range(4):
    cx,cy=(q%2)*cellw,(q//2)*cellh
    om=bbox(oldmask[cy:cy+cellh,cx:cx+cellw]); 
    ox0,oy0,ox1,oy1=om
    ow,oh=ox1-ox0,oy1-oy0
    c=cut.crop((q%2*cw,q//2*ch,q%2*cw+cw,q//2*ch+ch))
    nb=bbox(np.asarray(c)[...,3]>128)
    mon=c.crop(nb); mw,mh=mon.size
    s=min(ow/mw,oh/mh)
    # keep real size: monster scaled to old bbox in 8x space
    mon8=mon.resize((max(1,round(mw*s)),max(1,round(mh*s))),Image.LANCZOS)
    # place bottom-centre at old bbox bottom-centre
    cell=Image.new('RGBA',(cellw,cellh),(0,0,0,0))
    # soft shadow
    sh=Image.new('L',(cellw,cellh),0); d=ImageDraw.Draw(sh)
    bx=(ox0+ox1)//2; by=oy1-6
    sw=int(mon8.size[0]*0.55); shh=int(sw*0.32)
    d.ellipse((bx-sw,by-shh,bx+sw,by+shh),fill=110)
    sh=sh.filter(ImageFilter.GaussianBlur(10))
    cell.paste((20,25,15,255),(0,0),sh)
    px=bx-mon8.size[0]//2; py=oy1-mon8.size[1]-2
    cell.alpha_composite(mon8,(max(0,px),max(0,py)))
    tiles_new.append(cell)
    tiles_old.append(old.crop((cx,cy,cx+cellw,cy+cellh)))
# real size: sprite = 1/8
grey=(128,128,128)
def tile_bg(im):
    b=Image.new('RGBA',im.size,grey+(255,)); b.alpha_composite(im.convert('RGBA')); return b
order=[0,1,2,3]  # east,south,west,north
rows=Image.new('RGB',(4*cellw,3*cellh-150),(60,60,60))
for i,q in enumerate(order):
    rows.paste(tiles_old[q].convert('RGB'),(i*cellw,0))
    rows.paste(tile_bg(tiles_new[q]).convert('RGB'),(i*cellw,cellh))
    # real size
    ro=tiles_old[q].resize((cellw//8,cellh//8),Image.LANCZOS)
    rn=tile_bg(tiles_new[q]).resize((cellw//8,cellh//8),Image.LANCZOS).convert('RGB')
    rows.paste(ro,(i*cellw+20,2*cellh+10)); rows.paste(rn,(i*cellw+20+60,2*cellh+10))
    # also 3x magnified real size for readability
    rows.paste(ro.resize((cellw//8*3,cellh//8*3),Image.NEAREST),(i*cellw+10,2*cellh+60) if False else (i*cellw+5,2*cellh+60))
    rows.paste(rn.resize((cellw//8*3,cellh//8*3),Image.NEAREST),(i*cellw+160,2*cellh+60))
rows=rows.crop((0,0,rows.size[0],2*cellh+200)); rows.save('D:/Coding/BYMR/art-trials/bolt/test2-compare.png')
for q,t in enumerate(tiles_new): t.save(K+f'tmp/new{q}.png')
