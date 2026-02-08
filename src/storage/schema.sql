-- God Agent SQLite Schema
-- Core memory storage with provenance tracking

-- Memory entries table
CREATE TABLE IF NOT EXISTS memory_entries (
    id TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'user_input',
    importance REAL DEFAULT 0.5,
    session_id TEXT,
    agent_id TEXT,
    context TEXT, -- JSON
    pending_embedding INTEGER DEFAULT 0, -- 1 = awaiting batch embedding
    q_value REAL DEFAULT 0.5, -- MemRL Q-value for retrieval ranking
    q_update_count INTEGER DEFAULT 0, -- Number of Q-value updates
    last_q_update TEXT, -- Timestamp of last Q-value update
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memory_source ON memory_entries(source);
CREATE INDEX IF NOT EXISTS idx_memory_session ON memory_entries(session_id);
CREATE INDEX IF NOT EXISTS idx_memory_created ON memory_entries(created_at);
CREATE INDEX IF NOT EXISTS idx_memory_importance ON memory_entries(importance);

-- Memory tags (many-to-many)
CREATE TABLE IF NOT EXISTS memory_tags (
    entry_id TEXT NOT NULL,
    tag TEXT NOT NULL,
    PRIMARY KEY (entry_id, tag),
    FOREIGN KEY (entry_id) REFERENCES memory_entries(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tags_tag ON memory_tags(tag);

-- Provenance information
CREATE TABLE IF NOT EXISTS provenance (
    entry_id TEXT PRIMARY KEY,
    lineage_depth INTEGER DEFAULT 0,
    confidence REAL DEFAULT 1.0,
    relevance REAL DEFAULT 1.0,
    l_score REAL,
    FOREIGN KEY (entry_id) REFERENCES memory_entries(id) ON DELETE CASCADE
);

-- Parent-child provenance links
CREATE TABLE IF NOT EXISTS provenance_links (
    child_id TEXT NOT NULL,
    parent_id TEXT NOT NULL,
    PRIMARY KEY (child_id, parent_id),
    FOREIGN KEY (child_id) REFERENCES memory_entries(id) ON DELETE CASCADE,
    FOREIGN KEY (parent_id) REFERENCES memory_entries(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_prov_child ON provenance_links(child_id);
CREATE INDEX IF NOT EXISTS idx_prov_parent ON provenance_links(parent_id);

-- Causal relations (hyperedges)
CREATE TABLE IF NOT EXISTS causal_relations (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL DEFAULT 'causes',
    strength REAL DEFAULT 0.8,
    metadata TEXT, -- JSON
    created_at TEXT NOT NULL,
    ttl INTEGER, -- Time-to-live in milliseconds (NULL = permanent)
    expires_at TEXT -- ISO timestamp when relation expires (NULL = never)
);

CREATE INDEX IF NOT EXISTS idx_causal_type ON causal_relations(type);
CREATE INDEX IF NOT EXISTS idx_causal_expires ON causal_relations(expires_at);

-- Causal sources (hyperedge sources)
CREATE TABLE IF NOT EXISTS causal_sources (
    relation_id TEXT NOT NULL,
    entry_id TEXT NOT NULL,
    PRIMARY KEY (relation_id, entry_id),
    FOREIGN KEY (relation_id) REFERENCES causal_relations(id) ON DELETE CASCADE,
    FOREIGN KEY (entry_id) REFERENCES memory_entries(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_causal_src_entry ON causal_sources(entry_id);

-- Causal targets (hyperedge targets)
CREATE TABLE IF NOT EXISTS causal_targets (
    relation_id TEXT NOT NULL,
    entry_id TEXT NOT NULL,
    PRIMARY KEY (relation_id, entry_id),
    FOREIGN KEY (relation_id) REFERENCES causal_relations(id) ON DELETE CASCADE,
    FOREIGN KEY (entry_id) REFERENCES memory_entries(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_causal_tgt_entry ON causal_targets(entry_id);

-- Pattern templates
CREATE TABLE IF NOT EXISTS pattern_templates (
    id TEXT PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    pattern TEXT NOT NULL,
    slots TEXT NOT NULL, -- JSON array
    priority INTEGER DEFAULT 0,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pattern_name ON pattern_templates(name);
CREATE INDEX IF NOT EXISTS idx_pattern_priority ON pattern_templates(priority DESC);

-- Pattern statistics for success tracking
CREATE TABLE IF NOT EXISTS pattern_stats (
    pattern_id TEXT PRIMARY KEY,
    use_count INTEGER DEFAULT 0,
    success_count INTEGER DEFAULT 0,
    last_used_at TEXT,
    FOREIGN KEY (pattern_id) REFERENCES pattern_templates(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_pattern_stats_success ON pattern_stats(success_count);
CREATE INDEX IF NOT EXISTS idx_pattern_stats_use ON pattern_stats(use_count);

-- Vector ID mappings (for HNSW index)
CREATE TABLE IF NOT EXISTS vector_mappings (
    entry_id TEXT PRIMARY KEY,
    label INTEGER UNIQUE NOT NULL,
    access_count INTEGER DEFAULT 0,
    last_accessed_at TEXT,
    compression_tier TEXT DEFAULT 'hot',
    FOREIGN KEY (entry_id) REFERENCES memory_entries(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_vector_label ON vector_mappings(label);
CREATE INDEX IF NOT EXISTS idx_vector_access ON vector_mappings(access_count DESC);
CREATE INDEX IF NOT EXISTS idx_vector_tier ON vector_mappings(compression_tier);

-- System metadata
CREATE TABLE IF NOT EXISTS system_metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- ==========================================
-- SCHEDULER TABLES (Phase 9)
-- ==========================================

-- Scheduled tasks
CREATE TABLE IF NOT EXISTS scheduled_tasks (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    prompt_template TEXT NOT NULL,
    trigger_type TEXT NOT NULL,
    trigger_config TEXT, -- JSON
    context_ids TEXT, -- JSON array of memory IDs
    context_query TEXT, -- Query to run for fresh context
    status TEXT DEFAULT 'pending',
    priority INTEGER DEFAULT 5,
    notify_on_complete INTEGER DEFAULT 0,
    notify_on_decision INTEGER DEFAULT 1,
    notify_on_failure INTEGER DEFAULT 1,
    created_at TEXT NOT NULL,
    last_run TEXT,
    next_run TEXT,
    run_count INTEGER DEFAULT 0,
    metadata TEXT -- JSON
);

CREATE INDEX IF NOT EXISTS idx_task_status ON scheduled_tasks(status);
CREATE INDEX IF NOT EXISTS idx_task_trigger ON scheduled_tasks(trigger_type);
CREATE INDEX IF NOT EXISTS idx_task_next_run ON scheduled_tasks(next_run);
CREATE INDEX IF NOT EXISTS idx_task_priority ON scheduled_tasks(priority DESC);

-- Task execution history
CREATE TABLE IF NOT EXISTS task_runs (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    started_at TEXT NOT NULL,
    completed_at TEXT,
    status TEXT NOT NULL,
    result_memory_id TEXT,
    error TEXT,
    decision_prompt TEXT,
    output TEXT,
    duration_ms INTEGER,
    FOREIGN KEY (task_id) REFERENCES scheduled_tasks(id) ON DELETE CASCADE,
    FOREIGN KEY (result_memory_id) REFERENCES memory_entries(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_run_task ON task_runs(task_id);
CREATE INDEX IF NOT EXISTS idx_run_status ON task_runs(status);
CREATE INDEX IF NOT EXISTS idx_run_started ON task_runs(started_at);

-- Event queue for event-based triggers
CREATE TABLE IF NOT EXISTS event_queue (
    id TEXT PRIMARY KEY,
    event TEXT NOT NULL,
    fired_at TEXT NOT NULL,
    payload TEXT, -- JSON
    consumed INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_event_name ON event_queue(event);
CREATE INDEX IF NOT EXISTS idx_event_consumed ON event_queue(consumed);
CREATE INDEX IF NOT EXISTS idx_event_fired ON event_queue(fired_at);

-- ==========================================
-- MEMRL TABLES (Q-value Learning)
-- ==========================================

-- Index for Q-value queries (on memory_entries)
CREATE INDEX IF NOT EXISTS idx_memory_q_value ON memory_entries(q_value DESC);

-- MemRL query tracking for feedback
CREATE TABLE IF NOT EXISTS memrl_queries (
    id TEXT PRIMARY KEY,
    query_text TEXT NOT NULL,
    entry_ids TEXT NOT NULL,      -- JSON array of entry IDs returned
    similarities TEXT NOT NULL,   -- JSON array of similarity scores
    q_values TEXT NOT NULL,       -- JSON array of Q-values at query time
    delta_used REAL NOT NULL,     -- Phase A threshold used
    lambda_used REAL NOT NULL,    -- Exploration/exploitation balance used
    has_feedback INTEGER DEFAULT 0,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memrl_queries_created ON memrl_queries(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_memrl_queries_feedback ON memrl_queries(has_feedback);

-- Feedback ratings for AutoRecall results
CREATE TABLE IF NOT EXISTS feedback_ratings (
    query_id TEXT PRIMARY KEY,
    score INTEGER NOT NULL,          -- 1-10 rating
    auto INTEGER DEFAULT 0,          -- 1 if auto-rated by Claude, 0 if human
    created_at TEXT NOT NULL,
    FOREIGN KEY (query_id) REFERENCES memrl_queries(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_feedback_ratings_auto ON feedback_ratings(auto);
CREATE INDEX IF NOT EXISTS idx_feedback_ratings_score ON feedback_ratings(score);

-- Disagreements between auto and human ratings for calibration learning
CREATE TABLE IF NOT EXISTS feedback_disagreements (
    id TEXT PRIMARY KEY,
    query_id TEXT NOT NULL,
    auto_score INTEGER NOT NULL,
    human_score INTEGER NOT NULL,
    context TEXT,                    -- JSON context about the query
    created_at TEXT NOT NULL,
    FOREIGN KEY (query_id) REFERENCES memrl_queries(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_disagreements_created ON feedback_disagreements(created_at DESC);
