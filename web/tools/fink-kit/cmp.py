from PIL import Image
import numpy as np
im=Image.open('test1/out/frames-cel.png').convert('RGB'); print(im.size)
im=im.resize((640,512),Image.LANCZOS)
a=np.asarray(im).astype(float); r,g,b=a[...,0],a[...,1],a[...,2]
gd=g-np.maximum(r,b)
alpha=np.clip(1-(gd-40)/60,0,1)  # green dominance -> transparent
a2=a.copy()
spill=(gd>0)&(alpha>0); 
a2[...,1]=np.where(spill,np.maximum(r,b)+0*g,g)
rgba=np.dstack([a2,alpha*255]).astype(np.uint8)
k=Image.fromarray(rgba,'RGBA'); k.save('test1/out/frames-keyed.png')
bg=Image.new('RGBA',(640,512),(128,128,128,255)); bg.alpha_composite(k)
old=Image.open('test1/reference/frames.png').convert('RGB')
out=Image.new('RGB',(1280,512),(128,128,128))
# old top, new below: stack 2 rows x4 -> 4 side by side each
def row(img):
    r=Image.new('RGB',(1280,256))
    cells=[img.crop(((i%2)*320,(i//2)*256,(i%2)*320+320,(i//2)*256+256)) for i in range(4)]
    for i,c in enumerate(cells): r.paste(c,(i*320,0))
    return r
out.paste(row(old),(0,0)); out.paste(row(bg.convert('RGB')),(0,256))
out.save('../../test1-compare.png' if False else 'D:/Coding/BYMR/art-trials/fink/test1-compare.png')
