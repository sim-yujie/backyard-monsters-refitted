import sys,os,shutil,numpy as np
from PIL import Image
from scipy import ndimage as ndi
def clean(path):
    a=np.array(Image.open(path).convert('RGBA')); r,g,b=[a[...,i].astype(int) for i in range(3)]
    pk=(a[...,3]>0)&(r>g+50)&(b>g+40)&(b>0.4*r)
    solid=(a[...,3]>=200)&~pk
    bad=((a[...,3]>0)&(a[...,3]<200))|pk
    idx=ndi.distance_transform_edt(~solid,return_distances=False,return_indices=True)
    o=a.copy(); o[bad,:3]=a[idx[0][bad],idx[1][bad],:3]
    # fully transparent stays
    Image.fromarray(o,'RGBA').save(path); return int(pk.sum())
if __name__=='__main__':
    for n in map(int,sys.argv[1:]):
        for k in range(1,12): clean(f'h{n}/frames/f{k:02d}.png')
