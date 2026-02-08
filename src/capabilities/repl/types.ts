/**
 * REPL/Debug Types
 *
 * Type definitions specific to runtime debugging.
 */

export interface InspectorSession {
  id: string;
  pid: number;
  url: string;
  connected: boolean;
}

export interface BreakpointInfo {
  id: string;
  file: string;
  line: number;
  column?: number;
  condition?: string;
  enabled: boolean;
  hitCount: number;
}

export interface CallFrame {
  callFrameId: string;
  functionName: string;
  location: {
    scriptId: string;
    lineNumber: number;
    columnNumber: number;
  };
  url: string;
  scopeChain: Scope[];
  this: RemoteObject;
}

export interface Scope {
  type: 'global' | 'local' | 'with' | 'closure' | 'catch' | 'block' | 'script' | 'eval' | 'module' | 'wasm-expression-stack';
  object: RemoteObject;
  name?: string;
}

export interface RemoteObject {
  type: string;
  subtype?: string;
  className?: string;
  value?: unknown;
  description?: string;
  objectId?: string;
}

export interface DebuggerPausedEvent {
  callFrames: CallFrame[];
  reason: 'breakpoint' | 'exception' | 'step' | 'other';
  hitBreakpoints?: string[];
  data?: unknown;
}

export interface StepAction {
  type: 'into' | 'over' | 'out' | 'continue';
}
