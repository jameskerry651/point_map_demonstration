import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

// 获取当前文件的目录路径
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 简单测试：读取AIS数据文件并分析坐标范围
function simpleAISTest() {
  try {
    // 读取文件内容
    const file1 = fs.readFileSync(resolve(__dirname, '209203000.csv'), 'utf8');
    const file2 = fs.readFileSync(resolve(__dirname, '477369900.csv'), 'utf8');
    
    console.log('Files read successfully');
    
    // 解析CSV数据（手动解析）
    const parseCSV = (csvContent: string) => {
      const lines = csvContent.trim().split('\n');
      const headers = lines[0].split(',');
      const data: any[] = [];
      
      for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',');
        if (values.length === headers.length) {
          const row: any = {};
          headers.forEach((header, index) => {
            // 尝试转换为数字
            const numValue = parseFloat(values[index]);
            row[header] = isNaN(numValue) ? values[index] : numValue;
          });
          data.push(row);
        }
      }
      
      return data;
    };
    
    const data1 = parseCSV(file1);
    const data2 = parseCSV(file2);
    
    console.log('Data parsed successfully');
    console.log('First file data length:', data1.length);
    console.log('Second file data length:', data2.length);
    
    // 分析坐标范围
    if (data1.length > 0) {
      console.log('\nFirst file (209203000.csv) analysis:');
      console.log('Data structure:', data1[0]);
      console.log('Lat/Lng range:');
      console.log('  Min lat:', Math.min(...data1.map((d: any) => d.lat)));
      console.log('  Max lat:', Math.max(...data1.map((d: any) => d.lat)));
      console.log('  Min lng:', Math.min(...data1.map((d: any) => d.lng)));
      console.log('  Max lng:', Math.max(...data1.map((d: any) => d.lng)));
    }
    
    if (data2.length > 0) {
      console.log('\nSecond file (477369900.csv) analysis:');
      console.log('Data structure:', data2[0]);
      console.log('Lat/Lng range:');
      console.log('  Min lat:', Math.min(...data2.map((d: any) => d.lat)));
      console.log('  Max lat:', Math.max(...data2.map((d: any) => d.lat)));
      console.log('  Min lng:', Math.min(...data2.map((d: any) => d.lng)));
      console.log('  Max lng:', Math.max(...data2.map((d: any) => d.lng)));
    }
    
    // 查看地图初始视图设置
    console.log('\nMap initial view settings reference:');
    console.log('  longitude: 120.314');
    console.log('  latitude: 36.086');
    console.log('  zoom: 13');
    
  } catch (error) {
    console.error('Error reading or analyzing AIS data:', error);
  }
}

simpleAISTest().then(() => {
  console.log('\nTest completed');
});