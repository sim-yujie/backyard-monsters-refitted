import sys
from PIL import Image
im = Image.open(sys.argv[1])
im.resize((im.size[0] // 2, im.size[1] // 2)).save(sys.argv[2])
