import numpy as np
from PIL import Image, ImageFilter, ImageEnhance
from scipy import ndimage as ndi
D='/home/claude/so-repo/public/img/'
rng=np.random.default_rng(3)
W,H=1920,1080
soon=Image.open(D+'royal-soon.jpg').convert('RGB'); brk=Image.open(D+'royal-break.jpg').convert('RGB')

# --- финальная заставка: тот же замок, но тёплый «рассвет» победы ---
a=np.asarray(soon,np.float32)/255
yy,xx=np.mgrid[0:H,0:W].astype(np.float32)
lum=a.mean(2,keepdims=True)
warm=np.concatenate([lum*1.25+0.02, lum*0.98, lum*0.62],2)            # золотистый тон
sky=np.clip(1-yy/760,0,1)[...,None]
mix=0.55*sky+0.18
out=a*(1-mix)+warm*mix
r=np.sqrt((xx-960)**2+(yy-300)**2)
sun=np.exp(-(r/420)**1.3)[...,None]*np.array([1.0,.78,.42],np.float32)*0.55
rays_th=np.arctan2(yy-260,xx-960)
ray=ndi.gaussian_filter1d(rng.random(1440).astype(np.float32),2.0,mode='wrap'); ray=np.clip((ray-ray.min())/(ray.max()-ray.min())-.45,0,1)*1.8
idx=((rays_th+np.pi)/(2*np.pi)*1439).astype(int)
rays=(ray[idx]*np.exp(-r/900)*np.clip(r/260,0,1))[...,None]*np.array([1.0,.8,.45],np.float32)*0.28
out=out+sun+rays
# синие края остаются: возвращаем немного оригинала по бокам
side=(np.abs(xx-960)/960)[...,None]**3
out=out*(1-0.5*side)+a*0.5*side
out=np.clip(out,0,1)
Image.fromarray((out*255).astype(np.uint8)).save(D+'royal-end.jpg',quality=88,optimize=True)

# --- фон сетки: размытый «перерыв», приглушённый ---
b=ImageEnhance.Brightness(brk.filter(ImageFilter.GaussianBlur(7))).enhance(.62)
b.save(D+'royal-bracket.jpg',quality=84,optimize=True)

# --- бесшовный туман (горизонтальный тайл) ---
def tile(h,w,oct):
    o=np.zeros((h,w),np.float32)
    for n,amp in oct:
        g=rng.random((max(2,int(n*h/w)),n)).astype(np.float32)
        g=np.concatenate([g,g[:,:1]],1)              # шов по X
        im=Image.fromarray((g*255).astype(np.uint8)).resize((w+int(w/n),h),Image.BICUBIC)
        o+=amp*np.asarray(im,np.float32)[:, :w]/255
    o-=o.min(); o/=o.max(); return o
f=tile(540,1920,((5,1),(11,.6),(24,.35),(60,.15)))
f=np.clip((f-.35)*1.9,0,1)
vf=np.clip(1-np.abs(np.arange(540)-270)/270,0,1)[:,None]**1.2
al=(f*vf*255).astype(np.uint8)
rgba=np.dstack([np.full((540,1920),200,np.uint8),np.full((540,1920),220,np.uint8),np.full((540,1920),255,np.uint8),al])
Image.fromarray(rgba,'RGBA').save(D+'fog.png',optimize=True)
print('ok')
