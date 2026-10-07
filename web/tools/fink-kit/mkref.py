from PIL import Image, ImageChops
import numpy as np
S=Image.open('D:/Coding/BYMR/backyard-monsters-refitted/server/public/assets/monsters/fink.png').convert('RGBA')
W,H=34,32
cells=[S.crop((i*W,0,(i+1)*W,H)) for i in range(30)]
# mirror symmetry: compare cell i flipped vs cell (30-i)%30 and best partner
def d(a,b):
    return np.abs(np.asarray(a,float)-np.asarray(b,float)).mean()
tot=[]
for i in range(30):
    best=min(((d(ImageOps_flip,cells[j]),j) for j in range(30) for ImageOps_flip in [cells[i].transpose(Image.FLIP_LEFT_RIGHT)]))
    exp=(30-i)%30
    tot.append((i,exp,round(d(cells[i].transpose(Image.FLIP_LEFT_RIGHT),cells[exp]),1),best[1],round(best[0],1)))
print(tot[:12])
print('mean expected-mirror diff',np.mean([t[2] for t in tot]))
# ref frames
cols=[0,8,15,23]
g=(128,128,128,255)
sheet=Image.new('RGB',(640,512),g[:3])
for k,c in enumerate(cols):
    bg=Image.new('RGBA',(W,H),g); bg.alpha_composite(cells[c])
    big=bg.convert('RGB').resize((W*8,H*8),Image.BICUBIC)
    x=(k%2)*320+(320-W*8)//2; y=(k//2)*256
    sheet.paste(big,(x,y))
sheet.save('test1/reference/frames.png')
bg=Image.new('RGBA',(W,H),g); bg.alpha_composite(cells[0])
bg.convert('RGB').resize((W*14,H*14),Image.BICUBIC).save('test1/reference/portrait.png')
print(S.getbbox())
