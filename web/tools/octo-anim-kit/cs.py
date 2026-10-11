import sys
from PIL import Image
a,b=int(sys.argv[1]),int(sys.argv[2])
W=Image.new('RGB',(12*110,(b-a+1)*72),(86,92,74))
for r,n in enumerate(range(a,b+1)):
    for k in range(12):
        f=Image.open(f'h{n}/frames/f{k:02d}.png').convert('RGBA').resize((110,72),Image.LANCZOS); W.paste(f,(k*108,r*87),f)
W.save(f'cs_{a}_{b}.png')
