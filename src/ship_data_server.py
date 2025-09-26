import asyncio
import websockets
import csv
import os
import time
import asyncio
from datetime import datetime

# WebSocket服务器地址和端口
SERVER_ADDRESS = "localhost"
SERVER_PORT = 8080

# 已连接的客户端列表
connected_clients = set()

# CSV文件路径
CSV_FILE_PATH = "output_20220408.csv"
# MMSI与length对应关系的CSV文件路径
MMSI_LENGTH_FILE_PATH = "output_20220408_classic.csv"
# 存储mmsi到length的映射字典
mmsi_length_map = {}


# 读取MMSI与length对应关系的函数
def read_mmsi_length_map():
    try:
        # 获取当前脚本所在目录
        script_dir = os.path.dirname(os.path.abspath(__file__))
        # 构建完整的CSV文件路径
        full_csv_path = os.path.join(script_dir, MMSI_LENGTH_FILE_PATH)
        
        with open(full_csv_path, 'r', encoding='utf-8') as csv_file:
            csv_reader = csv.reader(csv_file)
            # 跳过表头（如果有）
            header_skipped = False
            for row in csv_reader:
                if not header_skipped and len(row) > 0 and row[0].strip().lower() == 'mmsi':
                    header_skipped = True
                    continue
                
                if len(row) >= 5:
                    mmsi = row[0].strip()
                    try:
                        # 尝试将第5列（索引为4）转换为浮点数作为length
                        length = float(row[4].strip())
                        mmsi_length_map[mmsi] = length
                    except ValueError:
                        # 如果无法转换，跳过该条记录
                        continue
        
        print(f"成功读取MMSI与length对应关系文件，共{len(mmsi_length_map)}条记录")
    except Exception as e:
        print(f"读取MMSI与length对应关系文件时出错: {e}")

# 读取CSV文件数据的函数
def read_ship_data_from_csv():
    ship_data = []
    try:
        # 获取当前脚本所在目录
        script_dir = os.path.dirname(os.path.abspath(__file__))
        # 构建完整的CSV文件路径
        full_csv_path = os.path.join(script_dir, CSV_FILE_PATH)
        
        with open(full_csv_path, 'r', encoding='utf-8') as csv_file:
            csv_reader = csv.DictReader(csv_file)
            for row in csv_reader:
                # 提取所需字段并保持原始格式
                lat = float(row['lat'])
                lng = float(row['lng'])
                
                # 经纬度和航速筛选：只添加经度在120.036到120.503之间、纬度在35.9到36.3之间且航速大于0的数据
                sog = float(row['sog'])
                if lng >= 120.036 and lng <= 120.503 and lat >= 35.9 and lat <= 36.3 and sog > 0:
                    mmsi = row['mmsi']
                    # 获取对应的length，如果没有找到则默认为0
                    length = mmsi_length_map.get(mmsi, 0.0)
                    
                    ship_data.append({
                        'lat': row['lat'],
                        'mmsi': mmsi,
                        'cog': row['cog'],
                        'lng': row['lng'],
                        'sog': row['sog'],
                        'ts': row['ts'],
                        'heading': row['heading'],
                        'length': str(length)  # 转换为字符串以保持一致的格式
                    })
        
        print(f"成功读取CSV文件，共{len(ship_data)}条记录")
        return ship_data
    except Exception as e:
        print(f"读取CSV文件时出错: {e}")
        return []

# 初始化加载MMSI与length对应关系
read_mmsi_length_map()

# 初始化加载CSV数据
ship_data = read_ship_data_from_csv()

# 按时间戳ts对船舶数据进行排序
if ship_data:
    try:
        # 转换ts字段为datetime对象并进行排序
        def sort_by_timestamp(data):
            try:
                # 尝试多种可能的时间格式解析
                timestamp_formats = ['%Y-%m-%d %H:%M:%S', '%Y/%m/%d %H:%M:%S', '%d-%m-%Y %H:%M:%S', '%m/%d/%Y %H:%M:%S']
                ts_str = data['ts']
                for fmt in timestamp_formats:
                    try:
                        return datetime.strptime(ts_str, fmt)
                    except ValueError:
                        continue
                # 如果都解析失败，尝试使用时间戳数字
                try:
                    return datetime.fromtimestamp(float(ts_str))
                except ValueError:
                    # 返回一个非常早的时间，确保无法解析的记录排在最后
                    return datetime(1900, 1, 1)
            except Exception:
                # 出现任何异常，返回一个非常早的时间
                return datetime(1900, 1, 1)
        
        # 按照时间戳排序
        ship_data.sort(key=sort_by_timestamp)
        print(f"数据已按时间戳排序，共{len(ship_data)}条记录")
    except Exception as e:
        print(f"数据排序时出错: {e}")

# 处理客户端连接的异步函数 - 适应websockets 15.0.1版本
async def handle_client(websocket):
    # 将新客户端添加到已连接客户端列表
    connected_clients.add(websocket)
    print(f"客户端已连接，当前连接数: {len(connected_clients)}")
    
    try:
        # 如果没有读取到数据，发送错误消息
        if not ship_data:
            await websocket.send("错误: 无法读取或解析CSV文件")
            return
        
        # 持续向客户端发送船舶数据（循环播放数据）
        data_index = 0
        try:
            while True:
                # 获取当前数据记录
                current_data = ship_data[data_index]
                
                # 按照用户要求的格式，用制表符分隔各字段
                # 顺序：lat, mmsi, cog, lng, sog, ts, heading, length
                data_line = f"{current_data['lat']}\t{current_data['mmsi']}\t{current_data['cog']}\t{current_data['lng']}\t{current_data['sog']}\t{current_data['ts']}\t{current_data['heading']}\t{current_data['length']}"
                
                # 发送数据给客户端
                await websocket.send(data_line)
                print(f"发送数据: {data_line}")
                
                # 更新数据索引，循环播放
                data_index = (data_index + 1) % len(ship_data)
                
                # 等待一段时间再发送下一条数据（可根据需要调整频率）
                await asyncio.sleep(0.5)  # 每0.5秒发送一次数据
        except websockets.exceptions.ConnectionClosed:
            print("客户端连接已关闭")
    finally:
        # 从已连接客户端列表中移除断开连接的客户端
        if websocket in connected_clients:
            connected_clients.remove(websocket)
        print(f"客户端已断开，当前连接数: {len(connected_clients)}")

# 启动WebSocket服务器的异步函数 - 适应websockets 15.0.1版本
async def start_server():
    # 使用较旧的协议版本来兼容客户端
    async with websockets.serve(
        handle_client,
        SERVER_ADDRESS,
        SERVER_PORT,
        subprotocols=['binary']  # 指定子协议以避免握手问题
    ) as server:
        # 打印服务器启动信息
        print(f"WebSocket服务器已启动，监听 {SERVER_ADDRESS}:{SERVER_PORT}")
        print(f"正在从 {CSV_FILE_PATH} 读取船舶数据")
        print(f"共读取到 {len(ship_data)} 条船舶数据记录")
        print("按Ctrl+C停止服务器")
        
        # 保持服务器运行直到收到停止信号
        await server.wait_closed()

# 主函数
if __name__ == "__main__":
    try:
        # 启动服务器
        asyncio.run(start_server())
    except KeyboardInterrupt:
        print("服务器已停止")