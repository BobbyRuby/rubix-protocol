/**
 * REPLManager
 *
 * Runtime debugging using Node.js Inspector protocol.
 * Provides breakpoints, variable inspection, and code evaluation.
 */

import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import WebSocket from 'ws';

import type { REPLConfig } from '../types.js';
import type {
  DebugSession,
  Breakpoint,
  VariableInspection,
  StackFrame,
  EvalResult
} from '../types.js';
import type {
  InspectorSession,
  BreakpointInfo,
  CallFrame,
  RemoteObject,
  DebuggerPausedEvent,
  StepAction
} from './types.js';

/**
 * REPLManager - Runtime debugging operations
 */
export class REPLManager {
  private projectRoot: string;
  private config: REPLConfig;
  private sessions: Map<string, {
    process: ChildProcess;
    ws: WebSocket;
    session: InspectorSession;
    breakpoints: Map<string, BreakpointInfo>;
    paused: boolean;
    callFrames: CallFrame[];
  }> = new Map();
  private messageId: number = 1;
  private pendingMessages: Map<number, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }> = new Map();

  constructor(projectRoot: string, config: REPLConfig) {
    this.projectRoot = projectRoot;
    this.config = config;
  }

  /**
   * Shutdown all debug sessions
   */
  async shutdown(): Promise<void> {
    for (const [id] of this.sessions) {
      await this.stopSession(id);
    }
  }

  /**
   * Start a debug session
   */
  async startSession(script: string): Promise<DebugSession> {
    const port = this.config.port ?? 9229;
    const scriptPath = path.isAbsolute(script)
      ? script
      : path.join(this.projectRoot, script);

    // Start Node.js with inspector
    const nodeProcess = spawn('node', [
      `--inspect-brk=${port}`,
      scriptPath
    ], {
      cwd: this.projectRoot,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    // Wait for inspector to be ready
    await this.waitForInspector(nodeProcess, port);

    // Connect to inspector
    const ws = await this.connectToInspector(port);

    const sessionId = `session-${Date.now()}`;
    const session: InspectorSession = {
      id: sessionId,
      pid: nodeProcess.pid ?? 0,
      url: `ws://127.0.0.1:${port}`,
      connected: true
    };

    this.sessions.set(sessionId, {
      process: nodeProcess,
      ws,
      session,
      breakpoints: new Map(),
      paused: true, // Starts paused due to --inspect-brk
      callFrames: []
    });

    // Enable debugger
    await this.sendCommand(ws, 'Debugger.enable');
    await this.sendCommand(ws, 'Runtime.enable');

    // Set up event handlers
    this.setupEventHandlers(sessionId, ws);

    return {
      id: sessionId,
      script: path.relative(this.projectRoot, scriptPath),
      status: 'paused',
      currentLocation: undefined
    };
  }

  /**
   * Stop a debug session
   */
  async stopSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    try {
      session.ws.close();
      session.process.kill();
    } catch {
      // Ignore errors during cleanup
    }

    this.sessions.delete(sessionId);
  }

  /**
   * Set a breakpoint
   */
  async setBreakpoint(file: string, line: number, condition?: string): Promise<Breakpoint> {
    const session = this.getActiveSession();
    const filePath = path.isAbsolute(file)
      ? file
      : path.join(this.projectRoot, file);

    const result = await this.sendCommand(session.ws, 'Debugger.setBreakpointByUrl', {
      lineNumber: line - 1, // 0-indexed
      urlRegex: filePath.replace(/\\/g, '\\\\'),
      condition
    }) as { breakpointId: string };

    const breakpoint: BreakpointInfo = {
      id: result.breakpointId,
      file: path.relative(this.projectRoot, filePath),
      line,
      condition,
      enabled: true,
      hitCount: 0
    };

    session.breakpoints.set(result.breakpointId, breakpoint);

    return {
      id: result.breakpointId,
      file: breakpoint.file,
      line,
      condition,
      hitCount: 0,
      enabled: true
    };
  }

  /**
   * Remove a breakpoint
   */
  async removeBreakpoint(breakpointId: string): Promise<void> {
    const session = this.getActiveSession();

    await this.sendCommand(session.ws, 'Debugger.removeBreakpoint', {
      breakpointId
    });

    session.breakpoints.delete(breakpointId);
  }

  /**
   * Inspect a variable
   */
  async inspectVariable(name: string): Promise<VariableInspection> {
    const session = this.getActiveSession();

    if (!session.paused || session.callFrames.length === 0) {
      throw new Error('Debugger must be paused to inspect variables');
    }

    // Get the current call frame
    const frame = session.callFrames[0];

    // Search in scope chain
    for (const scope of frame.scopeChain) {
      try {
        const properties = await this.sendCommand(session.ws, 'Runtime.getProperties', {
          objectId: scope.object.objectId,
          ownProperties: true
        }) as { result: Array<{ name: string; value: RemoteObject }> };

        const prop = properties.result.find(p => p.name === name);
        if (prop) {
          return this.remoteObjectToInspection(name, prop.value, scope.type as 'local' | 'closure' | 'global');
        }
      } catch {
        // Continue searching
      }
    }

    throw new Error(`Variable '${name}' not found in scope`);
  }

  /**
   * Evaluate an expression
   */
  async eval(expression: string): Promise<EvalResult> {
    const session = this.getActiveSession();

    try {
      let result: { result: RemoteObject; exceptionDetails?: { text: string } };

      if (session.paused && session.callFrames.length > 0) {
        // Evaluate in current call frame context
        result = await this.sendCommand(session.ws, 'Debugger.evaluateOnCallFrame', {
          callFrameId: session.callFrames[0].callFrameId,
          expression,
          returnByValue: true
        }) as typeof result;
      } else {
        // Evaluate in global context
        result = await this.sendCommand(session.ws, 'Runtime.evaluate', {
          expression,
          returnByValue: true
        }) as typeof result;
      }

      if (result.exceptionDetails) {
        return {
          expression,
          result: undefined,
          type: 'error',
          error: result.exceptionDetails.text
        };
      }

      return {
        expression,
        result: result.result.value,
        type: result.result.type
      };
    } catch (error) {
      return {
        expression,
        result: undefined,
        type: 'error',
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Step through code
   */
  async step(action: StepAction['type']): Promise<void> {
    const session = this.getActiveSession();

    if (!session.paused) {
      throw new Error('Debugger is not paused');
    }

    switch (action) {
      case 'into':
        await this.sendCommand(session.ws, 'Debugger.stepInto');
        break;
      case 'over':
        await this.sendCommand(session.ws, 'Debugger.stepOver');
        break;
      case 'out':
        await this.sendCommand(session.ws, 'Debugger.stepOut');
        break;
      case 'continue':
        await this.sendCommand(session.ws, 'Debugger.resume');
        break;
    }
  }

  /**
   * Get current stack frames
   */
  getStackFrames(): StackFrame[] {
    const session = this.getActiveSession();

    return session.callFrames.map((frame, index) => ({
      id: index,
      name: frame.functionName || '(anonymous)',
      file: frame.url,
      line: frame.location.lineNumber + 1,
      column: frame.location.columnNumber + 1,
      isNative: frame.url.startsWith('node:')
    }));
  }

  /**
   * Get session status
   */
  getSessionStatus(sessionId: string): DebugSession | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    let currentLocation: DebugSession['currentLocation'];
    if (session.paused && session.callFrames.length > 0) {
      const frame = session.callFrames[0];
      currentLocation = {
        file: frame.url,
        line: frame.location.lineNumber + 1,
        column: frame.location.columnNumber + 1
      };
    }

    return {
      id: sessionId,
      script: '',
      status: session.paused ? 'paused' : 'running',
      currentLocation
    };
  }

  // ===========================================================================
  // Private helpers
  // ===========================================================================

  private getActiveSession() {
    const session = this.sessions.values().next().value;
    if (!session) {
      throw new Error('No active debug session');
    }
    return session;
  }

  private async waitForInspector(process: ChildProcess, _port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timeout waiting for inspector'));
      }, 10000);

      process.stderr?.on('data', (data: Buffer) => {
        const message = data.toString();
        if (message.includes('Debugger listening')) {
          clearTimeout(timeout);
          resolve();
        }
      });

      process.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });

      process.on('exit', (code) => {
        clearTimeout(timeout);
        reject(new Error(`Process exited with code ${code}`));
      });
    });
  }

  private async connectToInspector(port: number): Promise<WebSocket> {
    // Get websocket URL from inspector
    const response = await fetch(`http://127.0.0.1:${port}/json`);
    const info = await response.json() as Array<{ webSocketDebuggerUrl: string }>;

    if (!info[0]?.webSocketDebuggerUrl) {
      throw new Error('Could not get WebSocket URL from inspector');
    }

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(info[0].webSocketDebuggerUrl);

      ws.on('open', () => resolve(ws));
      ws.on('error', reject);

      ws.on('message', (data: Buffer) => {
        const message = JSON.parse(data.toString());

        if (message.id && this.pendingMessages.has(message.id)) {
          const pending = this.pendingMessages.get(message.id)!;
          this.pendingMessages.delete(message.id);

          if (message.error) {
            pending.reject(new Error(message.error.message));
          } else {
            pending.resolve(message.result);
          }
        }
      });
    });
  }

  private setupEventHandlers(sessionId: string, ws: WebSocket): void {
    ws.on('message', (data: Buffer) => {
      const message = JSON.parse(data.toString());

      if (message.method === 'Debugger.paused') {
        const session = this.sessions.get(sessionId);
        if (session) {
          const event = message.params as DebuggerPausedEvent;
          session.paused = true;
          session.callFrames = event.callFrames;
        }
      }

      if (message.method === 'Debugger.resumed') {
        const session = this.sessions.get(sessionId);
        if (session) {
          session.paused = false;
          session.callFrames = [];
        }
      }
    });
  }

  private async sendCommand(ws: WebSocket, method: string, params?: unknown): Promise<unknown> {
    const id = this.messageId++;

    return new Promise((resolve, reject) => {
      this.pendingMessages.set(id, { resolve, reject });

      ws.send(JSON.stringify({ id, method, params }));

      // Timeout after 30 seconds
      setTimeout(() => {
        if (this.pendingMessages.has(id)) {
          this.pendingMessages.delete(id);
          reject(new Error(`Command '${method}' timed out`));
        }
      }, 30000);
    });
  }

  private remoteObjectToInspection(
    name: string,
    obj: RemoteObject,
    scope: 'local' | 'closure' | 'global'
  ): VariableInspection {
    return {
      name,
      value: obj.value ?? obj.description,
      type: obj.subtype ?? obj.type,
      scope,
      properties: undefined // Would need additional calls for nested objects
    };
  }
}

export default REPLManager;
