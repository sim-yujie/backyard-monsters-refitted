import sys
from PIL import Image
ns=[int(x) for x in sys.argv[1:]]
ims=[Image.open(f'h{n}/sheet.png').convert('RGB') for n in ns]
ims=[i.resize((900,round(900*i.height/i.width))) for i in ims]
W=Image.new('RGB',(900*len(ims),max(i.height for i in ims)))
for k,i in enumerate(ims): W.paste(i,(k*900,0))
W.save('mont.png')
