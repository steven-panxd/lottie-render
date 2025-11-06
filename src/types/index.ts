/**
 * Lottie 渲染服务的类型定义
 */

/**
 * 渲染配置选项
 */
export interface RenderOptions {
  width?: number;          // 视频宽度 (默认 1920)
  height?: number;         // 视频高度 (默认 1080)
  fps?: number;           // 帧率 (默认 30)
  backgroundColor?: string;  // 背景色 (默认透明)
  quality?: number;       // 视频质量 0-100 (默认 80)
}

/**
 * Lottie 动画元数据
 */
export interface LottieMetadata {
  duration: number;      // 动画时长(秒)
  fps: number;          // 原始帧率
  width: number;        // 原始宽度
  height: number;       // 原始高度
  name?: string;        // 动画名称
}

/**
 * 渲染结果
 */
export interface RenderResult {
  success: boolean;
  videoPath?: string;
  error?: string;
  duration: number;     // 渲染耗时(毫秒)
  metadata?: LottieMetadata;
}

/**
 * Lottie JSON 基础结构
 */
export interface LottieJSON {
  v: string;           // Lottie 版本
  fr: number;          // 帧率
  ip: number;          // 起始帧
  op: number;          // 结束帧
  w: number;           // 宽度
  h: number;           // 高度
  nm?: string;         // 名称
  assets?: any[];      // 资源
  layers?: any[];      // 图层
  [key: string]: any;  // 其他属性
}
