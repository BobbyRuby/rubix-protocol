/**
 * ProfilerManager
 *
 * CPU profiling for finding performance bottlenecks.
 * Uses V8 profiler for detailed function-level timing.
 */

import * as path from 'path';

import type { ProfilerConfig } from '../types.js';
import type {
  ProfileResult,
  ProfileFunction,
  ProfileNode as OutputProfileNode,
  HotspotResult
} from '../types.js';
import type {
  CPUProfile,
  ProfileNode,
  ProfileOptions,
  FunctionMetrics
} from './types.js';

/**
 * ProfilerManager - CPU profiling operations
 */
export class ProfilerManager {
  private projectRoot: string;
  private config: ProfilerConfig;
  private profiler: unknown = null;
  private isRunning: boolean = false;
  private startTime: number = 0;
  private lastProfile: ProfileResult | null = null;

  constructor(projectRoot: string, config: ProfilerConfig) {
    this.projectRoot = projectRoot;
    this.config = config;
  }

  /**
   * Initialize profiler
   */
  async initialize(): Promise<void> {
    try {
      // Dynamic import to handle native module
      const v8Profiler = await import('v8-profiler-next');
      this.profiler = v8Profiler.default ?? v8Profiler;
    } catch (error) {
      console.warn('V8 profiler not available:', error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Shutdown profiler
   */
  async shutdown(): Promise<void> {
    if (this.isRunning) {
      await this.stop();
    }
    this.profiler = null;
  }

  /**
   * Start CPU profiling
   */
  async start(options?: ProfileOptions): Promise<void> {
    if (this.isRunning) {
      throw new Error('Profiling already in progress');
    }

    if (!this.profiler) {
      await this.initialize();
    }

    if (!this.profiler) {
      throw new Error('V8 profiler not available');
    }

    const profilerAny = this.profiler as {
      setSamplingInterval: (interval: number) => void;
      startProfiling: (name: string, record: boolean) => void;
    };

    const samplingInterval = options?.samplingInterval ?? this.config.samplingInterval ?? 1000;
    profilerAny.setSamplingInterval(samplingInterval);

    this.startTime = Date.now();
    profilerAny.startProfiling('cpu-profile', true);
    this.isRunning = true;

    // Auto-stop if duration specified
    if (options?.duration) {
      setTimeout(() => {
        if (this.isRunning) {
          this.stop().catch(() => {});
        }
      }, options.duration);
    }
  }

  /**
   * Stop CPU profiling and get results
   */
  async stop(): Promise<ProfileResult> {
    if (!this.isRunning) {
      throw new Error('Profiling not in progress');
    }

    if (!this.profiler) {
      throw new Error('V8 profiler not available');
    }

    const profilerAny = this.profiler as {
      stopProfiling: (name: string) => {
        export: () => CPUProfile;
        delete: () => void;
      };
    };

    const profile = profilerAny.stopProfiling('cpu-profile');
    this.isRunning = false;

    const duration = Date.now() - this.startTime;
    const cpuProfile = profile.export();

    // Process the profile
    const result = this.processProfile(cpuProfile, duration);
    this.lastProfile = result;

    // Clean up
    profile.delete();

    return result;
  }

  /**
   * Find performance hotspots
   */
  async findHotspots(): Promise<HotspotResult> {
    if (!this.lastProfile) {
      throw new Error('No profile available. Run start() and stop() first.');
    }

    const hotspots: HotspotResult['hotspots'] = [];

    // Get top 10 functions by self time
    const topFunctions = [...this.lastProfile.topFunctions]
      .sort((a, b) => b.selfTime - a.selfTime)
      .slice(0, 10);

    for (const func of topFunctions) {
      const suggestion = this.generateOptimizationSuggestion(func);

      hotspots.push({
        function: func.name,
        file: func.file,
        line: func.line,
        percentage: func.percentage,
        suggestion
      });
    }

    // Generate summary
    const summary = this.generateSummary(hotspots);

    return { hotspots, summary };
  }

  /**
   * Get profiling status
   */
  isProfileRunning(): boolean {
    return this.isRunning;
  }

  /**
   * Run profiling on a specific file/function
   */
  async profileScript(script: string, duration: number = 5000): Promise<ProfileResult> {
    const { spawn } = await import('child_process');

    const scriptPath = path.isAbsolute(script)
      ? script
      : path.join(this.projectRoot, script);

    return new Promise((resolve, reject) => {
      // Run the script with profiling enabled
      const child = spawn('node', [
        '--prof',
        scriptPath
      ], {
        cwd: this.projectRoot
      });

      const timeout = setTimeout(() => {
        child.kill();
      }, duration);

      child.on('close', () => {
        clearTimeout(timeout);

        // Return a basic profile result
        // Full V8 log processing would require additional tooling
        resolve({
          duration,
          samples: 0,
          topFunctions: [],
          callTree: {
            name: 'root',
            file: '',
            line: 0,
            selfTime: 0,
            totalTime: duration,
            children: []
          }
        });
      });

      child.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
  }

  // ===========================================================================
  // Private helpers
  // ===========================================================================

  private processProfile(cpuProfile: CPUProfile, duration: number): ProfileResult {
    const nodeMap = new Map<number, ProfileNode>();
    const metrics = new Map<string, FunctionMetrics>();

    // Build node map
    for (const node of cpuProfile.nodes) {
      nodeMap.set(node.id, node);
    }

    // Calculate times
    const totalSamples = cpuProfile.samples.length;
    const sampleDuration = duration / totalSamples;

    for (const sampleId of cpuProfile.samples) {
      const node = nodeMap.get(sampleId);
      if (!node) continue;

      const key = `${node.callFrame.url}:${node.callFrame.lineNumber}:${node.callFrame.functionName}`;

      if (!metrics.has(key)) {
        metrics.set(key, {
          functionName: node.callFrame.functionName || '(anonymous)',
          file: node.callFrame.url,
          line: node.callFrame.lineNumber + 1,
          selfTime: 0,
          totalTime: 0,
          hitCount: 0,
          percentage: 0
        });
      }

      const metric = metrics.get(key)!;
      metric.selfTime += sampleDuration;
      metric.hitCount++;
    }

    // Calculate percentages
    for (const metric of metrics.values()) {
      metric.percentage = (metric.selfTime / duration) * 100;
    }

    // Sort and get top functions
    const topFunctions: ProfileFunction[] = [...metrics.values()]
      .sort((a, b) => b.selfTime - a.selfTime)
      .slice(0, 20)
      .map(m => ({
        name: m.functionName,
        file: m.file ? path.relative(this.projectRoot, m.file) : '',
        line: m.line,
        selfTime: m.selfTime,
        totalTime: m.totalTime,
        callCount: m.hitCount,
        percentage: m.percentage
      }));

    // Build call tree
    const callTree = this.buildCallTree(cpuProfile, nodeMap, duration);

    return {
      duration,
      samples: totalSamples,
      topFunctions,
      callTree
    };
  }

  private buildCallTree(
    cpuProfile: CPUProfile,
    nodeMap: Map<number, ProfileNode>,
    duration: number
  ): OutputProfileNode {
    const root = nodeMap.get(cpuProfile.nodes[0]?.id ?? 0);

    if (!root) {
      return {
        name: 'root',
        file: '',
        line: 0,
        selfTime: 0,
        totalTime: duration,
        children: []
      };
    }

    const buildNode = (node: ProfileNode, depth: number): OutputProfileNode => {
      if (depth > 50) {
        return {
          name: '...',
          file: '',
          line: 0,
          selfTime: 0,
          totalTime: 0,
          children: []
        };
      }

      const children = node.children
        .map(id => nodeMap.get(id))
        .filter((n): n is ProfileNode => !!n)
        .map(n => buildNode(n, depth + 1));

      const selfTime = (node.hitCount ?? 0) * (duration / cpuProfile.samples.length);
      const childTime = children.reduce((sum, c) => sum + c.totalTime, 0);

      return {
        name: node.callFrame.functionName || '(anonymous)',
        file: node.callFrame.url ? path.relative(this.projectRoot, node.callFrame.url) : '',
        line: node.callFrame.lineNumber + 1,
        selfTime,
        totalTime: selfTime + childTime,
        children
      };
    };

    return buildNode(root, 0);
  }

  private generateOptimizationSuggestion(func: ProfileFunction): string | undefined {
    // Generate suggestions based on function characteristics
    if (func.percentage > 50) {
      return 'Critical hotspot - consider algorithmic optimization';
    }

    if (func.percentage > 20) {
      return 'Major contributor - consider caching or memoization';
    }

    if (func.name.includes('loop') || func.name.includes('forEach') || func.name.includes('map')) {
      return 'Loop operation - consider reducing iterations or using more efficient data structures';
    }

    if (func.name.includes('JSON') || func.name.includes('parse') || func.name.includes('stringify')) {
      return 'Serialization overhead - consider streaming or partial parsing';
    }

    if (func.name.includes('regex') || func.name.includes('match') || func.name.includes('replace')) {
      return 'Regex operation - consider caching compiled regex or using simpler string methods';
    }

    if (func.percentage > 5) {
      return 'Notable time spent - review for optimization opportunities';
    }

    return undefined;
  }

  private generateSummary(hotspots: HotspotResult['hotspots']): string {
    if (hotspots.length === 0) {
      return 'No significant hotspots detected.';
    }

    const topHotspot = hotspots[0];
    const totalHotspotTime = hotspots.reduce((sum, h) => sum + h.percentage, 0);

    if (topHotspot.percentage > 50) {
      return `Critical: ${topHotspot.function} consumes ${topHotspot.percentage.toFixed(1)}% of execution time. Focus optimization efforts here.`;
    }

    if (totalHotspotTime > 80) {
      return `Top ${hotspots.length} functions account for ${totalHotspotTime.toFixed(1)}% of execution. Well-distributed workload.`;
    }

    return `Found ${hotspots.length} hotspots. Top function: ${topHotspot.function} at ${topHotspot.percentage.toFixed(1)}%.`;
  }
}

export default ProfilerManager;
