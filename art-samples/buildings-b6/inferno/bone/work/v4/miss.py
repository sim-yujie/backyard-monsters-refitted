import sys; from pathlib import Path
from PIL import Image
sys.path.insert(0,'.')
import ipost
ipost.D=Path('bone').resolve(); ipost.C=ipost.load(ipost.D)
lv=int(sys.argv[1])
im,iou,mf,mt=ipost.outline(lv)
print(f"L{lv} IoU {iou:.3f} flash-not-3d {mf:.3f} 3d-not-flash {mt:.3f}")
w=im.width//4
im=im.crop((w*2,0,w*4,im.height)); im.resize((im.width*2//5,im.height*2//5)).save(sys.argv[2])
