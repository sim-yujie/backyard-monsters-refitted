import sys,numpy as np
from PIL import Image
sys.path.insert(0,'D:/Coding/BYMR/worktrees/anim-dave/web/tools')
import importlib.util
src=open('D:/Coding/BYMR/worktrees/anim-dave/web/tools/gen-dave-sprite.py').read()
i=src.index('def goldify'); j=src.index('gold = goldify')
ns={'np':np,'Image':Image}; exec(src[i:j],ns)
s=Image.open('out/dave-anim@4x.png').convert('RGBA')
g=ns['goldify'](s); g.save('out/dave-gold-anim@4x.png',optimize=True)
from lib import premul_resize
g.resize((s.width//4,s.height//4),Image.LANCZOS).save('out/dave-gold-anim.png',optimize=True)
