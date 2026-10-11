import os,sys
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from lib import *
os.chdir('D:/Coding/BYMR/art-trials/vorg-anim/full')
N=int(sys.argv[1]) if len(sys.argv)>1 else 32
ROWS=8
os.makedirs('../out',exist_ok=True)
F=[[Image.open(f'h{n}/frames/f{k:02d}.png').convert('RGBA') for k in range(ROWS)] for n in range(N)]
sheet=Image.new('RGBA',(N*CW,ROWS*CH))
for n in range(N):
    for k in range(ROWS): sheet.paste(F[n][k],(n*CW,k*CH))
sheet.save('../out/vorg-anim@4x.png',optimize=True)
s1=Image.new('RGBA',(N*CW//4,ROWS*CH//4))
for n in range(N):
    for k in range(ROWS): s1.paste(premul_resize(F[n][k],(CW//4,CH//4)),(n*CW//4,k*CH//4))
s1.save('../out/vorg-anim.png',optimize=True)
import subprocess
subprocess.run([sys.executable,'D:/Coding/BYMR/worktrees/anim-vorg/web/tools/shrink-sheet.py','../out/vorg-anim@4x.png','../out/vorg-anim.png'],check=True)
BG=(86,92,74,255)
def flat(c,sc):
    b=Image.new('RGBA',c.size,BG); b.alpha_composite(c); b=b.convert('RGB')
    return b.resize((round(c.width*sc),round(c.height*sc)),Image.NEAREST if sc<1 else Image.LANCZOS)
def real(c,zoom=1):
    c1=premul_resize(c,(CW//4,CH//4)); b=Image.new('RGBA',c1.size,BG); b.alpha_composite(c1)
    return b.convert('RGB').resize((c1.width*zoom,c1.height*zoom),Image.NEAREST)
def gif(path,fl,ms): fl[0].save(path,save_all=True,append_images=fl[1:],duration=ms,loop=0)
heads=[0,5,8,13,19,26]
# overview at real size: attack (rows 3-7 = 5 frames), top = new, bottom = today's still (row 1)
fr=[]
for t in range(10):
    k=3+t%5
    row=[real(F[n][k],4) for n in heads]; st=[real(F[n][1],4) for n in heads]
    w,h=row[0].size
    W=Image.new('RGB',(w*len(heads),h*2),BG)
    for i,(a,b) in enumerate(zip(row,st)): W.paste(a,(i*w,0)); W.paste(b,(i*w,h))
    d=ImageDraw.Draw(W); d.text((4,4),f'top: new attack row {k}   bottom: current half-open still',fill=(255,255,255))
    for i,n in enumerate(heads): d.text((i*w+4,h-14),f'heading {n}',fill=(255,230,120))
    fr.append(W)
gif('../out/overview-real.gif',fr,150)
# turn-walk: the flap (rows 0-2, 3 ticks = 100 ms) while the heading turns, 2 laps
fr=[]
for t in range(N*2):
    n=t%N; k=t%3; fr.append(flat(F[n][k],1)); ImageDraw.Draw(fr[-1]).text((4,4),f'heading {n}  flap row {k}',fill=(255,255,255))
gif('../out/turn-walk.gif',fr,100)
# attack turn: attack rows cycle while the heading turns
fr=[]
for t in range(N*2):
    n=t%N; k=3+t%5; fr.append(flat(F[n][k],1)); ImageDraw.Draw(fr[-1]).text((4,4),f'heading {n}  attack row {k}',fill=(255,255,255))
gif('../out/turn-attack.gif',fr,110)
# flap-real: one gif per heading group, real size x4, flap at the game's speed (3 rows, 3 ticks each ~ 100 ms at 30 ticks/s)
groups=[(0,[0,3,6]),(1,[8,10,12]),(2,[16,18,19]),(3,[20,24,28]),(4,[30,31,7])]
for gi,hs in groups:
    fr=[]
    for t in range(18):
        k=t%3; row=[real(F[n][k],3) for n in hs]; w,h=row[0].size
        W=Image.new('RGB',(w*len(hs),h),BG)
        for i,im in enumerate(row): W.paste(im,(i*w,0))
        d=ImageDraw.Draw(W)
        for i,n in enumerate(hs): d.text((i*w+4,4),f'heading {n} flap {k}',fill=(255,255,255))
        fr.append(W)
    gif(f'../out/flap-real-g{gi}.gif',fr,100)
# contact sheets: 6 headings per sheet, rows = headings, cols = 8 frames (labelled)
names=['flap0 up','flap1 half','flap2 down','wait','windup','strike','follow','recover']
sc=0.8; w,h=round(CW*sc),round(CH*sc)
for g in range(0,N,6):
    ns=list(range(g,min(N,g+6)))
    W=Image.new('RGB',(w*ROWS,h*len(ns)),BG); d=ImageDraw.Draw(W)
    for r,n in enumerate(ns):
        for k in range(ROWS):
            W.paste(flat(F[n][k],sc),(k*w,r*h)); d.text((k*w+3,r*h+3),f'{n}/{names[k]}',fill=(255,255,255))
    W.save(f'../out/contact-{g:02d}-{ns[-1]:02d}.png')
print('done',N)
