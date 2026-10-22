import sys
from PIL import Image,ImageDraw
N=int(sys.argv[1]); BG=(86,92,74,255); CW,CH=184,152
labels=["idle"]+["walk%d"%i for i in range(1,7)]+["atk%d"%i for i in range(7,12)]
sc=0.75; w,h=round(CW*sc),round(CH*sc)
def flat(c):
    b=Image.new('RGBA',c.size,BG); b.alpha_composite(c); return b.convert('RGB').resize((w,h),Image.LANCZOS)
for g in range(0,N,6):
    ns=list(range(g,min(N,g+6)))
    W=Image.new('RGB',(w*12,h*len(ns)),BG); d=ImageDraw.Draw(W)
    for r,n in enumerate(ns):
        for k in range(12):
            W.paste(flat(Image.open(f'h{n}/frames/f{k:02d}.png').convert('RGBA')),(k*w,r*h)); d.text((k*w+3,r*h+3),f'{n}/{labels[k]}',fill=(255,255,255))
    W.save(f'out/contact-{g:02d}-{ns[-1]:02d}.png')
