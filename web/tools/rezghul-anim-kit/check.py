import sys,numpy as np
from PIL import Image
from scipy import ndimage as ndi
def pink(a):
    r,g,b=[a[...,i].astype(int) for i in range(3)]
    return (a[...,3]>0)&(r>140)&(b>110)&(g<0.65*np.minimum(r,b)+10)&(abs(r-b)<90)
def knob(a):
    r,g,b=[a[...,i].astype(int) for i in range(3)]
    m=(a[...,3]>200)&(np.maximum(np.maximum(r,g),b)<95)&(b>=g)&(r<90)
    lab,n=ndi.label(m)
    if n==0: return 0
    return int(max(ndi.sum(m,lab,range(1,n+1))))
if __name__=='__main__':
    for n in map(int,sys.argv[1:]):
        out=[]
        for k in range(12):
            a=np.array(Image.open(f'h{n}/frames/f{k:02d}.png').convert('RGBA'))
            out.append((int(pink(a).sum()),knob(a)))
        print(n,'pink',[o[0] for o in out],'knob',[o[1] for o in out])
