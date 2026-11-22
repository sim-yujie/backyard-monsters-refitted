# Final pictures for the owner: copies the named shots out of work/ and builds the comparison sheets.
from PIL import Image, ImageDraw, ImageFont
import shutil, os
W='/home/yujiesim/Coding/backyard-monsters-refitted/worktrees/hcc-r3/shots/hcc-r3'; S=W+'/work'
NAMES={'l2-monsters':'1-monsters-tab-l2','l2-presets-empty':'2-presets-empty-l2','l2-building':'3-presets-building-one-l2','l3-presets':'4-presets-five-filled-l3','l3-sent':'5-after-send-l3','l3-remote-presets':'6-outpost-from-home-l3','l3-edit':'7-changing-a-preset-l3','l2-housing':'8-housing-box-open-l2','today':'0-today'}
for look in ['modern','classic']:
    for size,tag in [('390x844','phone'),('1280x720','desktop')]:
        for src,dst in NAMES.items():
            f=f'{S}/{src}-{look}-{size}.png'
            if os.path.exists(f): shutil.copy(f,f'{W}/{tag}-{dst}-{look}-{size}.png')
font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',54)
def side(pairs,out,scale=1.0):
    ims=[(t,Image.open(f)) for t,f in pairs]
    h=max(i.height for _,i in ims); pad=40; head=110
    w=sum(i.width for _,i in ims)+pad*(len(ims)+1)
    s=Image.new('RGB',(w,h+head+pad),(20,23,28)); d=ImageDraw.Draw(s); x=pad
    for t,i in ims:
        d.text((x,28),t,font=font,fill=(255,255,255)); s.paste(i,(x,head)); x+=i.width+pad
    if scale!=1.0: s=s.resize((int(s.width*scale),int(s.height*scale)),Image.LANCZOS)
    s.save(out); print(out,s.size)
for look in ['modern','classic']:
    p=lambda j: f'{S}/{j}-{look}-390x844.png'
    side([('Today',p('today')),('Round 3: Monsters',p('l2-monsters')),('Round 3: Presets',p('l3-presets'))],f'{W}/compare-phone-today-vs-round3-{look}.png')
    side([('Empty',p('l2-presets-empty')),('Building one',p('l2-building')),('Five filled (L3)',p('l3-presets')),('After Send',p('l3-sent')),('Outpost from home',p('l3-remote-presets'))],f'{W}/sheet-phone-presets-{look}.png',0.6)
    q=lambda j: f'{S}/{j}-{look}-1280x720.png'
    side([('Today',q('today')),('Round 3: Presets (L3)',q('l3-presets'))],f'{W}/compare-desktop-today-vs-round3-{look}.png')
