import sys
from PIL import Image,ImageDraw
a,b=int(sys.argv[1]),int(sys.argv[2]); sc=0.6
w,h=round(164*sc),round(160*sc)
W=Image.new('RGB',(w*12,h*(b-a+1)),(86,92,74)); d=ImageDraw.Draw(W)
for r,n in enumerate(range(a,b+1)):
    for k in range(12):
        f=Image.open(f'h{n}/frames/f{k:02d}.png'); c=Image.new('RGBA',f.size,(86,92,74,255)); c.alpha_composite(f)
        W.paste(c.convert('RGB').resize((w,h),Image.LANCZOS),(k*w,r*h))
    d.text((3,r*h+3),f'h{n}',fill=(255,255,0))
W.save('contact.png')
