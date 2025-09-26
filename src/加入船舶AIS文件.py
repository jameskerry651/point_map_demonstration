import numpy as np
import matplotlib.pyplot as plt
from matplotlib.patches import Polygon as MplPolygon
from matplotlib.animation import FuncAnimation
from shapely.geometry import Polygon as ShapelyPolygon
import pandas as pd
import math


# ===== 四元船舶域计算 =====
def compute_quadrant_axes(L, V0):
    k_AD = 10 ** (0.3591 * np.log10(V0) + 0.0952)
    k_DT = 10 ** (0.5441 * np.log10(V0) - 0.0795)

    R_fore = (1 + 1.34 * np.sqrt(k_AD ** 2 + (k_DT / 2) ** 2)) * L
    R_aft = (1 + 0.67 * np.sqrt(k_AD ** 2 + (k_DT / 2) ** 2)) * L
    R_starboard = (0.2 + k_DT) * L
    R_port = (0.2 + 0.75 * k_DT) * L

    return R_fore, R_aft, R_starboard, R_port


# ===== 修正后的四元船舶域生成函数 =====
def four_quadrant_domain_polygon(x0, y0, R_fore, R_aft, R_starboard, R_port, cog=0.0, n=100):
    points = []

    # 第一象限 (前右)
    theta = np.linspace(3 * np.pi / 2, 2 * np.pi, n)
    x = R_fore * np.cos(theta)
    y = R_starboard * np.sin(theta)
    points.extend(zip(x, y))

    # 第二象限 (前左)
    theta = np.linspace(0, np.pi / 2, n)
    x = R_fore * np.cos(theta)
    y = R_port * np.sin(theta)
    points.extend(zip(x, y))

    # 第三象限 (后左)
    theta = np.linspace(np.pi / 2, np.pi, n)
    x = R_aft * np.cos(theta)
    y = R_port * np.sin(theta)
    points.extend(zip(x, y))

    # 第四象限 (后右)
    theta = np.linspace(np.pi, 3 * np.pi / 2, n)
    x = R_aft * np.cos(theta)
    y = R_starboard * np.sin(theta)
    points.extend(zip(x, y))

    points = np.array(points)

    # 坐标旋转 + 平移
    math_angle = np.pi / 2 - cog
    cosA, sinA = np.cos(math_angle), np.sin(math_angle)
    x_rot = points[:, 0] * cosA - points[:, 1] * sinA + x0
    y_rot = points[:, 0] * sinA + points[:, 1] * cosA + y0

    return np.column_stack([x_rot, y_rot])


# ===== 读取AIS数据 =====
def read_ais_data(filename):
    df = pd.read_csv(filename)
    df['cog_rad'] = np.radians(df['cog'])  # 航向角转弧度
    return df


# 读取两艘船的AIS数据
ship1_df = read_ais_data(r'C:\Users\misaki\Desktop\recent\deckgl/209203000.csv')
ship2_df = read_ais_data(r'C:\Users\misaki\Desktop\recent\deckgl/477369900.csv')

min_len = min(len(ship1_df), len(ship2_df))
ship1_df = ship1_df.head(min_len)
ship2_df = ship2_df.head(min_len)


# ===== 经纬度转平面坐标 =====
def latlng_to_xy(lat, lng, lat0, lng0):
    x = (lng - lng0) * 111000 * math.cos(math.radians(lat0))
    y = (lat - lat0) * 111000
    return x, y


lat0 = ship1_df['lat'].iloc[0]
lng0 = ship1_df['lng'].iloc[0]

ship1_x, ship1_y = [], []
for _, row in ship1_df.iterrows():
    x, y = latlng_to_xy(row['lat'], row['lng'], lat0, lng0)
    ship1_x.append(x)
    ship1_y.append(y)

ship2_x, ship2_y = [], []
for _, row in ship2_df.iterrows():
    x, y = latlng_to_xy(row['lat'], row['lng'], lat0, lng0)
    ship2_x.append(x)
    ship2_y.append(y)


# ===== 船舶参数 =====
L1, L2 = 100.0, 100.0  # 船长


# ===== 图像初始化 =====
fig, ax = plt.subplots(figsize=(14, 10))
ax.set_aspect("equal")
ax.set_title("两船四元船舶域动态仿真 - 基于AIS数据")
ax.set_xlabel("东向距离 (米)")
ax.set_ylabel("北向距离 (米)")
ax.grid(True, linestyle='--', alpha=0.7)

margin = 1000
x_min = min(min(ship1_x), min(ship2_x)) - margin
x_max = max(max(ship1_x), max(ship2_x)) + margin
y_min = min(min(ship1_y), min(ship2_y)) - margin
y_max = max(max(ship1_y), max(ship2_y)) + margin
ax.set_xlim(x_min, x_max)
ax.set_ylim(y_min, y_max)

# 初始四元域
R_fore1, R_aft1, R_star1, R_port1 = compute_quadrant_axes(L1, ship1_df['sog'].iloc[0])
R_fore2, R_aft2, R_star2, R_port2 = compute_quadrant_axes(L2, ship2_df['sog'].iloc[0])

coords1 = four_quadrant_domain_polygon(ship1_x[0], ship1_y[0],
                                       R_fore1, R_aft1, R_star1, R_port1,
                                       cog=ship1_df['cog_rad'].iloc[0])
coords2 = four_quadrant_domain_polygon(ship2_x[0], ship2_y[0],
                                       R_fore2, R_aft2, R_star2, R_port2,
                                       cog=ship2_df['cog_rad'].iloc[0])

poly1_patch = MplPolygon(coords1, closed=True, edgecolor='navy', facecolor='lightblue', alpha=0.5, lw=2)
poly2_patch = MplPolygon(coords2, closed=True, edgecolor='darkred', facecolor='lightcoral', alpha=0.5, lw=2)
ax.add_patch(poly1_patch)
ax.add_patch(poly2_patch)

ship1_dot, = ax.plot([ship1_x[0]], [ship1_y[0]], 'bo', markersize=10, label='船舶1 (209203000)')
ship2_dot, = ax.plot([ship2_x[0]], [ship2_y[0]], 'ro', markersize=10, label='船舶2 (477369900)')

overlap_patch = MplPolygon([[0, 0]], closed=True, facecolor='purple', alpha=0.3)
ax.add_patch(overlap_patch)

txt = ax.text(0.02, 0.98, '', transform=ax.transAxes, va='top', ha='left',
              bbox=dict(boxstyle='round', facecolor='white', alpha=0.8))

ax.legend(loc='upper right')


# ===== 动画函数 =====
def update(frame):
    x1, y1 = ship1_x[frame], ship1_y[frame]
    x2, y2 = ship2_x[frame], ship2_y[frame]

    sog1 = ship1_df['sog'].iloc[frame]
    sog2 = ship2_df['sog'].iloc[frame]
    cog1 = ship1_df['cog_rad'].iloc[frame]
    cog2 = ship2_df['cog_rad'].iloc[frame]

    R_fore1, R_aft1, R_star1, R_port1 = compute_quadrant_axes(L1, sog1)
    R_fore2, R_aft2, R_star2, R_port2 = compute_quadrant_axes(L2, sog2)

    coords1 = four_quadrant_domain_polygon(x1, y1, R_fore1, R_aft1, R_star1, R_port1, cog=cog1)
    coords2 = four_quadrant_domain_polygon(x2, y2, R_fore2, R_aft2, R_star2, R_port2, cog=cog2)
    poly1_patch.set_xy(coords1)
    poly2_patch.set_xy(coords2)

    ship1_dot.set_data([x1], [y1])
    ship2_dot.set_data([x2], [y2])

    poly1 = ShapelyPolygon(coords1)
    poly2 = ShapelyPolygon(coords2)
    inter = poly1.intersection(poly2)

    if not inter.is_empty and inter.geom_type == 'Polygon':
        overlap_patch.set_xy(np.array(inter.exterior.coords))
    else:
        overlap_patch.set_xy([[0, 0]])

    distance = np.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2)
    timestamp = ship1_df['ts'].iloc[frame]

    txt.set_text(f"时间戳: {timestamp}\n"
                 f"船舶1: 速度={sog1:.1f}节, 航向={np.degrees(cog1):.1f}°\n"
                 f"船舶2: 速度={sog2:.1f}节, 航向={np.degrees(cog2):.1f}°\n"
                 f"两船距离: {distance:.1f}米\n"
                 f"领域重叠: {'是' if not inter.is_empty else '否'}")

    return poly1_patch, poly2_patch, ship1_dot, ship2_dot, overlap_patch, txt


# ===== 创建动画 =====
ani = FuncAnimation(fig, update, frames=min_len, interval=100, blit=True, repeat=True)
plt.tight_layout()
plt.show()
