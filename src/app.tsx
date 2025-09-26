// deck.gl
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import React, { useState, useEffect, useRef } from 'react';
import {createRoot} from 'react-dom/client';
import {Map} from 'react-map-gl/maplibre';
import {DeckGL} from '@deck.gl/react';
import {ScatterplotLayer, IconLayer, PolygonLayer} from '@deck.gl/layers';
import { CSVLoader } from '@loaders.gl/csv';

import type {Color, MapViewState} from '@deck.gl/core';

const POINT_COLOR: Color = [0, 128, 255];

// Local CSV data
const DATA_URL = './points_lonlat.csv';

const INITIAL_VIEW_STATE: MapViewState = {
  longitude: 120.40,
  latitude: 36.01,
  zoom: 13,
  maxZoom: 18,
  pitch: 0,
  bearing: 0
};

type DataPoint = {lat: number, lon: number};

// 船舶数据类型定义
interface ShipDataPoint {
  lat: number;
  lon: number;
  mmsi: string;
  cog: number;
  sog: number;
  ts: string;
  heading: number;
  length: number; // 船长字段
}

// MMSI到颜色的映射类型定义
type MmsiColorMap = Record<string, Color>;

// 船舶域数据类型
interface DomainData {
  domains: Record<string, number[][][]>;
  overlapDomains: number[][][][];
}

// 四元船舶域计算函数
function computeQuadrantAxes(L: number, V0: number) {
  const k_AD = Math.pow(10, 0.3591 * Math.log10(V0) + 0.0952);
  const k_DT = Math.pow(10, 0.5441 * Math.log10(V0) - 0.0795);

  const R_fore = (1 + 1.34 * Math.sqrt(k_AD ** 2 + (k_DT / 2) ** 2)) * L;
  const R_aft = (1 + 0.67 * Math.sqrt(k_AD ** 2 + (k_DT / 2) ** 2)) * L;
  const R_starboard = (0.2 + k_DT) * L;
  const R_port = (0.2 + 0.75 * k_DT) * L;

  return { R_fore, R_aft, R_starboard, R_port };
}

// 四元船舶域生成函数
function fourQuadrantDomainPolygon(
  x0: number, 
  y0: number, 
  R_fore: number, 
  R_aft: number, 
  R_starboard: number, 
  R_port: number, 
  cog: number = 0.0, 
  n: number = 100
) {
  const points: number[][] = [];

  // 第一象限 (前右)
  for (let i = 0; i < n; i++) {
    const theta = (3 * Math.PI / 2) + (i / (n - 1)) * (Math.PI / 2);
    const x = R_fore * Math.cos(theta);
    const y = R_starboard * Math.sin(theta);
    points.push([x, y]);
  }

  // 第二象限 (前左)
  for (let i = 0; i < n; i++) {
    const theta = 0 + (i / (n - 1)) * (Math.PI / 2);
    const x = R_fore * Math.cos(theta);
    const y = R_port * Math.sin(theta);
    points.push([x, y]);
  }

  // 第三象限 (后左)
  for (let i = 0; i < n; i++) {
    const theta = Math.PI / 2 + (i / (n - 1)) * (Math.PI / 2);
    const x = R_aft * Math.cos(theta);
    const y = R_port * Math.sin(theta);
    points.push([x, y]);
  }

  // 第四象限 (后右)
  for (let i = 0; i < n; i++) {
    const theta = Math.PI + (i / (n - 1)) * (Math.PI / 2);
    const x = R_aft * Math.cos(theta);
    const y = R_starboard * Math.sin(theta);
    points.push([x, y]);
  }

  // 坐标旋转 + 平移
  const math_angle = Math.PI / 2 - cog;
  const cosA = Math.cos(math_angle);
  const sinA = Math.sin(math_angle);
  
  // 将地理坐标转换为Web墨卡托投影下的偏移坐标
  // 由于DeckGL使用的是Web墨卡托坐标，我们需要进行坐标转换
  // 这里我们假设在小范围内，可以使用简化的线性变换
  const lat0 = 36.01; // 基准纬度
  const lon0 = 120.40; // 基准经度
  const xScale = 111000 * Math.cos(Math.radians(lat0));
  const yScale = 111000;
  
  const transformedPoints: number[][] = points.map(([x, y]) => {
    const x_rot = x * cosA - y * sinA;
    const y_rot = x * sinA + y * cosA;
    
    // 转换回经纬度
    const newLat = y0 + y_rot / yScale;
    const newLon = x0 + x_rot / xScale;
    
    return [newLon, newLat];
  });

  return [transformedPoints]; // DeckGL的PolygonLayer需要的格式
}

// 计算多边形重叠区域
// 注意：这里使用简化的方法，实际应用中可能需要更复杂的几何计算库
function calculateOverlap(
  poly1Coords: number[][][], 
  poly2Coords: number[][][]
): number[][][] | null {
  // 这里是一个简化的重叠检测实现
  // 实际应用中，应该使用专门的几何计算库如 turf.js 或 jsts
  // 由于我们没有这些库，这里只返回一个占位符
  return null;
}

// 添加Math.radians方法（如果不存在）
if (!Math.radians) {
  Math.radians = (degrees: number) => degrees * Math.PI / 180;
}

export default function App({
  data = DATA_URL,
  radius = 1,
  pointColor = POINT_COLOR,
  mapStyle = 'https://basemaps.cartocdn.com/gl/positron-nolabels-gl-style/style.json'
}: {
  data?: string | DataPoint[];
  radius?: number;
  pointColor?: Color;
  mapStyle?: string;
}) {
  // 船舶数据和域状态
  const [shipData, setShipData] = useState<ShipDataPoint[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const [domainData, setDomainData] = useState<DomainData>({
    domains: {},
    overlapDomains: []
  });
  
  // MMSI到颜色的映射状态
  const [mmsiColors, setMmsiColors] = useState<MmsiColorMap>({});
  
  // 生成随机颜色函数
  const generateRandomColor = (): Color => {
    // 避免使用太暗的颜色，确保在地图上可见
    const getRandomComponent = () => Math.floor(Math.random() * 155) + 100;
    return [getRandomComponent(), getRandomComponent(), getRandomComponent()];
  };
  
  // 为MMSI分配颜色的函数
  const assignColorForMmsi = (mmsi: string): void => {
    setMmsiColors(prevColors => {
      if (!prevColors[mmsi]) {
        // 如果该MMSI还没有分配颜色，则生成一个新的随机颜色
        return { ...prevColors, [mmsi]: generateRandomColor() };
      }
      return prevColors;
    });
  };
  
  // 为每艘船生成半透明填充颜色（使用其MMSI对应的颜色）
  const getDomainFillColor = (mmsi: string): Color => {
    const baseColor = mmsiColors[mmsi] || [255, 0, 0];
    // 添加alpha通道（半透明）
    return [...baseColor.slice(0, 3), 128] as Color;
  };
  
  // 为每艘船生成边框颜色（使用其MMSI对应的颜色，但更暗）
  const getDomainLineColor = (mmsi: string): Color => {
    const baseColor = mmsiColors[mmsi] || [255, 0, 0];
    // 创建更暗的版本用于边框
    return baseColor.map(c => Math.floor(c * 0.7)) as Color;
  };

  // WebSocket连接设置
  useEffect(() => {
    // 创建WebSocket服务器的代码通常在后端实现
    // 这里我们假设已经有一个WebSocket服务器运行在ws://localhost:8080
    
    // 尝试连接WebSocket服务器
    try {
      wsRef.current = new WebSocket('ws://localhost:8080', ['binary']);
      
      wsRef.current.onopen = () => {
        console.log('WebSocket connection established');
      };
      
      wsRef.current.onmessage = (event) => {
        try {
          // 解析接收到的数据（假设是CSV格式的单行数据）
          const dataLine = event.data;
          console.log('Received data:', dataLine);
          
          // 解析CSV行数据
          const [lat, mmsi, cog, lng, sog, ts, heading, length] = dataLine.split('\t').map(item => item.trim());
          
          // 转换数据类型
          const newShipData: ShipDataPoint = {
            lat: parseFloat(lat),
            lon: parseFloat(lng),
            mmsi,
            cog: parseFloat(cog),
            sog: parseFloat(sog),
            ts,
            heading: parseFloat(heading),
            length: parseFloat(length) || 100.0 // 默认值为100.0，防止解析失败
          };
          
          // 经纬度筛选：只添加经度在120.036到120.503之间且纬度在35.9到36.3之间的船舶
          if (newShipData.lon >= 120.036 && newShipData.lon <= 120.503 && 
              newShipData.lat >= 35.9 && newShipData.lat <= 36.3) {
            
            // 为新的MMSI分配颜色
            assignColorForMmsi(mmsi);
            
            // 更新船舶数据状态 - 基于MMSI更新
            setShipData(prev => {
              // 检查是否已存在该MMSI的船舶数据
              const index = prev.findIndex(ship => ship.mmsi === mmsi);
              
              if (index >= 0) {
                // 如果存在，更新该船舶的数据
                const updated = [...prev];
                updated[index] = newShipData;
                return updated;
              } else {
                // 如果不存在，添加新的船舶数据
                // 保留最近10艘船的数据
                const updated = [...prev, newShipData];
                return updated.slice(-10000);
              }
            });
          }
        } catch (error) {
          console.error('Error processing received data:', error);
        }
      };
      
      wsRef.current.onclose = () => {
        console.log('WebSocket connection closed');
      };
      
      wsRef.current.onerror = (error) => {
        console.error('WebSocket error:', error);
        // 显示一个友好的错误提示
        alert('无法连接到数据服务器。请确保Python脚本已启动并正在运行WebSocket服务器。');
      };
    } catch (error) {
      console.error('Failed to create WebSocket connection:', error);
      alert('无法创建数据连接。请确保Python脚本已启动并正在运行WebSocket服务器。');
    }
    
    // 清理函数
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  // 计算船舶域
  useEffect(() => {
    if (shipData.length > 0) {
      const domains: Record<string, number[][][]> = {};
      
      // 为每艘船计算四元域（按MMSI区分）
      shipData.forEach((ship) => {
        // 使用从服务端获取的length值
        const L = ship.length || 100.0; // 默认值为100.0，防止缺失
        
        const { R_fore, R_aft, R_starboard, R_port } = computeQuadrantAxes(L, ship.sog);
        const domain = fourQuadrantDomainPolygon(
          ship.lon, 
          ship.lat, 
          R_fore, 
          R_aft, 
          R_starboard, 
          R_port, 
          Math.radians(ship.cog)
        );
        domains[ship.mmsi] = domain;
      });
      
      // 更新船舶域数据
      setDomainData({
        domains,
        overlapDomains: [] // 暂时不处理多艘船之间的重叠
      });
    } else {
      setDomainData({
        domains: {},
        overlapDomains: []
      });
    }
  }, [shipData]);

  // 添加地图缩放状态管理
  const [currentZoom, setCurrentZoom] = useState(INITIAL_VIEW_STATE.zoom);
  // 添加点云位置偏移和旋转补偿状态（注意：rotation现在支持小数）
  const [positionOffset, setPositionOffset] = useState({x: 0, y: 0, rotation: 0.0});
  // 点云重心坐标状态
  const [pointCloudCenter, setPointCloudCenter] = useState({lon: INITIAL_VIEW_STATE.longitude, lat: INITIAL_VIEW_STATE.latitude});

  // 监听地图缩放变化
  const onViewStateChange = ({ viewState }: any) => {
    setCurrentZoom(viewState.zoom);
  };

  // 计算点云数据的重心坐标
  const calculatePointCloudCenter = (pointData: DataPoint[]) => {
    if (!pointData || pointData.length === 0) {
      return {lon: INITIAL_VIEW_STATE.longitude, lat: INITIAL_VIEW_STATE.latitude};
    }
    
    const totalPoints = pointData.length;
    const sumLon = pointData.reduce((sum, point) => sum + point.lon, 0);
    const sumLat = pointData.reduce((sum, point) => sum + point.lat, 0);
    
    return {lon: sumLon / totalPoints, lat: sumLat / totalPoints};
  };

  // 监听数据变化，计算点云重心
  useEffect(() => {
    if (Array.isArray(data)) {
      const center = calculatePointCloudCenter(data);
      setPointCloudCenter(center);
    } else if (typeof data === 'string') {
      // 对于CSV数据，我们假设初始中心就是地图初始中心
      // 实际应用中可以加载CSV数据后计算重心
    }
  }, [data]);

  // 计算应用旋转后的坐标
  const applyRotation = (lon: number, lat: number, rotationDeg: number) => {
    if (rotationDeg === 0) return [lon, lat];
    
    // 简单旋转计算（实际应用中可能需要更复杂的地理坐标旋转计算）
    const rotationRad = (rotationDeg * Math.PI) / 180;
    const centerLon = pointCloudCenter.lon;
    const centerLat = pointCloudCenter.lat;
    
    // 将相对坐标旋转
    const relLon = lon - centerLon;
    const relLat = lat - centerLat;
    
    const rotatedLon = relLon * Math.cos(rotationRad) - relLat * Math.sin(rotationRad);
    const rotatedLat = relLon * Math.sin(rotationRad) + relLat * Math.cos(rotationRad);
    
    return [centerLon + rotatedLon, centerLat + rotatedLat];
  };

  // 创建基础点图层
  const pointLayers = [
    new ScatterplotLayer<DataPoint>({
      id: 'scatter-plot',
      data,
      loaders: [CSVLoader],
      loadOptions: {
        csv: {
          delimiter: ',',
          dynamicTyping: true,
          skipEmptyLines: true
        }
      },
      radiusScale: 10 * Math.max(currentZoom / INITIAL_VIEW_STATE.zoom, 1), // 确保缩放比例不小于1，点不小于初始大小
      getPosition: d => {
        // 应用旋转补偿
        const [rotatedLon, rotatedLat] = applyRotation(d.lon, d.lat, positionOffset.rotation);
        // 应用位置偏移（注意：这里的偏移量是度数，可能需要根据实际需求调整单位）
        return [
          rotatedLon + positionOffset.x / 10000,  // 缩小偏移量，防止过度偏移
          rotatedLat + positionOffset.y / 10000, 
          0
        ];
      },
      getFillColor: pointColor,
      getRadius: d => 0.001, // 基础圆点大小
      updateTriggers: {
        getFillColor: [pointColor],
        getPosition: [positionOffset, pointCloudCenter] // 确保偏移和重心变化时更新位置
      }
    })
  ];

  // 创建船舶图标图层
  const shipLayers = shipData.length > 0 ? [
    new IconLayer<ShipDataPoint>({
      id: 'ship-icons',
      data: shipData,
      getPosition: d => [d.lon, d.lat],
      getIcon: d => 'ship',
      getSize: d => 5 * Math.max(currentZoom / INITIAL_VIEW_STATE.zoom, 1), // 增大基础图标大小，确保缩放比例不小于1，图标不小于初始大小
      sizeScale: 1.2, // 增大缩放比例
      getAngle: d => d.cog,
      // 使用base64编码的SVG作为船图标
      iconAtlas: 'data:image/svg+xml;charset=utf-8,%3Csvg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"%3E%3Cpath d="M12,2 L18,8 L16,8 L16,16 L8,16 L8,8 L6,8 Z" fill="%23ff0000" stroke="%23000000" stroke-width="1"/%3E%3C/svg%3E',
      iconMapping: {
        ship: {
          x: 0,
          y: 0,
          width: 24,
          height: 24,
          anchorY: 12
        }
      },
      // 根据MMSI获取颜色
      getColor: d => mmsiColors[d.mmsi] || [255, 0, 0],
      updateTriggers: {
        getPosition: shipData,
        getAngle: shipData,
        getColor: [shipData, mmsiColors]
      }
    })
  ] : [];

  // 创建船舶域多边形图层（根据MMSI动态生成）
  const domainLayers = Object.entries(domainData.domains).map(([mmsi, domain]) => {
    if (!domain || domain.length === 0) return null;
    
    return new PolygonLayer({
      id: `ship-domain-${mmsi}`,
      data: [{ polygon: domain }],
      getPolygon: d => d.polygon,
      getFillColor: getDomainFillColor(mmsi), // 使用船舶对应的颜色（半透明）
      getLineColor: getDomainLineColor(mmsi), // 使用船舶对应的颜色（更暗的边框）
      getLineWidth: 2,
      updateTriggers: {
        getPolygon: [domain],
        getFillColor: [mmsiColors],
        getLineColor: [mmsiColors]
      }
    });
  }).filter(Boolean);
  
  // 添加重叠区域图层
  if (domainData.overlapDomains.length > 0) {
    domainData.overlapDomains.forEach((overlapDomain, index) => {
      domainLayers.push(
        new PolygonLayer({
          id: `overlap-domain-${index}`,
          data: [{ polygon: overlapDomain }],
          getPolygon: d => d.polygon,
          getFillColor: [75, 0, 130, 220], // 深紫色，更深颜色
          getLineColor: [75, 0, 130], // 深紫色边框
          getLineWidth: 2,
          updateTriggers: {
            getPolygon: [overlapDomain]
          }
        })
      );
    });
  }

  // 合并所有图层
  const layers = [...pointLayers, ...shipLayers, ...domainLayers];

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh' }}>
      <DeckGL 
        layers={layers} 
        initialViewState={INITIAL_VIEW_STATE} 
        controller={true}
        onViewStateChange={onViewStateChange}
      >
        <Map reuseMaps mapStyle={mapStyle} mapboxAccessToken="pk.eyJ1IjoiZXhhbXBsZXVzZXIiLCJhIjoiY2p5aW95emRtMDFxdjNjcXZ5OGU4Nno0byJ9.1aY8xXKYa2X8Z1D9L5eKmA" />
      </DeckGL>
      
      {/* 点云微调控制面板 */}
      <div style={{
        position: 'absolute',
        top: '10px',
        right: '10px',
        backgroundColor: 'white',
        padding: '10px',
        borderRadius: '5px',
        boxShadow: '0 2px 5px rgba(0,0,0,0.1)',
        fontSize: '12px',
        fontFamily: 'Arial, sans-serif',
        zIndex: 10,
        display: 'none' // 隐藏点云微调界面，但保留逻辑
      }}>
        <h3 style={{ margin: '0 0 10px 0', fontSize: '14px' }}>点云微调控制</h3>
        
        <div style={{ marginBottom: '10px' }}>
          <label style={{ display: 'block', marginBottom: '5px' }}>X位置偏移: {positionOffset.x}</label>
          <input
            type="range"
            min="-100"
            max="100"
            value={positionOffset.x}
            onChange={(e) => setPositionOffset({...positionOffset, x: parseInt(e.target.value)})}
            style={{ width: '100%' }}
          />
        </div>
        
        <div style={{ marginBottom: '10px' }}>
          <label style={{ display: 'block', marginBottom: '5px' }}>Y位置偏移: {positionOffset.y}</label>
          <input
            type="range"
            min="-100"
            max="100"
            value={positionOffset.y}
            onChange={(e) => setPositionOffset({...positionOffset, y: parseInt(e.target.value)})}
            style={{ width: '100%' }}
          />
        </div>
        
        <div style={{ marginBottom: '10px' }}>
          <label style={{ display: 'block', marginBottom: '5px' }}>旋转角度: {positionOffset.rotation.toFixed(2)}</label>
          <input
            type="range"
            min="-1"
            max="2"
            step="0.01"
            value={positionOffset.rotation}
            onChange={(e) => setPositionOffset({...positionOffset, rotation: parseFloat(e.target.value)})}
            style={{ width: '100%' }}
          />
        </div>
        
        <button 
          onClick={() => {
            setPositionOffset({x: 0, y: 0, rotation: 0.0});
          }}
          style={{
            width: '100%',
            padding: '5px',
            backgroundColor: '#f0f0f0',
            border: '1px solid #ccc',
            borderRadius: '3px',
            cursor: 'pointer'
          }}
        >
          重置微调参数
        </button>
      </div>
      
      {/* 状态显示面板 */}
      <div style={{
        position: 'absolute',
        top: '10px',
        left: '10px',
        backgroundColor: 'white',
        padding: '10px',
        borderRadius: '5px',
        boxShadow: '0 2px 5px rgba(0,0,0,0.1)',
        fontSize: '12px',
        fontFamily: 'Arial, sans-serif',
        zIndex: 10
      }}>
        <div>WebSocket 状态: {wsRef.current?.readyState === WebSocket.OPEN ? '已连接' : '未连接'}</div>
        <div>船舶数据点数量: {shipData.length}</div>
        {shipData.length > 0 && (
          <div>最新船舶位置: {shipData[shipData.length - 1].lat.toFixed(6)}, {shipData[shipData.length - 1].lon.toFixed(6)}</div>
        )}
      </div>
      
      {/* 船舶图例面板 */}
      {Object.keys(mmsiColors).length > 0 && (
        <div style={{
          position: 'absolute',
          bottom: '10px',
          left: '10px',
          backgroundColor: 'white',
          padding: '10px',
          borderRadius: '5px',
          boxShadow: '0 2px 5px rgba(0,0,0,0.1)',
          fontSize: '12px',
          fontFamily: 'Arial, sans-serif',
          zIndex: 10,
          maxHeight: '300px',
          overflowY: 'auto'
        }}>
          <h3 style={{ margin: '0 0 10px 0', fontSize: '14px' }}>船舶图例</h3>
          {Object.entries(mmsiColors).map(([mmsi, color]) => {
            // 找到该MMSI对应的最新船舶数据
            const shipInfo = shipData.find(ship => ship.mmsi === mmsi);
            return (
              <div key={mmsi} style={{ marginBottom: '5px', display: 'flex', alignItems: 'center' }}>
                <div 
                  style={{
                    width: '12px', 
                    height: '12px', 
                    backgroundColor: `rgb(${color[0]}, ${color[1]}, ${color[2]})`,
                    marginRight: '5px',
                    borderRadius: '2px'
                  }}
                />
                <div>
                  <strong>MMSI: {mmsi}</strong>
                  {shipInfo && (
                    <div style={{ fontSize: '10px', color: '#666' }}>
                      位置: {shipInfo.lat.toFixed(4)}, {shipInfo.lon.toFixed(4)} | 
                      航向: {shipInfo.cog.toFixed(0)}° | 
                      航速: {shipInfo.sog.toFixed(1)}节
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function renderToDOM(container: HTMLDivElement) {
  createRoot(container).render(<App />);
}