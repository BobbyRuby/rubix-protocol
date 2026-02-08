/**
 * Profiler Types
 *
 * Type definitions specific to CPU profiling.
 */

export interface ProfileNode {
  id: number;
  callFrame: {
    functionName: string;
    scriptId: string;
    url: string;
    lineNumber: number;
    columnNumber: number;
  };
  hitCount: number;
  children: number[];
  positionTicks?: Array<{
    line: number;
    ticks: number;
  }>;
}

export interface CPUProfile {
  nodes: ProfileNode[];
  startTime: number;
  endTime: number;
  samples: number[];
  timeDeltas: number[];
}

export interface ProfileOptions {
  /** Sampling interval in microseconds */
  samplingInterval?: number;
  /** Duration in milliseconds (0 = until stopped) */
  duration?: number;
}

export interface FunctionMetrics {
  functionName: string;
  file: string;
  line: number;
  selfTime: number;
  totalTime: number;
  hitCount: number;
  percentage: number;
}
