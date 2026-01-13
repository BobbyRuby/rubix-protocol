import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

// Types for memory data
interface MemoryRecord {
  id: string;
  content: string;
  embedding: number[];
  timestamp: number;
  cluster?: number;
  metadata: Record<string, unknown>;
  importance: number;
  accessCount: number;
  lastAccessed: number;
}

interface ClusterInfo {
  id: number;
  centroid: number[];
  memberCount: number;
  label?: string;
}

interface MemoriesResponse {
  memories: MemoryRecord[];
  clusters: ClusterInfo[];
  stats: {
    total: number;
    clustered: number;
    unclustered: number;
    oldestTimestamp: number;
    newestTimestamp: number;
  };
}

// Mock MemoryEngine interface - replace with actual import when available
interface IMemoryEngine {
  getAllMemories(): Promise<MemoryRecord[]>;
  getClusters(): Promise<ClusterInfo[]>;
  search(query: string, limit?: number): Promise<MemoryRecord[]>;
}

// Attempt to load actual MemoryEngine, fallback to mock
async function loadMemoryEngine(): Promise<IMemoryEngine | null> {
  try {
    // Try to import the actual MemoryEngine from the codebase
    const memoryModule = await import('../core/MemoryEngine.js');
    if (memoryModule.MemoryEngine) {
      return new memoryModule.MemoryEngine() as unknown as IMemoryEngine;
    }
    return null;
  } catch {
    console.warn('[VisualizationServer] MemoryEngine not available, using mock data');
    return null;
  }
}

// Generate mock memory data for visualization testing
function generateMockMemories(count: number = 200): MemoryRecord[] {
  const memories: MemoryRecord[] = [];
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  
  const contentTemplates = [
    'Implemented feature: ',
    'Fixed bug in: ',
    'Refactored: ',
    'Added tests for: ',
    'Documentation update: ',
    'Performance optimization: ',
    'Security patch: ',
    'API endpoint: ',
    'Database migration: ',
    'Configuration change: ',
  ];
  
  const modules = [
    'TaskExecutor', 'MemoryEngine', 'TelegramBot', 'Scheduler',
    'CodeAnalyzer', 'GitManager', 'FileSystem', 'DatabasePool',
    'CommunicationManager', 'RuntimeContext', 'EmbeddingQueue',
    'ClusterManager', 'SearchIndex', 'CacheLayer', 'EventEmitter'
  ];

  for (let i = 0; i < count; i++) {
    // Generate 3D embedding (reduced from high-dim for visualization)
    // Use spherical distribution with some clustering
    const cluster = Math.floor(Math.random() * 8);
    const clusterCenter = [
      Math.cos(cluster * Math.PI / 4) * 3,
      Math.sin(cluster * Math.PI / 4) * 3,
      (cluster % 2 === 0 ? 1 : -1) * 2
    ];
    
    const embedding = [
      clusterCenter[0] + (Math.random() - 0.5) * 2,
      clusterCenter[1] + (Math.random() - 0.5) * 2,
      clusterCenter[2] + (Math.random() - 0.5) * 2
    ];

    const template = contentTemplates[Math.floor(Math.random() * contentTemplates.length)];
    const module = modules[Math.floor(Math.random() * modules.length)];
    
    memories.push({
      id: `mem_${i.toString(36).padStart(6, '0')}`,
      content: `${template}${module}`,
      embedding,
      timestamp: now - Math.floor(Math.random() * 30 * dayMs),
      cluster,
      metadata: {
        type: ['task', 'insight', 'error', 'success'][Math.floor(Math.random() * 4)],
        module,
        tags: ['dev', 'prod', 'test'][Math.floor(Math.random() * 3)]
      },
      importance: Math.random(),
      accessCount: Math.floor(Math.random() * 100),
      lastAccessed: now - Math.floor(Math.random() * 7 * dayMs)
    });
  }
  
  return memories;
}

function generateMockClusters(): ClusterInfo[] {
  const clusters: ClusterInfo[] = [];
  const labels = [
    'Task Execution', 'Memory Operations', 'Communication',
    'File System', 'Database', 'Security', 'Performance', 'Testing'
  ];
  
  for (let i = 0; i < 8; i++) {
    clusters.push({
      id: i,
      centroid: [
        Math.cos(i * Math.PI / 4) * 3,
        Math.sin(i * Math.PI / 4) * 3,
        (i % 2 === 0 ? 1 : -1) * 2
      ],
      memberCount: 20 + Math.floor(Math.random() * 30),
      label: labels[i]
    });
  }
  
  return clusters;
}

// Create Express app
const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Middleware
app.use(express.json());

// CORS for development
app.use((_req: Request, res: Response, next: NextFunction) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Cache for memory data
let memoryCache: { data: MemoriesResponse; timestamp: number } | null = null;
const CACHE_TTL = 30000; // 30 seconds

// API: Get all memories with embeddings
app.get('/api/memories', async (_req: Request, res: Response) => {
  try {
    // Check cache
    if (memoryCache && Date.now() - memoryCache.timestamp < CACHE_TTL) {
      return res.json(memoryCache.data);
    }

    const memoryEngine = await loadMemoryEngine();
    
    let memories: MemoryRecord[];
    let clusters: ClusterInfo[];
    
    if (memoryEngine) {
      // Use actual MemoryEngine
      memories = await memoryEngine.getAllMemories();
      clusters = await memoryEngine.getClusters();
    } else {
      // Use mock data
      memories = generateMockMemories(200);
      clusters = generateMockClusters();
    }

    // Calculate stats
    const timestamps = memories.map(m => m.timestamp);
    const clusteredCount = memories.filter(m => m.cluster !== undefined).length;
    
    const response: MemoriesResponse = {
      memories,
      clusters,
      stats: {
        total: memories.length,
        clustered: clusteredCount,
        unclustered: memories.length - clusteredCount,
        oldestTimestamp: Math.min(...timestamps),
        newestTimestamp: Math.max(...timestamps)
      }
    };

    // Update cache
    memoryCache = { data: response, timestamp: Date.now() };
    
    return res.json(response);
  } catch (error) {
    console.error('[VisualizationServer] Error fetching memories:', error);
    return res.status(500).json({ 
      error: 'Failed to fetch memories',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// API: Search memories
app.get('/api/memories/search', async (req: Request, res: Response) => {
  try {
    const query = req.query.q as string;
    const limit = parseInt(req.query.limit as string) || 50;
    
    if (!query) {
      return res.status(400).json({ error: 'Query parameter "q" is required' });
    }

    const memoryEngine = await loadMemoryEngine();
    
    let results: MemoryRecord[];
    
    if (memoryEngine) {
      results = await memoryEngine.search(query, limit);
    } else {
      // Mock search - filter by content
      const allMemories = generateMockMemories(200);
      const lowerQuery = query.toLowerCase();
      results = allMemories
        .filter(m => m.content.toLowerCase().includes(lowerQuery))
        .slice(0, limit);
    }

    return res.json({ results, query, count: results.length });
  } catch (error) {
    console.error('[VisualizationServer] Search error:', error);
    return res.status(500).json({ error: 'Search failed' });
  }
});

// API: Get single memory by ID
app.get('/api/memories/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    
    // For now, search in cached data or generate
    const data = memoryCache?.data ?? { 
      memories: generateMockMemories(200),
      clusters: generateMockClusters(),
      stats: { total: 200, clustered: 200, unclustered: 0, oldestTimestamp: 0, newestTimestamp: Date.now() }
    };
    
    const memory = data.memories.find(m => m.id === id);
    
    if (!memory) {
      return res.status(404).json({ error: 'Memory not found' });
    }

    return res.json(memory);
  } catch (error) {
    console.error('[VisualizationServer] Error fetching memory:', error);
    return res.status(500).json({ error: 'Failed to fetch memory' });
  }
});

// API: Get cluster details
app.get('/api/clusters/:id', async (req: Request, res: Response) => {
  try {
    const clusterId = parseInt(String(req.params.id));
    
    const data = memoryCache?.data ?? {
      memories: generateMockMemories(200),
      clusters: generateMockClusters(),
      stats: { total: 200, clustered: 200, unclustered: 0, oldestTimestamp: 0, newestTimestamp: Date.now() }
    };
    
    const cluster = data.clusters.find(c => c.id === clusterId);
    const members = data.memories.filter(m => m.cluster === clusterId);
    
    if (!cluster) {
      return res.status(404).json({ error: 'Cluster not found' });
    }

    return res.json({ cluster, members, memberCount: members.length });
  } catch (error) {
    console.error('[VisualizationServer] Error fetching cluster:', error);
    return res.status(500).json({ error: 'Failed to fetch cluster' });
  }
});

// API: Health check
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ 
    status: 'healthy',
    timestamp: Date.now(),
    service: 'rubix-memory-visualization'
  });
});

// Fallback to index.html for SPA routing
app.get('*', (_req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
const PORT = parseInt(process.env.VISUALIZATION_PORT ?? '3847');

export function startVisualizationServer(port: number = PORT): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const server = app.listen(port, () => {
        console.log(`[VisualizationServer] Memory visualization running at http://localhost:${port}`);
        resolve();
      });
      
      server.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          console.warn(`[VisualizationServer] Port ${port} in use, trying ${port + 1}`);
          startVisualizationServer(port + 1).then(resolve).catch(reject);
        } else {
          reject(err);
        }
      });
    } catch (error) {
      reject(error);
    }
  });
}

// Direct execution
if (import.meta.url === `file://${process.argv[1]}`) {
  startVisualizationServer().catch(console.error);
}

export { app, MemoryRecord, ClusterInfo, MemoriesResponse };