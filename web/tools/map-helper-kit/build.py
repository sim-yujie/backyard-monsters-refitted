# Cuts Codex's redraw off its magenta, fits it to the Flash helper's exact body box inside Flash's 28x28 canvas,
# matches Flash's colours, adds Flash's ground shadow, and saves it 8x. Prints how close it is to Flash at 28 px.
import sys
import numpy as np
from PIL import Image, ImageFilter
OUT=sys.argv[1]
S=8
flash=Image.open('C:/Coding/BYMR/backyard-monsters-refitted/client/shapes/130.png').convert('RGBA')
fa=np.asarray(flash).astype(float)
body=(fa[...,3]>170)&((fa[...,2]>fa[...,0]+25)|(fa[...,:3].min(2)>170)|(fa[...,:3].max(2)<70))
ys,xs=np.where(body); bx0,bx1,by0,by1=xs.min(),xs.max()+1,ys.min(),ys.max()+1
print('flash body box',bx0,bx1,by0,by1)
fb=fa[body]; print('flash mean body rgb',fb[...,:3].mean(0).round())
im=np.asarray(Image.open('helper-new.png').convert('RGB')).astype(float)
r,g,b=im[...,0],im[...,1],im[...,2]
# magenta-ness: red and blue high with green low, against the pure key colour
d=np.sqrt((r-255)**2+g**2+(b-255)**2)
alpha=np.clip((d-90)/90,0,1)
# take the magenta spill out of the edge pixels
spill=(1-alpha)[...,None]
rgb=im.copy()
rgb[...,0]=np.minimum(r, np.maximum(g,b*0.45)+ (r-r)*0) if False else r
edge=(alpha<1)&(alpha>0)
rgb[...,0][edge]=np.minimum(r[edge],g[edge]+40)
ys,xs=np.where(alpha>0.5); x0,x1,y0,y1=xs.min(),xs.max()+1,ys.min(),ys.max()+1
print('codex box',x0,x1,y0,y1)
cut=Image.fromarray(np.dstack([rgb,alpha*255]).clip(0,255).astype('uint8'),'RGBA').crop((x0,y0,x1,y1))
w,h=(bx1-bx0)*S,(by1-by0)*S
cut=cut.resize((w,h),Image.LANCZOS)
c=np.asarray(cut).astype(float)
# colour: scale the body's blue so its average equals Flash's blue, leave whites and blacks alone
c=np.asarray(cut).astype(float)
blue=(c[...,2]>c[...,0]+35)&(c[...,3]>200)
fblue=fa[(fa[...,3]>170)&(fa[...,2]>fa[...,0]+40)][...,:3].mean(0)
cblue=c[blue][...,:3].mean(0)
print('flash blue',fblue.round(),'codex blue',cblue.round())
scale=fblue/cblue
for k in range(3): c[...,k][blue]=c[...,k][blue]*scale[k]
cut=Image.fromarray(c.clip(0,255).astype('uint8'),'RGBA')
# pupils: Codex drew thin dashes that vanish at game size; thicken them to Flash's weight
from PIL import ImageFilter as IF
c=np.asarray(cut).astype(float)
dark=((c[...,:3].max(2)<70)&(c[...,3]>200))
ys,xs=np.where(dark)
print('pupil pixels',dark.sum(),'x',xs.min(),xs.max(),'y',ys.min(),ys.max())
grow=Image.fromarray((dark*255).astype('uint8'),'L').filter(IF.MaxFilter(2*int(0.75*S/2)*2+1)).filter(IF.GaussianBlur(0.08*S))
m=np.asarray(grow).astype(float)[...,None]/255
white=(c[...,:3].min(2)>150)
keep=np.asarray(Image.fromarray((white*255).astype('uint8'),'L').filter(IF.MaxFilter(5))).astype(float)[...,None]/255
m=m*keep
c[...,:3]=c[...,:3]*(1-m)+np.array([10,14,28])*m
cut=Image.fromarray(c.clip(0,255).astype('uint8'),'RGBA')
canvas=Image.new('RGBA',(28*S,28*S),(0,0,0,0))
# shadow: Flash's own soft shadow pixels, enlarged; the part hidden behind the body is filled in
al=fa[...,3].copy()
shadow_only=(al<170)&(fa[...,:3].max(2)<140)
sa=np.where(shadow_only,al,0)
sa[8:20,8:17]=np.maximum(sa[8:20,8:17],sa.max()*0.8)
sh=Image.fromarray(sa.astype('uint8'),'L').resize((28*S,28*S),Image.BICUBIC).filter(ImageFilter.GaussianBlur(0.35*S))
shadow=Image.new('RGBA',canvas.size,tuple(np.median(fa[shadow_only][...,:3],axis=0).astype(int))+(0,)); shadow.putalpha(sh)
canvas.alpha_composite(shadow)
canvas.alpha_composite(cut,(int(bx0*S),int(by0*S)))
canvas.save(OUT)
small=canvas.resize((28,28),Image.LANCZOS)
ground=(84,110,60,255)
def on(i):
    bg=Image.new('RGBA',i.size,ground);bg.alpha_composite(i);return bg
sheet=Image.new('RGBA',(28*20+40,28*10+28*4+30),(40,50,40,255))
for k,i in enumerate((on(flash),on(small))):
    sheet.paste(i.resize((280,280),Image.NEAREST),(k*300,0))
sheet.paste(on(canvas).resize((280,280),Image.LANCZOS),(0,290))
sheet.paste(on(flash).resize((112,112),Image.BICUBIC),(300,290))
sheet.paste(on(small).resize((112,112),Image.BICUBIC),(420,290))
sheet.convert('RGB').save('compare.png')
