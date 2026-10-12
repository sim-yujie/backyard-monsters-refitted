import sys,os,shutil,numpy as np,cv2
from PIL import Image
def dome(rgb,a):
    hsv=cv2.cvtColor(rgb,cv2.COLOR_RGB2HSV)
    h=hsv[...,0].astype(int); s=hsv[...,1]
    return (a>200)&(h>=130)&(h<=175)&(s>70)
def stats(lab,m):
    p=lab[m]; return p.mean(0),p.std(0)+1e-3
def fix(n):
    d=f'h{n}/frames'; bk=f'h{n}/frames_orig'
    if not os.path.isdir(bk): shutil.copytree(d,bk)
    ref=np.asarray(Image.open(f'{bk}/f00.png').convert('RGBA'))
    rl=cv2.cvtColor(ref[...,:3],cv2.COLOR_RGB2LAB).astype(np.float32)
    rm=dome(ref[...,:3],ref[...,3])
    rmu,rsd=stats(rl,rm)
    for k in range(1,12):
        im=np.asarray(Image.open(f'{bk}/f{k:02d}.png').convert('RGBA')).copy()
        rgb=im[...,:3]; a=im[...,3]
        m=dome(rgb,a)
        if m.sum()<30: continue
        lab=cv2.cvtColor(rgb,cv2.COLOR_RGB2LAB).astype(np.float32)
        mu,sd=stats(lab,m)
        out=lab.copy()
        sdr=np.clip(rsd/sd,0.5,1.5)
        tr=(lab-mu)*sdr+rmu
        w=cv2.GaussianBlur(m.astype(np.float32),(0,0),0.8)[...,None]
        out=lab*(1-w)+tr*w
        rgb2=cv2.cvtColor(np.clip(out,0,255).astype(np.uint8),cv2.COLOR_LAB2RGB)
        im[...,:3]=np.where(a[...,None]>0,rgb2,rgb)
        Image.fromarray(im,'RGBA').save(f'{d}/f{k:02d}.png')
if __name__=='__main__':
    for n in map(int,sys.argv[1:]): fix(n)
