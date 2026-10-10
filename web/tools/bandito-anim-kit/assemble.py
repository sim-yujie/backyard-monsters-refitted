import os,sys,json
from lib import *
from PIL import ImageFont
N=int(sys.argv[1]) if len(sys.argv)>1 else 30
os.makedirs('out',exist_ok=True)
F=[[Image.open(f'h{n}/frames/f{k:02d}.png').convert('RGBA') for k in range(12)] for n in range(N)]
# sheet: columns = headings, rows = frames
sheet=Image.new('RGBA',(N*CW,12*CH))
for n in range(N):
    for k in range(12): sheet.paste(F[n][k],(n*CW,k*CH))
sheet.save('out/bandito-anim@4x.png',optimize=True)
s1=Image.new('RGBA',(N*CW//4,12*CH//4))
for n in range(N):
    for k in range(12): s1.paste(premul_resize(F[n][k],(CW//4,CH//4)),(n*CW//4,k*CH//4))
s1.save('out/bandito-anim.png',optimize=True)
BG=(86,92,74,255)
def flat(c,sc):
    b=Image.new('RGBA',c.size,BG); b.alpha_composite(c); b=b.convert('RGB')
    return b.resize((round(c.width*sc),round(c.height*sc)),Image.NEAREST if sc<1 else Image.LANCZOS)
def real(c,zoom=1):
    # true 1x game sprite (41x40), optionally shown enlarged with nearest-neighbour
    c1=premul_resize(c,(CW//4,CH//4)); return flat_big(c1,zoom)
def flat_big(c,z):
    b=Image.new('RGBA',c.size,BG); b.alpha_composite(c); return b.convert('RGB').resize((c.width*z,c.height*z),Image.NEAREST)
def gif(path,fl,ms): fl[0].save(path,save_all=True,append_images=fl[1:],duration=ms,loop=0)
def stillframe(n): return F[n][0]
heads=[0,5,8,13,19,25] if N==30 else list(range(0,N,max(1,N//6)))[:6]
def overview(mode,path):
    fr=[]
    tl=[('w',i%6+1) for i in range(12)]+[('a',7+i%5) for i in range(10)]
    for kind,k in tl:
        row=[];
        for n in heads:
            row.append(real(F[n][k],4) if mode=='real' else flat(F[n][k],1))
        st=[real(F[n][0],4) if mode=='real' else flat(F[n][0],1) for n in heads]
        w,h=row[0].size
        W=Image.new('RGB',(w*len(heads),h*2),BG)
        for i,(a,b) in enumerate(zip(row,st)): W.paste(a,(i*w,0)); W.paste(b,(i*w,h))
        d=ImageDraw.Draw(W); d.text((4,4),'top: new '+('walk' if kind=='w' else 'attack')+'   bottom: current still',fill=(255,255,255))
        for i,n in enumerate(heads): d.text((i*w+4,h-14),f'heading {n*12}',fill=(255,230,120))
        fr.append(W)
    gif(path,fr,110)
overview('4x','out/overview-4x.gif'); overview('real','out/overview-real.gif')
# turn-walk: walk cycle advances while the heading turns through all headings (2 laps)
fr=[]
for t in range(N*2):
    n=t%N; k=1+(t%6)
    fr.append(flat(F[n][k],1)); ImageDraw.Draw(fr[-1]).text((4,4),f'heading {n*12}  walk {k}',fill=(255,255,255))
gif('out/turn-walk.gif',fr,110)
fr=[]
for t in range(N*2):
    n=t%N; k=1+(t%6); fr.append(real(F[n][k],4))
gif('out/turn-walk-real.gif',fr,110)
# contact sheets: one per 6 headings, rows = headings, cols = 12 frames
sc=0.75; w,h=round(CW*sc),round(CH*sc)
for g in range(0,N,6):
    ns=list(range(g,min(N,g+6)))
    W=Image.new('RGB',(w*12,h*len(ns)),BG); d=ImageDraw.Draw(W)
    for r,n in enumerate(ns):
        for k in range(12):
            W.paste(flat(F[n][k],sc),(k*w,r*h))
            d.text((k*w+3,r*h+3),f'{n}/{["idle"]+["walk%d"%i for i in range(1,7)]+["atk%d"%i for i in range(7,12)] and (["idle"]+["walk%d"%i for i in range(1,7)]+["atk%d"%i for i in range(7,12)])[k]}',fill=(255,255,255))
    W.save(f'out/contact-{g:02d}-{ns[-1]:02d}.png')
print('done',N)
