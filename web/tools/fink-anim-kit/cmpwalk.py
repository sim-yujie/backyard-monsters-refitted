import sys
from PIL import Image
a,b=int(sys.argv[1]),int(sys.argv[2]); BG=(86,92,74,255)
ks=[0,1,3,8]
W=Image.new('RGB',(len(ks)*184,(b-a+1)*168),BG[:3])
for r,n in enumerate(range(a,b+1)):
    for c,k in enumerate(ks):
        f=Image.open(f'h{n}/frames/f{k:02d}.png').convert('RGBA'); W.paste(f,(c*184,r*168),f)
W.save('cmpwalk.png')
