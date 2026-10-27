import numpy as np, math, sys
from PIL import Image, ImageDraw
from scipy import ndimage as ndi

W, H = 1920, 1080
rng = np.random.default_rng(5)
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)

def fbm(h, w, octaves=((5, 1.0), (12, .55), (30, .3), (80, .15))):
    out = np.zeros((h, w), np.float32)
    for n, a in octaves:
        g = rng.random((max(2, int(n * h / w)), n)).astype(np.float32)
        out += a * np.asarray(Image.fromarray((g * 255).astype(np.uint8)).resize((w, h), Image.BICUBIC), np.float32) / 255
    out -= out.min(); out /= out.max()
    return out

CX, CY = 960, 540
r = np.sqrt((xx - CX) ** 2 + (yy - CY) ** 2)
img = np.zeros((H, W, 3), np.float32)
img[..., 0] = 5 + 14 * np.exp(-(r / 800) ** 1.5)
img[..., 1] = 8 + 38 * np.exp(-(r / 800) ** 1.5)
img[..., 2] = 18 + 70 * np.exp(-(r / 800) ** 1.5)
img += np.exp(-(r / 300) ** 1.6)[..., None] * np.array([38, 72, 125], np.float32)

layer = Image.new('RGBA', (W, H), (0, 0, 0, 0))
d = ImageDraw.Draw(layer)

def shard(angle, r0, r1, w0, seed):
    # основание далеко от центра, остриё направлено к центру
    ca, sa = math.cos(angle), math.sin(angle)
    bx, by = CX + ca * r0, CY + sa * r0
    tx, ty = CX + ca * r1, CY + sa * r1
    px, py = -sa, ca
    k = rng.uniform(-0.35, 0.35)
    mid = 0.55
    mx, my = bx + (tx - bx) * mid + px * w0 * k, by + (ty - by) * mid + py * w0 * k
    L = (bx + px * w0, by + py * w0); R = (bx - px * w0, by - py * w0)
    T = (tx, ty); M = (mx, my)
    # две грани относительно гребня B-M-T
    ridge_b = (bx, by)
    light = rng.uniform(0.4, 1.0)
    shade = rng.uniform(0.25, 1.0)
    fz = 1 - min(1, (r1 - 380) / 520)               # ближе к центру — ярче
    def c(v, a=255):
        base = np.array([8, 18, 46]) + np.array([70, 105, 150]) * v ** 1.6 * (0.35 + 0.8 * fz)
        return (int(min(255, base[0])), int(min(255, base[1])), int(min(255, base[2])), a)
    d.polygon([L, ridge_b, M, T], fill=c(light))
    d.polygon([R, ridge_b, M, T], fill=c(shade * 0.55))
    # кромка
    if rng.random() < .75:
        d.line([ridge_b, M, T], fill=(230, 215, 170, 255) if rng.random() < .35 else (150, 200, 255, 255), width=int(rng.integers(2, 5)))
    d.line([L, T], fill=(120, 170, 235, 200), width=2)

# дальние (тёмные, плотные), затем крупные ближние
for _ in range(80):
    a = rng.uniform(0, 2 * math.pi)
    shard(a, rng.uniform(1100, 1500), rng.uniform(700, 860), rng.uniform(30, 90), 0)
for _ in range(34):
    a = rng.uniform(0, 2 * math.pi)
    # не закрываем центр и зону заголовка: больше шардов по бокам
    a = rng.choice([rng.uniform(math.radians(150), math.radians(210)), rng.uniform(-math.radians(30), math.radians(30)), rng.uniform(0, 2 * math.pi)])
    shard(a, rng.uniform(1200, 1600), rng.uniform(560, 700), rng.uniform(70, 170), 1)

arr = np.asarray(layer, np.float32); a = arr[..., 3:4] / 255
img = img * (1 - a) + arr[..., :3] * a

# затемнение центра под текст и свечение за ним
img *= (1 - 0.35 * np.exp(-(r / 380) ** 2))[..., None]
img += np.exp(-((r - 120) / 140) ** 2)[..., None] * np.array([20, 40, 80], np.float32) * .5

# лучи
th = np.arctan2(yy - CY, xx - CX)
ray = ndi.gaussian_filter1d(rng.random(1440).astype(np.float32), 2.0, mode='wrap')
ray = np.clip((ray - ray.min()) / (ray.max() - ray.min()) - .5, 0, 1) * 2
idx = ((th + math.pi) / (2 * math.pi) * 1439).astype(int)
rays = ray[idx] * np.exp(-r / 700) * np.clip(r / 200, 0, 1)
img += rays[..., None] * np.array([8, 18, 38], np.float32)

# боковые блики и «золото» на самых ярких гранях
fog = fbm(H, W)
img += (np.exp(-((yy - 900) / 190) ** 2) * (0.3 + fog))[..., None] * np.array([18, 40, 84], np.float32)
img += (fog * np.exp(-((r - 520) / 260) ** 2))[..., None] * np.array([8, 18, 40], np.float32)

bright = np.clip(img - 170, 0, None)
sm = np.stack([ndi.zoom(bright[..., c], .25, order=1) for c in range(3)], -1)
for sg, gn in ((6, .7), (20, .7), (50, .6)):
    bl = np.stack([ndi.gaussian_filter(sm[..., c], sg / 4) for c in range(3)], -1)
    img += np.stack([ndi.zoom(bl[..., c], 4, order=1)[:H, :W] for c in range(3)], -1) * gn

img = np.clip(img, 0, 255) / 255.0
vig = 1 - 0.8 * (((xx - W / 2) / (W / 1.3)) ** 2 + ((yy - H / 2) / (H / 1.1)) ** 2)
img *= np.clip(vig, 0.12, 1)[..., None]
img += rng.normal(0, 0.012, (H, W, 1)).astype(np.float32)
Image.fromarray((np.clip(img, 0, 1) * 255).astype(np.uint8)).save(sys.argv[1], quality=88, optimize=True)
print('saved')
