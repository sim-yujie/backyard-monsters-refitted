import sys
from PIL import Image
a,b=int(sys.argv[1]),int(sys.argv[2])
W=Image.new('RGB',(12*126,(b-a+1)*114),(86,92,74))
for r,n in enumerate(range(a,b+1)):
    for k in range(12):
        f=Image.open(f'h{n}/frames/f{k:02d}.png').convert('RGBA').resize((126,114),Image.LANCZOS); W.paste(f,(k*126,r*114),f)
W.save(f'cs_{a}_{b}.png')
